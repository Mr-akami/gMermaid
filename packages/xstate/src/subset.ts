/** The accepted XState subset, in the words the UI shows. Kept next to the
 * reader so the promise and the code cannot drift apart. */
export const XSTATE_SUBSET = [
  "XState v5 only. The machine config must be plain data: `createMachine({ … })`,",
  "`setup({ … }).createMachine({ … })`, or a bare `{ … }` object.",
  "Inline functions, calls and identifier references are refused — name actions,",
  "guards, actors and delays in `setup({ … })` and reference them as strings.",
  "`context` and the `setup({ … })` argument are carried through verbatim, unread.",
].join(" ");
