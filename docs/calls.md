# Calls

A call is one phone call with a company, whatever dialled it. The `calls` table
keeps every call in a workspace, so a company's history lists them all in one
place.

## Subjects

A call belongs to a company and works on at most one subject:

| Subject         | Set when                                             |
| --------------- | ---------------------------------------------------- |
| campaign record | an executive calls a record from the batch they hold |
| case            | a user who can work cases calls from the case page   |
| person          | an executive calls a contact they hold               |
| none            | an imported call that names only the company         |

The `calls_one_subject` check in
[`schema/modules/calls.ts`](../apps/web/src/server/platform/database/schema/modules/calls.ts)
holds the rule.

## Sources

| Source      | Written by                                                |
| ----------- | --------------------------------------------------------- |
| `extension` | the extension's claim of a handoff token, before dialling |
| `manual`    | completing a contact hold that had no extension call      |
| `import`    | a data import, such as the [safeapp cutover](cutover.md)  |

A manual or imported call may have no phone.

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
claim creates the call row and returns its `callId`, which the recordings attach
to. [Architecture](architecture.md#browser-extension) covers recording and
upload.

## Outcomes

Completing a contact hold records the outcome and notes on the executive's
latest call to that person since the hold started. Without one, it writes a
`manual` call that carries the outcome. One conversation leaves one row either
way.
