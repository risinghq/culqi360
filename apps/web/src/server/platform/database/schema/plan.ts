import type { SchemaModule } from ".";
import * as activities from "./modules/activities";
import * as auth from "./modules/auth";
import * as campaigns from "./modules/campaigns";
import * as capacity from "./modules/capacity";
import * as cases from "./modules/cases";
import * as contactHolds from "./modules/contact-holds";
import * as core from "./modules/core";
import * as extensions from "./modules/extensions";
import * as files from "./modules/files";
import * as fulfillment from "./modules/fulfillment";
import * as identity from "./modules/identity";
import * as integrations from "./modules/integrations";
import * as jobQueues from "./modules/job-queues";
import * as merchantStats from "./modules/merchant-stats";
import * as notifications from "./modules/notifications";
import * as observability from "./modules/observability";
import * as organization from "./modules/organization";
import * as platform from "./modules/platform";
import * as pricing from "./modules/pricing";
import * as sales from "./modules/sales";
import * as search from "./modules/search";
import * as tenancy from "./modules/tenancy";
import * as workflow from "./modules/workflow";

export const SCHEMA_MODULES: readonly SchemaModule[] = [
  core,
  identity,
  auth,
  organization,
  contactHolds,
  campaigns,
  capacity,
  notifications,
  search,
  platform,
  observability,
  workflow,
  cases,
  // After campaigns and cases, which an activity may name as its subject.
  activities,
  extensions,
  integrations,
  files,
  pricing,
  sales,
  fulfillment,
  merchantStats,
  jobQueues,
  // Last: it classifies every table the modules above created.
  tenancy,
];
