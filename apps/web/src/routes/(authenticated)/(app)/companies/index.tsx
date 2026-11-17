import { AppPage } from "~/components/layout/page";
import { CompanySearch } from "~/features/companies/company-search";

export default function CompaniesPage() {
  return (
    <AppPage width="medium">
      <CompanySearch />
    </AppPage>
  );
}
