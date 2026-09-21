import type { SectionId, TaskId } from "./ids";
import { sanitizeJourneyText, type JourneyIR, type JourneySection, type JourneyTask } from "./journey";
import { omitUndefined } from "./omitUndefined";

// Same contract as the other diagram actions: intent-carrying, immutable,
// identity-preserving on no-ops.

export type JourneyAction =
  | { type: "setJourneyTitle"; title: string }
  | { type: "addSection"; section: { id: SectionId; name: string } }
  | { type: "updateSection"; id: SectionId; name: string }
  | { type: "removeSection"; id: SectionId }
  // order is the only position a section has; -1 = up, +1 = down
  | { type: "moveSection"; id: SectionId; delta: -1 | 1 }
  | { type: "addTask"; sectionId: SectionId; task: JourneyTask; afterTaskId?: TaskId }
  | { type: "updateTask"; id: TaskId; name?: string; score?: number; actors?: readonly string[] }
  | { type: "removeTask"; id: TaskId }
  // a task moved past the edge of its section hops into the neighbour section
  | { type: "moveTask"; id: TaskId; delta: -1 | 1 };

export const JOURNEY_MIN_SCORE = 1;
export const JOURNEY_MAX_SCORE = 5;

function sanitizeActors(actors: readonly string[]): readonly string[] {
  const out: string[] = [];
  for (const a of actors) {
    const clean = sanitizeJourneyText(a, { actor: true });
    if (clean !== "" && !out.includes(clean)) out.push(clean);
  }
  return out;
}

function cleanTask(t: JourneyTask): JourneyTask {
  return { id: t.id, name: sanitizeJourneyText(t.name), score: t.score, actors: sanitizeActors(t.actors) };
}

function findTask(ir: JourneyIR, id: TaskId): { section: number; index: number } | undefined {
  for (let s = 0; s < ir.sections.length; s++) {
    const i = ir.sections[s]!.tasks.findIndex((t) => t.id === id);
    if (i >= 0) return { section: s, index: i };
  }
  return undefined;
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

function replaceSection(ir: JourneyIR, index: number, section: JourneySection): JourneyIR {
  return { ...ir, sections: ir.sections.map((s, i) => (i === index ? section : s)) };
}

export function applyJourneyAction(ir: JourneyIR, action: JourneyAction): JourneyIR {
  switch (action.type) {
    case "setJourneyTitle": {
      const title = sanitizeJourneyText(action.title);
      const next = title === "" ? undefined : title;
      if (next === ir.title) return ir;
      return omitUndefined({ ...ir, title: next });
    }

    case "addSection": {
      if (ir.sections.some((s) => s.id === action.section.id)) return ir;
      const name = sanitizeJourneyText(action.section.name);
      // an unnamed section is only expressible in mermaid text as the first one
      if (name === "" && ir.sections.length > 0) return ir;
      return { ...ir, sections: [...ir.sections, { id: action.section.id, name, tasks: [] }] };
    }

    case "updateSection": {
      const index = ir.sections.findIndex((s) => s.id === action.id);
      if (index < 0) return ir;
      const name = sanitizeJourneyText(action.name);
      if (name === "" && index !== 0) return ir;
      const s = ir.sections[index]!;
      if (name === s.name) return ir;
      return replaceSection(ir, index, { ...s, name });
    }

    case "removeSection": {
      if (!ir.sections.some((s) => s.id === action.id)) return ir;
      return { ...ir, sections: ir.sections.filter((s) => s.id !== action.id) };
    }

    case "moveSection": {
      const from = ir.sections.findIndex((s) => s.id === action.id);
      const to = from + action.delta;
      if (from < 0 || to < 0 || to >= ir.sections.length) return ir;
      // the unnamed section can only ever be first
      if (ir.sections[from]!.name === "" || ir.sections[to]!.name === "") return ir;
      const sections = [...ir.sections];
      [sections[from], sections[to]] = [sections[to]!, sections[from]!];
      return { ...ir, sections };
    }

    case "addTask": {
      const index = ir.sections.findIndex((s) => s.id === action.sectionId);
      if (index < 0) return ir;
      if (ir.sections.some((s) => s.tasks.some((t) => t.id === action.task.id))) return ir;
      if (!Number.isFinite(action.task.score)) return ir;
      const task = cleanTask(action.task);
      if (task.name === "") return ir;
      const s = ir.sections[index]!;
      const at = action.afterTaskId !== undefined ? s.tasks.findIndex((t) => t.id === action.afterTaskId) + 1 : s.tasks.length;
      const tasks = [...s.tasks];
      tasks.splice(at > 0 ? at : s.tasks.length, 0, task);
      return replaceSection(ir, index, { ...s, tasks });
    }

    case "updateTask": {
      const pos = findTask(ir, action.id);
      if (!pos) return ir;
      const s = ir.sections[pos.section]!;
      const t = s.tasks[pos.index]!;
      const name = action.name !== undefined ? sanitizeJourneyText(action.name) : t.name;
      const score = action.score !== undefined && Number.isFinite(action.score) ? action.score : t.score;
      const actors = action.actors !== undefined ? sanitizeActors(action.actors) : t.actors;
      if (name === "" || (name === t.name && score === t.score && sameList(actors, t.actors))) return ir;
      const next: JourneyTask = { id: t.id, name, score, actors };
      return replaceSection(ir, pos.section, { ...s, tasks: s.tasks.map((x) => (x.id === t.id ? next : x)) });
    }

    case "removeTask": {
      const pos = findTask(ir, action.id);
      if (!pos) return ir;
      const s = ir.sections[pos.section]!;
      return replaceSection(ir, pos.section, { ...s, tasks: s.tasks.filter((t) => t.id !== action.id) });
    }

    case "moveTask": {
      const pos = findTask(ir, action.id);
      if (!pos) return ir;
      const s = ir.sections[pos.section]!;
      const target = pos.index + action.delta;
      if (target >= 0 && target < s.tasks.length) {
        const tasks = [...s.tasks];
        [tasks[pos.index], tasks[target]] = [tasks[target]!, tasks[pos.index]!];
        return replaceSection(ir, pos.section, { ...s, tasks });
      }
      // past the edge: hop into the neighbouring section (end of the previous
      // one when moving up, start of the next one when moving down)
      const neighbour = pos.section + action.delta;
      if (neighbour < 0 || neighbour >= ir.sections.length) return ir;
      const task = s.tasks[pos.index]!;
      const n = ir.sections[neighbour]!;
      const nTasks = action.delta < 0 ? [...n.tasks, task] : [task, ...n.tasks];
      return {
        ...ir,
        sections: ir.sections.map((x, i) =>
          i === pos.section ? { ...x, tasks: x.tasks.filter((t) => t.id !== task.id) } : i === neighbour ? { ...x, tasks: nTasks } : x,
        ),
      };
    }
  }
}
