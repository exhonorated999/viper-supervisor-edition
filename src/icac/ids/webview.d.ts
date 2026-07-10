// Ambient JSX typing for Electron's <webview> custom element so TSX accepts it.
// Only the attributes we actually use are declared. In the plain-web build the
// element is inert (unknown custom element) and we never render it.
import type { DetailedHTMLProps, HTMLAttributes } from "react";

declare global {
  namespace JSX {
    interface IntrinsicElements {
      webview: DetailedHTMLProps<
        HTMLAttributes<HTMLElement> & {
          src?: string;
          partition?: string;
          allowpopups?: boolean | string;
          useragent?: string;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ref?: any;
        },
        HTMLElement
      >;
    }
  }
}

export {};
