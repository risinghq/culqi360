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

  // The server end of a WebSocketPair. The DOM WebSocket type has none of the
  // Workers-only members.
  export interface ServerWebSocket {
    // Accepts a socket the Worker itself serves, outside any object.
    accept(): void;
    send(message: string): void;
    close(code?: number, reason?: string): void;
    // Survives hibernation with the socket. At most 2 KiB.
    serializeAttachment(value: unknown): void;
    deserializeAttachment(): unknown;
  }

  export interface DurableObjectState {
    readonly id: DurableObjectId;
    readonly storage: DurableObjectStorageLike & AlarmStorage;
    // Hibernatable sockets: the object may be evicted while they stay open.
    acceptWebSocket(socket: ServerWebSocket, tags?: string[]): void;
    getWebSockets(tag?: string): ServerWebSocket[];
    // Answers a matching message without waking the object.
    setWebSocketAutoResponse(pair: WebSocketRequestResponsePair): void;
  }

  export abstract class DurableObject<Env = unknown> {
    protected readonly ctx: DurableObjectState;
    protected readonly env: Env;
    constructor(ctx: DurableObjectState, env: Env);
  }
}

// Globals of the Workers runtime, used only by src/worker.ts.
declare class WebSocketPair {
  readonly 0: unknown;
  readonly 1: import("cloudflare:workers").ServerWebSocket;
}

declare class WebSocketRequestResponsePair {
  constructor(request: string, response: string);
  readonly request: string;
  readonly response: string;
}
