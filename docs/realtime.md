# Realtime

Tracked job progress and event logs reach the browser through one pipeline.
Queue execution does not depend on an open browser connection.

## Publishing

Each workspace has one realtime service, built with its application in
[`workspace-application.ts`](../apps/web/src/server/composition/workspace-application.ts).
[`runtime.ts`](../apps/web/src/server/realtime/runtime.ts) holds the sockets of
that workspace only. A writer calls `publish` with the executor it wrote
through. The message leaves when that transaction commits, and never after a
rollback
([`commit-effects.ts`](../apps/web/src/server/platform/database/commit-effects.ts)).
The Bun host closes every socket on `SIGINT` or `SIGTERM`
([`runtime.ts`](../apps/web/src/server/entrypoints/runtime.ts)).

The event log has no writer that publishes. After every commit to a workspace
store, [`event-logs/realtime.ts`](../apps/web/src/server/event-logs/realtime.ts)
reads the `events` rows past the last one it sent, by rowid, and publishes them
in order. It reads only while someone watches the log.

[`defineRealtimeChannel`](../apps/web/src/server/realtime/channel.ts) defines a
channel. It maps a payload to a topic, optionally extracts a cursor from the
payload, and supplies one `open` function. `open` authorizes the caller and
reads the state a new socket needs. It runs on every connect, so a reconnect
loses nothing. Returning `null` denies the socket.

`connect` in `runtime.ts` lists the socket under its topic before it calls
`open`, holds anything broadcast during the read, and sends it after the opening
state. A socket leaves its topic only when it closes.

## Transport

Browsers open a WebSocket at `/api/realtime/:channel/:id/socket`. Each server
frame is the message id, a newline, then the payload. The id is empty on a
channel without cursors. The browser sends `ping` every 30 seconds and the
server answers `pong`, so proxies keep the connection.

A browser cannot read the status of a refused handshake, so the route accepts
every handshake and refuses with a close code.
[`request-class.ts`](../apps/web/src/server/platform/http/request-class.ts)
classes the socket path apart from `/api/`, and the route authenticates its own
caller.

| Close code | Cause                                                                      |
| ---------- | -------------------------------------------------------------------------- |
| 4401       | The request has no session, or its class is `pre_auth` or `recovery_setup` |
| 4404       | The channel is unknown, the id is malformed, or `open` returned null       |
| 4000       | The socket is older than 15 minutes                                        |
| 1011       | `open` threw                                                               |
| 1001       | The server is stopping                                                     |

The server never redirects: the browser's navigation guard holds a `pre_auth`
session on `/onboarding` and a `recovery_setup` session on `/recovery-codes`.

### Hosts

The Solid request handler rebuilds the response a route returns, so a 101 cannot
travel back through it. The route upgrades through a `SocketUpgrade` that the
host sets on the request event's locals
([`sockets.ts`](../apps/web/src/server/realtime/sockets.ts)), and the host
completes the handshake. Frames the route sends before the host opens the
connection queue in order.

| Host                  | File                                           | Sockets live in                            |
| --------------------- | ---------------------------------------------- | ------------------------------------------ |
| Workers               | [`worker.ts`](../apps/web/src/worker.ts)       | The workspace Durable Object, hibernatable |
| Bun production server | [`server.ts`](../apps/web/server.ts)           | Process memory, through `Bun.serve`        |
| Vite dev server       | [`dev-sockets.ts`](../apps/web/dev-sockets.ts) | Process memory, through `ws`               |

On Workers the object accepts its sockets with `acceptWebSocket`, so it can be
evicted while they stay open. Each socket carries its id and open time as an
attachment, which survives hibernation. `setWebSocketAutoResponse` answers
`ping` without waking the object. A broadcast finds the sockets of a topic by
tag.

The object accepts a socket for hibernation only when the route first sends on
it. A socket the route refuses without sending is accepted plainly and closed.
workerd delivers a close that a hibernatable socket issues during its opening
request about 36 seconds late, while frames arrive at once. A plainly accepted
socket closes at once. A socket not yet accepted is still listed under its
topic, so a broadcast during the opening read reaches it.

### Browser

[`read-realtime-socket.ts`](../apps/web/src/browser/realtime/read-realtime-socket.ts)
opens the socket and maps its close to one of three outcomes:

| Close                                         | Outcome  | Client behavior                            |
| --------------------------------------------- | -------- | ------------------------------------------ |
| 1000, 1001 or 4000                            | `closed` | Reopens, without reporting `offline`       |
| 4401 or 4404                                  | `denied` | Stops permanently                          |
| Any other code, or a socket that never opened | `failed` | Reopens with backoff and reports `offline` |

[`connection-lifecycle.ts`](../apps/web/src/browser/realtime/connection-lifecycle.ts)
sets the retry policy: jittered exponential backoff from one second to a
30-second cap, reset when a socket opens. The connection reports `idle`,
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
[`job-event.ts`](../apps/web/src/contracts/jobs/job-event.ts):
`data-source-ingest` and `client-enrichment`. A socket id is `kind:subjectId`.
Adding a kind needs a projector and a producer, not another channel.

A `JobEvent` has two parts. The envelope (`state`, `progress`, `errorMessage`)
is the same for every kind, so the client can draw a bar or a failure without
knowing the kind. `detail` holds what only one view reads. `subjectId` names the
entity, such as a snapshot, not the attempt that is running, so a socket
survives a retry. `stale` lists the query keys the event invalidated. Only the
server knows which views an activated snapshot makes stale, so it says so.

The engine keeps ingest jobs in its own SQLite and exposes them over HTTP only,
so it cannot notify the web server.
[`ingest-watch.ts`](../apps/web/src/server/data-source-uploads/ingest-watch.ts)
stores a watch row in the workspace store when an upload starts a job. The
store's alarm runs a duty that reads each due job every 2 seconds, for at most
30 minutes, and publishes each state as a job event. A failed read retries at
the next poll. The watch survives an eviction because it lives in the store.

## Cursors and recovery

A resumable channel attaches an id to each message. Once the client has received
an id, it sends the latest one as the `cursor` query parameter on every later
connect, and `open` replays what came after it.

The server closes sockets instead of repairing them. A socket closes with 4000
at the first broadcast after 15 minutes, so that authorization runs again.
Clients reconnect and re-read their state through `open`.
