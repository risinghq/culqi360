import type { CapacityPolicyDefaultsView } from "~/contracts/capacity";
import type { DomainError } from "~/domain/errors";
import type { CapacityTeamsRepo } from "~/server/capacity/infrastructure/capacity-teams-repo";
import type {
  DrawPolicyDefaultsRepo,
  SearchPolicyDefaultsRepo,
} from "~/server/capacity/infrastructure/policy-repos";
import type { AppContext } from "~/server/platform/action/context";
import { Ok, type Result } from "~/shared/result";

interface PolicyDefaultsDeps {
  repos: {
    teams: Pick<CapacityTeamsRepo, "findByBranch">;
    searchPolicyDefaults: Pick<
      SearchPolicyDefaultsRepo,
      "findForScope" | "listForScope"
    >;
    drawPolicyDefaults: Pick<
      DrawPolicyDefaultsRepo,
      "findForScope" | "listForScope"
    >;
  };
}

export async function getPolicyDefaults(
  ctx: AppContext,
  deps: PolicyDefaultsDeps,
): Promise<Result<CapacityPolicyDefaultsView, DomainError>> {
  const [teams, branchSearch, branchDraw] = await Promise.all([
    deps.repos.teams.findByBranch(ctx.actor.branchId),
    deps.repos.searchPolicyDefaults.findForScope("branch", ctx.actor.branchId),
    deps.repos.drawPolicyDefaults.findForScope("branch", ctx.actor.branchId),
  ]);
  const teamIds = teams.map((team) => team.id);
  const [searchTeamDefaults, drawTeamDefaults] = await Promise.all([
    deps.repos.searchPolicyDefaults.listForScope("team", teamIds),
    deps.repos.drawPolicyDefaults.listForScope("team", teamIds),
  ]);
  const searchTeamById = new Map(
    searchTeamDefaults.map((row) => [row.scope_id, row]),
  );
  const drawTeamById = new Map(
    drawTeamDefaults.map((row) => [row.scope_id, row]),
  );

  return Ok({
    branchId: ctx.actor.branchId,
    branchSearchLimit: branchSearch?.search_limit ?? null,
    branchActiveBufferTarget: branchDraw?.active_buffer_target ?? null,
    branchDailyRefillLimit: branchDraw?.daily_refill_limit ?? null,
    teams: teams.map((team) => ({
      teamId: team.id,
      teamName: team.name,
      searchLimit: searchTeamById.get(team.id)?.search_limit ?? null,
      activeBufferTarget:
        drawTeamById.get(team.id)?.active_buffer_target ?? null,
      dailyRefillLimit: drawTeamById.get(team.id)?.daily_refill_limit ?? null,
    })),
  });
}
