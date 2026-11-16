import { AppPage } from "~/components/layout/page";
import { CaseList } from "~/features/cases/case-list";

export default function CasesPage() {
  return (
    <AppPage width="medium">
      <CaseList />
    </AppPage>
  );
}
