import { describe, expect, test } from "vitest";

import { ContactId, OrganizationId, UserId } from "~/domain/ids";
import { canContactNow } from "~/server/contacts/domain/cooldown";
import { createHold } from "~/server/contacts/domain/hold";

import { BENCH_NOW } from "../_shared/constants";

const USER_ID = UserId.trust("bench-component-user");
const CONTACT_ID = ContactId.trust("bench-component-contact");
const ORGANIZATION_ID = OrganizationId.trust(
  "01974fd5-f261-7a7d-93f5-2f3d0f963001",
);

describe("contact hold component benchmark", () => {
  test("component path: build contact hold payload", async ({ bench }) => {
    const result =
      await bench("component path: build contact hold payload", () => {
        const hold = createHold(USER_ID, CONTACT_ID, BENCH_NOW);
        if (hold.user_id !== USER_ID || hold.contact_id !== CONTACT_ID) {
          throw new Error("unexpected hold payload");
        }
      }).run();
    expect(result.state).toBe("completed");
  });

  test("component path: evaluate contact cooldown rule", async ({ bench }) => {
    const result =
      await bench("component path: evaluate contact cooldown rule", () => {
        const contact = {
          id: CONTACT_ID,
          organization_id: ORGANIZATION_ID,
          dni: "70000001",
          name: "Bench",
          phone_primary: "911111111",
          phone_secondary: null,
          last_contacted_at: null,
          last_contacted_by_user_id: null,
          cooldown_until: new Date(BENCH_NOW.getTime() - 1),
          created_at: BENCH_NOW,
        };
        const canContact = canContactNow(contact, BENCH_NOW);
        if (!canContact) {
          throw new Error("expected contact to be outside cooldown window");
        }
      }).run();
    expect(result.state).toBe("completed");
  });
});
