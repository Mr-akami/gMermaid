import { useEffect, useMemo, useState } from "react";
import {
  applyClassAction,
  emptyClassDiagram,
  formatAttribute,
  formatMethod,
  newId,
  CLASS_NAME_RE,
  type ClassIR,
  type ClassId,
  type ClassMember,
  type ClassMethod,
} from "@gmermaid/ir";
import { layoutClassDiagram } from "@gmermaid/layout";
import { classToMermaid } from "@gmermaid/mermaid-codegen";
import { parseClassDiagram, parseMemberLine } from "@gmermaid/mermaid-parser";
import { ClassView, type Viewport } from "@gmermaid/renderer";
import { measurer } from "./measurer";
import { formatParseErrors, loadInitial, openMmd, saveMmd, useAutosave } from "./persistence";
import { CodePane } from "./CodePane";
import { ErrorBoundary } from "./ErrorBoundary";
import { ClassPropertyWindow, type ClassSelection } from "./ClassPropertyWindow";
import { useDiagramHistory } from "./useDiagramHistory";
import type { EditorRuntimeProps } from "./editorRuntime";

function initialIR(): ClassIR {
  let ir = emptyClassDiagram();
  const a = newId("class");
  const b = newId("class");
  ir = applyClassAction(ir, {
    type: "addClass",
    node: {
      id: a,
      name: "Animal",
      attributes: [{ name: "name", type: "String", visibility: "protected" }],
      methods: [{ name: "speak", params: "", type: "String", visibility: "public" }],
    },
  });
  ir = applyClassAction(ir, { type: "addClass", node: { id: b, name: "Dog", attributes: [], methods: [] } });
  ir = applyClassAction(ir, {
    type: "addRelation",
    relation: { id: newId("relation"), from: b, to: a, type: "inheritance" },
  });
  return ir;
}

// ViewState: transient UI state, never part of the IR (ADR 0001).
interface ViewState {
  readonly selectedId?: string;
  readonly relateFrom?: ClassId;
}

/** One member per line; returns undefined (with message) on the first bad line. */
function parseMembers(text: string): { attributes: ClassMember[]; methods: ClassMethod[] } | string {
  const attributes: ClassMember[] = [];
  const methods: ClassMethod[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === "") continue;
    const m = parseMemberLine(line);
    if (!m) return `line ${i + 1}: cannot parse \`${line}\``;
    if (m.attribute) attributes.push(m.attribute);
    if (m.method) methods.push(m.method);
  }
  return { attributes, methods };
}

const STORAGE_KEY = "gmermaid:doc:class";

export interface EditorProps extends EditorRuntimeProps {
  readonly loadRequest?: { readonly seq: number; readonly code: string | null } | undefined;
}

export function ClassEditor({ loadRequest, initialCode, mode = "standalone", onCodeChange, onValidityChange }: EditorProps) {
  // recoveredText: stored data that stopped parsing, poured into the code
  // pane as a broken draft for manual repair (S1-3)
  const [initial] = useState(() => {
    if (initialCode === undefined) return loadInitial(STORAGE_KEY, parseClassDiagram, initialIR);
    const parsed = parseClassDiagram(initialCode);
    return parsed.ok ? { ir: parsed.ir } : { ir: initialIR(), recoveredText: initialCode };
  });
  const h = useDiagramHistory(() => initial.ir, applyClassAction);
  const [view, setView] = useState<ViewState>({});
  // pan/zoom is ViewState (ADR 0001), held apart from the selection
  const [viewport, setViewport] = useState<Viewport | undefined>(undefined);
  // drag-to-connect rubber band: view-transient (ADR 0001)
  const [connectLine, setConnectLine] = useState<{ x1: number; y1: number; x2: number; y2: number } | undefined>(undefined);
  // member text drafts are view-transient; the IR only sees parsed members.
  // base* records which canonical text the draft branched from: if the IR
  // moves underneath (code pane edit), a stale draft self-invalidates
  // instead of overwriting the newer members (same rule as CodePane).
  const [memberDraft, setMemberDraft] = useState<{
    id: ClassId;
    attrs: string;
    methods: string;
    baseAttrs: string;
    baseMethods: string;
  } | null>(null);
  const ir = h.ir;

  const layout = useMemo(() => layoutClassDiagram(ir, measurer), [ir]);
  const code = useMemo(() => classToMermaid(ir), [ir]);
  // autosave pauses while the code pane shows a broken/stale draft, so a
  // recovered draft is never clobbered by the sample it fell back to
  const [codeValid, setCodeValid] = useState(initial.recoveredText === undefined);
  useAutosave(STORAGE_KEY, code, mode === "standalone" && codeValid);
  useEffect(() => onCodeChange?.(code), [code, onCodeChange]);

  useEffect(() => {
    if (!loadRequest) return;
    setMemberDraft(null);
    if (loadRequest.code === null) {
      h.pushIR(initialIR());
    } else {
      const result = parseClassDiagram(loadRequest.code);
      if (result.ok) h.pushIR(result.ir);
      else alert(`Cannot load stored diagram:\n${formatParseErrors(result.errors)}`);
    }
    setView({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadRequest?.seq]);

  async function openFile() {
    const text = await openMmd();
    if (text === null) return;
    const result = parseClassDiagram(text);
    if (result.ok) {
      setMemberDraft(null);
      h.pushIR(result.ir);
      setView({});
    } else {
      alert(`Cannot open file:\n${result.errors.map((e) => `line ${e.line}: ${e.message}`).join("\n")}`);
    }
  }

  const selectedClass = ir.classes.find((c) => c.id === view.selectedId);
  const selectedRelation = ir.relations.find((r) => r.id === view.selectedId);
  const selection: ClassSelection | undefined = selectedClass
    ? { kind: "class", node: selectedClass }
    : selectedRelation
      ? { kind: "relation", relation: selectedRelation }
      : undefined;

  const canonicalAttrs = selectedClass?.attributes.map(formatAttribute).join("\n") ?? "";
  const canonicalMethods = selectedClass?.methods.map(formatMethod).join("\n") ?? "";
  const draftFor =
    selectedClass &&
    memberDraft?.id === selectedClass.id &&
    memberDraft.baseAttrs === canonicalAttrs &&
    memberDraft.baseMethods === canonicalMethods
      ? memberDraft
      : null;
  const attributesText = draftFor?.attrs ?? canonicalAttrs;
  const methodsText = draftFor?.methods ?? canonicalMethods;
  const membersError = useMemo(() => {
    if (!draftFor) return undefined;
    const a = parseMembers(draftFor.attrs);
    if (typeof a === "string") return `attributes: ${a}`;
    const m = parseMembers(draftFor.methods);
    if (typeof m === "string") return `methods: ${m}`;
    return undefined;
  }, [draftFor]);
  useEffect(() => onValidityChange?.(codeValid && membersError === undefined), [codeValid, membersError, onValidityChange]);

  function handleMembersChange(id: ClassId, attrs: string, methods: string) {
    const a = parseMembers(attrs);
    const m = parseMembers(methods);
    if (typeof a === "string" || typeof m === "string") {
      // keep the draft (pinned to the current canonical), show the error
      setMemberDraft({ id, attrs, methods, baseAttrs: canonicalAttrs, baseMethods: canonicalMethods });
      return;
    }
    // lines are routed by their PARSED shape, whichever pane they were typed in
    const attributes = [...a.attributes, ...m.attributes];
    const allMethods = [...a.methods, ...m.methods];
    h.dispatch({ type: "setMembers", id, attributes, methods: allMethods }, `class:${id}:members`);
    // re-pin the draft to the canonical of what we just committed, so it
    // survives the IR update without being reformatted under the cursor
    setMemberDraft({
      id,
      attrs,
      methods,
      baseAttrs: attributes.map(formatAttribute).join("\n"),
      baseMethods: allMethods.map(formatMethod).join("\n"),
    });
  }

  function addClass() {
    const id = newId("class");
    let n = 1;
    while (ir.classes.some((c) => c.name === `NewClass${n}`)) n += 1;
    h.dispatch({ type: "addClass", node: { id, name: `NewClass${n}`, attributes: [], methods: [] } });
    setView({ selectedId: id });
  }

  function handleConnectDrag(fromId: string, x: number, y: number) {
    const from = layout.classes.find((c) => c.id === fromId);
    if (from) setConnectLine({ x1: from.rect.x + from.rect.w / 2, y1: from.rect.y + from.rect.h / 2, x2: x, y2: y });
  }

  function handleConnectDrop(fromId: string, x: number, y: number) {
    setConnectLine(undefined);
    const from = ir.classes.find((c) => c.id === fromId);
    // dropping on the source class itself creates a self-relation
    const target = layout.classes.find(
      (c) => x >= c.rect.x && x <= c.rect.x + c.rect.w && y >= c.rect.y && y <= c.rect.y + c.rect.h,
    );
    if (!from || !target) return;
    const relId = newId("relation");
    h.dispatch({ type: "addRelation", relation: { id: relId, from: from.id, to: target.id, type: "association" } });
    setView({ selectedId: relId });
  }

  function handleElementClick(id: string) {
    const target = ir.classes.find((c) => c.id === id);
    if (view.relateFrom !== undefined && target) {
      h.dispatch({
        type: "addRelation",
        relation: { id: newId("relation"), from: view.relateFrom, to: target.id, type: "association" },
      });
    }
    if (view.selectedId !== id) setMemberDraft(null);
    setView({ selectedId: id });
  }

  return (
    <>
      <div className="toolbar">
        {mode === "standalone" && <button onClick={openFile}>Open…</button>}
        {mode === "standalone" && <button onClick={() => saveMmd(code, "class.mmd")}>Save…</button>}
        <button onClick={addClass}>+ Class</button>
        <button
          disabled={selectedClass === undefined}
          onClick={() => selectedClass && setView({ ...view, relateFrom: selectedClass.id })}
        >
          → Relation from selected
        </button>
        <button onClick={h.undo} disabled={!h.canUndo}>Undo</button>
        <button onClick={h.redo} disabled={!h.canRedo}>Redo</button>
        <select
          value={ir.direction ?? "TB"}
          onChange={(e) => h.dispatch({ type: "setDirection", direction: e.target.value as NonNullable<ClassIR["direction"]> })}
        >
          <option value="TB">Top→Bottom</option>
          <option value="LR">Left→Right</option>
          <option value="BT">Bottom→Top</option>
          <option value="RL">Right→Left</option>
        </select>
        {view.relateFrom !== undefined && <span className="hint">click a target class…</span>}
      </div>
      <div className="canvas">
        <ErrorBoundary>
          <ClassView
            layout={layout}
            viewState={{ selectedId: view.selectedId }}
            viewport={viewport}
            onViewportChange={setViewport}
            onElementClick={handleElementClick}
            onBackgroundClick={() => {
              setMemberDraft(null);
              setView({});
            }}
            onConnectDrag={handleConnectDrag}
            onConnectDrop={handleConnectDrop}
            connectLine={connectLine}
            onGestureCancel={() => setConnectLine(undefined)}
          />
        </ErrorBoundary>
        {selection && (
          <ClassPropertyWindow
            selection={selection}
            attributesText={attributesText}
            methodsText={methodsText}
            membersError={membersError}
            onChangeName={(name) => {
              if (!selectedClass) return;
              if (CLASS_NAME_RE.test(name)) h.dispatch({ type: "renameClass", id: selectedClass.id, name }, `class:${selectedClass.id}:name`);
            }}
            onChangeStereotype={(stereotype) =>
              selectedClass && h.dispatch({ type: "setStereotype", id: selectedClass.id, stereotype }, `class:${selectedClass.id}:st`)
            }
            onChangeAttributesText={(text) => selectedClass && handleMembersChange(selectedClass.id, text, methodsText)}
            onChangeMethodsText={(text) => selectedClass && handleMembersChange(selectedClass.id, attributesText, text)}
            onChangeRelationType={(relationType) =>
              selectedRelation && h.dispatch({ type: "updateRelation", id: selectedRelation.id, relationType })
            }
            onChangeRelationLabel={(label) =>
              selectedRelation && h.dispatch({ type: "updateRelation", id: selectedRelation.id, label }, `rel:${selectedRelation.id}:label`)
            }
            onChangeFromCardinality={(fromCardinality) =>
              selectedRelation && h.dispatch({ type: "updateRelation", id: selectedRelation.id, fromCardinality }, `rel:${selectedRelation.id}:fc`)
            }
            onChangeToCardinality={(toCardinality) =>
              selectedRelation && h.dispatch({ type: "updateRelation", id: selectedRelation.id, toCardinality }, `rel:${selectedRelation.id}:tc`)
            }
            onDelete={() => {
              if (selectedClass) h.dispatch({ type: "removeClass", id: selectedClass.id });
              if (selectedRelation) h.dispatch({ type: "removeRelation", id: selectedRelation.id });
              setMemberDraft(null);
              setView({});
            }}
            onEditStart={() => {}}
            onEditEnd={() => {
              h.endEdit();
              if (membersError === undefined) setMemberDraft(null);
            }}
          />
        )}
      </div>
      <CodePane
        code={code}
        parse={parseClassDiagram}
        onCommit={(next) => {
          setMemberDraft(null);
          h.pushIR(next, "code-pane");
        }}
        onEditStart={() => {}}
        onEditEnd={h.endEdit}
        initialDraft={mode === "standalone" ? initial.recoveredText : undefined}
        onValidityChange={setCodeValid}
      />
    </>
  );
}
