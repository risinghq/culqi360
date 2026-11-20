# Realtime

Tracked job progress and event logs reach the browser through one pipeline.
Queue execution does not depend on an open browser connection.

## Publishing

Each workspace has one realtime service, built with its application in
[`workspace-application.ts`](../apps/web/src/server/composition/workspace-application.ts).
[`runtime.ts`](../apps/web/src/server/realtime/runtime.ts) holds the streams of
that workspace only. A writer calls `publish` with the executor it wrote
through. The message leaves when that transaction commits, and never after a
rollback
([`commit-effects.ts`](../apps/web/src/server/platform/database/commit-effects.ts)).
The host stops every service on `SIGINT` or `SIGTERM`
([`runtime-lifecycle.ts`](../apps/web/src/server/entrypoints/runtime-lifecycle.ts)).

The event log has no writer that publishes. After every commit to a workspace
store, [`event-logs/realtime.ts`](../apps/web/src/server/event-logs/realtime.ts)
reads the `events` rows past the last one it sent, by rowid, and publishes them
in order. It reads only while someone watches the log.

[`defineRealtimeChannel`](../apps/web/src/server/realtime/channel.ts) defines a
channel. It maps a payload to a topic, optionally extracts a cursor from the
payload, and supplies one `open` function. `open` authorizes the caller and
reads the state a new subscriber needs. It runs on every connect, so a reconnect
loses nothing. Returning `null` denies the subscription.

[`stream.ts`](../apps/web/src/server/realtime/stream.ts) subscribes the peer
before it calls `open`, buffers anything broadcast during the read, and flushes
the buffer after the opening state. A peer leaves the hub only when its sink
closes.

## Transport

Browsers subscribe at `/api/realtime/:channel/:id/stream`. The response is
server-sent events with the content type `text/event-stream`.

A subscription request gets:

| Status | Cause                                                                      |
| ------ | -------------------------------------------------------------------------- |
| 401    | The request has no session, or its class is `pre_auth` or `recovery_setup` |
| 404    | The channel is unknown, the id is malformed, or `open` returned null       |

[`request-auth.ts`](../apps/web/src/server/platform/http/request-auth.ts) sends
the 401 before the route runs. The server never redirects: the browser's
navigation guard holds a `pre_auth` session on `/onboarding` and a
`recovery_setup` session on `/recovery-codes`.

[`read-realtime-stream.ts`](../apps/web/src/browser/realtime/read-realtime-stream.ts)
reads the stream with `fetch` and `eventsource-parser`. It reports one of three
outcomes:

| Response                                                         | Outcome  | Client behavior                            |
| ---------------------------------------------------------------- | -------- | ------------------------------------------ |
| Clean end of stream                                              | `closed` | Reopens, without reporting `offline`       |
| 401 or 404                                                       | `denied` | Stops permanently                          |
| Any other non-OK status, a network error, or an error mid-stream | `failed` | Reopens with backoff and reports `offline` |

[`connection-lifecycle.ts`](../apps/web/src/browser/realtime/connection-lifecycle.ts)
sets the retry policy: jittered exponential backoff from one second to a
30-second cap, reset when a stream opens. The connection reports `idle`,
`connecting`, `live`, `offline`, or `denied`.

## Consuming a topic

Features consume a topic through
[`createTopicConnection`](../apps/web/src/browser/realtime/create-topic-connection.ts),
which owns the connection state, or through
[`createTopicFeed`](../apps/web/src/browser/realtime/create-topic-feed.ts),
which accumulates a capped list of records. Both return the connection state
with the data, so a view can show `offline` or `denied` instead of stale data
that looks current.

## Job events

Every kind of tracked work streams over one channel, built by
[`createJobsChannel`](../apps/web/src/server/jobs/channel.ts) as the `jobs`
channel. The kinds are in
[`job-event.ts`](../apps/web/src/contracts/jobs/job-event.ts): `gpv-snapshot`,
`data-source-ingest` and `client-enrichment`. A subscription id is
`kind:subjectId`. Adding a kind needs a projector and a producer, not another
channel.

A `JobEvent` has two parts. The envelope (`state`, `progress`, `errorMessage`)
is the same for every kind, so the client can draw a bar or a failure without
knowing the kind. `detail` holds what only one view reads. `subjectId` names the
entity, such as a snapshot, not the attempt that is running, so a subscription
survives a retry. `stale` lists the query keys the event invalidated. Only the
server knows which views an activated snapshot makes stale, so it says so.

The engine keeps ingest jobs in its own SQLite and exposes them over HTTP only,
so it cannot notify the web server.
[`job-bridge.ts`](../apps/web/src/server/data-source-uploads/job-bridge.ts)
polls each running job every 2 seconds, for at most 30 minutes, on the instance
that started it. It publishes each state as a job event.

## Cursors and recovery

A resumable channel attaches an id to each message. The id is the SSE event id
and the reconnect cursor. Once the client has received an id, it sends the
latest one as `Last-Event-ID` on every later connect, including reconnects it
opens itself, so the header is the only cursor and a topic has one stream URL.

The server closes streams instead of repairing them. A stream closes after 15
minutes so that authorization runs again. Clients reconnect and re-read their
state through `open`.
