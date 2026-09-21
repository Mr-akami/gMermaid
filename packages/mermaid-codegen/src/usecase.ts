import {
  normalizeUsecaseRelation,
  type UseCase,
  type UsecaseActor,
  type UsecaseHead,
  type UsecaseIR,
  type UsecaseRelation,
} from "@gmermaid/ir";

// Labels always go inside double quotes, so only the entity set shared with
// the other diagram kinds has to be escaped.
function escapeLabel(label: string): string {
  return label
    .replaceAll("#", "#35;")
    .replaceAll("<", "#lt;")
    .replaceAll(">", "#gt;")
    .replaceAll('"', "#quot;")
    .replaceAll(/\r?\n/g, "<br/>");
}

/** `@{ … }` metadata, or "" when everything is at its default. */
function metadata(entries: readonly string[]): string {
  return entries.length === 0 ? "" : `@{ ${entries.join(", ")} }`;
}

function actorDecl(a: UsecaseActor): string {
  const label = a.label !== undefined ? `("${escapeLabel(a.label)}")` : "";
  const meta = metadata([
    ...(a.variant !== "default" ? [`type: ${a.variant}`] : []),
    ...(a.business === true ? ["business: true"] : []),
  ]);
  const stereotype = a.stereotype !== undefined ? ` <<${a.stereotype}>>` : "";
  return `actor ${a.name}${label}${meta}${stereotype}`;
}

function useCaseDecl(u: UseCase): string {
  // the bracket form is what makes a use case rectangular, so a label-less
  // rectangle repeats its name as the label (the parser drops it again)
  const text = escapeLabel(u.label ?? u.name);
  const body = u.shape === "rect" ? `["${text}"]` : u.label !== undefined ? `("${text}")` : "";
  const meta = metadata(u.business === true ? ["business: true"] : []);
  const stereotype = u.stereotype !== undefined ? ` <<${u.stereotype}>>` : "";
  return `${u.name}${body}${meta}${stereotype}`;
}

/** Operator halves around a label: `A <left> "label" <right> B`. */
const TO_OP: Record<Exclude<UsecaseHead, "none">, string> = {
  arrow: "-->",
  circle: "--o",
  cross: "--x",
  inheritance: "--|>",
};
const FROM_OP: Record<Exclude<UsecaseHead, "none">, string> = {
  arrow: "<--",
  circle: "o--",
  cross: "x--",
  inheritance: "--|>", // unreachable: normalization mirrors head-from generalization
};

function relationLine(r: UsecaseRelation, nameOf: (id: string) => string): string {
  const from = nameOf(r.from);
  const to = nameOf(r.to);
  if (r.kind !== undefined) return `${from} ..> : ${r.kind} ${to}`;
  const left = r.headFrom !== "none" ? FROM_OP[r.headFrom] : "--";
  const right = r.headTo !== "none" ? TO_OP[r.headTo] : "--";
  if (r.label !== undefined) return `${from} ${left} "${escapeLabel(r.label)}" ${right} ${to}`;
  // unlabelled associations spell the marker as one token
  const op = r.headFrom !== "none" ? FROM_OP[r.headFrom] : r.headTo !== "none" ? TO_OP[r.headTo] : "--";
  return `${from} ${op} ${to}`;
}

export function usecaseToMermaid(ir: UsecaseIR): string {
  const lines = ["usecase-beta"];
  if (ir.direction !== undefined) lines.push(`  direction ${ir.direction}`);

  const nameOf = (id: string): string =>
    ir.actors.find((a) => a.id === id)?.name ?? ir.usecases.find((u) => u.id === id)?.name ?? id;

  for (const a of ir.actors) if (a.boundary === undefined) lines.push(`  ${actorDecl(a)}`);
  for (const u of ir.usecases) if (u.boundary === undefined) lines.push(`  ${useCaseDecl(u)}`);

  // a boundary owns its members' declarations: mermaid has no "belongs to"
  // statement, membership is only expressed by nesting
  for (const b of ir.boundaries) {
    const title = b.label !== undefined ? `["${escapeLabel(b.label)}"]` : "";
    const meta = metadata(b.type === "package" ? ["type: package"] : []);
    lines.push(`  systemBoundary ${b.name}${title}${meta}`);
    for (const a of ir.actors) if (a.boundary === b.id) lines.push(`    ${actorDecl(a)}`);
    for (const u of ir.usecases) if (u.boundary === b.id) lines.push(`    ${useCaseDecl(u)}`);
    lines.push("  end");
  }

  for (const r of ir.relations) lines.push(`  ${relationLine(normalizeUsecaseRelation(r), nameOf)}`);
  for (const n of ir.notes) lines.push(`  note for ${nameOf(n.target)} "${escapeLabel(n.text)}"`);

  return lines.join("\n") + "\n";
}
