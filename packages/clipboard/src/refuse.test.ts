import { describe, expect, it } from "vitest";
import type { ClassIR, GanttIR, MindmapIR, SequenceIR, StateIR } from "@gmermaid/ir";
import { emptyFlowchart, emptyMindmap, emptyStateDiagram } from "@gmermaid/ir";
import { copySelection, pasteInto } from "./clipboard";
import { FIXTURES } from "./fixtures";

const fixture = (name: string) => FIXTURES.find((f) => f.name === name)!;

describe("copy refuses what cannot be a diagram", () => {
  it("says nothing about an empty selection", () => {
    for (const f of FIXTURES) expect(copySelection(f.ir, []), f.name).toBeUndefined();
  });

  it("says nothing about ids that are not in the diagram", () => {
    for (const f of FIXTURES) expect(copySelection(f.ir, ["nope", "also-nope"]), f.name).toBeUndefined();
  });

  it("says nothing about a create/destroy whose message stayed behind", () => {
    // mermaid reads both as a prefix on the next message; without it there is
    // no statement left to write, so the selection copies to nothing
    expect(copySelection(fixture("sequence").ir, ["lfc_00000001", "lfc_00000002"])).toBeUndefined();
  });

  it("drops a create whose message stayed behind but keeps the rest", () => {
    // the next surviving message goes to Alice, not to the created Temp
    const text = copySelection(fixture("sequence").ir, ["lfc_00000001", "msg_00000007"])!;
    expect(text).not.toContain("create");
    expect(text).toContain("bye");
  });

  it("says nothing about two disjoint mindmap subtrees — a mindmap has one root", () => {
    const mindmap = fixture("mindmap");
    expect(copySelection(mindmap.ir, ["mmn_00000002", "mmn_00000004"])).toBeUndefined();
    // …but either one on its own is fine
    expect(copySelection(mindmap.ir, ["mmn_00000002"])).toBeDefined();
    expect(copySelection(mindmap.ir, ["mmn_00000004"])).toBeDefined();
  });
});

describe("paste refuses what it cannot make sense of", () => {
  it("refuses an empty clipboard", () => {
    const r = pasteInto(emptyFlowchart(), "   \n  ");
    expect(r).toEqual({ ok: false, reason: "the clipboard is empty" });
  });

  it("refuses prose a user pasted onto the canvas by accident", () => {
    const r = pasteInto(emptyFlowchart(), "Dear team,\n\nplease review the attached plan.\n");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("the clipboard does not hold a mermaid diagram");
  });

  it("refuses the wrong kind with a sentence naming both", () => {
    const sequenceText = copySelection(fixture("sequence").ir, ["msg_00000001"])!;
    const r = pasteInto(emptyFlowchart(), sequenceText);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("cannot paste a sequence diagram into a flowchart");
  });

  it("refuses mermaid of the right kind that does not parse, carrying the error", () => {
    const r = pasteInto(emptyStateDiagram(), "stateDiagram-v2\n  A --> B\n  }\n");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/^line 3: /);
  });

  it("refuses a diagram with nothing in it", () => {
    const r = pasteInto(emptyFlowchart(), "flowchart TB\n");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("the clipboard holds an empty flowchart");
  });

  it("drops a reference to something that did not come along", () => {
    // `after nothing` names a task the clipboard does not carry: the start
    // degrades to "where the previous task ends" rather than dangling
    const gantt = fixture("gantt");
    const r = pasteInto(gantt.ir, "gantt\n  section X\n  Solo :s1, after nothing, 3d\n");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ir = r.ir as GanttIR;
    const task = ir.sections.at(-1)!.tasks[0]!;
    expect(task.start).toEqual({ kind: "prev" });
  });

  it("drops a task whose `until` names nothing that came along, and refuses if that is all there was", () => {
    const r = pasteInto(fixture("gantt").ir, "gantt\n  section X\n  Solo :s1, 2024-01-01, until nothing\n");
    expect(r).toEqual({ ok: false, reason: "nothing in the clipboard could be pasted here" });
  });
});

describe("paste keeps identities unique", () => {
  it("suffixes a class name that is already taken", () => {
    const f = fixture("class");
    const text = copySelection(f.ir, ["cls_00000003"])!;
    const once = pasteInto(f.ir, text);
    expect(once.ok).toBe(true);
    if (!once.ok) return;
    const twice = pasteInto(once.ir, text);
    expect(twice.ok).toBe(true);
    if (!twice.ok) return;
    expect((twice.ir as ClassIR).classes.map((c) => c.name)).toEqual(["Shape", "Square", "Canvas", "Canvas_2", "Canvas_3"]);
  });

  it("suffixes a lifeline name that is already taken", () => {
    const f = fixture("sequence");
    const text = copySelection(f.ir, ["lfl_00000001"])!;
    const once = pasteInto(f.ir, text);
    expect(once.ok).toBe(true);
    if (!once.ok) return;
    expect((once.ir as SequenceIR).lifelines.map((l) => l.name)).toEqual(["Alice", "Bob", "DB", "Temp", "Alice_2"]);
  });

  it("suffixes a gantt task id, and re-points the dependencies that name it", () => {
    const f = fixture("gantt");
    const text = copySelection(f.ir, ["tsk_00000003"])!;
    const pasted = pasteInto(f.ir, text);
    expect(pasted.ok).toBe(true);
    if (!pasted.ok) return;
    const tasks = (pasted.ir as GanttIR).sections.flatMap((s) => s.tasks);
    expect(tasks.map((t) => t.taskId)).toEqual(["k1", "d1", "i1", undefined, "k1_2", "d1_2", "i1_2"]);
    // the pasted `Implement` follows the pasted `Design`, not the original one
    expect(tasks.at(-1)!.start).toEqual({ kind: "after", ids: ["d1_2"] });
  });

  it("re-mints every id, so pasting twice gives two copies", () => {
    const f = fixture("flowchart");
    const text = copySelection(f.ir, ["nod_00000001"])!;
    const once = pasteInto(f.ir, text);
    expect(once.ok).toBe(true);
    if (!once.ok) return;
    const twice = pasteInto(once.ir, text);
    expect(twice.ok).toBe(true);
    if (!twice.ok) return;
    expect(twice.ir.kind === "flowchart" && twice.ir.nodes.filter((n) => n.label === "Start")).toHaveLength(3);
  });
});

describe("what the text form cannot carry", () => {
  it("leaves XState-only detail behind, because mermaid cannot spell it", () => {
    const f = fixture("state");
    const source = f.ir as StateIR;
    const withXState: StateIR = {
      ...source,
      xstate: { id: "machine" },
      states: source.states.map((s) => (s.id === "stt_00000001" ? { ...s, xstate: { entry: ["log"] } } : s)),
    };
    const text = copySelection(withXState, ["stt_00000001"])!;
    expect(text).not.toContain("log");

    const pasted = pasteInto(emptyStateDiagram(), text);
    expect(pasted.ok).toBe(true);
    if (!pasted.ok) return;
    // the original keeps its extension; the copy is the mermaid half (ADR 0002)
    expect((pasted.ir as StateIR).states.every((s) => s.xstate === undefined)).toBe(true);
  });
});

describe("paste stays inside what the reducers allow", () => {
  it("merges a pasted top-level [*] with the one already there", () => {
    const f = fixture("state");
    const text = copySelection(f.ir, ["trn_00000001"])!; // `[*] --> Idle`
    expect(text).toContain("[*]");
    const pasted = pasteInto(f.ir, text);
    expect(pasted.ok).toBe(true);
    if (!pasted.ok) return;
    const ir = pasted.ir as StateIR;
    expect(ir.states.filter((s) => s.role === "start" && s.parent === undefined)).toHaveLength(1);
  });

  it("folds two [*] promoted out of different blocks into one", () => {
    const f = fixture("state");
    // two transitions out of two different `[*]`, one of them a composite's
    // own, which promotion would otherwise collide at the top level
    const text = copySelection(f.ir, ["trn_00000001", "trn_00000003"])!;
    expect(text.match(/\[\*\] -->/g)).toHaveLength(2); // two arrows, one state
    const pasted = pasteInto(emptyStateDiagram(), text);
    expect(pasted.ok).toBe(true);
    if (!pasted.ok) return;
    expect((pasted.ir as StateIR).states.filter((s) => s.role === "start")).toHaveLength(1);
  });

  it("hangs a pasted mindmap under the root it lands in", () => {
    const f = fixture("mindmap");
    const text = copySelection(f.ir, ["mmn_00000003"])!;
    const pasted = pasteInto(f.ir, text);
    expect(pasted.ok).toBe(true);
    if (!pasted.ok) return;
    const ir = pasted.ir as MindmapIR;
    expect(ir.nodes.filter((n) => n.parent === undefined)).toHaveLength(1);
    expect(ir.nodes.filter((n) => n.label === "Right")).toHaveLength(2);
  });

  it("gives an empty mindmap its root", () => {
    const f = fixture("mindmap");
    const text = copySelection(f.ir, ["mmn_00000003"])!;
    const pasted = pasteInto(emptyMindmap(), text);
    expect(pasted.ok).toBe(true);
    if (!pasted.ok) return;
    const ir = pasted.ir as MindmapIR;
    expect(ir.nodes.find((n) => n.parent === undefined)?.label).toBe("Right");
  });
});
