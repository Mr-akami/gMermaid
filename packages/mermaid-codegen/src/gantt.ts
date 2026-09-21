import type { GanttIR, GanttTask, GanttTaskEnd, GanttTaskStart } from "@gmermaid/ir";

// Gantt text is line-oriented and unquoted: a task line is `Name : meta`, so
// the name must not carry `:`/`#`/`;`/`%` (the reducer sanitizes it) and the
// metadata fields are joined with `, ` in mermaid's fixed order.

function startField(start: GanttTaskStart): string | undefined {
  switch (start.kind) {
    case "prev":
      return undefined;
    case "date":
      return start.value;
    case "after":
      return `after ${start.ids.join(" ")}`;
  }
}

function endField(end: GanttTaskEnd): string {
  switch (end.kind) {
    case "date":
    case "duration":
      return end.value;
    case "until":
      return `until ${end.ids.join(" ")}`;
  }
}

function taskLine(task: GanttTask): string {
  const start = startField(task.start);
  // the id slot only exists in the 3-field form (id, start, end)
  const fields = [
    ...task.tags,
    ...(start !== undefined && task.taskId !== undefined ? [task.taskId] : []),
    ...(start !== undefined ? [start] : []),
    endField(task.end),
  ];
  return `  ${task.name} :${fields.join(", ")}`;
}

export function ganttToMermaid(ir: GanttIR): string {
  const lines = ["gantt"];
  if (ir.title !== undefined) lines.push(`  title ${ir.title}`);
  if (ir.dateFormat !== undefined) lines.push(`  dateFormat ${ir.dateFormat}`);
  if (ir.axisFormat !== undefined) lines.push(`  axisFormat ${ir.axisFormat}`);
  if (ir.tickInterval !== undefined) lines.push(`  tickInterval ${ir.tickInterval}`);
  if (ir.excludes !== undefined && ir.excludes.length > 0) lines.push(`  excludes ${ir.excludes.join(" ")}`);
  if (ir.weekend !== undefined) lines.push(`  weekend ${ir.weekend}`);
  if (ir.todayMarker !== undefined) lines.push(`  todayMarker ${ir.todayMarker}`);
  if (ir.inclusiveEndDates === true) lines.push("  inclusiveEndDates");

  for (const section of ir.sections) {
    // the leading nameless section holds tasks written before any `section`
    if (section.name !== "") lines.push(`  section ${section.name}`);
    for (const task of section.tasks) lines.push(taskLine(task));
  }

  return lines.join("\n") + "\n";
}
