import { createSignal } from "solid-js";

import { useIsMobile } from "~/components/ui/layout/responsive/use-is-mobile";
import { isSettingsRoutePath } from "~/domain/navigation/route-classification";

import {
  navigationDrawerAdvancedMode,
  navigationDrawerExpanded,
} from "./navigation-drawer-preferences";
import { navigationDrawerWidth } from "./navigation-drawer-width";

type MobileDrawerType = "main" | "settings";

export interface NavigationDrawerStateValue {
  expanded: () => boolean;
  setExpanded: (value: boolean | ((current: boolean) => boolean)) => void;
  width: () => number;
  setWidth: (value: number) => void;
  isMobile: () => boolean;
  currentMobileDrawer: () => MobileDrawerType;
  setCurrentMobileDrawer: (
    value: MobileDrawerType | ((current: MobileDrawerType) => MobileDrawerType),
  ) => void;
  advancedModeEnabled: () => boolean;
  setAdvancedModeEnabled: (
    value: boolean | ((current: boolean) => boolean),
  ) => void;
  memorizedExpanded: () => boolean;
  setMemorizedExpanded: (
    value: boolean | ((current: boolean) => boolean),
  ) => void;
  memorizedPath: () => string;
  setMemorizedPath: (value: string | ((current: string) => string)) => void;
  hasMemorizedNavigation: () => boolean;
  setHasMemorizedNavigation: (
    value: boolean | ((current: boolean) => boolean),
  ) => void;
  memorizeNavigationState: (path: string, drawerExpanded: boolean) => void;
  isSectionOpen: (id: string) => boolean;
  setSectionOpen: (id: string, open: boolean) => void;
  toggleSectionOpen: (id: string) => void;
  isFolderOpen: (id: string) => boolean;
  toggleFolderOpen: (id: string) => void;
}

function isSettingsLikePath(path: string) {
  return isSettingsRoutePath(path);
}

export function createNavigationDrawerStore(): NavigationDrawerStateValue {
  // One media-query listener for every consumer of the drawer state: useIsMobile
  // allocates its own on each call, so the store is where it belongs.
  const isMobile = useIsMobile();
  const [expanded, setExpandedSignal] = createSignal(
    navigationDrawerExpanded.read() ?? !isMobile(),
  );
  const [width, setWidthSignal] = createSignal(navigationDrawerWidth.read());
  const [currentMobileDrawer, setCurrentMobileDrawer] =
    createSignal<MobileDrawerType>("main");
  const [advancedModeEnabled, setAdvancedModeEnabledSignal] = createSignal(
    navigationDrawerAdvancedMode.read() ?? false,
  );
  const [memorizedExpanded, setMemorizedExpanded] = createSignal(true);
  const [memorizedPath, setMemorizedPath] = createSignal("/");
  const [hasMemorizedNavigation, setHasMemorizedNavigation] =
    createSignal(false);
  const [openSections, setOpenSections] = createSignal<Record<string, boolean>>(
    {},
  );
  const [openFolders, setOpenFolders] = createSignal<Record<string, boolean>>(
    {},
  );

  const setExpanded: NavigationDrawerStateValue["setExpanded"] = (value) => {
    const previous = expanded();
    const next = typeof value === "function" ? value(previous) : value;

    setExpandedSignal(next);
    navigationDrawerExpanded.write(next);
  };

  const setAdvancedModeEnabled: NavigationDrawerStateValue["setAdvancedModeEnabled"] =
    (value) => {
      const previous = advancedModeEnabled();
      const next = typeof value === "function" ? value(previous) : value;
      setAdvancedModeEnabledSignal(next);
      navigationDrawerAdvancedMode.write(next);
    };

  const isSectionOpen = (id: string) => {
    const state = openSections();
    const value = state[id];
    return value ?? true;
  };

  const setSectionOpen = (id: string, open: boolean) => {
    setOpenSections((current) => ({ ...current, [id]: open }));
  };

  const toggleSectionOpen = (id: string) => {
    setOpenSections((current) => ({
      ...current,
      [id]: !(current[id] ?? true),
    }));
  };

  const isFolderOpen = (id: string) => {
    const state = openFolders();
    const value = state[id];
    return value ?? true;
  };

  const toggleFolderOpen = (id: string) => {
    setOpenFolders((current) => ({
      ...current,
      [id]: !(current[id] ?? true),
    }));
  };

  const memorizeNavigationState = (path: string, drawerExpanded: boolean) => {
    if (isSettingsLikePath(path)) {
      return;
    }

    setMemorizedExpanded(drawerExpanded);
    setMemorizedPath(path);
    setHasMemorizedNavigation(true);
  };

  return {
    expanded,
    setExpanded,
    width,
    setWidth: (next) => {
      setWidthSignal(navigationDrawerWidth.write(Math.round(next)));
    },
    isMobile,
    currentMobileDrawer,
    setCurrentMobileDrawer,
    advancedModeEnabled,
    setAdvancedModeEnabled,
    memorizedExpanded,
    setMemorizedExpanded,
    memorizedPath,
    setMemorizedPath,
    hasMemorizedNavigation,
    setHasMemorizedNavigation,
    memorizeNavigationState,
    isSectionOpen,
    setSectionOpen,
    toggleSectionOpen,
    isFolderOpen,
    toggleFolderOpen,
  };
}
