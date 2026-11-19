/// <reference types="@solidjs/vite-plugin/virtual-modules" />

import type { WorkspaceApplication } from "~/server/composition/workspace-application";
import type { RequestContext } from "~/server/platform/http/request-context-storage";

declare module "@solidjs/web" {
  interface RequestEventLocals {
    requestContext: RequestContext;
    /** The signed-in principal's workspace application. */
    application?: WorkspaceApplication;
  }
}
