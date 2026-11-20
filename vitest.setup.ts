// Node 25+ defines a global `localStorage` of its own (Web Storage, enabled by
// default and `undefined` without `--localstorage-file`). It is already on the
// global when vitest's jsdom environment copies the window's properties over,
// so jsdom's storage is skipped and every `localStorage.*` call throws. Put
// jsdom's back. CI runs Node 24, which has no such global — this is for the
// machines that run something newer.
const dom = (globalThis as { jsdom?: { window: Window } }).jsdom;
if (dom !== undefined) {
  for (const key of ["localStorage", "sessionStorage"] as const) {
    Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true, writable: true });
  }
}
