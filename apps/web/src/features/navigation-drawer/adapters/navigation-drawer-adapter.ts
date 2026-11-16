import { ICON_BY_ROUTE } from "~/components/layout/route-icons";
import type { Member } from "~/domain/auth/access/route-policy";
import {
  getSidebarChildren,
  getSidebarEntries,
  getSidebarGrouped,
  type SidebarEntry,
} from "~/domain/navigation/policy";

export interface DrawerNavChild {
  href: string;
  label: string;
}

export interface DrawerNavEntry {
  id: string;
  href: string;
  label: string;
  icon: SidebarEntry["icon"];
  tileColor: SidebarEntry["tileColor"];
  children: DrawerNavChild[];
  activePrefixes: string[];
}

export interface DrawerNavGroup {
  id: string;
  label: string;
  items: DrawerNavEntry[];
}

export function getMainPrimaryEntries(member: Member): DrawerNavEntry[] {
  return getSidebarEntries(member, "primary").map((entry) => ({
    id: entry.id,
    href: entry.href,
    label: entry.navLabel ?? entry.label,
    icon: entry.icon,
    tileColor: entry.tileColor,
    children: [],
    activePrefixes: entry.activePrefixes,
  }));
}

export function getMainSecondaryGroups(member: Member): DrawerNavGroup[] {
  const grouped = getSidebarGrouped(member, "secondary");

  return grouped.map((group, index) => ({
    id: group.label?.toLowerCase().replace(/\s+/g, "-") ?? `group-${index}`,
    label: group.label ?? "General",
    items: group.items.map((entry) => ({
      id: entry.id,
      href: entry.href,
      label: entry.navLabel ?? entry.label,
      icon: entry.icon,
      tileColor: entry.tileColor,
      children: getSidebarChildren(member, entry.id).map((child) => ({
        href: child.href,
        label: child.label,
      })),
      activePrefixes: entry.activePrefixes,
    })),
  }));
}

export function isEntryActive(pathname: string, entry: DrawerNavEntry) {
  return entry.activePrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function isChildActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function getEntryIcon(icon: SidebarEntry["icon"]) {
  return ICON_BY_ROUTE[icon];
}
