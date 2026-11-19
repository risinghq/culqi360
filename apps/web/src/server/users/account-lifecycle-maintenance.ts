import { shortName } from "~/domain/identity/display-name";
import { formatAppLongDate } from "~/domain/time/app-time";
import { addMilliseconds } from "~/domain/time/clock";
import type { MessagingGateway } from "~/server/notifications/channels/messaging-gateway";
import type { OperationContext } from "~/server/platform/operation/context";
import type { Duty } from "~/server/platform/schedule/schedule";
import { PLATFORM_NAME } from "~/shared/branding";
import { createLogger } from "~/shared/observability/runtime-logger";

import { type ExpireMembersDeps, expireMembers } from "./expire-users";
import type { MembersRepo } from "./repos-members";

const logger = createLogger("account-lifecycle-maintenance");
const EXPIRY_NOTIFICATION_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

interface AccountLifecycleDeps extends ExpireMembersDeps {
  members: MembersRepo;
  messaging: MessagingGateway;
}

async function runAccountExpiry(
  deps: AccountLifecycleDeps,
  context: OperationContext,
) {
  const expiredCount = await expireMembers(context.operationAt, deps);
  if (expiredCount > 0) {
    logger.info("accounts_expired", { count: expiredCount });
  }
}

async function runExpiryNotification(
  users: MembersRepo,
  messaging: MessagingGateway,
  context: OperationContext,
) {
  const sweptAt = context.operationAt;
  const threshold = addMilliseconds(sweptAt, EXPIRY_NOTIFICATION_THRESHOLD_MS);
  const expiringUsers = await users.findExpiringBefore(threshold);
  const outcomes = await Promise.all(
    expiringUsers.map(async (user) => {
      try {
        const claimed = await users.claimExpiryReminder(
          user.user_id,
          threshold,
          sweptAt,
        );
        if (!claimed || user.expires_at == null) {
          return false;
        }

        const sent = await messaging.sendAccountExpiringEmail({
          to: user.email,
          params: {
            fullName: shortName(user),
            username: user.username,
            expiresAt: formatAppLongDate(user.expires_at.getTime() - 1),
            platformName: PLATFORM_NAME,
          },
        });
        if (!sent.ok) {
          throw new Error(sent.error.message);
        }

        await users.markExpiryNotified(user.user_id, sweptAt);
        return true;
      } catch (error: unknown) {
        await users.releaseExpiryReminderClaim(user.user_id, sweptAt);
        logger.error("expiry_notification_send_failed", {
          userId: user.user_id,
          error: error instanceof Error ? error.message : "Unknown error",
        });
        return false;
      }
    }),
  );

  const sentCount = outcomes.filter(Boolean).length;

  if (sentCount > 0) {
    logger.info("expiry_notifications_sent", { count: sentCount });
  }
}

export function accountLifecycleDuties(deps: AccountLifecycleDeps): Duty[] {
  return [
    {
      name: "account-expiry",
      nextAt: () => deps.members.nextExpiryAt(),
      run: (context) => runAccountExpiry(deps, context),
    },
    {
      name: "expiry-notification",
      async nextAt() {
        const expiresAt = await deps.members.nextUnnotifiedExpiryAt();
        return (
          expiresAt &&
          addMilliseconds(expiresAt, -EXPIRY_NOTIFICATION_THRESHOLD_MS)
        );
      },
      run: (context) =>
        runExpiryNotification(deps.members, deps.messaging, context),
      // A failed send releases its claim, so the deadline stays past; retry
      // it hourly rather than on every alarm.
      spacingMs: 60 * 60_000,
    },
  ];
}
