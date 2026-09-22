import type {
  ClassId,
  ClassNamespace,
  ClassNode,
  ClassNote,
  ClassRelation,
  NamespaceId,
  RelationHead,
  RelationLine,
} from "@gmermaid/ir";
import { ConnectorEnds, distinctNames, type ConnectorEndpointOption } from "./ConnectorEnds";

/** What the canvas calls a class: its display label when it has one, else the
 * name mermaid addresses it by. */
function relationEndpoints(classes: readonly ClassNode[]): ConnectorEndpointOption[] {
  return distinctNames(classes.map((c) => ({ id: c.id as string, name: c.label ?? c.name })));
}

export type ClassSelection =
  | { kind: "class"; node: ClassNode }
  | { kind: "relation"; relation: ClassRelation }
  | { kind: "note"; note: ClassNote }
  | { kind: "namespace"; namespace: ClassNamespace };

export interface ClassPropertyWindowProps {
  readonly selection: ClassSelection;
  /** Raw text drafts: one member per line (e.g. `+String name`, `+run(x)*`). */
  readonly attributesText: string;
  readonly methodsText: string;
  readonly membersError?: string | undefined;
  /** Every namespace / class in the diagram, for the target pickers. */
  readonly namespaces: readonly ClassNamespace[];
  readonly classes: readonly ClassNode[];
  readonly onChangeName: (name: string) => void;
  readonly onChangeLabel: (label: string) => void;
  readonly onChangeGeneric: (generic: string) => void;
  readonly onChangeStereotypes: (text: string) => void;
  readonly onChangeNamespace: (id: NamespaceId | undefined) => void;
  readonly onChangeAttributesText: (text: string) => void;
  readonly onChangeMethodsText: (text: string) => void;
  /** Re-point ONE end of a relation; the refusal is the editor's to show,
   * the same way every other rejection there is. */
  readonly onRetargetRelation: (end: "from" | "to", id: string) => void;
  readonly onSwapRelationEnds: () => void;
  /** Select an end on the canvas, so a dense diagram can be walked from here. */
  readonly onSelectElement: (id: string) => void;
  readonly onChangeRelationLine: (line: RelationLine) => void;
  readonly onChangeHeadFrom: (head: RelationHead) => void;
  readonly onChangeHeadTo: (head: RelationHead) => void;
  readonly onChangeRelationLabel: (label: string) => void;
  readonly onChangeFromCardinality: (v: string) => void;
  readonly onChangeToCardinality: (v: string) => void;
  readonly onChangeNoteText: (text: string) => void;
  readonly onChangeNoteTarget: (id: ClassId | undefined) => void;
  readonly onChangeNamespaceName: (name: string) => void;
  readonly onDelete: () => void;
  readonly onEditStart: () => void;
  readonly onEditEnd: () => void;
}

const HEADS: readonly [RelationHead, string][] = [
  ["none", "None"],
  ["arrow", "Arrow"],
  ["inheritance", "Inheritance (triangle)"],
  ["composition", "Composition (filled diamond)"],
  ["aggregation", "Aggregation (hollow diamond)"],
  ["lollipop", "Lollipop"],
];

export function ClassPropertyWindow(props: ClassPropertyWindowProps) {
  const { selection, onEditStart, onEditEnd } = props;
  return (
    <div className="property-window">
      {selection.kind === "class" && (
        <>
          <h3>Class</h3>
          <label>
            Name
            <input value={selection.node.name} onFocus={onEditStart} onBlur={onEditEnd} onChange={(e) => props.onChangeName(e.target.value)} />
          </label>
          <label>
            Label
            <input
              value={selection.node.label ?? ""}
              placeholder="shown instead of the name"
              onFocus={onEditStart}
              onBlur={onEditEnd}
              onChange={(e) => props.onChangeLabel(e.target.value)}
            />
          </label>
          <label>
            Generic
            <input
              value={selection.node.generic ?? ""}
              placeholder="Shape, T, …"
              onFocus={onEditStart}
              onBlur={onEditEnd}
              onChange={(e) => props.onChangeGeneric(e.target.value)}
            />
          </label>
          <label>
            Annotations (comma separated)
            <input
              value={selection.node.stereotypes.join(", ")}
              placeholder="interface, service, …"
              onFocus={onEditStart}
              onBlur={onEditEnd}
              onChange={(e) => props.onChangeStereotypes(e.target.value)}
            />
          </label>
          <label>
            Namespace
            <select
              value={selection.node.namespace ?? ""}
              onChange={(e) => props.onChangeNamespace(e.target.value === "" ? undefined : (e.target.value as NamespaceId))}
            >
              <option value="">(none)</option>
              {props.namespaces.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
            </select>
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
      )}
      {selection.kind === "relation" && (
        <>
          <h3>Relation</h3>
          {/* the two classes it joins — the one thing that tells two
              relations between the same pair apart */}
          <ConnectorEnds
            from={selection.relation.from as string}
            to={selection.relation.to as string}
            options={relationEndpoints(props.classes)}
            onChangeFrom={(id) => props.onRetargetRelation("from", id)}
            onChangeTo={(id) => props.onRetargetRelation("to", id)}
            onSwap={props.onSwapRelationEnds}
            onSelectEndpoint={props.onSelectElement}
          />
          <label>
            Line
            <select value={selection.relation.line} onChange={(e) => props.onChangeRelationLine(e.target.value as RelationLine)}>
              <option value="solid">Solid</option>
              <option value="dashed">Dashed</option>
            </select>
          </label>
          <label>
            Head (start)
            <select value={selection.relation.headFrom} onChange={(e) => props.onChangeHeadFrom(e.target.value as RelationHead)}>
              {HEADS.map(([v, text]) => (
                <option key={v} value={v}>
                  {text}
                </option>
              ))}
            </select>
          </label>
          <label>
            Head (end)
            <select value={selection.relation.headTo} onChange={(e) => props.onChangeHeadTo(e.target.value as RelationHead)}>
              {HEADS.map(([v, text]) => (
                <option key={v} value={v}>
                  {text}
                </option>
              ))}
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
      {selection.kind === "note" && (
        <>
          <h3>Note</h3>
          <label>
            Text
            <textarea rows={3} value={selection.note.text} onFocus={onEditStart} onBlur={onEditEnd} onChange={(e) => props.onChangeNoteText(e.target.value)} />
          </label>
          <label>
            Target
            <select
              value={selection.note.target ?? ""}
              onChange={(e) => props.onChangeNoteTarget(e.target.value === "" ? undefined : (e.target.value as ClassId))}
            >
              <option value="">(free note)</option>
              {props.classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      {selection.kind === "namespace" && (
        <>
          <h3>Namespace</h3>
          <label>
            Name
            <input value={selection.namespace.name} onFocus={onEditStart} onBlur={onEditEnd} onChange={(e) => props.onChangeNamespaceName(e.target.value)} />
          </label>
          <div className="hint">Nested namespaces are not supported.</div>
        </>
      )}
      <button className="danger" onClick={props.onDelete}>
        Delete {selection.kind}
      </button>
    </div>
  );
}
