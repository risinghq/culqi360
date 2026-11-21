# Activities

An activity is one call or one visit with a company, however it was logged. The
`activities` table keeps every one in a workspace, so a company's history lists
them all in one place. The code is in
[`apps/web/src/server/activities`](../apps/web/src/server/activities).

## Channels

| Channel | Is                                         |
| ------- | ------------------------------------------ |
| `call`  | a phone call, dialled or logged            |
| `visit` | a visit to the company, logged by the user |

Only a call has a phone, and only a call comes from the extension. The checks
`activities_phone_on_call` and `activities_extension_on_call` in
[`schema/modules/activities.ts`](../apps/web/src/server/platform/database/schema/modules/activities.ts)
hold both rules.

## Subjects

An activity belongs to a company and works on at most one subject:

| Subject         | Set when                                             |
| --------------- | ---------------------------------------------------- |
| campaign record | an executive works a record from the batch they hold |
| case            | a user who can work cases calls from the case page   |
| person          | an executive works a contact they hold               |
| none            | an imported activity that names only the company     |

The `activities_one_subject` check holds the rule.

## Sources

| Source      | Written by                                                     |
| ----------- | -------------------------------------------------------------- |
| `extension` | the extension's claim of a handoff token, before dialling      |
| `manual`    | recording a result on a subject with no activity logged for it |
| `import`    | a data import, such as [safeapp's](cutover.md)                 |

A manual or imported call may have no phone.

## Outcomes

An outcome is a result from the workspace's list, such as "No contesta" or
"Venta cerrada". Each outcome belongs to one channel, and an activity can only
hold an outcome of its own channel: the `activities_outcome_fkey` key covers the
outcome and the channel together.

An outcome carries three flags a report can count: `contacted`, `negotiated` and
`callback`. A null flag means the outcome does not say.

- Every new workspace starts with the baseline list in
  [`outcome-seed.ts`](../apps/web/src/server/activities/domain/outcome-seed.ts).
- `/settings/outcomes` (`outcome:manage`, admin and superuser) adds, renames and
  archives outcomes. A new outcome goes to the end of its channel's list.
- A label is unique among the live outcomes of one channel, so a call and a
  visit outcome may share one. A repeated label fails with
  `activity_outcome_exists`.
- An outcome in use is archived, never deleted. The activities that hold it keep
  it, and its label is free for a new outcome.

## Recording a result

The user picks an outcome and writes notes when they finish work on a subject:
marking a campaign record worked, or completing a contact hold. On Mis contactos
(`/me/assignments`), "Registrar resultado" on a held contact asks for both and
removes the contact from the list.
[`record-result.ts`](../apps/web/src/server/activities/application/record-result.ts)
runs inside the caller's transaction:

- The outcome must be live, else the work fails with
  `activity_outcome_not_found` and nothing is written.
- The outcome's channel says whether the work was a call or a visit.
- The result lands on the user's latest activity of that channel on the subject
  since they took it, such as the extension's call. Without one, it writes a
  `manual` activity that carries the result. One conversation leaves one row
  either way.
- A visit outcome on a subject that has an extension call writes a separate
  visit and leaves the call alone.

## Calling through the extension

The web page posts a request that names the subject. The server resolves the
target in
[`resolve-call-target.ts`](../apps/web/src/server/calls/application/resolve-call-target.ts):

- The actor must be able to reach the subject. A contact hold must be active and
  theirs, a campaign record must be in the batch they hold, and a case must be
  one they can read.
- The phone is the number the user picked, else the person's number, else the
  company's. With none, the request fails with `call_phone_missing`.

The handoff token in
[`handoff-token.ts`](../apps/web/src/routes/api/extension/handoff-token.ts)
carries the company, the phone and the display names, and needs the permission
of its subject: `lead:work`, `campaign:work` or `case:work`. The extension's
claim creates the call activity and returns its `callId`, which the recordings
attach to. [Architecture](architecture.md#browser-extension) covers recording
and upload.

The extension records when the call ends, not its result. Its `ended` event
carries only the session id and the time. The user records the outcome in the
web app, where the result lands on the extension's call.
