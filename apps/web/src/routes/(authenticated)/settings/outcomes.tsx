import { OutcomesSection } from "~/features/outcomes/outcomes-section";
import { SettingsPageLayout } from "~/features/settings-shell/page/settings-page-layout";

export default function OutcomeSettingsPage() {
  return (
    <SettingsPageLayout>
      <OutcomesSection />
    </SettingsPageLayout>
  );
}
