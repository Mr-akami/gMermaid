import {
  REQUIREMENT_RELATION_TYPES,
  REQUIREMENT_TYPES,
  RISK_LEVELS,
  VERIFY_METHODS,
  type ReqElement,
  type Requirement,
  type RequirementRelation,
  type RequirementRelationType,
  type RequirementType,
  type RiskLevel,
  type VerifyMethod,
} from "@gmermaid/ir";

export type RequirementSelection =
  | { kind: "requirement"; requirement: Requirement }
  | { kind: "element"; element: ReqElement }
  | { kind: "relation"; relation: RequirementRelation };

export interface RequirementPropertyWindowProps {
  readonly selection: RequirementSelection;
  readonly onChangeName: (name: string) => void;
  readonly onChangeRequirementType: (type: RequirementType) => void;
  readonly onChangeReqId: (reqId: string) => void;
  readonly onChangeText: (text: string) => void;
  readonly onChangeRisk: (risk: RiskLevel | "") => void;
  readonly onChangeVerifyMethod: (method: VerifyMethod | "") => void;
  readonly onChangeElementType: (type: string) => void;
  readonly onChangeDocRef: (docRef: string) => void;
  readonly onChangeRelationType: (type: RequirementRelationType) => void;
  readonly onDelete: () => void;
  readonly onEditStart: () => void;
  readonly onEditEnd: () => void;
}

export function RequirementPropertyWindow(props: RequirementPropertyWindowProps) {
  const { selection, onEditStart, onEditEnd } = props;
  return (
    <div className="property-window">
      {selection.kind === "requirement" && (
        <>
          <h3>Requirement</h3>
          <label>
            Name
            <input value={selection.requirement.name} onFocus={onEditStart} onBlur={onEditEnd} onChange={(e) => props.onChangeName(e.target.value)} />
          </label>
          <label>
            Type
            <select value={selection.requirement.type} onChange={(e) => props.onChangeRequirementType(e.target.value as RequirementType)}>
              {REQUIREMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label>
            Id
            <input value={selection.requirement.reqId ?? ""} placeholder="1.1" onFocus={onEditStart} onBlur={onEditEnd} onChange={(e) => props.onChangeReqId(e.target.value)} />
          </label>
          <label>
            Text
            <textarea rows={3} value={selection.requirement.text ?? ""} onFocus={onEditStart} onBlur={onEditEnd} onChange={(e) => props.onChangeText(e.target.value)} />
          </label>
          <label>
            Risk
            <select value={selection.requirement.risk ?? ""} onChange={(e) => props.onChangeRisk(e.target.value as RiskLevel | "")}>
              <option value="">(none)</option>
              {RISK_LEVELS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label>
            Verify method
            <select value={selection.requirement.verifyMethod ?? ""} onChange={(e) => props.onChangeVerifyMethod(e.target.value as VerifyMethod | "")}>
              <option value="">(none)</option>
              {VERIFY_METHODS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      {selection.kind === "element" && (
        <>
          <h3>Element</h3>
          <label>
            Name
            <input value={selection.element.name} onFocus={onEditStart} onBlur={onEditEnd} onChange={(e) => props.onChangeName(e.target.value)} />
          </label>
          <label>
            Type
            <input value={selection.element.type ?? ""} placeholder="simulation, word doc, …" onFocus={onEditStart} onBlur={onEditEnd} onChange={(e) => props.onChangeElementType(e.target.value)} />
          </label>
          <label>
            Doc ref
            <input value={selection.element.docRef ?? ""} placeholder="reqs/test_entity" onFocus={onEditStart} onBlur={onEditEnd} onChange={(e) => props.onChangeDocRef(e.target.value)} />
          </label>
        </>
      )}
      {selection.kind === "relation" && (
        <>
          <h3>Relation</h3>
          <label>
            Type
            <select value={selection.relation.type} onChange={(e) => props.onChangeRelationType(e.target.value as RequirementRelationType)}>
              {REQUIREMENT_RELATION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      <button className="danger" onClick={props.onDelete}>
        Delete {selection.kind}
      </button>
    </div>
  );
}
