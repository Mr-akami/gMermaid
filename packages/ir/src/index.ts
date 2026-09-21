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
export * from "./timeline";
export * from "./timelineActions";
export * from "./journey";
export * from "./journeyActions";
export * from "./requirement";
export * from "./requirementActions";

import type { ClassIR } from "./classdiagram";
import type { FlowchartIR } from "./flowchart";
import type { RequirementIR } from "./requirement";
import type { SequenceIR } from "./sequence";
import type { StateIR } from "./statediagram";
import type { TimelineIR } from "./timeline";
import type { JourneyIR } from "./journey";

export type DiagramIR = FlowchartIR | SequenceIR | ClassIR | StateIR | RequirementIR | JourneyIR | TimelineIR;
