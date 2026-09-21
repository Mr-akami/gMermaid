export interface ParseError {
  readonly line: number; // 1-based
  readonly message: string;
}

export type ParseResult<T> =
  | { readonly ok: true; readonly ir: T }
  | { readonly ok: false; readonly errors: readonly ParseError[] };

/** Inverse of codegen's escapeLabel. Order mirrors codegen (entities last). */
export function unescapeLabel(text: string): string {
  return text
    .replaceAll("<br/>", "\n")
    .replaceAll("#quot;", '"')
    .replaceAll("#lt;", "<")
    .replaceAll("#gt;", ">")
    .replaceAll("#35;", "#");
}

/** Strip one level of double quotes if present. */
export function unquote(text: string): string {
  const t = text.trim();
  return t.startsWith('"') && t.endsWith('"') && t.length >= 2 ? t.slice(1, -1) : t;
}

// ---------------------------------------------------------------------------
// Shared line preprocessing. Mermaid's real grammars accept a lot of dialect
// the per-diagram parsers have no IR for: YAML frontmatter, `%%{init}%%`
// directives, trailing `%%` comments, `;` statement terminators, styling and
// accessibility statements, `:::class` suffixes. `prepareLines` normalizes all
// of that away so each parser only sees plain statements. Everything it drops
// is discarded BY DESIGN (lossy, like `%%` comments) — the IR does not model
// styling, so a parse → codegen round trip loses it.

export interface PreparedLine {
  /** The normalized statement text (trimmed, comment/terminator stripped). */
  readonly text: string;
  /** 1-based line number in the original source, for error reporting. */
  readonly line: number;
}

export interface PrepareOptions {
  /** Statement keywords to discard entirely (e.g. `style`, `classDef`).
   * Matched as a whole word at the start of the statement, optionally
   * followed by `:` (`accTitle: x`) or `{`. An `accDescr { … }` block is
   * dropped whole when `accDescr` is listed. */
  readonly drop?: readonly string[];
  /** Split one line into several statements on `;` that sit outside quotes
   * and brackets (`A-->B; B-->C;`). Otherwise only a trailing `;` is
   * removed. */
  readonly splitSemicolons?: boolean;
  /** Remove `:::className` suffixes (`A:::cls --> B`). */
  readonly stripClassSuffix?: boolean;
}

/** Index of the first `%%` outside `"…"`, or -1. */
function commentStart(text: string): number {
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"') inQuote = !inQuote;
    else if (!inQuote && c === "%" && text[i + 1] === "%") return i;
  }
  return -1;
}

/** `;` at `end` closes a mermaid entity (`#quot;`, `#35;`) — not a terminator. */
function endsEntity(text: string, end: number): boolean {
  return /#[A-Za-z0-9]+$/.test(text.slice(Math.max(0, end - 12), end));
}

/** Split on `;` outside quotes and brackets (entities like `#gt;` are kept). */
function splitStatements(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inQuote = false;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"') inQuote = !inQuote;
    else if (!inQuote && "([{".includes(c)) depth += 1;
    else if (!inQuote && ")]}".includes(c)) depth -= 1;
    else if (!inQuote && depth <= 0 && c === ";" && !endsEntity(text, i)) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

/** Remove every `:::name` outside quotes. */
function stripClassSuffix(text: string): string {
  let out = "";
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"') inQuote = !inQuote;
    if (!inQuote && text.startsWith(":::", i)) {
      let j = i + 3;
      while (j < text.length && /[\p{L}\p{N}_-]/u.test(text[j]!)) j += 1;
      i = j - 1;
      continue;
    }
    out += c;
  }
  return out;
}

function isDropped(text: string, drop: readonly string[]): boolean {
  for (const kw of drop) {
    if (text === kw) return true;
    if (text.startsWith(kw)) {
      const next = text[kw.length]!;
      if (next === " " || next === "\t" || next === ":" || next === "{") return true;
    }
  }
  return false;
}

/**
 * Normalize mermaid source into plain statements with original line numbers.
 * Skips a leading YAML frontmatter block (`---` … `---`), `%%{ … }%%`
 * directives (single- or multi-line), blank lines and `%%` comment lines;
 * strips trailing `%%` comments and `;` terminators; drops the statements
 * listed in `opts.drop`. The first returned statement is the diagram header.
 */
export function prepareLines(code: string, opts: PrepareOptions = {}): PreparedLine[] {
  const raw = code.split("\n");
  const out: PreparedLine[] = [];
  const drop = opts.drop ?? [];
  let i = 0;

  // frontmatter: only at the very top (blank lines allowed before it)
  while (i < raw.length && raw[i]!.trim() === "") i += 1;
  if (i < raw.length && raw[i]!.trim() === "---") {
    let j = i + 1;
    while (j < raw.length && raw[j]!.trim() !== "---") j += 1;
    i = j + 1;
  }

  for (; i < raw.length; i++) {
    let line = raw[i]!.trim();
    if (line === "") continue;
    if (line.startsWith("%%{")) {
      // directive, possibly spanning lines
      while (i < raw.length && !raw[i]!.includes("}%%")) i += 1;
      continue;
    }
    if (line.startsWith("%%")) continue;
    const cut = commentStart(line);
    if (cut >= 0) line = line.slice(0, cut).trimEnd();
    if (opts.stripClassSuffix) line = stripClassSuffix(line);

    const statements = opts.splitSemicolons
      ? splitStatements(line)
      : [line.endsWith(";") && !endsEntity(line, line.length - 1) ? line.slice(0, -1) : line];
    for (const stmt of statements) {
      const text = stmt.trim();
      if (text === "") continue;
      if (drop.length > 0 && isDropped(text, drop)) {
        // `accDescr {` opens a block: swallow up to the closing `}`
        if (/^accDescr\s*\{/.test(text) && !text.includes("}")) {
          while (i + 1 < raw.length && !raw[i]!.includes("}")) i += 1;
        }
        continue;
      }
      out.push({ text, line: i + 1 });
    }
  }
  return out;
}

/** First meaningful statement (the diagram header) after frontmatter,
 * directives and comments — what kind-sniffing should look at. */
export function firstStatement(code: string): string | undefined {
  return prepareLines(code)[0]?.text;
}
