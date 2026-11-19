import type { ParentProps } from "solid-js";

import favicon from "~/assets/images/logo/logo.ico";

/**
 * The static HTML shell. The build prerenders it once into
 * dist/client/index.html, so it reads nothing from the request. The plugin adds
 * the client entry script, and the browser renders <App /> into the body.
 */
export default function Document(props: ParentProps) {
  return (
    <html lang="es">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" type="image/x-icon" href={favicon} />
      </head>
      <body>{props.children}</body>
    </html>
  );
}
