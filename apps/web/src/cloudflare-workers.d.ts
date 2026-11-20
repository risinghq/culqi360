// The part of the Workers runtime module that src/worker.ts uses. The full
// @cloudflare/workers-types declare their own fetch, Request and Response as
// globals, which clash with the DOM types the rest of the app checks against.
declare module "cloudflare:workers" {
  import type { DurableObjectStorageLike } from "~/server/platform/database/durable-object-store";
  import type { AlarmStorage } from "~/server/platform/schedule/object-alarm";

  export interface DurableObjectId {
    equals(other: DurableObjectId): boolean;
    // The name given to `idFromName`, also inside `alarm()`.
    readonly name?: string;
  }

  export interface DurableObjectState {
    readonly id: DurableObjectId;
    readonly storage: DurableObjectStorageLike & AlarmStorage;
  }

  export abstract class DurableObject<Env = unknown> {
    protected readonly ctx: DurableObjectState;
    protected readonly env: Env;
    constructor(ctx: DurableObjectState, env: Env);
  }
}
