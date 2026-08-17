import { describe, expect, it } from "vitest";
import { coalesce, commit, initHistory, redo, undo } from "./history";

describe("history", () => {
  it("commit / undo / redo round-trip", () => {
    let h = initHistory(1);
    h = commit(h, 2);
    h = commit(h, 3);
    expect(h.present).toBe(3);
    h = undo(h);
    expect(h.present).toBe(2);
    h = redo(h);
    expect(h.present).toBe(3);
  });

  it("commit with identical reference is a no-op", () => {
    const h = initHistory(1);
    expect(commit(h, 1)).toBe(h);
  });

  it("coalesce replaces present without adding an undo step", () => {
    let h = initHistory("a");
    h = commit(h, "b");
    h = coalesce(h, "bc");
    h = coalesce(h, "bcd");
    expect(h.present).toBe("bcd");
    h = undo(h);
    expect(h.present).toBe("a");
  });
});
