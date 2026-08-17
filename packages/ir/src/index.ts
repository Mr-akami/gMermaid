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
export * from "./omitUndefined";
export * from "./statediagram";
export * from "./stateActions";

import type { ClassIR } from "./classdiagram";
import type { FlowchartIR } from "./flowchart";
import type { SequenceIR } from "./sequence";
import type { StateIR } from "./statediagram";

export type DiagramIR = FlowchartIR | SequenceIR | ClassIR | StateIR;
