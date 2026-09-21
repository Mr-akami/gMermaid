import { repairedId } from "@gmermaid/ir";

export interface ParseError {
  readonly line: number; // 1-based
  readonly message: string;
}

/** Something the parse UNDERSTOOD but threw away (styling, accessibility,
 * unsupported metadata). The diagram still opens; the statement is gone from
 * the IR and will not come back when the code is regenerated — so it has to
 * be said out loud, not swallowed. */
export interface ParseWarning {
  readonly line: number; // 1-based, in the ORIGINAL source
  readonly message: string;
}

export type ParseResult<T> =
  | { readonly ok: true; readonly ir: T; readonly warnings: readonly ParseWarning[] }
  | { readonly ok: false; readonly errors: readonly ParseError[] };

/** The one wording for "we read this and dropped it". */
export function droppedWarning(keyword: string, line: number): ParseWarning {
  return { line, message: `\`${keyword}\` is not represented in the editor and will be lost on save` };
}

/**
 * The gate every id that comes in FROM THE TEXT passes through, for the kinds
 * whose ids mermaid spells verbatim (flowchart, state, sequence). It answers
 * the two ways an id can be unreadable to mermaid:
 *
 * - ours: an id minted before `ID_PREFIX` existed spells a keyword
 *   (`subgraph-a6bde494`), and is silently renamed — repairing the file on
 *   the next save. The rename is pure, so every reference to an old id lands
 *   on the same new one; only the FIRST sighting is reported, since an id is
 *   normally mentioned many times.
 * - the user's: a hand-typed id that IS a keyword (`end`, `note`) is
 *   rejected, not rewritten — what the user typed is theirs, and the code
 *   pane shows the reason. `reserved` holds the words mermaid's own parser
 *   refuses in an id position for that diagram kind.
 */
export function importedIds(reserved: readonly string[]) {
  const keywords = new Set(reserved);
  const renamed = new Map<string, { readonly to: string; readonly line: number }>();
  const rejected = new Map<string, number>();
  return {
    /** The id to store for `raw` (unchanged unless `raw` is an old one). */
    take(raw: string, line: number): string {
      if (keywords.has(raw) && !rejected.has(raw)) rejected.set(raw, line);
      const to = repairedId(raw);
      if (to === undefined) return raw;
      if (!renamed.has(raw)) renamed.set(raw, { to, line });
      return to;
    },
    errors(): ParseError[] {
      return [...rejected].map(([id, line]) => ({ line, message: `\`${id}\` is a mermaid keyword, so it cannot be an id` }));
    },
    warnings(): ParseWarning[] {
      return [...renamed].map(([from, { to, line }]) => ({
        line,
        message: `\`${from}\` starts with a mermaid keyword, so it was renamed to \`${to}\``,
      }));
    },
  };
}

/** Inverse of codegen's escapeLabel. Order mirrors codegen (entities last). */
export function unescapeLabel(text: string): string {
  return text
    .replaceAll("<br/>", "\n")
    .replaceAll("#quot;", '"')
    .replaceAll("#37;", "%")
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
// styling, so a parse → codegen round trip loses it. Lossy is not the same as
// silent: every drop is reported as a ParseWarning so the editor can say what
// the file will lose on save.

export interface PreparedLine {
  /** The normalized statement text (trimmed, comment/terminator stripped). */
  readonly text: string;
  /** 1-based line number in the original source, for error reporting. */
  readonly line: number;
}

// The styling / accessibility statements EVERY diagram kind drops. Mermaid's
// grammars differ on which of these they accept, but the IR models none of
// them anywhere, so a single set keeps the behaviour predictable across kinds
// instead of one ad-hoc list per parser.
export const STYLING_STATEMENTS: readonly string[] = [
  "accDescr",
  "accTitle",
  "class",
  "classDef",
  "click",
  "cssClass",
  "linkStyle",
  "style",
];

/** Drop list for one diagram kind: the shared styling set plus kind-specific
 * `extra` keywords, minus anything in `keep` — a shared keyword that is a
 * REAL statement for that kind (`class` declares a class in classDiagram,
 * and is ordinary prose in a mindmap node). */
export function dropList(opts: { readonly extra?: readonly string[]; readonly keep?: readonly string[] } = {}): readonly string[] {
  const keep = opts.keep ?? [];
  return [...STYLING_STATEMENTS.filter((k) => !keep.includes(k)), ...(opts.extra ?? [])];
}

/** Keywords mermaid spells with `:` / `{` (`accTitle: x`, `accDescr { … }`).
 * Every other dropped keyword takes its argument after whitespace, so a
 * journey task named `class: 5: Me` is not read as a styling statement. */
const COLON_FORM = new Set(["accTitle", "accDescr"]);

/** Some of these keywords are also plausible prose in the kinds whose text is
 * free-form (a mindmap node `style guide`, a gantt task `click`), so they are
 * only dropped when the rest of the statement ALSO has the shape of mermaid's
 * styling syntax. */
const ARGUMENT_SHAPE: Record<string, RegExp | undefined> = {
  style: /\S\s*:/, // style A fill:#f00
  classDef: /\S\s*:/, // classDef x fill:#f00
  linkStyle: /\S\s*:/, // linkStyle 0 stroke:#f00
  class: /^\S+\s+\S+$/, // class A cls / class A,B cls
  click: /["']|\bcall\b|\bhref\b/, // click A "url" / click A call fn()
};

export interface PrepareOptions {
  /** Statement keywords to discard entirely (e.g. `style`, `classDef`) —
   * usually `dropList({ … })`. Matched as a whole keyword at the start of the
   * statement, followed by whitespace (or `:` / `{` for `accTitle` /
   * `accDescr`); an `accDescr { … }` block is dropped whole. */
  readonly drop?: readonly string[];
  /** Sink for the dropped statements, so the editor can tell the user what
   * their file lost instead of quietly rewriting it. */
  readonly warnings?: ParseWarning[];
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

/** Remove every `:::name` outside quotes, reporting each one: a class
 * suffix is styling, so it is dropped like a `classDef` statement and the
 * user has to be told, not left to discover it after saving. */
function stripClassSuffix(text: string): { text: string; stripped: boolean } {
  let out = "";
  let inQuote = false;
  let stripped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"') inQuote = !inQuote;
    if (!inQuote && text.startsWith(":::", i)) {
      let j = i + 3;
      while (j < text.length && /[\p{L}\p{N}_-]/u.test(text[j]!)) j += 1;
      i = j - 1;
      stripped = true;
      continue;
    }
    out += c;
  }
  return { text: out, stripped };
}

/** The keyword this statement is dropped for, or undefined to keep it. */
function droppedKeyword(text: string, drop: readonly string[]): string | undefined {
  for (const kw of drop) {
    if (text === kw) return kw; // bare statement, e.g. `topAxis`
    if (!text.startsWith(kw)) continue;
    const sep = text[kw.length]!;
    if (sep === ":" || sep === "{") {
      if (!COLON_FORM.has(kw)) continue; // `class: 5: Me` is a journey task
    } else if (sep !== " " && sep !== "\t") {
      continue; // a longer word (`classDef`, `styleNode`), not the keyword
    }
    const shape = ARGUMENT_SHAPE[kw];
    if (shape !== undefined && !shape.test(text.slice(kw.length).trim())) continue;
    return kw;
  }
  return undefined;
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
    if (opts.stripClassSuffix) {
      const s = stripClassSuffix(line);
      if (s.stripped) opts.warnings?.push(droppedWarning(":::", i + 1));
      line = s.text;
    }

    const statements = opts.splitSemicolons
      ? splitStatements(line)
      : [line.endsWith(";") && !endsEntity(line, line.length - 1) ? line.slice(0, -1) : line];
    for (const stmt of statements) {
      const text = stmt.trim();
      if (text === "") continue;
      const dropped = drop.length > 0 ? droppedKeyword(text, drop) : undefined;
      if (dropped !== undefined) {
        opts.warnings?.push(droppedWarning(dropped, i + 1));
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
