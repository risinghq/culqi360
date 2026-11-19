import { WorkspaceId } from "~/domain/ids";

import { stableSeedId } from "../shared/stable-id";

// The installation's workspace. Its first client is Culqi.
export const INSTALLATION_WORKSPACE_ID = WorkspaceId.trust(
  stableSeedId("workspace:culqi"),
);
