import type {
  FlowchartArrowType,
  FlowchartEdge,
  FlowchartNode,
  FlowchartNodeShape,
  FlowchartSubgraph,
} from "@gmermaid/ir";

// Callbacks carry user intent only (ADR 0001) — the property window never
// sees the IR or the dispatcher, just the resolved element it edits.
// onEditStart/onEditEnd bracket a text-editing transaction so one focus
// session undoes as a single step.
export interface PropertyWindowProps {
  readonly element: FlowchartNode | FlowchartEdge | FlowchartSubgraph;
  readonly onChangeNodeLabel: (label: string) => void;
  readonly onChangeNodeShape: (shape: FlowchartNodeShape) => void;
  readonly onChangeEdgeLabel: (label: string) => void;
  readonly onChangeEdgeArrow: (arrow: FlowchartArrowType) => void;
  readonly onChangeSubgraphLabel: (label: string) => void;
  readonly onDelete: () => void;
  readonly onEditStart: () => void;
  readonly onEditEnd: () => void;
}

function isNode(el: PropertyWindowProps["element"]): el is FlowchartNode {
  return "shape" in el;
}

function isSubgraph(el: PropertyWindowProps["element"]): el is FlowchartSubgraph {
  return !("shape" in el) && !("arrow" in el);
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
              <option value="rect">Rectangle</option>
              <option value="rounded">Rounded</option>
              <option value="stadium">Stadium</option>
              <option value="diamond">Diamond</option>
              <option value="circle">Circle</option>
              <option value="doubleCircle">Double circle</option>
              <option value="subroutine">Subroutine</option>
              <option value="cylinder">Cylinder</option>
              <option value="hexagon">Hexagon</option>
              <option value="asymmetric">Asymmetric</option>
              <option value="parallelogram">Parallelogram</option>
              <option value="parallelogramAlt">Parallelogram (alt)</option>
              <option value="trapezoid">Trapezoid</option>
              <option value="trapezoidAlt">Trapezoid (alt)</option>
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
            Arrow
            <select
              value={element.arrow}
              onChange={(e) => props.onChangeEdgeArrow(e.target.value as FlowchartArrowType)}
            >
              <option value="arrow">Arrow</option>
              <option value="open">Open (no head)</option>
              <option value="dotted">Dotted</option>
              <option value="thick">Thick</option>
              <option value="invisible">Invisible (layout only)</option>
            </select>
          </label>
        </>
      )}
      <button className="danger" onClick={onDelete}>
        Delete {isNode(element) ? "node" : "edge"}
      </button>
    </div>
  );
}
