import type { ElementId, RelationId, RequirementId } from "./ids";

// SysML v1.6 enumerations as mermaid spells them. Risk / verify method are
// stored in their canonical (docs table) case; the parser folds case.
export const REQUIREMENT_TYPES = [
  "requirement",
  "functionalRequirement",
  "interfaceRequirement",
  "performanceRequirement",
  "physicalRequirement",
  "designConstraint",
] as const;
export type RequirementType = (typeof REQUIREMENT_TYPES)[number];

export const RISK_LEVELS = ["Low", "Medium", "High"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const VERIFY_METHODS = ["Analysis", "Inspection", "Test", "Demonstration"] as const;
export type VerifyMethod = (typeof VERIFY_METHODS)[number];

export const REQUIREMENT_RELATION_TYPES = [
  "contains",
  "copies",
  "derives",
  "satisfies",
  "verifies",
  "refines",
  "traces",
] as const;
export type RequirementRelationType = (typeof REQUIREMENT_RELATION_TYPES)[number];

export interface Requirement {
  readonly id: RequirementId;
  /** Mermaid node name — the exchange identity, unique across requirements AND elements. */
  readonly name: string;
  readonly type: RequirementType;
  readonly text?: string;
  /** SysML requirement id (`id: 1.2.1`) — free text, distinct from the IR id. */
  readonly reqId?: string;
  readonly risk?: RiskLevel;
  readonly verifyMethod?: VerifyMethod;
}

export interface ReqElement {
  readonly id: ElementId;
  readonly name: string;
  readonly type?: string;
  readonly docRef?: string;
}

/** Either end of a relation: a requirement or an element. */
export type ReqNodeId = RequirementId | ElementId;

export interface RequirementRelation {
  readonly id: RelationId;
  readonly from: ReqNodeId;
  readonly to: ReqNodeId;
  readonly type: RequirementRelationType;
}

export type RequirementDirection = "TB" | "LR" | "BT" | "RL";

export interface RequirementIR {
  readonly kind: "requirement";
  /** absent = mermaid default (TB) */
  readonly direction?: RequirementDirection;
  readonly requirements: readonly Requirement[];
  readonly elements: readonly ReqElement[];
  readonly relations: readonly RequirementRelation[];
}

export function emptyRequirementDiagram(): RequirementIR {
  return { kind: "requirement", requirements: [], elements: [], relations: [] };
}
