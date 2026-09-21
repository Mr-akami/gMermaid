import {
  FLOWCHART_SHAPES,
  type FlowchartDirection,
  type FlowchartEdge,
  type FlowchartEdgeHead,
  type FlowchartLineStyle,
  type FlowchartNode,
  type FlowchartNodeShape,
  type FlowchartShapeInfo,
  type FlowchartSubgraph,
} from "@gmermaid/ir";

const SHAPE_GROUPS: readonly [FlowchartShapeInfo["group"], FlowchartShapeInfo[]][] = (
  ["Basic", "Process", "Data", "Flow", "Misc"] as const
).map((g) => [g, FLOWCHART_SHAPES.filter((s) => s.group === g)]);

const HEADS: readonly [FlowchartEdgeHead, string][] = [
  ["none", "None"],
  ["arrow", "Arrow"],
  ["circle", "Circle"],
  ["cross", "Cross"],
];

// Callbacks carry user intent only (ADR 0001) — the property window never
// sees the IR or the dispatcher, just the resolved element it edits.
// onEditStart/onEditEnd bracket a text-editing transaction so one focus
// session undoes as a single step.
export interface PropertyWindowProps {
  readonly element: FlowchartNode | FlowchartEdge | FlowchartSubgraph;
  readonly onChangeNodeLabel: (label: string) => void;
  readonly onChangeNodeShape: (shape: FlowchartNodeShape) => void;
  readonly onChangeEdgeLabel: (label: string) => void;
  readonly onChangeEdgeLine: (line: FlowchartLineStyle) => void;
  readonly onChangeEdgeHead: (which: "headStart" | "headEnd", head: FlowchartEdgeHead) => void;
  readonly onChangeEdgeLength: (length: number) => void;
  readonly onChangeSubgraphLabel: (label: string) => void;
  readonly onChangeSubgraphDirection: (direction: FlowchartDirection | null) => void;
  readonly onDelete: () => void;
  readonly onEditStart: () => void;
  readonly onEditEnd: () => void;
}

function isNode(el: PropertyWindowProps["element"]): el is FlowchartNode {
  return "shape" in el;
}

function isSubgraph(el: PropertyWindowProps["element"]): el is FlowchartSubgraph {
  return !("shape" in el) && !("line" in el);
}

export function PropertyWindow(props: PropertyWindowProps) {
  const { element, onEditStart, onEditEnd, onDelete } = props;

  if (isSubgraph(element)) {
    return (
      <div className="property-window">
        <h3>Subgraph</h3>
        <label>
          Label
          <input
            value={element.label}
            onFocus={onEditStart}
            onBlur={onEditEnd}
            onChange={(e) => props.onChangeSubgraphLabel(e.target.value)}
          />
        </label>
        <label>
          Direction
          <select
            aria-label="Subgraph direction"
            value={element.direction ?? ""}
            onChange={(e) =>
              props.onChangeSubgraphDirection(e.target.value === "" ? null : (e.target.value as FlowchartDirection))
            }
          >
            <option value="">(inherit)</option>
            <option value="TB">Top→Bottom</option>
            <option value="LR">Left→Right</option>
            <option value="BT">Bottom→Top</option>
            <option value="RL">Right→Left</option>
          </select>
        </label>
        <button className="danger" onClick={onDelete}>
          Dissolve subgraph
        </button>
        <div className="hint">中のノードは残ります(親へ昇格)</div>
      </div>
    );
  }

  return (
    <div className="property-window">
      {isNode(element) ? (
        <>
          <h3>Node</h3>
          <label>
            Label
            <input
              value={element.label}
              onFocus={onEditStart}
              onBlur={onEditEnd}
              onChange={(e) => props.onChangeNodeLabel(e.target.value)}
            />
          </label>
          <label>
            Shape
            <select
              value={element.shape}
              onChange={(e) => props.onChangeNodeShape(e.target.value as FlowchartNodeShape)}
            >
              {SHAPE_GROUPS.map(([group, shapes]) => (
                <optgroup key={group} label={group}>
                  {shapes.map((s) => (
                    <option key={s.shape} value={s.shape}>
                      {s.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        </>
      ) : (
        <>
          <h3>Edge</h3>
          <label>
            Label
            <input
              value={element.label ?? ""}
              onFocus={onEditStart}
              onBlur={onEditEnd}
              onChange={(e) => props.onChangeEdgeLabel(e.target.value)}
            />
          </label>
          <label>
            Line
            <select
              aria-label="Edge line"
              value={element.line}
              onChange={(e) => props.onChangeEdgeLine(e.target.value as FlowchartLineStyle)}
            >
              <option value="solid">Solid</option>
              <option value="dotted">Dotted</option>
              <option value="thick">Thick</option>
              <option value="invisible">Invisible (layout only)</option>
            </select>
          </label>
          <label>
            Start head
            <select
              aria-label="Edge start head"
              value={element.headStart}
              onChange={(e) => props.onChangeEdgeHead("headStart", e.target.value as FlowchartEdgeHead)}
            >
              {HEADS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            End head
            <select
              aria-label="Edge end head"
              value={element.headEnd}
              onChange={(e) => props.onChangeEdgeHead("headEnd", e.target.value as FlowchartEdgeHead)}
            >
              {HEADS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            Length
            <input
              aria-label="Edge length"
              type="number"
              min={1}
              max={9}
              value={element.length ?? 1}
              onChange={(e) => props.onChangeEdgeLength(Number(e.target.value))}
            />
          </label>
          {element.headStart !== "none" && element.headStart !== element.headEnd && (
            <div className="hint">mermaid は両端が同じ形のときだけ始点マーカーを出力します</div>
          )}
        </>
      )}
      <button className="danger" onClick={onDelete}>
        Delete {isNode(element) ? "node" : "edge"}
      </button>
    </div>
  );
}
