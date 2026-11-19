import { operationAt } from "@tests/support/operation";

import {
  type BranchId,
  ContactHoldId,
  ContactId,
  PersonId,
  type UserId,
} from "~/domain/ids";
import type { CallTarget } from "~/server/calls/domain/call-target";
import { createCallsRuntime } from "~/server/calls/runtime";
import { extensionReposBinder } from "~/server/extension/runtime";
import { createExtensionService } from "~/server/extension/service";
import type { ExtensionRepos } from "~/server/extension/service/shared";
import { createFileStorage } from "~/server/files/storage";
import { type AppUow, createExecutorUow } from "~/server/platform/database/uow";

import { testWorkspaceInfrastructure } from "../runtime/app";
import { TEST_FIXTURES, type TestDbContext } from "../runtime/db";

/** The repos and unit of work the extension runtime builds in production. */
export function extensionRepos(ctx: TestDbContext): {
  repos: ExtensionRepos;
  uow: AppUow<ExtensionRepos>;
} {
  const bind = extensionReposBinder(
    ctx.platform,
    testWorkspaceInfrastructure(ctx),
  );
  return { repos: bind(ctx.db), uow: createExecutorUow(ctx.db, bind) };
}

/** A unit of work whose database fails before anything is written. */
export function rejectingUow(error: Error): AppUow<ExtensionRepos> {
  return {
    run: () => {
      throw error;
    },
  };
}

/** Commits the work, then fails, as a connection lost before the ack would. */
export function commitThenRejectUow(
  ctx: TestDbContext,
  error: Error,
): AppUow<ExtensionRepos> {
  const real = extensionRepos(ctx).uow;
  return {
    run: async (work) => {
      await real.run(work);
      throw error;
    },
  };
}

export function createExtensionScenario(
  ctx: TestDbContext,
  now: () => Date = () => new Date(),
) {
  const storage = createFileStorage(ctx.storageRoot);
  const { repos, uow } = extensionRepos(ctx);
  const service = createExtensionService(repos, { uow, storage });
  const calls = createCallsRuntime({
    executor: ctx.db,
    cases: {
      read: () => {
        throw new Error("extension scenarios call assignments, not cases");
      },
    },
  });

  return {
    service,
    storage,
    calls,
    async session(
      input: {
        userId?: UserId;
        branchId?: BranchId;
        sessionId?: string;
      } = {},
    ) {
      const authSessionId = input.sessionId ?? crypto.randomUUID();
      const currentTime = now();
      await ctx.repos.sessions.create({
        id: authSessionId,
        account_id: input.userId ?? TEST_FIXTURES.users.execOne.id,
        workspace_id: ctx.fixtures.workspace.id,
        impersonator_account_id: null,
        session_class: "app",
        primary_auth_method: "password",
        strong_auth_method: null,
        strong_auth_at: null,
        ip_address: "127.0.0.1",
        user_agent: "vitest",
        created_at: currentTime,
        last_activity: currentTime,
        expires_at: new Date(currentTime.getTime() + 60 * 60_000),
      });
      return authSessionId;
    },
    async contactHold(
      input: { userId?: UserId; contactId?: ContactId } = {},
    ): Promise<ContactHoldId> {
      const currentTime = now();
      const holdId = ContactHoldId.trust(crypto.randomUUID());
      await ctx.db
        .insertInto("contact_holds")
        .values({
          id: holdId,
          user_id: input.userId ?? TEST_FIXTURES.users.execOne.id,
          contact_id: input.contactId ?? TEST_FIXTURES.contacts.lima.id,
          held_at: currentTime,
          expires_at: new Date(currentTime.getTime() + 60 * 60_000),
          status: "active",
        })
        .executeTakeFirstOrThrow();
      return holdId;
    },
    async contactWithoutPhone(sequence: number) {
      const currentTime = now();
      const dni = `7999${sequence.toString().padStart(4, "0")}`;
      const person = await ctx.db
        .insertInto("people")
        .values({
          id: PersonId.mint(),
          dni,
          names: "Contacto sin telefono",
          first_surname: null,
          second_surname: null,
          email: null,
          created_at: currentTime,
          updated_at: currentTime,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const contact = await ctx.db
        .insertInto("contacts")
        .values({
          id: ContactId.mint(),
          person_id: person.id,
          organization_id: ctx.fixtures.organizations.lima.id,
          phone: null,
          email: null,
          created_at: currentTime,
          updated_at: currentTime,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      return contact.id;
    },
    /** Resolves a contact hold to the call target a handoff token carries. */
    async target(
      contactHoldId: ContactHoldId,
      user: { id: UserId; branchId: BranchId } = TEST_FIXTURES.users.execOne,
    ): Promise<CallTarget> {
      const target = await calls.resolveTarget(
        {
          userId: user.id,
          branchId: user.branchId,
          roleKey: "executive",
          viewAll: false,
        },
        { subject: { kind: "contact_hold", contactHoldId }, phone: null },
        now(),
      );
      if (!target.ok) {
        throw new Error(target.error.code ?? target.error.kind);
      }
      return target.value;
    },
    async handoff(executive: "execOne" | "execTwo" = "execOne") {
      const user = TEST_FIXTURES.users[executive];
      const contact =
        executive === "execOne"
          ? TEST_FIXTURES.contacts.lima
          : TEST_FIXTURES.contacts.norte;
      const authSessionId = await this.session({
        userId: user.id,
        branchId: user.branchId,
      });
      const holdId = await this.contactHold({
        userId: user.id,
        contactId: contact.id,
      });
      const handoffResult = await service.createHandoffToken(
        {
          userId: user.id,
          authSessionId,
          branchId: user.branchId,
          target: await this.target(holdId, user),
          origin: "http://localhost:3000",
        },
        operationAt(now()),
      );
      if (!handoffResult.ok) {
        throw new Error(handoffResult.error.code ?? handoffResult.error.kind);
      }
      return {
        authSessionId,
        holdId,
        handoffToken: handoffResult.value.handoffToken,
      };
    },
    async claim(
      installationId: string,
      executive: "execOne" | "execTwo" = "execOne",
    ) {
      const handoff = await this.handoff(executive);
      const claimResult = await service.claimInstallationSession(
        { handoffToken: handoff.handoffToken, installationId },
        operationAt(now()),
      );
      if (!claimResult.ok) {
        throw new Error(claimResult.error.code ?? claimResult.error.kind);
      }
      return {
        ...handoff,
        sessionToken: claimResult.value.sessionToken,
        callId: claimResult.value.callId,
      };
    },
  };
}
