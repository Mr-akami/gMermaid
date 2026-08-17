import { describe, expect, it } from "vitest";
import { SessionStore } from "./session";

describe("SessionStore", () => {
  it("moves a review from pending to confirmed", () => {
    const store = new SessionStore();
    const session = store.create("flowchart", "flowchart TB\n  A --> B");
    expect(store.result(session.id)).toMatchObject({ status: "pending", kind: "flowchart" });

    expect(store.confirm(session.id, "flowchart TB\n  A --> C", session.token)).toEqual({
      status: "confirmed",
      sessionId: session.id,
      kind: "flowchart",
      mermaid: "flowchart TB\n  A --> C",
      changed: true,
    });
  });

  it("makes identical confirmation idempotent and rejects conflicting confirmation", () => {
    const store = new SessionStore();
    const session = store.create("class", "classDiagram\n  class A");
    store.confirm(session.id, session.originalMermaid);
    expect(store.confirm(session.id, session.originalMermaid)).toMatchObject({ status: "confirmed", changed: false });
    expect(() => store.confirm(session.id, "classDiagram\n  class B")).toThrow("already confirmed");
  });

  it("does not expose a session through a wrong browser token", () => {
    const store = new SessionStore();
    const session = store.create("sequence", "sequenceDiagram\n  A->>B: hi");
    expect(store.getSession(session.id, "wrong")).toBeUndefined();
    expect(store.getSession(session.id, session.token)).toBeDefined();
  });

  it("expires sessions", () => {
    let now = 100;
    const store = new SessionStore(50, 20, () => now);
    const session = store.create("flowchart", "flowchart TB\n  A");
    now = 151;
    expect(store.result(session.id)).toEqual({ status: "expired", sessionId: session.id });
  });

  it("wakes a waiter when the user confirms", async () => {
    const store = new SessionStore();
    const session = store.create("flowchart", "flowchart TB\n  A");
    const waiting = store.wait(session.id, 1_000);
    store.confirm(session.id, "flowchart TB\n  B");
    await expect(waiting).resolves.toMatchObject({ status: "confirmed", mermaid: "flowchart TB\n  B" });
  });
});
