import {
  ACTOR_VARIANTS,
  BOUNDARY_TYPES,
  USE_CASE_SHAPES,
  type ActorVariant,
  type BoundaryType,
  type UseCase,
  type UseCaseShape,
  type UsecaseActor,
  type UsecaseBoundary,
  type UsecaseHead,
  type UsecaseNote,
  type UsecaseRelation,
} from "@gmermaid/ir";

export type UsecaseSelection =
  | { kind: "actor"; actor: UsecaseActor }
  | { kind: "usecase"; usecase: UseCase }
  | { kind: "boundary"; boundary: UsecaseBoundary }
  | { kind: "relation"; relation: UsecaseRelation }
  | { kind: "note"; note: UsecaseNote };

/** Mermaid puts a marker on one end only, and generalization only points at
 * the target — so the two ends offer different choices. */
const SOURCE_HEADS: readonly UsecaseHead[] = ["none", "arrow", "circle", "cross"];
const TARGET_HEADS: readonly UsecaseHead[] = ["none", "arrow", "circle", "cross", "inheritance"];
const HEAD_LABEL: Record<UsecaseHead, string> = {
  none: "(none)",
  arrow: "Arrow",
  circle: "Circle",
  cross: "Cross",
  inheritance: "Generalization",
};

export interface UsecasePropertyWindowProps {
  readonly selection: UsecaseSelection;
  readonly boundaries: readonly UsecaseBoundary[];
  readonly onChangeName: (name: string) => void;
  readonly onChangeLabel: (label: string) => void;
  readonly onChangeVariant: (variant: ActorVariant) => void;
  readonly onChangeShape: (shape: UseCaseShape) => void;
  readonly onChangeBusiness: (business: boolean) => void;
  readonly onChangeStereotype: (stereotype: string) => void;
  /** "" = top level */
  readonly onChangeBoundary: (boundary: string) => void;
  readonly onChangeBoundaryType: (type: BoundaryType) => void;
  readonly onChangeHeadFrom: (head: UsecaseHead) => void;
  readonly onChangeHeadTo: (head: UsecaseHead) => void;
  readonly onChangeRelationLabel: (label: string) => void;
  readonly onChangeRelationKind: (kind: "include" | "extend" | "") => void;
  readonly onChangeNoteText: (text: string) => void;
  readonly onDelete: () => void;
  readonly onEditStart: () => void;
  readonly onEditEnd: () => void;
}

export function UsecasePropertyWindow(props: UsecasePropertyWindowProps) {
  const { selection, boundaries, onEditStart, onEditEnd } = props;
  const member = selection.kind === "actor" ? selection.actor : selection.kind === "usecase" ? selection.usecase : undefined;

  return (
    <div className="property-window">
      {(selection.kind === "actor" || selection.kind === "usecase") && member !== undefined && (
        <>
          <h3>{selection.kind === "actor" ? "Actor" : "Use case"}</h3>
          <label>
            Name
            <input value={member.name} onFocus={onEditStart} onBlur={onEditEnd} onChange={(e) => props.onChangeName(e.target.value)} />
          </label>
          <label>
            Label
            <input
              value={member.label ?? ""}
              placeholder={member.name}
              onFocus={onEditStart}
              onBlur={onEditEnd}
              onChange={(e) => props.onChangeLabel(e.target.value)}
            />
          </label>
          {selection.kind === "actor" ? (
            <label>
              Variant
              <select value={selection.actor.variant} onChange={(e) => props.onChangeVariant(e.target.value as ActorVariant)}>
                {ACTOR_VARIANTS.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label>
              Shape
              <select value={selection.usecase.shape} onChange={(e) => props.onChangeShape(e.target.value as UseCaseShape)}>
                {USE_CASE_SHAPES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          )}
          {/* mermaid rejects the business slash on awesome actors and rectangles */}
          {!(selection.kind === "actor" ? selection.actor.variant === "awesome" : selection.usecase.shape === "rect") && (
            <label>
              Business
              <input type="checkbox" checked={member.business === true} onChange={(e) => props.onChangeBusiness(e.target.checked)} />
            </label>
          )}
          <label>
            Stereotype
            <input
              value={member.stereotype ?? ""}
              placeholder="Employee, Core, …"
              onFocus={onEditStart}
              onBlur={onEditEnd}
              onChange={(e) => props.onChangeStereotype(e.target.value)}
            />
          </label>
          <label>
            Boundary
            <select value={member.boundary ?? ""} onChange={(e) => props.onChangeBoundary(e.target.value)}>
              <option value="">(top level)</option>
              {boundaries.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label ?? b.name}
                </option>
              ))}
            </select>
          </label>
        </>
      )}

      {selection.kind === "boundary" && (
        <>
          <h3>Boundary</h3>
          <label>
            Name
            <input value={selection.boundary.name} onFocus={onEditStart} onBlur={onEditEnd} onChange={(e) => props.onChangeName(e.target.value)} />
          </label>
          <label>
            Label
            <input
              value={selection.boundary.label ?? ""}
              placeholder={selection.boundary.name}
              onFocus={onEditStart}
              onBlur={onEditEnd}
              onChange={(e) => props.onChangeLabel(e.target.value)}
            />
          </label>
          <label>
            Type
            <select value={selection.boundary.type} onChange={(e) => props.onChangeBoundaryType(e.target.value as BoundaryType)}>
              {BOUNDARY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        </>
      )}

      {selection.kind === "relation" && (
        <>
          <h3>Relation</h3>
          <label>
            Relation kind
            <select
              value={selection.relation.kind ?? ""}
              onChange={(e) => props.onChangeRelationKind(e.target.value as "include" | "extend" | "")}
            >
              <option value="">association</option>
              <option value="include">include</option>
              <option value="extend">extend</option>
            </select>
          </label>
          {selection.relation.kind === undefined && (
            <>
              <label>
                Marker at source
                <select value={selection.relation.headFrom} onChange={(e) => props.onChangeHeadFrom(e.target.value as UsecaseHead)}>
                  {SOURCE_HEADS.map((head) => (
                    <option key={head} value={head}>
                      {HEAD_LABEL[head]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Marker at target
                <select value={selection.relation.headTo} onChange={(e) => props.onChangeHeadTo(e.target.value as UsecaseHead)}>
                  {TARGET_HEADS.map((head) => (
                    <option key={head} value={head}>
                      {HEAD_LABEL[head]}
                    </option>
                  ))}
                </select>
              </label>
              {selection.relation.headTo !== "inheritance" && (
                <label>
                  Label
                  <input
                    value={selection.relation.label ?? ""}
                    onFocus={onEditStart}
                    onBlur={onEditEnd}
                    onChange={(e) => props.onChangeRelationLabel(e.target.value)}
                  />
                </label>
              )}
            </>
          )}
        </>
      )}

      {selection.kind === "note" && (
        <>
          <h3>Note</h3>
          <label>
            Text
            <textarea
              rows={3}
              value={selection.note.text}
              onFocus={onEditStart}
              onBlur={onEditEnd}
              onChange={(e) => props.onChangeNoteText(e.target.value)}
            />
          </label>
        </>
      )}

      <button className="danger" onClick={props.onDelete}>
        Delete {selection.kind === "usecase" ? "use case" : selection.kind}
      </button>
    </div>
  );
}
