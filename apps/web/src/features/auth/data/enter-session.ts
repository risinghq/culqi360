import { revalidate } from "@solidjs/router";

import { meQuery } from "~/rpc/auth/me";

// The navigation guard routes on meQuery's session class. After a server
// function replaces the session cookie, the cached viewer still holds the old
// class, so the guard would send the next page back to the step just finished.
// Marking it stale makes the guard's next read fetch the new class.
export function enterSession(navigate: (to: string) => void, to: string): void {
  revalidate(meQuery.key);
  navigate(to);
}
