import type { QuadrantAxis, QuadrantIR, QuadrantPoint, QuadrantPointId } from "@gmermaid/ir";
import { sanitizeQuadrantText } from "@gmermaid/ir";
import { droppedWarning, prepareLines, type ParseError, type ParseResult, type ParseWarning } from "./common";

// quadrantChart: `title`, `x-axis low --> high`, `y-axis …`, `quadrant-1..4`
// labels and points `Name: [x, y]`, optionally followed by style fields
// (`radius: 12, color: #f00, stroke-color: …, stroke-width: 2px`) and with an
// optional `:::class` after the name. Styling has no place in the IR, so the
// fields, `:::class` and `classDef` are TOLERATED AND DROPPED with a
// ParseWarning, like every other kind's styling.
//
// Only `accTitle`, `accDescr` and `classDef` are statements here — the rest of
// the shared styling set (`style`, `class`, `click`…) is ordinary prose in a
// point name (`style guide: [0.2, 0.7]`), exactly as `class` is in a mindmap,
// so it is not dropped.

const DROPPED = ["accDescr", "accTitle", "classDef"] as const;

const STYLE_KEYS = ["radius", "color", "stroke-color", "stroke-width"] as const;
const STYLE_FIELD = `(?:${STYLE_KEYS.join("|")})\\s*:\\s*[^,\\s][^,]*`;
const STYLE_RE = new RegExp(`^${STYLE_FIELD}(?:\\s*,\\s*${STYLE_FIELD})*$`);

const NUMBER_RE = /^(?:\d+(?:\.\d+)?|\.\d+)$/;

/** `"Name": [ x , y ] rest` or `Name: [x, y] rest`; a quoted name may hold
 * `:` and brackets, a bare one stops at the first `:` before the `[`. */
const POINT_RE = /^(?:"([^"]*)"|([^":][^:]*?))\s*:\s*\[\s*([^,\]]*?)\s*,\s*([^\]]*?)\s*\]\s*(.*)$/;

/** Text as mermaid shows it: quotes (and a markdown-string backtick pair
 * inside them) are not part of it. */
function textOf(raw: string): string {
  let t = raw.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    t = t.slice(1, -1).trim();
    if (t.length >= 2 && t.startsWith("`") && t.endsWith("`")) t = t.slice(1, -1);
  }
  return sanitizeQuadrantText(t);
}

/** Split `low --> high` on the first arrow that sits outside quotes. */
function splitArrow(rest: string): readonly [string, string | undefined] {
  let inQuote = false;
  for (let i = 0; i < rest.length; i++) {
    const c = rest[i]!;
    if (c === '"') inQuote = !inQuote;
    else if (!inQuote && c === "-") {
      const m = /^--+>/.exec(rest.slice(i));
      if (m) return [rest.slice(0, i), rest.slice(i + m[0].length)];
    }
  }
  return [rest, undefined];
}

export function parseQuadrant(code: string): ParseResult<QuadrantIR> {
  const errors: ParseError[] = [];
  const warnings: ParseWarning[] = [];
  const lines = prepareLines(code, { drop: DROPPED, warnings, stripClassSuffix: true });

  let title: string | undefined;
  let xAxis: QuadrantAxis = { low: "", high: "" };
  let yAxis: QuadrantAxis = { low: "", high: "" };
  const quadrants: [string, string, string, string] = ["", "", "", ""];
  const points: QuadrantPoint[] = [];
  let headerSeen = false;
  let seq = 0;

  for (const { text, line } of lines) {
    if (!headerSeen) {
      if (text !== "quadrantChart") {
        errors.push({ line, message: "expected `quadrantChart` header" });
        return { ok: false, errors };
      }
      headerSeen = true;
      continue;
    }

    const titleMatch = /^title(?:\s+(.*))?$/.exec(text);
    if (titleMatch) {
      const value = textOf(titleMatch[1] ?? "");
      title = value === "" ? undefined : value;
      continue;
    }

    const axisMatch = /^([xy])-axis(?:\s+(.*))?$/.exec(text);
    if (axisMatch) {
      const rest = (axisMatch[2] ?? "").trim();
      if (rest === "") {
        errors.push({ line, message: `\`${axisMatch[1]}-axis\` needs a label` });
        continue;
      }
      const [low, high] = splitArrow(rest);
      const axis = { low: textOf(low), high: high === undefined ? "" : textOf(high) };
      if (axisMatch[1] === "x") xAxis = axis;
      else yAxis = axis;
      continue;
    }

    const quadMatch = /^quadrant-(\d+)(?:\s+(.*))?$/.exec(text);
    if (quadMatch) {
      const n = Number(quadMatch[1]);
      if (n < 1 || n > 4) {
        errors.push({ line, message: `unknown quadrant: quadrant-${n} (only 1 to 4)` });
        continue;
      }
      const rest = (quadMatch[2] ?? "").trim();
      if (rest === "") {
        errors.push({ line, message: `\`quadrant-${n}\` needs a label` });
        continue;
      }
      quadrants[n - 1] = textOf(rest);
      continue;
    }

    const m = POINT_RE.exec(text);
    if (!m) {
      errors.push({ line, message: `unrecognized statement: ${text}` });
      continue;
    }
    const name = m[1] !== undefined ? textOf(`"${m[1]}"`) : textOf(m[2]!);
    if (name === "") {
      errors.push({ line, message: "a point needs a name" });
      continue;
    }
    const [xs, ys] = [m[3]!, m[4]!];
    if (!NUMBER_RE.test(xs) || !NUMBER_RE.test(ys)) {
      errors.push({ line, message: `point "${name}": coordinates must be numbers between 0 and 1` });
      continue;
    }
    const [x, y] = [Number(xs), Number(ys)];
    if (x > 1 || y > 1) {
      errors.push({ line, message: `point "${name}": coordinates must be between 0 and 1` });
      continue;
    }

    const style = m[5]!.trim();
    if (style !== "") {
      if (!STYLE_RE.test(style)) {
        errors.push({ line, message: `unexpected text after the coordinates of "${name}": ${style}` });
        continue;
      }
      const keys = [...style.matchAll(/(radius|color|stroke-color|stroke-width)\s*:/g)].map((k) => k[1]!);
      warnings.push(droppedWarning([...new Set(keys)].join(", "), line));
    }

    seq += 1;
    points.push({ id: `point-${seq}` as QuadrantPointId, label: name, x, y });
  }

  if (!headerSeen) errors.push({ line: 1, message: "empty diagram: missing header" });
  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    warnings,
    ir: { kind: "quadrant", ...(title !== undefined ? { title } : {}), xAxis, yAxis, quadrants, points },
  };
}
