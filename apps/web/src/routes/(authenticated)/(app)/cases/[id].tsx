import { type RouteDefinition, useParams } from "@solidjs/router";

import { AppPage } from "~/components/layout/page";
import { CaseDetail } from "~/features/cases/case-detail";
import { caseQuery } from "~/rpc/cases/queries";

export const route = {
  preload: ({ params }) => {
    if (params.id) {
      void caseQuery(params.id);
    }
  },
} satisfies RouteDefinition;

export default function CasePage() {
  const params = useParams<{ id: string }>();
  return (
    <AppPage width="medium">
      <CaseDetail caseId={params.id} />
    </AppPage>
  );
}
