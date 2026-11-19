import { Show, onSettled } from "solid-js";

import { scheduleVisualMount } from "~/browser/visual/runtime/visual-mount-scheduler";
import { useIsMobile } from "~/components/ui/layout/responsive/use-is-mobile";
import { preloadSidePanelEntryPages } from "~/features/side-panel/registry/lazy-pages";

import { Router } from "../router/router";
import { DesktopSidePanelContent } from "./desktop-content";
import { DesktopSidePanelFrame } from "./desktop-frame";
import { MobileShell } from "./mobile-shell";

export function SidePanelHost() {
  const isMobile = useIsMobile();
  const isDesktop = () => !isMobile();

  // Preload the cold entry pages before the first panel open.
  onSettled(() =>
    scheduleVisualMount(preloadSidePanelEntryPages, { priority: "priority" }),
  );

  return (
    <>
      <DesktopSidePanelFrame
        isInteractive={isDesktop()}
        renderContent={() =>
          isDesktop() ? <DesktopSidePanelContent /> : <></>
        }
        shouldRenderChildren={isDesktop()}
      />

      <Show when={isMobile()}>
        <MobileShell targetVariant="fullScreen">
          <Router isMobile />
        </MobileShell>
      </Show>
    </>
  );
}
