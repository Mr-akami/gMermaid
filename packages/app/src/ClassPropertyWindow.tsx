import type { ClassNode, ClassRelation, RelationType } from "@gmermaid/ir";

export type ClassSelection =
  | { kind: "class"; node: ClassNode }
  | { kind: "relation"; relation: ClassRelation };

export interface ClassPropertyWindowProps {
  readonly selection: ClassSelection;
  /** Raw text drafts: one member per line (e.g. `+name : Type`, `+run(x)`). */
  readonly attributesText: string;
  readonly methodsText: string;
  readonly membersError?: string | undefined;
  readonly onChangeName: (name: string) => void;
  readonly onChangeStereotype: (stereotype: string) => void;
  readonly onChangeAttributesText: (text: string) => void;
  readonly onChangeMethodsText: (text: string) => void;
  readonly onChangeRelationType: (type: RelationType) => void;
  readonly onChangeRelationLabel: (label: string) => void;
  readonly onChangeFromCardinality: (v: string) => void;
  readonly onChangeToCardinality: (v: string) => void;
  readonly onDelete: () => void;
  readonly onEditStart: () => void;
  readonly onEditEnd: () => void;
}

export function ClassPropertyWindow(props: ClassPropertyWindowProps) {
  const { selection, onEditStart, onEditEnd } = props;
  return (
    <div className="property-window">
      {selection.kind === "class" ? (
        <>
          <h3>Class</h3>
          <label>
            Name
            <input value={selection.node.name} onFocus={onEditStart} onBlur={onEditEnd} onChange={(e) => props.onChangeName(e.target.value)} />
          </label>
          <label>
            Stereotype
            <input
              value={selection.node.stereotype ?? ""}
              placeholder="interface, abstract, …"
              onFocus={onEditStart}
              onBlur={onEditEnd}
              onChange={(e) => props.onChangeStereotype(e.target.value)}
            />
          </label>
          <label>
            Attributes (one per line)
            <textarea rows={4} value={props.attributesText} onFocus={onEditStart} onBlur={onEditEnd} onChange={(e) => props.onChangeAttributesText(e.target.value)} />
          </label>
          <label>
            Methods (one per line)
            <textarea rows={4} value={props.methodsText} onFocus={onEditStart} onBlur={onEditEnd} onChange={(e) => props.onChangeMethodsText(e.target.value)} />
          </label>
          {props.membersError !== undefined && <div className="hint" style={{ color: "#9f3a38" }}>{props.membersError}</div>}
        </>
      ) : (
        <>
          <h3>Relation</h3>
          <label>
            Type
            <select value={selection.relation.type} onChange={(e) => props.onChangeRelationType(e.target.value as RelationType)}>
              <option value="inheritance">Inheritance</option>
              <option value="realization">Realization</option>
              <option value="composition">Composition</option>
              <option value="aggregation">Aggregation</option>
              <option value="association">Association</option>
              <option value="dependency">Dependency</option>
              <option value="linkSolid">Link (solid, no head)</option>
              <option value="linkDashed">Link (dashed, no head)</option>
            </select>
          </label>
          <label>
            Label
            <input value={selection.relation.label ?? ""} onFocus={onEditStart} onBlur={onEditEnd} onChange={(e) => props.onChangeRelationLabel(e.target.value)} />
          </label>
          <label>
            Cardinality (from)
            <input value={selection.relation.fromCardinality ?? ""} onFocus={onEditStart} onBlur={onEditEnd} onChange={(e) => props.onChangeFromCardinality(e.target.value)} />
          </label>
          <label>
            Cardinality (to)
            <input value={selection.relation.toCardinality ?? ""} onFocus={onEditStart} onBlur={onEditEnd} onChange={(e) => props.onChangeToCardinality(e.target.value)} />
          </label>
        </>
      )}
      <button className="danger" onClick={props.onDelete}>
        Delete {selection.kind}
      </button>
    </div>
  );
}
