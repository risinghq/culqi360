import { useLocation, useNavigate } from "@solidjs/router";
import { createEffect, createMemo, type ParentProps, Show } from "solid-js";

import {
  decideNavigation,
  isPublicPage,
  type NavigationDecision,
} from "~/domain/auth/access/navigation";
import { meQuery } from "~/rpc/auth/me";

const ALLOW: NavigationDecision = { kind: "allow" };

/**
 * Renders the page only where the viewer may be, and otherwise replaces the
 * location with where they belong. A public page renders without asking for
 * the session.
 */
export function NavigationGuard(props: ParentProps) {
  const location = useLocation();
  const navigate = useNavigate();

  const decision = createMemo(async () => {
    const pathname = location.pathname;
    return isPublicPage(pathname)
      ? ALLOW
      : decideNavigation(await meQuery(), pathname);
  });

  createEffect(decision, (current) => {
    if (current.kind === "redirect") {
      navigate(current.to, { replace: true });
    }
  });

  return <Show when={decision().kind === "allow"}>{props.children}</Show>;
}
