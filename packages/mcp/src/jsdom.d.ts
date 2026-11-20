// The slice of jsdom `mermaidCheck.ts` uses — not worth a @types package.
declare module "jsdom" {
  export class JSDOM {
    constructor(html?: string, options?: { pretendToBeVisual?: boolean });
    readonly window: Window & typeof globalThis;
  }
}
