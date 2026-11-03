import {
  ARCH_BUILTIN_ICONS,
  ARCH_SIDES,
  type ArchEdge,
  type ArchGroup,
  type ArchJunction,
  type ArchService,
  type ArchSide,
} from "@gmermaid/ir";
import { ConnectorEnds, distinctNames, type ConnectorEndpointOption } from "./ConnectorEnds";

/** Only services and junctions are edge ends: mermaid has no edge that names
 * a group (a member's `{group}` flag reaches the border instead). */
function edgeEndpoints(services: readonly ArchService[], junctions: readonly ArchJunction[]): ConnectorEndpointOption[] {
  return distinctNames([
    ...services.map((s) => ({ id: s.id as string, name: s.label ?? s.name, group: "Services" })),
    ...junctions.map((j) => ({ id: j.id as string, name: j.name, group: "Junctions" })),
  ]);
}

export type ArchitectureSelection =
  | { kind: "service"; service: ArchService }
  | { kind: "junction"; junction: ArchJunction }
  | { kind: "group"; group: ArchGroup }
  | { kind: "edge"; edge: ArchEdge };

const SIDE_LABEL: Record<ArchSide, string> = { T: "Top", B: "Bottom", L: "Left", R: "Right" };

export interface ArchitecturePropertyWindowProps {
  readonly selection: ArchitectureSelection;
  /** Groups a member may move into / a group may nest in. */
  readonly groupOptions: readonly ArchGroup[];
  readonly services: readonly ArchService[];
  readonly junctions: readonly ArchJunction[];
  /** `{group}` only means something when the end sits in a group the other
   * end is not in; mermaid refuses it otherwise. */
  readonly canGroupFrom: boolean;
  readonly canGroupTo: boolean;
  readonly onRetargetEdge: (end: "from" | "to", id: string) => void;
  readonly onSwapEdgeEnds: () => void;
  readonly onSelectElement: (id: string) => void;
  readonly onChangeName: (name: string) => void;
  readonly onChangeLabel: (label: string) => void;
  readonly onChangeIcon: (icon: string) => void;
  /** "" = top level */
  readonly onChangeGroup: (group: string) => void;
  readonly onChangeFromSide: (side: ArchSide) => void;
  readonly onChangeToSide: (side: ArchSide) => void;
  readonly onChangeArrowFrom: (on: boolean) => void;
  readonly onChangeArrowTo: (on: boolean) => void;
  readonly onChangeGroupFrom: (on: boolean) => void;
  readonly onChangeGroupTo: (on: boolean) => void;
  readonly onChangeEdgeLabel: (label: string) => void;
  readonly onDelete: () => void;
  readonly onEditStart: () => void;
  readonly onEditEnd: () => void;
}

function IconField({ value, onChange, onEditStart, onEditEnd }: { value: string | undefined; onChange: (icon: string) => void; onEditStart: () => void; onEditEnd: () => void }) {
  const builtin = value !== undefined && (ARCH_BUILTIN_ICONS as readonly string[]).includes(value);
  return (
    <>
      <label>
        Icon
        <select aria-label="Icon" value={builtin ? value : value === undefined ? "" : "__custom"} onChange={(e) => onChange(e.target.value === "__custom" ? "custom" : e.target.value)}>
          <option value="">(none)</option>
          {ARCH_BUILTIN_ICONS.map((i) => (
            <option key={i} value={i}>
              {i}
            </option>
          ))}
          <option value="__custom">custom…</option>
        </select>
      </label>
      {value !== undefined && !builtin && (
        <label>
          Icon name
          <input
            value={value}
            placeholder="logos:aws"
            onFocus={onEditStart}
            onBlur={onEditEnd}
            onChange={(e) => onChange(e.target.value)}
          />
        </label>
      )}
    </>
  );
}

function GroupSelect({ value, groups, onChange, label }: { value: string | undefined; groups: readonly ArchGroup[]; onChange: (g: string) => void; label: string }) {
  return (
    <label>
      {label}
      <select aria-label={label} value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
        <option value="">(top level)</option>
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.label ?? g.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ArchitecturePropertyWindow(props: ArchitecturePropertyWindowProps) {
  const { selection, onEditStart, onEditEnd } = props;
  const named =
    selection.kind === "service" ? selection.service : selection.kind === "junction" ? selection.junction : selection.kind === "group" ? selection.group : undefined;

  return (
    <div className="property-window">
      {named !== undefined && (
        <>
          <h3>{selection.kind === "service" ? "Service" : selection.kind === "junction" ? "Junction" : "Group"}</h3>
          <label>
            Name
            <input value={named.name} onFocus={onEditStart} onBlur={onEditEnd} onChange={(e) => props.onChangeName(e.target.value)} />
          </label>
          {selection.kind !== "junction" && (
            <label>
              Label
              <input
                value={(selection.kind === "service" ? selection.service.label : selection.kind === "group" ? selection.group.label : undefined) ?? ""}
                placeholder={selection.kind === "service" ? named.name : "(no title)"}
                onFocus={onEditStart}
                onBlur={onEditEnd}
                onChange={(e) => props.onChangeLabel(e.target.value)}
              />
            </label>
          )}
          {selection.kind === "service" && (
            <IconField value={selection.service.icon} onChange={props.onChangeIcon} onEditStart={onEditStart} onEditEnd={onEditEnd} />
          )}
          {selection.kind === "group" && (
            <IconField value={selection.group.icon} onChange={props.onChangeIcon} onEditStart={onEditStart} onEditEnd={onEditEnd} />
          )}
          <GroupSelect
            label={selection.kind === "group" ? "Parent group" : "Group"}
            value={selection.kind === "service" ? selection.service.group : selection.kind === "junction" ? selection.junction.group : selection.kind === "group" ? selection.group.parent : undefined}
            groups={props.groupOptions}
            onChange={props.onChangeGroup}
          />
        </>
      )}

      {selection.kind === "edge" && (
        <>
          <h3>Edge</h3>
          <ConnectorEnds
            from={selection.edge.from as string}
            to={selection.edge.to as string}
            options={edgeEndpoints(props.services, props.junctions)}
            onChangeFrom={(id) => props.onRetargetEdge("from", id)}
            onChangeTo={(id) => props.onRetargetEdge("to", id)}
            onSwap={props.onSwapEdgeEnds}
            onSelectEndpoint={props.onSelectElement}
          />
          <label>
            Source side
            <select value={selection.edge.fromSide} onChange={(e) => props.onChangeFromSide(e.target.value as ArchSide)}>
              {ARCH_SIDES.map((s) => (
                <option key={s} value={s}>
                  {SIDE_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Target side
            <select value={selection.edge.toSide} onChange={(e) => props.onChangeToSide(e.target.value as ArchSide)}>
              {ARCH_SIDES.map((s) => (
                <option key={s} value={s}>
                  {SIDE_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Arrow at source
            <input type="checkbox" checked={selection.edge.arrowFrom} onChange={(e) => props.onChangeArrowFrom(e.target.checked)} />
          </label>
          <label>
            Arrow at target
            <input type="checkbox" checked={selection.edge.arrowTo} onChange={(e) => props.onChangeArrowTo(e.target.checked)} />
          </label>
          <label title="End the edge on the border of the source's group">
            Source on group border
            <input
              type="checkbox"
              disabled={!props.canGroupFrom && selection.edge.groupFrom !== true}
              checked={selection.edge.groupFrom === true}
              onChange={(e) => props.onChangeGroupFrom(e.target.checked)}
            />
          </label>
          <label title="End the edge on the border of the target's group">
            Target on group border
            <input
              type="checkbox"
              disabled={!props.canGroupTo && selection.edge.groupTo !== true}
              checked={selection.edge.groupTo === true}
              onChange={(e) => props.onChangeGroupTo(e.target.checked)}
            />
          </label>
          <label>
            Label
            <input
              value={selection.edge.label ?? ""}
              onFocus={onEditStart}
              onBlur={onEditEnd}
              onChange={(e) => props.onChangeEdgeLabel(e.target.value)}
            />
          </label>
        </>
      )}

      <button className="danger" onClick={props.onDelete}>
        Delete {selection.kind}
      </button>
    </div>
  );
}
