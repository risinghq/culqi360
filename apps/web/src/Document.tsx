import { getRequestEvent, HydrationScript, NoHydration } from "@solidjs/web";
import type { ParentProps } from "solid-js";

import favicon from "~/assets/images/logo/logo.ico";

/**
 * The HTML shell wrapped around <App /> by Root.tsx.
 * Request-specific metadata and the client entry script live under
 * <NoHydration> because the browser has no request event when it renders this
 * tree.
 */
export default function Document(props: ParentProps) {
  const requestEvent = getRequestEvent();

  return (
    <html lang="es">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <NoHydration>
          <script
            type="module"
            src="/src/entry-client.tsx"
            nonce={requestEvent?.locals.nonce}
            async
          />
        </NoHydration>
        <link rel="icon" type="image/x-icon" href={favicon} />
        <HydrationScript />
      </head>
      <body>{props.children}</body>
    </html>
  );
}
