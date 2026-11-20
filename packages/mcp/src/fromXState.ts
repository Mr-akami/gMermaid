import { stateToMermaid } from "@gmermaid/mermaid-codegen";
import { sketchXStateSource } from "@gmermaid/xstate";

// `gmermaid from-xstate <file>`: draw a machine written as code (TypeScript,
// function transitions, `createAsyncLogic` actors) as a stateDiagram, for an
// agent to `open` like any other diagram. A read-only picture — the source
// is never written back; see packages/xstate/src/sketch.ts.

export type Drawn =
  | { readonly ok: true; readonly mermaid: string; readonly notes: readonly string[] }
  | { readonly ok: false; readonly message: string };

export function drawMachine(file: string, source: string, machine?: string): Drawn {
  const r = sketchXStateSource(source);
  if (!r.ok) return { ok: false, message: r.errors.map((e) => `${file}:${e.line}: error: ${e.message}`).join("\n") };
  const names = r.machines.map((m) => m.name);
  const picked = machine === undefined ? (r.machines.length === 1 ? r.machines[0] : undefined) : r.machines.find((m) => m.name === machine);
  if (picked === undefined) {
    return {
      ok: false,
      message:
        machine === undefined
          ? `${file}: ${names.length} machines (${names.join(", ")}) — pick one with --machine NAME`
          : `${file}: no machine named \`${machine}\` (found: ${names.join(", ")})`,
    };
  }
  return { ok: true, mermaid: stateToMermaid(picked.ir), notes: picked.warnings.map((w) => `${file}:${w.line}: note: ${w.message}`) };
}
