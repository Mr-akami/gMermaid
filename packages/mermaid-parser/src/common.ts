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
