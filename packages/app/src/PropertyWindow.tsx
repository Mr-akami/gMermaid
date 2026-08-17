import type {
  FlowchartArrowType,
  FlowchartEdge,
  FlowchartNode,
  FlowchartNodeShape,
} from "@gmermaid/ir";

// Callbacks carry user intent only (ADR 0001) — the property window never
// sees the IR or the dispatcher, just the resolved element it edits.
// onEditStart/onEditEnd bracket a text-editing transaction so one focus
// session undoes as a single step.
export interface PropertyWindowProps {
  readonly element: FlowchartNode | FlowchartEdge;
  readonly onChangeNodeLabel: (label: string) => void;
  readonly onChangeNodeShape: (shape: FlowchartNodeShape) => void;
  readonly onChangeEdgeLabel: (label: string) => void;
  readonly onChangeEdgeArrow: (arrow: FlowchartArrowType) => void;
  readonly onDelete: () => void;
  readonly onEditStart: () => void;
  readonly onEditEnd: () => void;
}

function isNode(el: FlowchartNode | FlowchartEdge): el is FlowchartNode {
  return "shape" in el;
}

export function PropertyWindow(props: PropertyWindowProps) {
  const { element, onEditStart, onEditEnd, onDelete } = props;

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
