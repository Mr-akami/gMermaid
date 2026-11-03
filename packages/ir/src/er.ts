import type { AttributeId, EntityId, RelationId } from "./ids";

/** Attribute key constraints, in mermaid's spelling. */
export const ER_KEYS = ["PK", "FK", "UK"] as const;
export type ErKey = (typeof ER_KEYS)[number];

/** One end of a relationship: how many of THIS entity take part. */
export const ER_CARDINALITIES = ["zero-or-one", "exactly-one", "zero-or-more", "one-or-more"] as const;
export type ErCardinality = (typeof ER_CARDINALITIES)[number];

export const ER_CARDINALITY_LABEL: Record<ErCardinality, string> = {
  "zero-or-one": "zero or one",
  "exactly-one": "exactly one",
  "zero-or-more": "zero or more",
  "one-or-more": "one or more",
};

export interface ErAttribute {
  readonly id: AttributeId;
  /** `string`, `int`, `varchar(255)`, `string[]` — no spaces. */
  readonly type: string;
  readonly name: string;
  /** Order is the order written; empty = no key. */
  readonly keys: readonly ErKey[];
  readonly comment?: string;
}

export interface ErEntity {
  readonly id: EntityId;
  /** Mermaid entity name — the exchange identity, unique across the diagram. */
  readonly name: string;
  /** `A["Display name"]`: drawn instead of the name when present. */
  readonly alias?: string;
  readonly attributes: readonly ErAttribute[];
}

export interface ErRelationship {
  readonly id: RelationId;
  readonly from: EntityId;
  readonly to: EntityId;
  /** Cardinality on the `from` side (how many `from` per `to`). */
  readonly fromCard: ErCardinality;
  readonly toCard: ErCardinality;
  /** `--` (true) or `..` non-identifying (false). */
  readonly identifying: boolean;
  readonly label?: string;
}

export type ErDirection = "TB" | "LR" | "BT" | "RL";

export interface ErIR {
  readonly kind: "er";
  /** absent = mermaid default (TB) */
  readonly direction?: ErDirection;
  readonly entities: readonly ErEntity[];
  readonly relationships: readonly ErRelationship[];
}

export function emptyErDiagram(): ErIR {
  return { kind: "er", entities: [], relationships: [] };
}

/** Mermaid's glyph for a cardinality on the left / right of the line. */
export const ER_LEFT_GLYPH: Record<ErCardinality, string> = {
  "zero-or-one": "|o",
  "exactly-one": "||",
  "zero-or-more": "}o",
  "one-or-more": "}|",
};
export const ER_RIGHT_GLYPH: Record<ErCardinality, string> = {
  "zero-or-one": "o|",
  "exactly-one": "||",
  "zero-or-more": "o{",
  "one-or-more": "|{",
};
