import { createSignal, onSettled } from "solid-js";

import { MOBILE_VIEWPORT } from "~/components/ui/theme/design-system";

// Use this for structural switches that need a different DOM tree. Cosmetic
// responsive changes belong in CSS.
export function useIsMobile() {
  const mediaQuery = window.matchMedia(`(max-width: ${MOBILE_VIEWPORT}px)`);
  const [isMobile, setIsMobile] = createSignal(mediaQuery.matches);

  const handleChange = (event: MediaQueryListEvent) => {
    setIsMobile(event.matches);
  };

  onSettled(() => {
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  });

  return isMobile;
}
