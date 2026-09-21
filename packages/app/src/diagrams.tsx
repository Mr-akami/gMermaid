import type { ComponentType } from "react";
import { DIAGRAM_KINDS, type DiagramKind } from "@gmermaid/mermaid-parser";
import { ClassEditor } from "./ClassEditor";
import type { EditorRuntimeProps } from "./editorRuntime";
import { FlowchartEditor } from "./FlowchartEditor";
import { SequenceEditor } from "./SequenceEditor";
import { StateEditor } from "./StateEditor";

export { DIAGRAM_KINDS, type DiagramKind };

export interface LoadRequest {
  readonly seq: number;
  readonly code: string | null;
}

export interface EditorProps extends EditorRuntimeProps {
  /** External replace request from the Files panel (null code = sample). */
  readonly loadRequest?: LoadRequest | undefined;
}

export interface DiagramDef {
  readonly kind: DiagramKind;
  /** Tab label in the standalone app. */
  readonly label: string;
  readonly Editor: ComponentType<EditorProps>;
}

/** Every diagram editor, in tab order. Register new diagram kinds here. */
export const DIAGRAMS: readonly DiagramDef[] = [
  { kind: "flowchart", label: "Flowchart", Editor: FlowchartEditor },
  { kind: "sequence", label: "Sequence", Editor: SequenceEditor },
  { kind: "class", label: "Class", Editor: ClassEditor },
  { kind: "state", label: "State", Editor: StateEditor },
];
