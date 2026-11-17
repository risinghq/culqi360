import {
  cleanupTestDb,
  createIsolatedTestDb,
  resetTestDb,
  type TestDbContext,
} from "@tests/support/runtime/db";
import { safeappSnapshot } from "@tests/support/safeapp";
import { randomUUIDv7 } from "bun";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { WorkspaceId } from "~/domain/ids";
import { verifyPassword } from "~/server/auth/password/password";
import { createCampaignsRepo } from "~/server/campaigns/infrastructure/campaigns-repo";
import { createCasesRepo } from "~/server/cases/infrastructure/cases-repo";
import { loadSafeappCutover } from "~/server/cutover/safeapp/load";
import { planSafeappCutover } from "~/server/cutover/safeapp/transform";
import {
  runAsPlatform,
  runInWorkspace,
} from "~/server/platform/database/workspace-scope";

const AT = new Date("2026-11-16T15:00:00.000Z");

describe("safeapp cutover load", () => {
  let ctx: TestDbContext;

  beforeAll(async () => {
    ctx = await createIsolatedTestDb("safeapp-cutover");
  });

  afterAll(async () => {
    await cleanupTestDb(ctx);
  });

  beforeEach(async () => {
    await resetTestDb(ctx);
  });

  function cutover(workspaceName = "Entel") {
    const plan = planSafeappCutover({
      snapshot: safeappSnapshot(),
      newId: randomUUIDv7,
      at: AT,
    });
    const workspaceId = WorkspaceId.trust(randomUUIDv7());
    return {
      plan,
      workspaceId,
      done: loadSafeappCutover(ctx.db, {
        plan,
        workspaceId,
        workspaceName,
        at: AT,
      }),
    };
  }

  it("writes the plan into a new workspace the stage queues can read", async () => {
    const { plan, workspaceId, done } = cutover();
    await done;

    const counts = await runInWorkspace(workspaceId, async () => ({
      branches: await ctx.db.selectFrom("branches").select("id").execute(),
      users: await ctx.db
        .selectFrom("users")
        .select(["password_hash", "password_change_required"])
        .execute(),
      organizations: await ctx.db
        .selectFrom("organizations")
        .select("id")
        .execute(),
      cases: await ctx.db.selectFrom("cases").select("id").execute(),
      states: await ctx.db
        .selectFrom("case_stage_states")
        .select("status")
        .execute(),
    }));
    expect(counts.branches).toHaveLength(plan.branches.length);
    expect(counts.organizations).toHaveLength(plan.organizations.length);
    expect(counts.cases).toHaveLength(3);
    expect(counts.states).toHaveLength(4 + 3 + 2);
    expect(counts.users).toHaveLength(plan.users.length);
    for (const user of counts.users) {
      expect(user.password_change_required).toBe(true);
      // eslint-disable-next-line no-await-in-loop
      expect(await verifyPassword(user.password_hash, "")).toBe(false);
    }

    const movil = plan.cases.find((each) => each.caseTypeKey === "nc_movil");
    if (!movil) {
      throw new Error("the plan holds the mobile order");
    }
    const stored = await runInWorkspace(workspaceId, () =>
      createCasesRepo(ctx.db).findCase(movil.id),
    );
    expect(stored?.progress.statuses).toEqual({
      registro: "REGISTRADO",
      validacion: "PROCEDE",
      back: "ACTIVADO",
      liquidacion: "LIQUIDADO",
    });
    expect(stored?.progress.values).toMatchObject({ q_lineas: 5 });
  });

  it("writes campaigns whose open records an agent still holds", async () => {
    const { plan, workspaceId, done } = cutover();
    await done;

    const stored = await runInWorkspace(workspaceId, async () => ({
      campaigns: await ctx.db.selectFrom("campaigns").select("id").execute(),
      records: await ctx.db
        .selectFrom("campaign_records")
        .select("id")
        .execute(),
      holds: await ctx.db
        .selectFrom("campaign_holds")
        .select("released_at")
        .execute(),
      calls: await ctx.db.selectFrom("calls").select("source").execute(),
    }));
    expect(stored.campaigns).toHaveLength(2);
    expect(stored.records).toHaveLength(3);
    expect(
      stored.holds.filter((each) => each.released_at === null),
    ).toHaveLength(2);
    expect(stored.calls.map((each) => each.source)).toEqual([
      "import",
      "import",
    ]);

    const movil = plan.campaigns.find((each) => each.name === "MOVIL");
    const validador = plan.users.find(
      (each) => each.username === "validador.demo",
    );
    if (!movil || !validador) {
      throw new Error("the plan holds the MOVIL campaign and the validador");
    }
    const held = await runInWorkspace(workspaceId, () =>
      createCampaignsRepo(ctx.db).findHeld(movil.id, validador.id),
    );
    expect(held).toEqual([
      expect.objectContaining({
        ruc: "20999999002",
        segment: "BASE NOVIEMBRE",
      }),
    ]);
  });

  it("refuses a second run and writes nothing for it", async () => {
    await cutover().done;
    await expect(cutover("Entel 2").done).rejects.toThrow(
      "cutover_user_exists",
    );
    await expect(cutover("Entel").done).rejects.toThrow(
      "cutover_workspace_exists",
    );
    const workspaces = await runAsPlatform(() =>
      ctx.db.selectFrom("workspaces").select("name").execute(),
    );
    expect(
      workspaces.filter((row) => row.name.startsWith("Entel")),
    ).toHaveLength(1);
  });
});
