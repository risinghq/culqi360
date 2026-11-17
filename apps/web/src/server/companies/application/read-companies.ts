import { fail, type DomainError } from "~/domain/errors";
import type { OrganizationId } from "~/domain/ids";
import { Err, Ok, type Result } from "~/shared/result";

import type {
  CompaniesRepo,
  CompanyActivity,
  CompanyCampaignRecord,
  CompanyCase,
  CompanyIdentity,
  CompanyPerson,
  CompanyViewer,
} from "../infrastructure/companies-repo";

export type CompanyDetail = {
  identity: CompanyIdentity;
  people: CompanyPerson[];
  cases: CompanyCase[];
  activities: CompanyActivity[];
  campaignRecords: CompanyCampaignRecord[];
};

// Access is decided once, on the company. A viewer who reaches it sees all of
// its work, including cases and calls by other users.
export async function readCompany(
  id: OrganizationId,
  viewer: CompanyViewer,
  repo: CompaniesRepo,
): Promise<Result<CompanyDetail, DomainError>> {
  const identity = await repo.findIdentity(id, viewer);
  if (!identity) {
    return Err(fail("company_not_found"));
  }
  const [people, cases, activities, campaignRecords] = await Promise.all([
    repo.listPeople(id),
    repo.listCases(id),
    repo.listActivities(id),
    repo.listCampaignRecords(id),
  ]);
  return Ok({ identity, people, cases, activities, campaignRecords });
}
