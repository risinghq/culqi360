import type { SessionClass } from "../core/session-contract";
import { canAccessPath, getDefaultAppPath, type Member } from "./route-policy";

// The page trees under routes/(auth) and routes/(public).
const PUBLIC_PAGE_PREFIXES = [
  "/login",
  "/reset-password",
  "/updates",
  "/docs",
  "/legal",
];

export type NavigationViewer = Member & { sessionClass: SessionClass };

export type NavigationDecision =
  | { kind: "allow" }
  | { kind: "redirect"; to: string };

const ALLOW: NavigationDecision = { kind: "allow" };

export function isPublicPage(pathname: string): boolean {
  return PUBLIC_PAGE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Where the browser may go. A session that has not finished sign-in is held on
 * its one page, and an app session that opens a page its member cannot use
 * lands on its home page instead. This is navigation only: every server
 * function and API route authorizes its own caller.
 */
export function decideNavigation(
  viewer: NavigationViewer | null,
  pathname: string,
): NavigationDecision {
  if (isPublicPage(pathname)) {
    return ALLOW;
  }
  if (!viewer) {
    return redirect("/login");
  }

  switch (viewer.sessionClass) {
    case "pre_auth":
      return holdOn("/onboarding", pathname);
    case "recovery_setup":
      return holdOn("/recovery-codes", pathname);
    case "app":
      return decideAppNavigation(viewer, pathname);
    default:
      return viewer.sessionClass satisfies never;
  }
}

function decideAppNavigation(
  member: Member,
  pathname: string,
): NavigationDecision {
  const isSignInStep =
    pathname === "/" ||
    pathname === "/onboarding" ||
    pathname === "/recovery-codes";

  if (isSignInStep || !canAccessPath(member, pathname)) {
    return redirect(getDefaultAppPath(member));
  }
  return ALLOW;
}

function holdOn(page: string, pathname: string): NavigationDecision {
  return pathname === page ? ALLOW : redirect(page);
}

function redirect(to: string): NavigationDecision {
  return { kind: "redirect", to };
}
