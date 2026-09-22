import type { ElementId, ReqElement, ReqNodeId, Requirement, RequirementIR, RequirementRelation, RequirementId } from "@gmermaid/ir";
import { REQ_NAME_RE, newId, omitUndefined } from "@gmermaid/ir";
import type { KindClipboard, MergeResult } from "./kind";
import { uniqueName } from "./kind";

/** Closure: a relation pulls both ends, induced relations come along. */
function slice(ir: RequirementIR, ids: ReadonlySet<string>): RequirementIR | undefined {
  const nodes = new Set<string>([
    ...ir.requirements.filter((r) => ids.has(r.id)).map((r) => r.id),
    ...ir.elements.filter((e) => ids.has(e.id)).map((e) => e.id),
  ]);
  for (const r of ir.relations) {
    if (!ids.has(r.id)) continue;
    nodes.add(r.from);
    nodes.add(r.to);
  }
  if (nodes.size === 0) return undefined;

  return omitUndefined({
    kind: "requirement" as const,
    direction: ir.direction,
    requirements: ir.requirements.filter((r) => nodes.has(r.id)),
    elements: ir.elements.filter((e) => nodes.has(e.id)),
    relations: ir.relations.filter((r) => nodes.has(r.from) && nodes.has(r.to)),
  });
}

function merge(ir: RequirementIR, inc: RequirementIR): MergeResult<RequirementIR> {
  if (inc.requirements.length === 0 && inc.elements.length === 0) {
    return { reason: "the clipboard holds an empty requirement diagram" };
  }

  // requirements and elements share ONE name space in mermaid
  const names = new Set([...ir.requirements.map((r) => r.name), ...ir.elements.map((e) => e.name)]);
  const map = new Map<string, ReqNodeId>();

  const requirements: Requirement[] = inc.requirements.flatMap((r) => {
    if (!REQ_NAME_RE.test(r.name)) return [];
    const id = newId("requirement");
    map.set(r.id, id);
    return [{ ...r, id, name: uniqueName(r.name, names) }];
  });
  const elements: ReqElement[] = inc.elements.flatMap((e) => {
    if (!REQ_NAME_RE.test(e.name)) return [];
    const id = newId("element");
    map.set(e.id, id);
    return [{ ...e, id, name: uniqueName(e.name, names) }];
  });

  const relations: RequirementRelation[] = inc.relations.flatMap((r) => {
    const from = map.get(r.from);
    const to = map.get(r.to);
    if (from === undefined || to === undefined) return [];
    return [{ ...r, id: newId("relation"), from, to }];
  });

  if (requirements.length === 0 && elements.length === 0) return { reason: "nothing in the clipboard could be pasted here" };

  return {
    // `direction` is the target's: a paste must not re-orient the diagram
    ir: {
      ...ir,
      requirements: [...ir.requirements, ...requirements],
      elements: [...ir.elements, ...elements],
      relations: [...ir.relations, ...relations],
    },
    added: [
      ...requirements.map((r) => r.id as RequirementId as string),
      ...elements.map((e) => e.id as ElementId as string),
      ...relations.map((r) => r.id as string),
    ],
  };
}

export const requirementClipboard: KindClipboard<RequirementIR> = { slice, merge };
