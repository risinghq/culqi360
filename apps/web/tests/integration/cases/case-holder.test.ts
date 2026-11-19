import { operationAt } from "@tests/support/operation";
import { testWorkspaceInfrastructure } from "@tests/support/runtime/app";
import { createTestCasesRuntime } from "@tests/support/runtime/cases";
import {
  cleanupTestDb,
  createIsolatedTestDb,
  resetTestDb,
  TEST_FIXTURES,
  type TestDbContext,
} from "@tests/support/runtime/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { hydrateRuc } from "~/domain/identity/document";
import type { CaseId, UserId } from "~/domain/ids";
import type { CaseTypeDefinition } from "~/server/cases/domain/definition";
import { createFilesRuntime } from "~/server/files/runtime";

// A reservation the executive holds for two days unless it is won, with an
// optional proof file on the opening stage.
const RESERVA: CaseTypeDefinition = {
  key: "reserva",
  name: "Reserva",
  stages: [
    {
      key: "reserva",
      name: "Reserva",
      ownerRole: "executive",
      statuses: ["RESERVADO", "GANADO", "LIBERADO"],
      initialStatus: "RESERVADO",
      gate: null,
      timeout: { whileStatus: "RESERVADO", afterHours: 48, moveTo: "LIBERADO" },
    },
    {
      key: "cierre",
      name: "Cierre",
      ownerRole: "back_office",
      statuses: ["PENDIENTE", "CERRADO"],
      initialStatus: "PENDIENTE",
      gate: { stageKey: "reserva", statuses: ["GANADO"] },
    },
  ],
  fields: [
    {
      key: "constancia",
      stageKey: "reserva",
      label: "Constancia",
      kind: "file",
      choices: null,
      required: false,
    },
  ],
};

const EXEC_ONE = TEST_FIXTURES.users.execOne.id;
const EXEC_TWO = TEST_FIXTURES.users.execTwo.id;
const BACK_OFFICE = TEST_FIXTURES.users.backOne.id;
const MANAGER = TEST_FIXTURES.users.superUser.id;
const BRANCH = TEST_FIXTURES.branches.lima.id;
const OPENED_AT = new Date("2026-11-16T15:00:00.000Z");
const DUE_AT = new Date("2026-11-18T15:00:00.000Z");
const OPERATION = operationAt(OPENED_AT);
const PROOF = new TextEncoder().encode("ruc\n20100000001\n");

describe("case holder, timeouts and files", () => {
  let ctx: TestDbContext;
  let caseId: CaseId;
  let version: number;

  beforeAll(async () => {
    ctx = await createIsolatedTestDb("case-holder");
  });

  afterAll(async () => {
    await cleanupTestDb(ctx);
  });

  beforeEach(async () => {
    await resetTestDb(ctx);
    const defined = await runtime().defineCaseType(RESERVA, OPERATION);
    if (!defined.ok) {
      throw new Error(`the case type must define: ${defined.error.code}`);
    }
    const opened = await runtime().open(
      {
        actorUserId: EXEC_ONE,
        actorRoleKey: "executive",
        actorBranchId: BRANCH,
        caseTypeKey: RESERVA.key,
        ruc: hydrateRuc(TEST_FIXTURES.organizations.lima.ruc),
        values: {},
      },
      OPERATION,
    );
    if (!opened.ok) {
      throw new Error(`the case must open: ${opened.error.code}`);
    }
    caseId = opened.value.caseId;
    version = opened.value.version;
  });

  function runtime() {
    return createTestCasesRuntime(ctx);
  }

  function reassignTo(holderUserId: UserId, expectedVersion = version) {
    return runtime().reassign(
      { actorUserId: MANAGER, caseId, expectedVersion, holderUserId },
      OPERATION,
    );
  }

  async function reservaStatus() {
    const row = await ctx.db
      .selectFrom("case_stage_states")
      .select("status")
      .where("case_id", "=", caseId)
      .where("stage_key", "=", "reserva")
      .executeTakeFirstOrThrow();
    return row.status;
  }

  function uploadAs(userId: UserId) {
    return runtime().uploadFile(
      { actor: { userId }, operationAt: OPENED_AT },
      {
        name: "constancia.csv",
        sizeBytes: PROOF.byteLength,
        stream: new Blob([PROOF]).stream(),
      },
    );
  }

  function readAs(actorUserId: UserId) {
    return runtime().read({
      caseId,
      actorUserId,
      roleKey: "executive",
      branchId: BRANCH,
      viewAll: false,
      canReassign: false,
    });
  }

  function writeReserva(
    actorUserId: UserId,
    values: Record<string, unknown>,
    status?: string,
  ) {
    return runtime().writeStage(
      {
        actorUserId,
        actorRoleKey: "executive",
        actorBranchId: BRANCH,
        caseId,
        expectedVersion: version,
        stageKey: "reserva",
        values,
        ...(status ? { status } : {}),
      },
      OPERATION,
    );
  }

  async function eventKinds() {
    const read = await readAs(EXEC_ONE);
    if (!read.ok) {
      throw new Error(`the case must read: ${read.error.code}`);
    }
    return read.value.events.map((each) => each.kind);
  }

  describe("reassign", () => {
    it("hands the case and its opening stage to the new holder", async () => {
      const moved = await reassignTo(EXEC_TWO);
      if (!moved.ok) {
        throw new Error(`the case must reassign: ${moved.error.code}`);
      }
      version = moved.value.version;

      expect(
        await ctx.db
          .selectFrom("cases")
          .select("holder_user_id")
          .where("id", "=", caseId)
          .executeTakeFirstOrThrow(),
      ).toEqual({ holder_user_id: EXEC_TWO });
      expect(await readAs(EXEC_ONE)).toMatchObject({
        ok: false,
        error: { code: "case_not_found" },
      });
      expect(await writeReserva(EXEC_ONE, {}, "GANADO")).toMatchObject({
        ok: false,
        error: { code: "case_stage_not_owned" },
      });
      expect((await writeReserva(EXEC_TWO, {}, "GANADO")).ok).toBe(true);

      const read = await readAs(EXEC_TWO);
      expect(read.ok && read.value.events.map((each) => each.kind)).toEqual([
        "opened",
        "reassigned",
        "stage_written",
      ]);
    });

    it("refuses a stale version and a holder outside the opening role", async () => {
      expect(await reassignTo(EXEC_TWO, version + 1)).toMatchObject({
        ok: false,
        error: { code: "case_conflict" },
      });
      expect(await reassignTo(BACK_OFFICE)).toMatchObject({
        ok: false,
        error: { code: "case_holder_invalid" },
      });
      expect(await eventKinds()).toEqual(["opened"]);
    });
  });

  describe("timeout sweep", () => {
    it("releases a reservation once it is due, and only once", async () => {
      expect(await runtime().timeOutDue(new Date(DUE_AT.getTime() - 1))).toBe(
        0,
      );
      expect(await reservaStatus()).toBe("RESERVADO");

      expect(await runtime().timeOutDue(DUE_AT)).toBe(1);
      expect(await reservaStatus()).toBe("LIBERADO");
      expect(await runtime().timeOutDue(DUE_AT)).toBe(0);

      const read = await readAs(EXEC_ONE);
      expect(read.ok && read.value.events.at(-1)).toMatchObject({
        kind: "timed_out",
        stageKey: "reserva",
        status: "LIBERADO",
        actorName: null,
      });
    });

    it("leaves a won reservation alone", async () => {
      expect((await writeReserva(EXEC_ONE, {}, "GANADO")).ok).toBe(true);

      expect(await runtime().timeOutDue(DUE_AT)).toBe(0);
      expect(await reservaStatus()).toBe("GANADO");
    });
  });

  describe("file field", () => {
    it("attaches the writer's own upload and downloads it for a reader of the case", async () => {
      const uploaded = await uploadAs(EXEC_ONE);
      if (!uploaded.ok) {
        throw new Error(`the file must upload: ${uploaded.error.code}`);
      }
      expect(
        (await writeReserva(EXEC_ONE, { constancia: uploaded.value.id })).ok,
      ).toBe(true);

      const read = await readAs(EXEC_ONE);
      expect(read.ok && read.value.fileNames.get(uploaded.value.id)).toBe(
        "constancia.csv",
      );

      const token = await runtime().fileToken(
        { actor: { userId: BACK_OFFICE }, operationAt: OPENED_AT },
        {
          caseId,
          fieldKey: "constancia",
          actorUserId: BACK_OFFICE,
          roleKey: "back_office",
          branchId: BRANCH,
          viewAll: false,
          canReassign: false,
        },
      );
      if (!token.ok) {
        throw new Error(`the file must issue a token: ${token.error.code}`);
      }
      const files = createFilesRuntime(testWorkspaceInfrastructure(ctx));
      const download = await files.download(token.value.token, OPERATION);
      if (!download.ok) {
        throw new Error(`the file must download: ${download.error.code}`);
      }
      expect(new Uint8Array(download.value.body)).toEqual(PROOF);
    });

    it("refuses another user's upload", async () => {
      const uploaded = await uploadAs(EXEC_TWO);
      if (!uploaded.ok) {
        throw new Error(`the file must upload: ${uploaded.error.code}`);
      }

      expect(
        await writeReserva(EXEC_ONE, { constancia: uploaded.value.id }),
      ).toMatchObject({ ok: false, error: { code: "case_fields_invalid" } });
    });
  });
});
