import { createComponent, dynamic, type JSX } from "@solidjs/web";
import type { Component } from "solid-js";

// The JSX runtime MDX content compiles against. MDX names every HTML tag
// through a `_components` object so a page can replace it, and Solid's
// compiler reads `<_components.p>` as a component, not as the tag "p". MDX
// therefore emits runtime calls here, and a string tag renders as its element.

type Props = Record<string, unknown>;

export function jsx(
  type: string | Component<Props>,
  props: Props,
): JSX.Element {
  return createComponent(
    typeof type === "string" ? dynamic(() => type) : type,
    props,
  );
}

export const jsxs = jsx;
export const jsxDEV = jsx;

export function Fragment(props: { children?: JSX.Element }): JSX.Element {
  return props.children;
}
