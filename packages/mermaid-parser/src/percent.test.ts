import { describe, expect, it } from "vitest";
import type { ClassIR, Message, SequenceIR, StateIR } from "@gmermaid/ir";
import { classToMermaid, sequenceToMermaid, stateToMermaid } from "@gmermaid/mermaid-codegen";
import { parseClassDiagram } from "./classdiagram";
import { parseSequence } from "./sequence";
import { parseStateDiagram } from "./statediagram";

// `%%` starts a comment for our own line preprocessor, so text carrying it
// has to travel as an entity or the import would cut the line short.
describe("percent pairs survive the kinds whose text sits outside quotes", () => {
  it("sequence message text", () => {
    const parsed = parseSequence("sequenceDiagram\n  A->>B: hi\n");
    if (!parsed.ok) throw new Error("setup");
    const first = parsed.ir.events[0] as Message;
    const ir: SequenceIR = { ...parsed.ir, events: [{ ...first, label: "50%% off" }] };
    const text = sequenceToMermaid(ir);
    expect(text).toContain("#37;#37;");
    const back = parseSequence(text);
    if (!back.ok) throw new Error("reparse");
    expect((back.ir.events[0] as Message).label).toBe("50%% off");
  });

  it("state transition label", () => {
    const parsed = parseStateDiagram("stateDiagram-v2\n  A --> B : go\n");
    if (!parsed.ok) throw new Error("setup");
    const ir: StateIR = { ...parsed.ir, transitions: [{ ...parsed.ir.transitions[0]!, label: "50%% off" }] };
    const back = parseStateDiagram(stateToMermaid(ir));
    if (!back.ok) throw new Error("reparse");
    expect(back.ir.transitions[0]?.label).toBe("50%% off");
  });

  it("class relation label", () => {
    const parsed = parseClassDiagram("classDiagram\n  class A\n  class B\n  A --> B : go\n");
    if (!parsed.ok) throw new Error("setup");
    const ir: ClassIR = { ...parsed.ir, relations: [{ ...parsed.ir.relations[0]!, label: "50%% off" }] };
    const back = parseClassDiagram(classToMermaid(ir));
    if (!back.ok) throw new Error("reparse");
    expect(back.ir.relations[0]?.label).toBe("50%% off");
  });

  it("a literal #37; the user typed is not read back as a percent", () => {
    const parsed = parseSequence("sequenceDiagram\n  A->>B: hi\n");
    if (!parsed.ok) throw new Error("setup");
    const first = parsed.ir.events[0] as Message;
    const ir: SequenceIR = { ...parsed.ir, events: [{ ...first, label: "#37; literally" }] };
    const back = parseSequence(sequenceToMermaid(ir));
    if (!back.ok) throw new Error("reparse");
    expect((back.ir.events[0] as Message).label).toBe("#37; literally");
  });
});
