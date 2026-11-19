/// <reference types="@solidjs/vite-plugin/virtual-modules" />

import type { RequestHost } from "~/server/composition/application";
import type { WorkspaceApplication } from "~/server/composition/workspace-application";
import type { RequestContext } from "~/server/platform/http/request-context-storage";

declare module "@solidjs/web" {
  interface RequestEventLocals {
    requestContext: RequestContext;
    /** Every request but a page's. */
    host?: RequestHost;
    /** The signed-in principal's workspace application. */
    application?: WorkspaceApplication;
  }
}
