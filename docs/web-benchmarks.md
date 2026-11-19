# Web benchmarks

The web application's CPU benchmarks live under
[`apps/web/tests/bench/`](../apps/web/tests/bench/). Run them from the
repository root:

```sh
mise run test:perf
```

The command loads `.env.test` and runs `vitest bench` once with
[`vitest.bench.config.ts`](../apps/web/vitest.bench.config.ts) on Node, whose V8
is the engine Workers run. The CodSpeed workflow
([`codspeed.yml`](../.github/workflows/codspeed.yml)) runs the same command in
simulation mode on every pull request that touches the server and compares each
benchmark with master. For search benchmarks of the engine, see
[`ops/bench`](../ops/bench/readme.md).

A benchmark measures a path whose cost grows with a workspace's data or runs on
every request. Each one runs the real host over in-memory `node:sqlite` stores
that enforce the Durable Object limits.

| File                                                                                   | Measures                                                                                                |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| [`request/request.bench.ts`](../apps/web/tests/bench/request/request.bench.ts)         | Resolving a session, a password login, and waking a workspace.                                          |
| [`workspace/reads.bench.ts`](../apps/web/tests/bench/workspace/reads.bench.ts)         | Case lists, the back office queue, company search, the month's production and calls, and their exports. |
| [`workspace/campaigns.bench.ts`](../apps/web/tests/bench/workspace/campaigns.bench.ts) | Drawing a batch past every record other executives hold, and importing a 5,000-row campaign file.       |
| [`workspace/schedule.bench.ts`](../apps/web/tests/bench/workspace/schedule.bench.ts)   | Reading the workspace alarm's next deadline, which every commit does.                                   |

[`_shared/`](../apps/web/tests/bench/_shared/) builds the data:

- `host.ts` creates one workspace with an admin and 60 executives.
- `volume.ts` adds a workspace a few months into use: 10,000 companies from a
  campaign file, 59 held batches, 2,000 cases and 5,000 calls in November 2023.
  Its sizes are constants at the top of the file.
- `constants.ts` fixes the clock, so dates and month reports are stable.

The seed runs under the simulator too, so a bench file seeds only what its
benchmarks read.
