# Cookies

Choose the cookie API by where the cookie is read or written. `serializeCookie`
and `parseCookieHeader` come from `@solidjs/web`.

| Situation                                           | Use                                                                               |
| --------------------------------------------------- | --------------------------------------------------------------------------------- |
| Read or write a cookie during the current request   | `readCookie`, `writeCookie`, `expireCookie` from `~/server/platform/http/cookies` |
| Build or parse a cookie header on a manual response | `serializeCookie`, `parseCookieHeader`                                            |

The browser writes no cookies. A UI preference that only the browser reads
(theme, panel widths, drawer state, last sign-in method) goes in localStorage
through [`ui-preference.ts`](../apps/web/src/browser/ui/ui-preference.ts).

## Request cookies

Server code reads and writes cookies through
[`cookies.ts`](../apps/web/src/server/platform/http/cookies.ts). It throws
outside a request scope: call it from middleware, a server function, or an API
handler. The session cookie in
[`session/cookies.ts`](../apps/web/src/server/auth/session/cookies.ts) uses it.

## Header strings

Use `serializeCookie` and `parseCookieHeader` directly when no request scope
exists or when the code handles header strings itself.
[`google-oauth-cookies.ts`](../apps/web/src/server/auth/google/google-oauth-cookies.ts)
builds `Set-Cookie` header strings for the OAuth redirect and callback.
