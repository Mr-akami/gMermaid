// exactOptionalPropertyTypes: optional fields must be ABSENT, not
// present-as-undefined. Spreading through omitUndefined lets new optional
// fields flow through updates without every action hand-listing them.
type OmitUndefined<T> = {
  [K in keyof T as undefined extends T[K] ? never : K]: T[K];
} & {
  [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined>;
};

export function omitUndefined<T extends object>(obj: T): OmitUndefined<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as OmitUndefined<T>;
}
