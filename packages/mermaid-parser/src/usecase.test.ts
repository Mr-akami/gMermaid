import { describe, expect, it } from "vitest";
import type { ActorId, BoundaryId, NoteId, UseCaseId, UsecaseIR, UsecaseRelationId } from "@gmermaid/ir";
import { usecaseToMermaid } from "@gmermaid/mermaid-codegen";
import { parseUsecase } from "./usecase";

const A = (s: string) => s as ActorId;
const U = (s: string) => s as UseCaseId;
const B = (s: string) => s as BoundaryId;
const R = (s: string) => s as UsecaseRelationId;

describe("parseUsecase", () => {
  it("parses the docs' opening example", () => {
    const result = parseUsecase(`usecase-beta
direction LR
actor Customer("Customer")
systemBoundary "Order system"
  Checkout("Place order")
end
Customer --> Checkout
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir).toEqual({
      kind: "usecase",
      direction: "LR",
      actors: [{ id: "Customer", name: "Customer", variant: "default" }],
      usecases: [{ id: "Checkout", name: "Checkout", shape: "ellipse", label: "Place order", boundary: "Order_system" }],
      boundaries: [{ id: "Order_system", name: "Order_system", label: "Order system", type: "default" }],
      relations: [{ id: "relation-1", from: "Customer", to: "Checkout", line: "solid", headFrom: "none", headTo: "arrow" }],
      notes: [],
    });
  });

  it("creates implicit ellipse use cases and upgrades later `actor` declarations", () => {
    const result = parseUsecase(`usecase-beta
Customer --> Login
actor Customer
actor Admin("Main administrator")
Login("Sign in")
Report[Generate report]
"Reset password"
Admin --> Report
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.actors).toEqual([
      { id: "Customer", name: "Customer", variant: "default" },
      { id: "Admin", name: "Admin", variant: "default", label: "Main administrator" },
    ]);
    expect(result.ir.usecases).toEqual([
      { id: "Login", name: "Login", shape: "ellipse", label: "Sign in" },
      { id: "Report", name: "Report", shape: "rect", label: "Generate report" },
      // a quoted declaration gets mermaid's deterministic identifier
      { id: "Reset_password", name: "Reset_password", shape: "ellipse", label: "Reset password" },
    ]);
  });

  it("parses actor variants, business flags and stereotypes", () => {
    const result = parseUsecase(`usecase-beta
actor SalesAgent("Sales agent")@{ business: true } <<Employee>>
actor Broker@{ type: hollow, business: true }
actor Robot("Robot")@{ type: awesome }
actor Icon("Icon")@{ icon: "fa:user" }
Quote("Prepare quote")@{ business: true } <<Core>>
Archive[Archive quote] <<Record>>
SalesAgent --> Quote
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.actors).toEqual([
      { id: "SalesAgent", name: "SalesAgent", variant: "default", label: "Sales agent", business: true, stereotype: "Employee" },
      { id: "Broker", name: "Broker", variant: "hollow", business: true },
      { id: "Robot", name: "Robot", variant: "awesome" },
      // `icon` has no IR: the actor stays a default stick figure
      { id: "Icon", name: "Icon", variant: "default" },
    ]);
    expect(result.ir.usecases).toEqual([
      { id: "Quote", name: "Quote", shape: "ellipse", label: "Prepare quote", business: true, stereotype: "Core" },
      { id: "Archive", name: "Archive", shape: "rect", label: "Archive quote", stereotype: "Record" },
    ]);
  });

  it("parses every relation operator, labels and include / extend", () => {
    const result = parseUsecase(`usecase-beta
actor User
actor Support
User --> Start
Start <-- Support
Start -- Finish
User --o Start
Start o-- Support
User --x Finish
Finish x-- Support
User --|> Support
Checkout ..> : include Payment
ApplyCoupon ..> : extend Checkout
User -- "files R&D report" --> Finish
User o-- "watches" -- Start
User -- "long" ---> Payment
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.relations.map((r) => [r.from, r.to, r.headFrom, r.headTo, r.line, r.kind, r.label])).toEqual([
      ["User", "Start", "none", "arrow", "solid", undefined, undefined],
      ["Start", "Support", "arrow", "none", "solid", undefined, undefined],
      ["Start", "Finish", "none", "none", "solid", undefined, undefined],
      ["User", "Start", "none", "circle", "solid", undefined, undefined],
      ["Start", "Support", "circle", "none", "solid", undefined, undefined],
      ["User", "Finish", "none", "cross", "solid", undefined, undefined],
      ["Finish", "Support", "cross", "none", "solid", undefined, undefined],
      ["User", "Support", "none", "inheritance", "solid", undefined, undefined],
      ["Checkout", "Payment", "none", "none", "dashed", "include", undefined],
      ["ApplyCoupon", "Checkout", "none", "none", "dashed", "extend", undefined],
      ["User", "Finish", "none", "arrow", "solid", undefined, "files R&D report"],
      ["User", "Start", "circle", "none", "solid", undefined, "watches"],
      // extra dashes only ask for a longer edge — the IR has no length
      ["User", "Payment", "none", "arrow", "solid", undefined, "long"],
    ]);
  });

  it("parses boundaries with inline and deferred metadata, and notes", () => {
    const result = parseUsecase(`usecase-beta
systemBoundary sb1["Payment service"]@{ type: package }:::system
  actor Clerk("Payment clerk")
  Authorize("Authorize payment")
end
systemBoundary "Fulfilment"
  Track("Track delivery")
end
Fulfilment@{ type: package }
note for Authorize "checks the #quot;limit#quot;"
Clerk --> Authorize
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.boundaries).toEqual([
      { id: "sb1", name: "sb1", label: "Payment service", type: "package" },
      // the title is also the identifier here, so it carries no extra label
      { id: "Fulfilment", name: "Fulfilment", type: "package" },
    ]);
    expect(result.ir.actors[0]!.boundary).toBe("sb1");
    expect(result.ir.usecases.map((u) => [u.name, u.boundary])).toEqual([
      ["Authorize", "sb1"],
      ["Track", "Fulfilment"],
    ]);
    expect(result.ir.notes).toEqual([{ id: "note-1", target: "Authorize", text: 'checks the "limit"' }]);
  });

  it("drops styling, accessibility, edge ids and json tables", () => {
    const result = parseUsecase(`---
title: ignored
---
%%{init: {}}%%
usecase-beta
accTitle: Account access
accDescr {
  two lines
  of description
}
%% a comment
actor Customer:::external
Checkout("Checkout"):::critical
json Payload@{
  "a": 1,
  "b": { "c": 2 }
}:::data
Customer starts@-- "places order" ---> Checkout
Checkout pays@..> : include Payment
classDef data stroke:#3572a5
class Customer external
style Checkout stroke:#c33
starts@{ animation: fast }
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.actors.map((a) => a.name)).toEqual(["Customer"]);
    expect(result.ir.usecases.map((u) => u.name)).toEqual(["Checkout", "Payment"]);
    expect(result.ir.relations.map((r) => [r.from, r.to, r.label, r.kind])).toEqual([
      ["Customer", "Checkout", "places order", undefined],
      ["Checkout", "Payment", undefined, "include"],
    ]);
  });

  it("reports a wrong header, an unclosed boundary and junk lines", () => {
    expect(parseUsecase("flowchart LR\nA-->B").ok).toBe(false);
    const unclosed = parseUsecase("usecase-beta\nsystemBoundary sb\n  A\n");
    expect(unclosed.ok).toBe(false);
    if (!unclosed.ok) expect(unclosed.errors[0]!.message).toContain("unclosed systemBoundary");
    const junk = parseUsecase("usecase-beta\nA --> B\n???\n");
    expect(junk.ok).toBe(false);
    if (!junk.ok) expect(junk.errors[0]!.message).toContain("cannot parse");
    const nested = parseUsecase("usecase-beta\nsystemBoundary sb\n  A --> B\nend\n");
    expect(nested.ok).toBe(false);
    if (!nested.ok) expect(nested.errors[0]!.message).toContain("only declarations");
  });

  it("round-trips: parse(gen(ir)) == ir, and gen is stable", () => {
    const ir: UsecaseIR = {
      kind: "usecase",
      direction: "LR",
      actors: [
        { id: A("Customer"), name: "Customer", variant: "default", label: 'the "customer"' },
        { id: A("Staff"), name: "Staff", variant: "hollow", business: true, stereotype: "Employee" },
        { id: A("Clerk"), name: "Clerk", variant: "awesome", boundary: B("ordering") },
      ],
      usecases: [
        { id: U("Browse"), name: "Browse", shape: "ellipse", label: "Browse products" },
        { id: U("Report"), name: "Report", shape: "rect" },
        { id: U("Checkout"), name: "Checkout", shape: "ellipse", business: true, stereotype: "Core", boundary: B("ordering") },
        { id: U("Payment"), name: "Payment", shape: "rect", label: "Process payment", boundary: B("ordering") },
      ],
      boundaries: [{ id: B("ordering"), name: "ordering", label: "Ordering System", type: "package" }],
      relations: [
        { id: R("relation-1"), from: A("Customer"), to: U("Browse"), line: "solid", headFrom: "none", headTo: "arrow", label: "places < order" },
        { id: R("relation-2"), from: U("Checkout"), to: U("Payment"), line: "dashed", headFrom: "none", headTo: "none", kind: "include" },
        { id: R("relation-3"), from: A("Staff"), to: U("Report"), line: "solid", headFrom: "circle", headTo: "none" },
        { id: R("relation-4"), from: A("Clerk"), to: A("Customer"), line: "solid", headFrom: "none", headTo: "inheritance" },
        { id: R("relation-5"), from: U("Browse"), to: U("Report"), line: "solid", headFrom: "none", headTo: "none" },
      ],
      notes: [{ id: "note-1" as NoteId, target: U("Checkout"), text: "validates the cart\nbefore payment" }],
    };
    const code = usecaseToMermaid(ir);
    const back = parseUsecase(code);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.ir).toEqual(ir);
    expect(usecaseToMermaid(back.ir)).toBe(code);
  });
});
