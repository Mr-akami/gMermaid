export type EditorMode = "standalone" | "review";

/** Runtime seam shared by the standalone app and MCP review surfaces. */
export interface EditorRuntimeProps {
  readonly initialCode?: string | undefined;
  readonly mode?: EditorMode | undefined;
  readonly onCodeChange?: ((code: string) => void) | undefined;
  readonly onValidityChange?: ((valid: boolean) => void) | undefined;
}
