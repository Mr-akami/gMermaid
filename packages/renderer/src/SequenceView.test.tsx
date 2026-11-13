import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { LifelineId, MessageId, SequenceIR } from "@gmermaid/ir";
import { fixedWidthMeasurer, layoutSequence } from "@gmermaid/layout";
import { pinnedHeads, SequenceView } from "./SequenceView";

const ir: SequenceIR = {
  kind: "sequence",
  lifelines: [
    { id: "a" as LifelineId, name: "Alice", kind: "participant" },
    { id: "b" as LifelineId, name: "Bob", kind: "actor" },
  ],
  boxes: [],
  events: Array.from({ length: 20 }, (_, i) => ({
    kind: "message" as const,
    id: `m${i}` as MessageId,
    from: "a" as LifelineId,
    to: "b" as LifelineId,
    label: `hi ${i}`,
    arrow: "solid" as const,
  })),
};

const layout = layoutSequence(ir, fixedWidthMeasurer());
const pinnedLayer = (html: string) => html.split("data-gm-pinned-heads")[1] ?? "";

describe("SequenceView pinned heads", () => {
  it("draws no pinned layer while the heads are on screen", () => {
    const html = renderToStaticMarkup(<SequenceView layout={layout} viewState={{}} viewport={{ x: 10, y: 10, scale: 1 }} />);
    expect(html).not.toContain("data-gm-pinned-heads");
  });

  it("pins every head to the canvas top once scrolled past", () => {
    const html = renderToStaticMarkup(<SequenceView layout={layout} viewState={{}} viewport={{ x: 10, y: -400, scale: 1 }} />);
    const layer = pinnedLayer(html);
    expect(layer).toContain('data-element-id="a"');
    expect(layer).toContain('data-element-id="b"');
    expect(layer).toContain("Alice");
    for (const p of pinnedHeads(layout.lifelines, { x: 10, y: -400, scale: 1 })) {
      expect(-400 + p.l.headRect.y + p.dy, "screen y just under the canvas top").toBeCloseTo(6);
    }
  });

  it("keeps a head inside its own spine", () => {
    const head = { ...layout.lifelines[0]!, spineBottom: 200 };
    const [p] = pinnedHeads([head], { x: 0, y: -10_000, scale: 1 });
    expect(p!.l.headRect.y + p!.dy + head.headRect.h).toBe(200);
  });
});
