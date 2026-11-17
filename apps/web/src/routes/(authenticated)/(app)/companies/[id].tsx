import { type RouteDefinition, useParams } from "@solidjs/router";

import { AppPage } from "~/components/layout/page";
import { CompanyDetail } from "~/features/companies/company-detail";
import { companyQuery } from "~/rpc/companies/queries";

export const route = {
  preload: ({ params }) => {
    if (params.id) {
      void companyQuery(params.id);
    }
  },
} satisfies RouteDefinition;

export default function CompanyPage() {
  const params = useParams<{ id: string }>();
  return (
    <AppPage width="medium">
      <CompanyDetail companyId={params.id} />
    </AppPage>
  );
}
