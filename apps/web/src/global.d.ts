/// <reference types="@solidjs/vite-plugin/virtual-modules" />

import type { WorkspaceApplication } from "~/server/composition/workspace-application";
import type { RequestContext } from "~/server/platform/http/request-context-storage";

declare module "@solidjs/web" {
  interface RequestEventLocals {
    requestContext: RequestContext;
    /**
     * Seeded by the serving layer, which also hands it to `handleRequest` for
     * the injected client entry script. Absent in development, where the Vite
     * dev server owns that injection.
     */
    nonce?: string;
    /** The signed-in principal's workspace application. */
    application?: WorkspaceApplication;
  }
}
