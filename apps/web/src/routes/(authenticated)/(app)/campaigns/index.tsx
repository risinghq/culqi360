import { AppPage } from "~/components/layout/page";
import { CampaignWork } from "~/features/campaigns/campaign-work";

export default function CampaignsPage() {
  return (
    <AppPage width="medium">
      <CampaignWork />
    </AppPage>
  );
}
