import type { ClassMember, ClassMethod, Visibility } from "./classdiagram";

// Canonical one-line member rendering in mermaid's documented shape
// (`+Type name$`, `+method(params)* ReturnType`), shared by codegen and the
// property-window member editor so the text form is stable.
export const VISIBILITY_SYMBOL: Record<Visibility, string> = {
  public: "+",
  private: "-",
  protected: "#",
  package: "~",
};

export function formatAttribute(a: ClassMember): string {
  return `${VISIBILITY_SYMBOL[a.visibility]}${a.type !== undefined ? `${a.type} ` : ""}${a.name}${a.static ? "$" : ""}`;
}

export function formatMethod(m: ClassMethod): string {
  const classifier = m.abstract ? "*" : m.static ? "$" : "";
  return `${VISIBILITY_SYMBOL[m.visibility]}${m.name}(${m.params})${classifier}${m.type !== undefined ? ` ${m.type}` : ""}`;
}

/** Mermaid shows `List~int~` as `List<int>`: `~` opens before an identifier char, closes otherwise. */
export function genericToAngle(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c !== "~") {
      out += c;
      continue;
    }
    out += /[\p{L}\p{N}_]/u.test(text[i + 1] ?? "") ? "<" : ">";
  }
  return out;
}

/** Display text: like the canonical form but classifiers become styling, and generics use angle brackets. */
export function displayAttribute(a: ClassMember): string {
  return genericToAngle(formatAttribute({ ...a, static: false }));
}

export function displayMethod(m: ClassMethod): string {
  return genericToAngle(formatMethod({ ...m, static: false, abstract: false }));
}
