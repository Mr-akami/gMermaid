// The From / To block every connector's property window shows.
//
// A property window used to name a connector's own attributes and nothing
// else, so the one thing that identifies it — which two elements it joins —
// was invisible, and the only way to re-point it was to delete it and draw a
// new one. Several connectors between the same pair are indistinguishable
// from their label alone, which is why the ends are worth showing even before
// they are worth editing.
//
// The component is deliberately kind-agnostic: every diagram names its ends
// differently (a node's label, a class's name, a lifeline's name) and allows a
// different set of candidates, so the caller resolves both and passes the
// result. Refusals are NOT handled here — each editor already owns a
// `rejectHint`, and that is where a rejected retarget has to surface, beside
// every other refusal in that editor.

/** One candidate for either end, named the way the user sees it on the canvas.
 * `group` splits the select into optgroups (nodes vs subgraphs, actors vs use
 * cases, requirements vs elements); leave it out for a flat list. */
export interface ConnectorEndpointOption {
  readonly id: string;
  readonly name: string;
  readonly group?: string;
}

export interface ConnectorEndsProps {
  readonly from: string;
  readonly to: string;
  readonly options: readonly ConnectorEndpointOption[];
  readonly onChangeFrom: (id: string) => void;
  readonly onChangeTo: (id: string) => void;
  /** Reverse the connector — one action instead of two selects, and the
   * common case behind "I drew it the wrong way round". */
  readonly onSwap?: (() => void) | undefined;
  /** Select that element on the canvas, so a dense diagram can be walked from
   * the property window. Omitted = no jump buttons. */
  readonly onSelectEndpoint?: ((id: string) => void) | undefined;
}

/** What to show for an id: the name the canvas shows, and the id itself when
 * there is no label to show (an unnamed node, a `[*]` pseudo-state). */
function nameOf(options: readonly ConnectorEndpointOption[], id: string): string {
  const hit = options.find((o) => o.id === id);
  return hit === undefined || hit.name === "" ? id : hit.name;
}

/** Keep every option distinguishable. Two nodes may carry the same label, a
 * composite may share a state's label, and several `[*]` live in one diagram —
 * a picker that offers the same word twice is worse than one that shows the
 * id, so a repeated (or empty) name falls back to it. */
export function distinctNames(options: readonly ConnectorEndpointOption[]): ConnectorEndpointOption[] {
  const count = new Map<string, number>();
  for (const o of options) count.set(o.name, (count.get(o.name) ?? 0) + 1);
  return options.map((o) => {
    if (o.name === "") return { ...o, name: o.id };
    if ((count.get(o.name) ?? 0) < 2) return { ...o };
    return { ...o, name: `${o.name} (${o.id})` };
  });
}

function Options({ options }: { options: readonly ConnectorEndpointOption[] }) {
  const groups = [...new Set(options.map((o) => o.group))];
  if (groups.length === 1 && groups[0] === undefined) {
    return (
      <>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name === "" ? o.id : o.name}
          </option>
        ))}
      </>
    );
  }
  return (
    <>
      {groups.map((g) => (
        <optgroup key={g ?? ""} label={g ?? "Other"}>
          {options
            .filter((o) => o.group === g)
            .map((o) => (
              <option key={o.id} value={o.id}>
                {o.name === "" ? o.id : o.name}
              </option>
            ))}
        </optgroup>
      ))}
    </>
  );
}

function End({
  label,
  value,
  options,
  onChange,
  onSelectEndpoint,
}: {
  label: "From" | "To";
  value: string;
  options: readonly ConnectorEndpointOption[];
  onChange: (id: string) => void;
  onSelectEndpoint?: ((id: string) => void) | undefined;
}) {
  // an end the picker does not offer still has to be SHOWN (a stale id, or a
  // kind that allows an end the picker deliberately leaves out), or the select
  // would silently read as whatever sits first in the list
  const known = options.some((o) => o.id === value);
  return (
    <div className="connector-end">
      <label>
        {label}
        <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
          {!known && <option value={value}>{value}</option>}
          <Options options={options} />
        </select>
      </label>
      {onSelectEndpoint !== undefined && (
        <button
          type="button"
          className="endpoint-jump"
          aria-label={`Select ${label} on the canvas`}
          title={`Select ${nameOf(options, value)} on the canvas`}
          onClick={() => onSelectEndpoint(value)}
        >
          ⦿
        </button>
      )}
    </div>
  );
}

export function ConnectorEnds(props: ConnectorEndsProps) {
  return (
    <>
      <End
        label="From"
        value={props.from}
        options={props.options}
        onChange={props.onChangeFrom}
        onSelectEndpoint={props.onSelectEndpoint}
      />
      <End
        label="To"
        value={props.to}
        options={props.options}
        onChange={props.onChangeTo}
        onSelectEndpoint={props.onSelectEndpoint}
      />
      {props.onSwap !== undefined && (
        <button type="button" className="swap-ends" onClick={props.onSwap}>
          ⇄ Swap ends
        </button>
      )}
    </>
  );
}
