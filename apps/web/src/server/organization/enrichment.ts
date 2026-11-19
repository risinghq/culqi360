import type { Ruc } from "~/domain/identity/document";
import type { EngineClient } from "~/server/integrations/engine/client";
import type { OperationContext } from "~/server/platform/operation/context";

// Resolves legal name and address from the external registry by RUC. One port
// shared by lead registration and the bootstrap preview.
export type OrganizationEnrichment = {
  enrichByRuc(ruc: string): Promise<{
    legalName: string | null;
    address: string | null;
  } | null>;
};

// Asks the company registry to verify RUCs against SUNAT. The registry is
// another store, so call it after the workspace transaction commits.
export type OrganizationEnrichmentQueue = {
  requestRucs(
    rucs: readonly Ruc[],
    requestedByUserId: string | null,
    operation: OperationContext,
  ): Promise<void>;
};

export function createOrganizationEnrichment(
  engine: EngineClient,
): OrganizationEnrichment {
  return {
    async enrichByRuc(ruc: string) {
      const result = await engine.search("companies", ruc, 1);
      if (!result.ok) {
        return null;
      }

      const match =
        result.value.find(
          (candidate) =>
            candidate.kind === "company" && candidate.company.ruc === ruc,
        ) ??
        result.value[0] ??
        null;

      return match && match.kind === "company"
        ? {
            legalName: match.company.legal_name ?? null,
            address: match.company.fiscal_address ?? null,
          }
        : null;
    },
  };
}
