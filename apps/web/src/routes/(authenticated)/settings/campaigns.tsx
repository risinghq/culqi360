import { CampaignImportSection } from "~/features/campaigns/campaign-import-section";
import { SettingsPageLayout } from "~/features/settings-shell/page/settings-page-layout";

export default function CampaignSettingsPage() {
  return (
    <SettingsPageLayout>
      <CampaignImportSection />
    </SettingsPageLayout>
  );
}
