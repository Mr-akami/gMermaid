import type { ElementId, RelationId, RequirementId } from "./ids";
import type {
  ReqElement,
  ReqNodeId,
  Requirement,
  RequirementDirection,
  RequirementIR,
  RequirementRelation,
  RequirementRelationType,
  RequirementType,
  RiskLevel,
  VerifyMethod,
} from "./requirement";
import { omitUndefined } from "./omitUndefined";

// Mermaid identifies requirement / element nodes by NAME, shared across both
// kinds, so names must be unique over the whole diagram. Codegen quotes any
// name that is not a plain identifier, so the only forbidden characters are
// the ones a quoted mermaid name cannot carry.
export const REQ_NAME_RE = /^[^"\r\n{}]+$/;

export type RequirementAction =
  | { type: "addRequirement"; requirement: Requirement }
  | { type: "addElement"; element: ReqElement }
  | { type: "removeNode"; id: ReqNodeId }
  | { type: "renameNode"; id: ReqNodeId; name: string }
  | {
      type: "updateRequirement";
      id: RequirementId;
      requirementType?: RequirementType;
      text?: string;
      reqId?: string;
      risk?: RiskLevel | "";
      verifyMethod?: VerifyMethod | "";
    }
  | { type: "updateElement"; id: ElementId; elementType?: string; docRef?: string }
  | { type: "setDirection"; direction: RequirementDirection }
  | { type: "addRelation"; relation: RequirementRelation }
  | { type: "removeRelation"; id: RelationId }
  | { type: "updateRelation"; id: RelationId; relationType: RequirementRelationType };

// "" is how a cleared select/input arrives; an absent optional field is the
// IR's only representation of "unset" (exactOptionalPropertyTypes).
const norm = <T extends string>(v: T | undefined): Exclude<T, ""> | undefined =>
  v === "" || v === undefined ? undefined : (v as Exclude<T, "">);

function nameTaken(ir: RequirementIR, name: string): boolean {
  return ir.requirements.some((r) => r.name === name) || ir.elements.some((e) => e.name === name);
}

function idTaken(ir: RequirementIR, id: string): boolean {
  return ir.requirements.some((r) => r.id === id) || ir.elements.some((e) => e.id === id);
}

export function applyRequirementAction(ir: RequirementIR, action: RequirementAction): RequirementIR {
  switch (action.type) {
    case "addRequirement": {
      const r = action.requirement;
      if (idTaken(ir, r.id) || nameTaken(ir, r.name) || !REQ_NAME_RE.test(r.name)) return ir;
      return {
        ...ir,
        requirements: [
          ...ir.requirements,
          omitUndefined({ ...r, text: norm(r.text), reqId: norm(r.reqId), risk: norm(r.risk), verifyMethod: norm(r.verifyMethod) }),
        ],
      };
    }

    case "addElement": {
      const e = action.element;
      if (idTaken(ir, e.id) || nameTaken(ir, e.name) || !REQ_NAME_RE.test(e.name)) return ir;
      return { ...ir, elements: [...ir.elements, omitUndefined({ ...e, type: norm(e.type), docRef: norm(e.docRef) })] };
    }

    case "removeNode": {
      if (!idTaken(ir, action.id)) return ir;
      return {
        ...ir,
        requirements: ir.requirements.filter((r) => r.id !== action.id),
        elements: ir.elements.filter((e) => e.id !== action.id),
        relations: ir.relations.filter((r) => r.from !== action.id && r.to !== action.id),
      };
    }

    case "renameNode": {
      const current = ir.requirements.find((r) => r.id === action.id) ?? ir.elements.find((e) => e.id === action.id);
      if (!current || current.name === action.name) return ir;
      if (!REQ_NAME_RE.test(action.name) || nameTaken(ir, action.name)) return ir;
      return {
        ...ir,
        requirements: ir.requirements.map((r) => (r.id === action.id ? { ...r, name: action.name } : r)),
        elements: ir.elements.map((e) => (e.id === action.id ? { ...e, name: action.name } : e)),
      };
    }

    case "updateRequirement": {
      const r = ir.requirements.find((x) => x.id === action.id);
      if (!r) return ir;
      const next = omitUndefined({
        ...r,
        type: action.requirementType ?? r.type,
        text: action.text !== undefined ? norm(action.text) : r.text,
        reqId: action.reqId !== undefined ? norm(action.reqId) : r.reqId,
        risk: action.risk !== undefined ? norm(action.risk) : r.risk,
        verifyMethod: action.verifyMethod !== undefined ? norm(action.verifyMethod) : r.verifyMethod,
      });
      if (
        next.type === r.type &&
        next.text === r.text &&
        next.reqId === r.reqId &&
        next.risk === r.risk &&
        next.verifyMethod === r.verifyMethod
      ) {
        return ir;
      }
      return { ...ir, requirements: ir.requirements.map((x) => (x.id === action.id ? next : x)) };
    }

    case "updateElement": {
      const e = ir.elements.find((x) => x.id === action.id);
      if (!e) return ir;
      const type = action.elementType !== undefined ? norm(action.elementType) : e.type;
      const docRef = action.docRef !== undefined ? norm(action.docRef) : e.docRef;
      if (type === e.type && docRef === e.docRef) return ir;
      return { ...ir, elements: ir.elements.map((x) => (x.id === action.id ? omitUndefined({ ...x, type, docRef }) : x)) };
    }

    case "setDirection":
      return ir.direction === action.direction ? ir : { ...ir, direction: action.direction };

    case "addRelation": {
      const r = action.relation;
      if (ir.relations.some((x) => x.id === r.id)) return ir;
      // self-relations are allowed; layout draws them as a detour off the node
      if (!idTaken(ir, r.from) || !idTaken(ir, r.to)) return ir;
      return { ...ir, relations: [...ir.relations, r] };
    }

    case "removeRelation": {
      if (!ir.relations.some((r) => r.id === action.id)) return ir;
      return { ...ir, relations: ir.relations.filter((r) => r.id !== action.id) };
    }

    case "updateRelation": {
      const r = ir.relations.find((x) => x.id === action.id);
      if (!r || r.type === action.relationType) return ir;
      return { ...ir, relations: ir.relations.map((x) => (x.id === action.id ? { ...x, type: action.relationType } : x)) };
    }
  }
}
