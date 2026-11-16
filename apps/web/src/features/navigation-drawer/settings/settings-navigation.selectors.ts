import UserCircle from "~/components/icons/user-circle";
import type { Member } from "~/domain/auth/access/route-policy";

import { createSettingsNavigationSections } from "./settings-navigation-config";
import { settingsItemMatchesPath } from "./settings-navigation-path-match";
import type {
  SettingsNavItem,
  SettingsNavSection,
  SettingsNavSectionId,
} from "./settings-navigation.types";

function flattenSettingsItems(items: SettingsNavItem[]): SettingsNavItem[] {
  const result: SettingsNavItem[] = [];

  for (const item of items) {
    result.push(item);

    if (item.subItems && item.subItems.length > 0) {
      result.push(...flattenSettingsItems(item.subItems));
    }
  }

  return result;
}

function getSettingsNavigationSections(member: Member): SettingsNavSection[] {
  return createSettingsNavigationSections({
    member,
    onLogout: () => undefined,
  });
}

function getVisibleSettingsItems(
  sections: SettingsNavSection[],
): SettingsNavItem[] {
  return sections.flatMap((section) =>
    flattenSettingsItems(section.items).filter((item) => !item.isHidden),
  );
}

export function getCurrentSettingsItem(
  pathname: string,
  member: Member,
): SettingsNavItem {
  const sections = getSettingsNavigationSections(member);
  const items = getVisibleSettingsItems(sections);
  const firstWithHref = items.find((item) => Boolean(item.href));

  return (
    items.find((item) =>
      settingsItemMatchesPath(pathname, item.href, item.matchSubPages),
    ) ??
    firstWithHref ?? {
      id: "profile",
      label: "Perfil",
      href: "/settings/profile",
      icon: UserCircle,
      section: "account",
    }
  );
}

export function getSettingsSectionLabel(
  sectionId: SettingsNavSectionId,
  member: Member,
): string {
  return (
    getSettingsNavigationSections(member).find(
      (section) => section.id === sectionId,
    )?.label ?? "Ajustes"
  );
}

export function getSettingsSectionHref(
  sectionId: SettingsNavSectionId,
  member: Member,
): string | undefined {
  const section = getSettingsNavigationSections(member).find(
    (currentSection) => currentSection.id === sectionId,
  );

  if (!section) {
    return undefined;
  }

  return flattenSettingsItems(section.items).find(
    (item) => Boolean(item.href) && !item.isHidden,
  )?.href;
}
