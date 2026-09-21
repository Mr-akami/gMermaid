import { MINDMAP_SHAPES, type MindmapNode, type MindmapShape } from "@gmermaid/ir";

export interface MindmapPropertyWindowProps {
  readonly node: MindmapNode;
  /** False on the root and on the first/last child of a parent. */
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
  readonly onChangeLabel: (label: string) => void;
  readonly onChangeShape: (shape: MindmapShape) => void;
  readonly onChangeIcon: (icon: string) => void;
  /** -1 = earlier among siblings, +1 = later. */
  readonly onMove: (delta: -1 | 1) => void;
  readonly onDelete: () => void;
  readonly onEditStart: () => void;
  readonly onEditEnd: () => void;
}

const SHAPE_LABELS: Record<MindmapShape, string> = {
  default: "Default (no border)",
  square: "Square [ ]",
  rounded: "Rounded ( )",
  circle: "Circle (( ))",
  bang: "Bang )) ((",
  cloud: "Cloud ) (",
  hexagon: "Hexagon {{ }}",
};

export function MindmapPropertyWindow(props: MindmapPropertyWindowProps) {
  const { node, onEditStart, onEditEnd } = props;
  return (
    <div className="property-window">
      <h3>Node</h3>
      <label>
        Label
        <textarea
          rows={3}
          value={node.label}
          onFocus={onEditStart}
          onBlur={onEditEnd}
          onChange={(e) => props.onChangeLabel(e.target.value)}
        />
      </label>
      <label>
        Shape
        <select value={node.shape} onChange={(e) => props.onChangeShape(e.target.value as MindmapShape)}>
          {MINDMAP_SHAPES.map((s) => (
            <option key={s} value={s}>
              {SHAPE_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Icon
        <input
          value={node.icon ?? ""}
          placeholder="fa fa-book"
          onFocus={onEditStart}
          onBlur={onEditEnd}
          onChange={(e) => props.onChangeIcon(e.target.value)}
        />
      </label>
      {node.classes !== undefined && node.classes.length > 0 && (
        // classes come from the embedding site's CSS — kept on round trip,
        // but there is nothing here to render them with
        <div className="hint">classes: {node.classes.join(" ")}</div>
      )}
      <div className="row-buttons">
        <button disabled={!props.canMoveUp} onClick={() => props.onMove(-1)}>
          ↑ Move up
        </button>
        <button disabled={!props.canMoveDown} onClick={() => props.onMove(1)}>
          ↓ Move down
        </button>
      </div>
      <button className="danger" onClick={props.onDelete}>
        Delete node
      </button>
    </div>
  );
}
