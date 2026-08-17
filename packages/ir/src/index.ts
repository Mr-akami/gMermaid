export * from "./ids";
export * from "./flowchart";
export * from "./sequence";
export * from "./classdiagram";
export * from "./flowchartActions";
export * from "./sequenceActions";
export * from "./sequenceQuery";
export * from "./classActions";
export * from "./classFormat";
export * from "./history";

import type { ClassIR } from "./classdiagram";
import type { FlowchartIR } from "./flowchart";
import type { SequenceIR } from "./sequence";

export type DiagramIR = FlowchartIR | SequenceIR | ClassIR;
