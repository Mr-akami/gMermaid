import {
  ER_CARDINALITIES,
  ER_CARDINALITY_LABEL,
  ER_KEYS,
  type AttributeId,
  type ErAttribute,
  type ErCardinality,
  type ErEntity,
  type ErKey,
  type ErRelationship,
} from "@gmermaid/ir";
import { ConnectorEnds, distinctNames } from "./ConnectorEnds";

export type ErSelection =
  | { kind: "entity"; entity: ErEntity }
  | { kind: "relationship"; relationship: ErRelationship };

export interface ErPropertyWindowProps {
  readonly selection: ErSelection;
  /** Candidates for a relationship's two ends. */
  readonly entities: readonly ErEntity[];
  readonly onRetarget: (end: "from" | "to", id: string) => void;
  readonly onSwapEnds: () => void;
  readonly onSelectEntity: (id: string) => void;
  readonly onChangeName: (name: string) => void;
  readonly onChangeAlias: (alias: string) => void;
  readonly onAddAttribute: () => void;
  readonly onChangeAttribute: (id: AttributeId, patch: { attrType?: string; name?: string; keys?: readonly ErKey[]; comment?: string }) => void;
  readonly onMoveAttribute: (id: AttributeId, to: number) => void;
  readonly onRemoveAttribute: (id: AttributeId) => void;
  readonly onChangeCard: (end: "from" | "to", card: ErCardinality) => void;
  readonly onChangeIdentifying: (identifying: boolean) => void;
  readonly onChangeLabel: (label: string) => void;
  readonly onDelete: () => void;
  readonly onEditStart: () => void;
  readonly onEditEnd: () => void;
}

export function ErPropertyWindow(props: ErPropertyWindowProps) {
  const { selection, onEditStart, onEditEnd } = props;
  return (
    <div className="property-window">
      {selection.kind === "entity" && (
        <>
          <h3>Entity</h3>
          <label>
            Name
            <input value={selection.entity.name} onFocus={onEditStart} onBlur={onEditEnd} onChange={(e) => props.onChangeName(e.target.value)} />
          </label>
          <label>
            Alias
            <input value={selection.entity.alias ?? ""} placeholder="display name" onFocus={onEditStart} onBlur={onEditEnd} onChange={(e) => props.onChangeAlias(e.target.value)} />
          </label>
          <h4>Attributes</h4>
          {selection.entity.attributes.map((a, i, all) => (
            <AttributeRow key={a.id} a={a} index={i} last={i === all.length - 1} {...props} />
          ))}
          <button className="btn" onClick={props.onAddAttribute}>+ Attribute</button>
        </>
      )}
      {selection.kind === "relationship" && (
        <>
          <h3>Relationship</h3>
          <ConnectorEnds
            from={selection.relationship.from as string}
            to={selection.relationship.to as string}
            options={distinctNames(props.entities.map((e) => ({ id: e.id as string, name: e.name })))}
            onChangeFrom={(id) => props.onRetarget("from", id)}
            onChangeTo={(id) => props.onRetarget("to", id)}
            onSwap={props.onSwapEnds}
            onSelectEndpoint={props.onSelectEntity}
          />
          <label>
            From cardinality
            <select value={selection.relationship.fromCard} onChange={(e) => props.onChangeCard("from", e.target.value as ErCardinality)}>
              {ER_CARDINALITIES.map((c) => (
                <option key={c} value={c}>
                  {ER_CARDINALITY_LABEL[c]}
                </option>
              ))}
            </select>
          </label>
          <label>
            To cardinality
            <select value={selection.relationship.toCard} onChange={(e) => props.onChangeCard("to", e.target.value as ErCardinality)}>
              {ER_CARDINALITIES.map((c) => (
                <option key={c} value={c}>
                  {ER_CARDINALITY_LABEL[c]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Line
            <select value={selection.relationship.identifying ? "identifying" : "non-identifying"} onChange={(e) => props.onChangeIdentifying(e.target.value === "identifying")}>
              <option value="identifying">Identifying (solid)</option>
              <option value="non-identifying">Non-identifying (dashed)</option>
            </select>
          </label>
          <label>
            Label
            <input value={selection.relationship.label ?? ""} placeholder="places" onFocus={onEditStart} onBlur={onEditEnd} onChange={(e) => props.onChangeLabel(e.target.value)} />
          </label>
        </>
      )}
      <button className="danger" onClick={props.onDelete}>
        Delete {selection.kind}
      </button>
    </div>
  );
}

function AttributeRow({
  a,
  index,
  last,
  onChangeAttribute,
  onMoveAttribute,
  onRemoveAttribute,
  onEditStart,
  onEditEnd,
}: { a: ErAttribute; index: number; last: boolean } & ErPropertyWindowProps) {
  const n = index + 1;
  const toggle = (key: ErKey) => onChangeAttribute(a.id, { keys: a.keys.includes(key) ? a.keys.filter((k) => k !== key) : [...a.keys, key] });
  return (
    <fieldset className="er-attribute" style={{ border: "1px solid var(--gm-border, #ccc)", margin: "4px 0", padding: 6 }}>
      <legend>#{n}</legend>
      <input aria-label={`Attribute ${n} type`} value={a.type} size={8} onFocus={onEditStart} onBlur={onEditEnd} onChange={(e) => onChangeAttribute(a.id, { attrType: e.target.value })} />{" "}
      <input aria-label={`Attribute ${n} name`} value={a.name} size={10} onFocus={onEditStart} onBlur={onEditEnd} onChange={(e) => onChangeAttribute(a.id, { name: e.target.value })} />
      <div>
        {ER_KEYS.map((k) => (
          <label key={k} style={{ display: "inline-flex", gap: 2, marginRight: 8 }}>
            <input type="checkbox" aria-label={`Attribute ${n} ${k}`} checked={a.keys.includes(k)} onChange={() => toggle(k)} />
            {k}
          </label>
        ))}
      </div>
      <input aria-label={`Attribute ${n} comment`} value={a.comment ?? ""} placeholder="comment" onFocus={onEditStart} onBlur={onEditEnd} onChange={(e) => onChangeAttribute(a.id, { comment: e.target.value })} />
      <div>
        <button className="btn" aria-label={`Move attribute ${n} up`} disabled={index === 0} onClick={() => onMoveAttribute(a.id, index - 1)}>↑</button>{" "}
        <button className="btn" aria-label={`Move attribute ${n} down`} disabled={last} onClick={() => onMoveAttribute(a.id, index + 1)}>↓</button>{" "}
        <button className="btn" aria-label={`Remove attribute ${n}`} onClick={() => onRemoveAttribute(a.id)}>Remove</button>
      </div>
    </fieldset>
  );
}
