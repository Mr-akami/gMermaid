// Date math for gantt layout. Mermaid uses dayjs + d3-time-format; gMermaid
// has no date dependency, so this is a deliberately small subset:
// `dateFormat` tokens YYYY YY MM M DD D HH H mm m ss s X x, `axisFormat`
// directives %Y %y %m %d %e %H %M %S %L %b %B %a %A %p %I %j %%, and the
// duration suffixes ms s m h d w. Everything is computed in UTC so a layout
// is identical in every timezone (golden tests depend on it).

const MS = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 } as const;

export const DAY_MS = MS.d;

interface DateToken {
  readonly token: string;
  readonly pattern: string;
}

// longest first: `YYYY` must win over `YY`, `MM` over `M`
const DATE_TOKENS: readonly DateToken[] = [
  { token: "YYYY", pattern: "(\\d{4})" },
  { token: "YY", pattern: "(\\d{2})" },
  { token: "MM", pattern: "(\\d{2})" },
  { token: "M", pattern: "(\\d{1,2})" },
  { token: "DD", pattern: "(\\d{2})" },
  { token: "D", pattern: "(\\d{1,2})" },
  { token: "HH", pattern: "(\\d{2})" },
  { token: "H", pattern: "(\\d{1,2})" },
  { token: "mm", pattern: "(\\d{2})" },
  { token: "m", pattern: "(\\d{1,2})" },
  { token: "ss", pattern: "(\\d{2})" },
  { token: "s", pattern: "(\\d{1,2})" },
  { token: "X", pattern: "(\\d+(?:\\.\\d+)?)" },
  { token: "x", pattern: "(\\d+)" },
];

function escapeLiteral(ch: string): string {
  return /[\\^$.*+?()[\]{}|]/.test(ch) ? `\\${ch}` : ch;
}

interface CompiledFormat {
  readonly re: RegExp;
  readonly tokens: readonly string[];
}

const compiled = new Map<string, CompiledFormat>();

function compile(format: string): CompiledFormat {
  const cached = compiled.get(format);
  if (cached) return cached;
  let source = "^";
  const tokens: string[] = [];
  for (let i = 0; i < format.length; ) {
    const match = DATE_TOKENS.find((t) => format.startsWith(t.token, i));
    if (match) {
      source += match.pattern;
      tokens.push(match.token);
      i += match.token.length;
    } else {
      source += escapeLiteral(format[i]!);
      i += 1;
    }
  }
  const result = { re: new RegExp(source + "$"), tokens };
  compiled.set(format, result);
  return result;
}

/**
 * Parse `value` against a mermaid `dateFormat`, returning UTC milliseconds,
 * or undefined when it does not match. A format without a date part (e.g.
 * `HH:mm`) resolves against 1970-01-01 — mermaid would use today, but layout
 * must stay deterministic, and only the relative positions matter.
 */
export function parseGanttDate(value: string, format: string): number | undefined {
  const text = value.trim();
  const fmt = format.trim();
  const { re, tokens } = compile(fmt);
  const m = re.exec(text);
  if (!m) return undefined;
  const parts = { year: 1970, month: 1, day: 1, hour: 0, minute: 0, second: 0 };
  for (const [i, token] of tokens.entries()) {
    const raw = m[i + 1]!;
    const n = Number(raw);
    switch (token) {
      case "YYYY":
        parts.year = n;
        break;
      case "YY":
        parts.year = n < 70 ? 2000 + n : 1900 + n;
        break;
      case "MM":
      case "M":
        parts.month = n;
        break;
      case "DD":
      case "D":
        parts.day = n;
        break;
      case "HH":
      case "H":
        parts.hour = n;
        break;
      case "mm":
      case "m":
        parts.minute = n;
        break;
      case "ss":
      case "s":
        parts.second = n;
        break;
      case "X":
        return Math.round(n * 1000);
      case "x":
        return n;
    }
  }
  if (parts.month < 1 || parts.month > 12 || parts.day < 1 || parts.day > 31) return undefined;
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

/** `3d`, `1.5h`, `500ms` → milliseconds. Mermaid's `M`/`y` are not supported
 * (they need calendar arithmetic) and read as undefined. */
export function parseGanttDuration(value: string): number | undefined {
  const m = /^(\d+(?:\.\d+)?)(ms|s|m|h|d|w)$/.exec(value.trim());
  if (!m) return undefined;
  return Number.parseFloat(m[1]!) * MS[m[2]! as keyof typeof MS];
}

const TICK_UNITS: Record<string, number> = {
  millisecond: MS.ms,
  second: MS.s,
  minute: MS.m,
  hour: MS.h,
  day: MS.d,
  week: MS.w,
  month: 30 * MS.d,
};

/** `1day`, `2week` … → milliseconds (mermaid's tickInterval grammar). */
export function parseTickInterval(value: string): number | undefined {
  const m = /^([1-9][0-9]*)(millisecond|second|minute|hour|day|week|month)$/.exec(value.trim());
  if (!m) return undefined;
  return Number(m[1]) * TICK_UNITS[m[2]!]!;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** Format UTC milliseconds with a d3-style `axisFormat` string. */
export function formatGanttDate(ms: number, format: string): string {
  const d = new Date(ms);
  let out = "";
  for (let i = 0; i < format.length; i++) {
    if (format[i] !== "%" || i + 1 >= format.length) {
      out += format[i];
      continue;
    }
    i += 1;
    switch (format[i]) {
      case "Y":
        out += String(d.getUTCFullYear());
        break;
      case "y":
        out += pad(d.getUTCFullYear() % 100);
        break;
      case "m":
        out += pad(d.getUTCMonth() + 1);
        break;
      case "B":
        out += MONTHS[d.getUTCMonth()]!;
        break;
      case "b":
        out += MONTHS[d.getUTCMonth()]!.slice(0, 3);
        break;
      case "d":
        out += pad(d.getUTCDate());
        break;
      case "e":
        out += String(d.getUTCDate()).padStart(2, " ");
        break;
      case "A":
        out += DAYS[d.getUTCDay()]!;
        break;
      case "a":
        out += DAYS[d.getUTCDay()]!.slice(0, 3);
        break;
      case "H":
        out += pad(d.getUTCHours());
        break;
      case "I":
        out += pad(d.getUTCHours() % 12 === 0 ? 12 : d.getUTCHours() % 12);
        break;
      case "p":
        out += d.getUTCHours() < 12 ? "AM" : "PM";
        break;
      case "M":
        out += pad(d.getUTCMinutes());
        break;
      case "S":
        out += pad(d.getUTCSeconds());
        break;
      case "L":
        out += pad(d.getUTCMilliseconds(), 3);
        break;
      case "j":
        out += pad(Math.floor((ms - Date.UTC(d.getUTCFullYear(), 0, 1)) / DAY_MS) + 1, 3);
        break;
      case "%":
        out += "%";
        break;
      default:
        out += `%${format[i]}`;
    }
  }
  return out;
}

/** Tick steps the auto axis may choose from, coarsest last. */
const TICK_STEPS: readonly number[] = [
  MS.s,
  5 * MS.s,
  15 * MS.s,
  30 * MS.s,
  MS.m,
  5 * MS.m,
  15 * MS.m,
  30 * MS.m,
  MS.h,
  3 * MS.h,
  6 * MS.h,
  12 * MS.h,
  MS.d,
  2 * MS.d,
  MS.w,
  2 * MS.w,
  4 * MS.w,
  13 * MS.w,
  26 * MS.w,
  52 * MS.w,
];

/** Coarsest-but-one step that keeps the axis under `maxTicks` labels. */
export function chooseTickStep(span: number, maxTicks: number): number {
  for (const step of TICK_STEPS) {
    if (span / step <= maxTicks) return step;
  }
  return TICK_STEPS[TICK_STEPS.length - 1]!;
}
