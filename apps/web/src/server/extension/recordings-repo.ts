import type { Kysely } from "kysely";

import type {
  ActivityId,
  ExtensionRecordingId,
  InstallationId,
  UserId,
} from "~/domain/ids";
import type { Database } from "~/server/platform/database/types";

export function createExtensionRecordingsRepo(db: Kysely<Database>) {
  return {
    // A call belongs to the installation whose claim opened it.
    findCallForInstallation(
      callId: ActivityId,
      owner: { userId: UserId; installationId: InstallationId },
    ) {
      return db
        .selectFrom("activities")
        .innerJoin(
          "extension_handoffs as handoff",
          "handoff.call_id",
          "activities.id",
        )
        .select([
          "activities.id",
          "activities.started_at",
          "activities.ended_at",
        ])
        .where("activities.id", "=", callId)
        .where("handoff.user_id", "=", owner.userId)
        .where("handoff.installation_id", "=", owner.installationId)
        .executeTakeFirst();
    },

    // The sweeper's end for extension calls that never opened a recording.
    // activities-repo owns every other write to activities.
    async endCallsWithoutRecording(startedBefore: Date, endedAt: Date) {
      const ended = await db
        .updateTable("activities")
        .set({ ended_at: endedAt })
        .where("source", "=", "extension")
        .where("ended_at", "is", null)
        .where("started_at", "<=", startedBefore)
        .where((eb) =>
          eb.not(
            eb.exists(
              eb
                .selectFrom("extension_recordings")
                .select("extension_recordings.id")
                .whereRef("extension_recordings.call_id", "=", "activities.id"),
            ),
          ),
        )
        .returning("id")
        .execute();
      return ended.length;
    },

    async insertRecordingIfAbsent(values: {
      call_id: ActivityId;
      created_at: Date;
    }) {
      await db
        .insertInto("extension_recordings")
        .values({
          call_id: values.call_id,
          created_at: values.created_at,
          last_activity_at: values.created_at,
        })
        .onConflict((oc) => oc.column("call_id").doNothing())
        .execute();
    },

    findRecordingByCallId(callId: ActivityId) {
      return db
        .selectFrom("extension_recordings")
        .selectAll()
        .where("call_id", "=", callId)
        .executeTakeFirst();
    },

    findRecordingForInstallation(
      recordingId: ExtensionRecordingId,
      owner: { userId: UserId; installationId: InstallationId },
    ) {
      return db
        .selectFrom("extension_recordings")
        .innerJoin(
          "extension_handoffs as handoff",
          "handoff.call_id",
          "extension_recordings.call_id",
        )
        .selectAll("extension_recordings")
        .where("extension_recordings.id", "=", recordingId)
        .where("handoff.user_id", "=", owner.userId)
        .where("handoff.installation_id", "=", owner.installationId)
        .executeTakeFirst();
    },

    /**
     * Takes the row lock that serializes segment writes, the extension's close
     * and the sweeper on one recording. Only meaningful inside a transaction.
     */
    lockRecording(recordingId: ExtensionRecordingId) {
      return db
        .selectFrom("extension_recordings")
        .selectAll()
        .where("id", "=", recordingId)
        .forUpdate()
        .executeTakeFirst();
    },

    async touchRecording(recordingId: ExtensionRecordingId, at: Date) {
      await db
        .updateTable("extension_recordings")
        .set({ last_activity_at: at })
        .where("id", "=", recordingId)
        .execute();
    },

    findSegment(recordingId: ExtensionRecordingId, seq: number) {
      return db
        .selectFrom("extension_recording_segments")
        .selectAll()
        .where("recording_id", "=", recordingId)
        .where("seq", "=", seq)
        .executeTakeFirst();
    },

    async insertSegmentIfAbsent(values: {
      recording_id: ExtensionRecordingId;
      seq: number;
      storage_key: string;
      content_type: string;
      channels: string;
      started_at: Date;
      size_bytes: number;
      sha256_hex: string;
      received_at: Date;
    }): Promise<boolean> {
      const result = await db
        .insertInto("extension_recording_segments")
        .values(values)
        .onConflict((oc) => oc.columns(["recording_id", "seq"]).doNothing())
        .executeTakeFirst();
      return Number(result.numInsertedOrUpdatedRows ?? 0) > 0;
    },

    listSegmentSizesBelow(recordingId: ExtensionRecordingId, count: number) {
      return db
        .selectFrom("extension_recording_segments")
        .select(["seq", "size_bytes"])
        .where("recording_id", "=", recordingId)
        .where("seq", "<", count)
        .orderBy("seq", "asc")
        .execute();
    },

    async completeRecording(values: {
      recording_id: ExtensionRecordingId;
      closed_at: Date;
      reported_interrupted: boolean;
      expected_segments: number;
      expected_bytes: number;
    }) {
      await db
        .updateTable("extension_recordings")
        .set({
          status: "complete",
          closed_at: values.closed_at,
          last_activity_at: values.closed_at,
          reported_interrupted: values.reported_interrupted,
          expected_segments: values.expected_segments,
          expected_bytes: values.expected_bytes,
        })
        .where("id", "=", values.recording_id)
        .execute();
    },

    interruptIdleRecordings(idleBefore: Date, interruptedAt: Date) {
      return db
        .updateTable("extension_recordings")
        .set({ status: "interrupted", closed_at: interruptedAt })
        .where("status", "=", "open")
        .where("last_activity_at", "<=", idleBefore)
        .returning(["id", "call_id"])
        .execute();
    },
  };
}

export type ExtensionRecordingsRepo = ReturnType<
  typeof createExtensionRecordingsRepo
>;
