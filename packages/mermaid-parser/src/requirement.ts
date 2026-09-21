import {
  REQUIREMENT_RELATION_TYPES,
  REQUIREMENT_TYPES,
  RISK_LEVELS,
  VERIFY_METHODS,
  type ElementId,
  type RelationId,
  type ReqElement,
  type ReqNodeId,
  type Requirement,
  type RequirementId,
  type RequirementIR,
  type RequirementRelation,
  type RequirementRelationType,
  type RequirementType,
} from "@gmermaid/ir";
import { prepareLines, unescapeLabel, unquote, type ParseError, type ParseResult } from "./common";

// Styling has no IR here, so `style` / `classDef` / `class` statements and
// `:::class` suffixes are dropped on import (lossy by design, like `%%`).
const DROPPED = ["style", "classDef", "class", "accTitle", "accDescr"];

// mermaid's name rule: bare `[A-Za-z0-9_.]+`, or anything in double quotes
// (spaces, keywords, `-`). Unicode only works quoted.
const NAME = '(?:"[^"]*"|[A-Za-z0-9_.]+)';

const TYPE_ALTERNATION = REQUIREMENT_TYPES.join("|");

/** Case-insensitive lookup into an enumeration, returning its canonical spelling. */
function canonical<T extends string>(values: readonly T[], raw: string): T | undefined {
  const lower = raw.toLowerCase();
  return values.find((v) => v.toLowerCase() === lower);
}

const readName = (raw: string): string => unescapeLabel(unquote(raw));
const readValue = (raw: string): string => unescapeLabel(unquote(raw));

export function parseRequirementDiagram(code: string): ParseResult<RequirementIR> {
  const errors: ParseError[] = [];
  const lines = prepareLines(code, { drop: DROPPED, stripClassSuffix: true });

  const requirements: Requirement[] = [];
  const elements: ReqElement[] = [];
  const relations: RequirementRelation[] = [];
  const idByName = new Map<string, ReqNodeId>();
  let relSeq = 0;
  let headerSeen = false;
  let direction: RequirementIR["direction"];
  // the block currently being filled (last pushed requirement / element)
  let open: { kind: "requirement" | "element"; name: string; line: number } | null = null;

  const declare = (name: string, id: ReqNodeId, lineNo: number): boolean => {
    if (idByName.has(name)) {
      errors.push({ line: lineNo, message: `duplicate node name: ${name}` });
      return false;
    }
    idByName.set(name, id);
    return true;
  };

  for (const { text: line, line: lineNo } of lines) {
    if (!headerSeen) {
      if (line !== "requirementDiagram") {
        errors.push({ line: lineNo, message: "expected `requirementDiagram` header" });
        return { ok: false, errors };
      }
      headerSeen = true;
      continue;
    }

    if (open !== null) {
      if (line === "}") {
        open = null;
        continue;
      }
      const field = line.match(/^([A-Za-z]+)\s*:\s*(.*)$/);
      if (!field) {
        errors.push({ line: lineNo, message: `cannot parse field: ${line}` });
        continue;
      }
      const key = field[1]!.toLowerCase();
      const value = readValue(field[2]!);
      if (open.kind === "requirement") {
        const r = requirements[requirements.length - 1]!;
        if (key === "id") requirements[requirements.length - 1] = { ...r, reqId: value };
        else if (key === "text") requirements[requirements.length - 1] = { ...r, text: value };
        else if (key === "risk") {
          const risk = canonical(RISK_LEVELS, value);
          if (risk === undefined) errors.push({ line: lineNo, message: `unknown risk: ${value}` });
          else requirements[requirements.length - 1] = { ...r, risk };
        } else if (key === "verifymethod") {
          const verifyMethod = canonical(VERIFY_METHODS, value);
          if (verifyMethod === undefined) errors.push({ line: lineNo, message: `unknown verifymethod: ${value}` });
          else requirements[requirements.length - 1] = { ...r, verifyMethod };
        } else errors.push({ line: lineNo, message: `unknown requirement field: ${field[1]!}` });
      } else {
        const e = elements[elements.length - 1]!;
        if (key === "type") elements[elements.length - 1] = { ...e, type: value };
        else if (key === "docref") elements[elements.length - 1] = { ...e, docRef: value };
        else errors.push({ line: lineNo, message: `unknown element field: ${field[1]!}` });
      }
      continue;
    }

    const dir = line.match(/^direction\s+(TB|LR|BT|RL)$/);
    if (dir) {
      direction = dir[1] as NonNullable<RequirementIR["direction"]>;
      continue;
    }

    const reqDecl = line.match(new RegExp(`^(${TYPE_ALTERNATION})\\s+(${NAME})\\s*\\{$`));
    if (reqDecl) {
      const name = readName(reqDecl[2]!);
      if (declare(name, name as RequirementId, lineNo)) {
        requirements.push({ id: name as RequirementId, name, type: reqDecl[1] as RequirementType });
      }
      open = { kind: "requirement", name, line: lineNo };
      continue;
    }

    const elemDecl = line.match(new RegExp(`^element\\s+(${NAME})\\s*\\{$`));
    if (elemDecl) {
      const name = readName(elemDecl[1]!);
      if (declare(name, name as ElementId, lineNo)) elements.push({ id: name as ElementId, name });
      open = { kind: "element", name, line: lineNo };
      continue;
    }

    // `a - satisfies -> b` or the mirrored `b <- satisfies - a`
    const fwd = line.match(new RegExp(`^(${NAME})\\s*-\\s*([A-Za-z]+)\\s*->\\s*(${NAME})$`));
    const rev = fwd ? null : line.match(new RegExp(`^(${NAME})\\s*<-\\s*([A-Za-z]+)\\s*-\\s*(${NAME})$`));
    const rel = fwd ?? rev;
    if (rel) {
      const [fromRaw, toRaw] = fwd ? [rel[1]!, rel[3]!] : [rel[3]!, rel[1]!];
      const type = canonical(REQUIREMENT_RELATION_TYPES, rel[2]!);
      const from = idByName.get(readName(fromRaw));
      const to = idByName.get(readName(toRaw));
      if (type === undefined) errors.push({ line: lineNo, message: `unknown relation type: ${rel[2]!}` });
      if (from === undefined) errors.push({ line: lineNo, message: `unknown node: ${readName(fromRaw)}` });
      if (to === undefined) errors.push({ line: lineNo, message: `unknown node: ${readName(toRaw)}` });
      if (type === undefined || from === undefined || to === undefined) continue;
      relSeq += 1;
      relations.push({ id: `relation-${relSeq}` as RelationId, from, to, type: type as RequirementRelationType });
      continue;
    }

    // a bare `name:::cls` becomes a bare name once the suffix is stripped
    if (new RegExp(`^${NAME}$`).test(line) && idByName.has(readName(line))) continue;

    errors.push({ line: lineNo, message: `cannot parse: ${line}` });
  }

  if (open !== null) errors.push({ line: open.line, message: `unclosed ${open.kind} block: ${open.name}` });
  if (!headerSeen) errors.push({ line: 1, message: "empty diagram: missing header" });
  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    ir: {
      kind: "requirement",
      ...(direction !== undefined ? { direction } : {}),
      requirements,
      elements,
      relations,
    },
  };
}
