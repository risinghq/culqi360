# Diagnostics

Request tracing logs dev-server requests while you develop. It is separate from
audit and operational logs.

```sh
DEBUG_DIAGNOSTICS=requests bun run dev
DEBUG_DIAGNOSTICS=requests DEBUG_DIAGNOSTICS_REQUESTS=verbose bun run dev
DEBUG_DIAGNOSTICS=requests DEBUG_DIAGNOSTICS_REQUESTS_SLOW_MS=500 bun run dev
```

`DEBUG_DIAGNOSTICS` takes a comma-separated list of channels. `requests` is the
only channel, and `*` or `all` enables it.

Request tracing logs document navigations, server functions, API routes, non-GET
requests, failures (status 400 and above), slow responses, and aborted requests.
It skips asset traffic. The slow threshold defaults to 250 ms
(`DEBUG_DIAGNOSTICS_REQUESTS_SLOW_MS`). With
`DEBUG_DIAGNOSTICS_REQUESTS=verbose`, every request is logged, assets included.

The tracer is [`tracer.ts`](../apps/web/tracer.ts).
