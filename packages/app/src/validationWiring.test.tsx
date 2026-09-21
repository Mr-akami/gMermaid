// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

// Mermaid's verdict and our own parser's verdict are two signals, and they
// must stay apart: persistence follows ours, the review submit follows both.
// Only the CodePane has to be reached here, so CodeMirror (needs a layout
// engine) and the canvas-backed measurer are stubbed; the validator is the
// real mermaid.
vi.mock("./measurer", () => ({
  measurer: { measure: (text: string, style: { fontSize: number }) => ({ w: text.length * style.fontSize * 0.6, h: style.fontSize * 1.4 }) },
}));
vi.mock("@uiw/react-codemirror", () => ({
  default: ({ value }: { value: string }) => <pre className="cm-content">{value}</pre>,
  ExternalChange: { of: () => ({}) },
}));

const { ReviewApp } = await import("./ReviewApp");
const { FlowchartEditor } = await import("./FlowchartEditor");

// gMermaid's own parser accepts this; mermaid does not, because `subgraph` is
// one of its keywords (the user's subgraph-id bug).
const MERMAID_REJECTS = 'flowchart TB\n  a["A"]\n  subgraph subgraph-1["G"]\n  end\n  a --> subgraph-1\n';
const EDITED_REJECTS = 'flowchart TB\n  a["A"]\n  subgraph subgraph-2["G2"]\n  end\n  a --> subgraph-2\n';
const FINE = 'flowchart TB\n  a["A"] --> b["B"]\n';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

beforeEach(() => localStorage.clear());
afterEach(async () => {
  const r = root;
  if (r) await act(async () => r.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

/** Let time pass in small steps. One long `act` would hold every state update
 * back until it ends, which hides exactly the ordering these tests are about
 * (a verdict landing before or after the autosave timer). */
async function settle(ms = 1_500): Promise<void> {
  for (let elapsed = 0; elapsed < ms; elapsed += 50) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
  }
}

/** Mount `node` and let the debounced validator load mermaid and answer. */
async function mount(node: ReactNode): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const r = root;
  await act(async () => {
    r.render(node);
  });
  await settle();
  return container;
}

function submitButton(host: HTMLElement): HTMLButtonElement {
  const button = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("LLMへ返す"));
  expect(button, "the submit button should be rendered").toBeDefined();
  return button as HTMLButtonElement;
}

it("disables the review submit when mermaid rejects the diagram's text", async () => {
  const host = await mount(<ReviewApp sessionId="s1" kind="flowchart" mermaid={MERMAID_REJECTS} onSubmit={async () => {}} />);
  expect(submitButton(host).disabled).toBe(true);
  expect(host.querySelector(".code-mermaid-error")).not.toBeNull();
});

it("leaves the review submit enabled for text mermaid accepts", async () => {
  const host = await mount(<ReviewApp sessionId="s2" kind="flowchart" mermaid={FINE} onSubmit={async () => {}} />);
  expect(submitButton(host).disabled).toBe(false);
  expect(host.querySelector(".code-mermaid-error")).toBeNull();
});

// The other half of the split: a diagram our parser accepts lives in the IR,
// so it is real work and keeps being saved — mermaid's opinion of the
// generated text must never stop persistence (whole diagram families have had
// codegen bugs of exactly that shape).
it("keeps autosaving a diagram mermaid rejects", async () => {
  const host = await mount(<FlowchartEditor initialCode={MERMAID_REJECTS} />);
  expect(host.querySelector(".code-mermaid-error"), "mermaid should have refused this text").not.toBeNull();

  // edit the diagram AFTER the rejection is on screen, so the save under test
  // cannot be one that raced ahead of the verdict
  localStorage.clear();
  const r = root as Root;
  await act(async () => {
    r.render(<FlowchartEditor initialCode={MERMAID_REJECTS} loadRequest={{ seq: 1, code: EDITED_REJECTS }} />);
  });
  await settle();

  expect(host.querySelector(".code-mermaid-error"), "still rejected after the edit").not.toBeNull();
  const stored = localStorage.getItem("gmermaid:doc:flowchart");
  expect(stored, "work mermaid dislikes is still real work: it must be autosaved").not.toBeNull();
  expect(JSON.parse(stored as string).code).toContain("subgraph-2");
});
