import { useNavigate } from "@solidjs/router";
import {
  createContext,
  Loading,
  type ParentProps,
  Show,
  useContext,
} from "solid-js";

import { Spinner } from "~/components/feedback/spinner/spinner";
import type { CurrentUserView } from "~/contracts/auth";

import { SessionProvider, useSession } from "./session-provider";

interface AuthenticatedSessionContextValue {
  currentUser: () => CurrentUserView;
  updateCurrentUser: (
    update: (current: CurrentUserView) => CurrentUserView,
  ) => void;
  refreshCurrentUser: () => void;
}

const AuthenticatedSessionContext =
  createContext<AuthenticatedSessionContextValue>();

/**
 * The navigation guard already sends a signed-out viewer to the login page, so
 * this only catches a session that ends while the page is open.
 */
function RedirectToLogin() {
  useNavigate()("/login", { replace: true });
  return null;
}

function AuthenticatedSessionBoundary(props: ParentProps) {
  const { user, updateCurrentUser, refreshCurrentUser } = useSession();

  return (
    <Show when={user()} fallback={<RedirectToLogin />}>
      {(currentUser) => (
        <AuthenticatedSessionContext
          value={{ currentUser, updateCurrentUser, refreshCurrentUser }}
        >
          {props.children}
        </AuthenticatedSessionContext>
      )}
    </Show>
  );
}

export function AuthenticatedSessionProvider(props: ParentProps) {
  return (
    <SessionProvider>
      <Loading fallback={<Spinner />}>
        <AuthenticatedSessionBoundary>
          {props.children}
        </AuthenticatedSessionBoundary>
      </Loading>
    </SessionProvider>
  );
}

export function useAuthenticatedSession() {
  const context = useContext(AuthenticatedSessionContext);

  if (!context) {
    throw new Error(
      "useAuthenticatedSession must be used within AuthenticatedSessionProvider",
    );
  }

  return context;
}
