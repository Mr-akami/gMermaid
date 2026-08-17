import type { ClassMember, ClassMethod, Visibility } from "./classdiagram";

// Canonical one-line member rendering, shared by codegen and layout so the
// diagram and the mermaid text always show members identically.
export const VISIBILITY_SYMBOL: Record<Visibility, string> = {
  public: "+",
  private: "-",
  protected: "#",
  package: "~",
};

export function formatAttribute(a: ClassMember): string {
  return `${VISIBILITY_SYMBOL[a.visibility]}${a.name}${a.type !== undefined ? ` : ${a.type}` : ""}`;
}

export function formatMethod(m: ClassMethod): string {
  return `${VISIBILITY_SYMBOL[m.visibility]}${m.name}(${m.params})${m.type !== undefined ? ` : ${m.type}` : ""}`;
}
