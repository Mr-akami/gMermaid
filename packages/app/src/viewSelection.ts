/**
 * Replace a ViewState's primary selection, keeping every other mode
 * (connect-from, move-into, …) intact — the shell selects, the editor's own
 * pending gesture is none of its business.
 *
 * `exactOptionalPropertyTypes` means "nothing selected" is the ABSENT key,
 * not `undefined`, so this is the one place in the app that spells it.
 */
export function withSelected<V extends { readonly selectedId?: string | undefined }>(
  view: V,
  id: string | undefined,
): V {
  const next: Record<string, unknown> = { ...view };
  if (id === undefined) delete next["selectedId"];
  else next["selectedId"] = id;
  return next as V;
}
