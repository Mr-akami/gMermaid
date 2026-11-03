import { useEffect, useMemo, useState } from "react";
import {
  GIT_DIRECTIONS,
  GIT_MAIN_BRANCH,
  GIT_MAIN_NAME,
  applyGitGraphAction,
  emptyGitGraph,
  gitLabel,
  isGitCommitLike,
  newId,
  resolveGitGraph,
  tryGitGraphAction,
  type GitBranchId,
  type GitBranchStep,
  type GitCommitId,
  type GitCommitLikeStep,
  type GitGraphAction,
  type GitGraphIR,
} from "@gmermaid/ir";
import { layoutGitGraph } from "@gmermaid/layout";
import { gitGraphToMermaid } from "@gmermaid/mermaid-codegen";
import { parseGitGraph } from "@gmermaid/mermaid-parser";
import { GitGraphView } from "@gmermaid/renderer";
import { measurer } from "./measurer";
import { loadInitial, openMmd, saveMmd, useAutosave, useLoadWarnings } from "./persistence";
import { CodePane } from "./CodePane";
import { ErrorBoundary } from "./ErrorBoundary";
import { GitGraphPropertyWindow, type GitBranchChoice, type GitGraphSelection } from "./GitGraphPropertyWindow";
import { SelectionOverlay } from "./SelectionUI";
import { DeleteButton, DirectionSelect, EditorToolbar } from "./EditorToolbar";
import { useDiagramHistory } from "./useDiagramHistory";
import { useEditorShell } from "./useEditorShell";
import { withSelected } from "./viewSelection";
import type { EditorRuntimeProps } from "./editorRuntime";

function initialIR(): GitGraphIR {
  const sample = `gitGraph
  commit id: "init"
  commit id: "base" tag: "v0.1"
  branch develop
  commit id: "wip"
  commit id: "tests"
  checkout main
  merge develop id: "release" tag: "v1.0"
  commit
`;
  const parsed = parseGitGraph(sample);
  return parsed.ok ? parsed.ir : emptyGitGraph();
}

// ViewState: transient UI state, never part of the IR (ADR 0001).
interface ViewState {
  readonly selectedId?: string;
}

/** `Stem1`, `Stem2`, … skipping names already in use. */
function uniqueName(taken: readonly string[], stem: string): string {
  let n = 1;
  while (taken.includes(`${stem}${n}`)) n += 1;
  return `${stem}${n}`;
}

const STORAGE_KEY = "gmermaid:doc:gitGraph";

export interface EditorProps extends EditorRuntimeProps {
  readonly loadRequest?: { readonly seq: number; readonly code: string | null } | undefined;
}

export function GitGraphEditor({ loadRequest, initialCode, mode = "standalone", onCodeChange, onValidityChange }: EditorProps) {
  // recoveredText: stored data that stopped parsing, poured into the code
  // pane as a broken draft for manual repair (S1-3)
  const [initial] = useState(() => {
    if (initialCode === undefined) return loadInitial(STORAGE_KEY, parseGitGraph, initialIR);
    const parsed = parseGitGraph(initialCode);
    return parsed.ok ? { ir: parsed.ir, warnings: parsed.warnings } : { ir: initialIR(), recoveredText: initialCode, warnings: [] };
  });
  const load = useLoadWarnings(initial.warnings);
  const h = useDiagramHistory(() => initial.ir, applyGitGraphAction);
  const [view, setView] = useState<ViewState>({});
  // reducer rejections must be visible, not silent no-ops (L2)
  const [rejectHint, setRejectHint] = useState<string | undefined>(undefined);
  const ir = h.ir;

  const layout = useMemo(() => layoutGitGraph(ir, measurer), [ir]);
  const code = useMemo(() => gitGraphToMermaid(ir), [ir]);
  const run = useMemo(() => resolveGitGraph(ir), [ir]);
  // autosave pauses while the code pane shows a broken/stale draft, so a
  // recovered draft is never clobbered by the sample it fell back to
  const [codeValid, setCodeValid] = useState(initial.recoveredText === undefined);
  useAutosave(STORAGE_KEY, code, mode === "standalone" && codeValid);
  // autosave follows OUR parser alone; mermaid's verdict only gates submit
  const [mermaidValid, setMermaidValid] = useState(true);
  useEffect(() => onCodeChange?.(code), [code, onCodeChange]);
  useEffect(() => onValidityChange?.(codeValid && mermaidValid), [codeValid, mermaidValid, onValidityChange]);

  useEffect(() => {
    if (!loadRequest) return;
    // a REPLACED diagram is framed afresh; an edit never moves the camera
    shell.fitOnNextLayout();
    if (loadRequest.code === null) {
      h.pushIR(initialIR());
    } else {
      const loaded = load.accept(parseGitGraph(loadRequest.code), "Cannot load stored diagram");
      if (loaded !== undefined) h.pushIR(loaded);
    }
    setView({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadRequest?.seq]);

  async function openFile() {
    const text = await openMmd();
    if (text === null) return;
    const opened = load.accept(parseGitGraph(text), "Cannot open file");
    if (opened === undefined) return;
    shell.fitOnNextLayout();
    h.pushIR(opened);
    setView({});
  }

  // ---- what is selected
  const branchSteps = ir.steps.filter((s): s is GitBranchStep => s.type === "branch");
  const selectedBranchStep = branchSteps.find((s) => s.id === view.selectedId);
  const selectedMain = view.selectedId === GIT_MAIN_BRANCH;
  const selectedCommit: GitCommitLikeStep | undefined = ir.steps.find((s): s is GitCommitLikeStep => isGitCommitLike(s) && s.id === view.selectedId);

  const branches: GitBranchChoice[] = [{ id: GIT_MAIN_BRANCH, name: GIT_MAIN_NAME }, ...branchSteps.map((s) => ({ id: s.id, name: s.name }))];
  const labelOf = (id: GitCommitId): string => {
    const found = run.ok ? run.commits.find((c) => c.step.id === id) : undefined;
    return found ? (gitLabel(found.step) ?? `#${found.seq + 1}`) : id;
  };
  /** Parents a cherry-pick may name: only commits with an id mermaid can spell. */
  const parentChoices = (id: GitCommitId): GitBranchChoice[] => {
    const found = run.ok ? run.commits.find((c) => c.step.id === id) : undefined;
    if (!found) return [];
    return found.parents
      .filter((p) => run.ok && run.commits.find((c) => c.step.id === p)?.step.type !== "cherryPick")
      .map((p) => ({ id: p, name: labelOf(p as GitCommitId) }));
  };

  /** Where "+ Branch" and "+ Commit" act: the selected branch, the branch
   * of the selected commit, else the branch the last step ran on. */
  const targetBranch: GitBranchId =
    selectedBranchStep?.id ??
    (selectedMain ? GIT_MAIN_BRANCH : undefined) ??
    selectedCommit?.branch ??
    (() => {
      const last = ir.steps[ir.steps.length - 1];
      return last === undefined ? GIT_MAIN_BRANCH : last.type === "branch" ? last.id : last.branch;
    })();

  /** Every edit goes through the simulator first: a refusal is shown, not
   * swallowed. */
  function attempt(action: GitGraphAction, txn?: string): boolean {
    const r = tryGitGraphAction(ir, action);
    if (!r.ok) {
      setRejectHint(r.reason);
      return false;
    }
    setRejectHint(undefined);
    h.dispatch(action, txn);
    return true;
  }

  function addBranch() {
    const id = newId("gitBranch");
    const name = uniqueName(branchSteps.map((s) => s.name), "branch");
    if (attempt({ type: "addStep", step: { type: "branch", id, name, from: targetBranch } })) setView({ selectedId: id });
  }

  function addCommit() {
    const id = newId("gitCommit");
    if (attempt({ type: "addStep", step: { type: "commit", id, branch: targetBranch, tags: [], commitType: "NORMAL" } })) {
      setView({ selectedId: id });
    }
  }

  function mergeInto(from: string, into: string) {
    const id = newId("gitCommit");
    if (
      attempt({
        type: "addStep",
        step: { type: "merge", id, branch: into as GitBranchId, from: from as GitBranchId, tags: [], commitType: "NORMAL" },
      })
    ) {
      setView({ selectedId: id });
    }
  }

  function cherryPick(source: GitCommitId, onto: string, parent: string | undefined) {
    const id = newId("gitCommit");
    if (
      attempt({
        type: "addStep",
        step: {
          type: "cherryPick",
          id,
          branch: onto as GitBranchId,
          source,
          ...(parent !== undefined ? { parent: parent as GitCommitId } : {}),
          tags: [],
        },
      })
    ) {
      setView({ selectedId: id });
    }
  }

  /** A whole selection leaves as ONE undo step (shared txn key). What cannot
   * go (the implicit `main`) is skipped; a refusal is reported. */
  function deleteSelected(ids: readonly string[]) {
    const removable = ids.filter((id) => ir.steps.some((s) => s.id === id));
    if (removable.length === 0) return;
    const txn = `delete:${removable.join(",")}`;
    let reason: string | undefined;
    let cur = ir;
    for (const id of removable) {
      const action: GitGraphAction = { type: "removeStep", id };
      const r = tryGitGraphAction(cur, action);
      if (!r.ok) {
        reason ??= r.reason;
        continue;
      }
      cur = r.ir;
      h.dispatch(action, txn);
    }
    setRejectHint(reason === undefined ? undefined : `cannot delete: ${reason}`);
    setView({});
  }

  function moveSelected(delta: -1 | 1) {
    const id = selectedBranchStep?.id ?? selectedCommit?.id;
    if (id !== undefined) attempt({ type: "moveStep", id, delta });
  }

  const selection: GitGraphSelection | undefined = (() => {
    if (selectedMain) {
      return { kind: "branch", id: GIT_MAIN_BRANCH, name: GIT_MAIN_NAME, order: undefined, isMain: true, others: branches.filter((b) => b.id !== GIT_MAIN_BRANCH) };
    }
    if (selectedBranchStep) {
      return {
        kind: "branch",
        id: selectedBranchStep.id,
        name: selectedBranchStep.name,
        order: selectedBranchStep.order,
        isMain: false,
        others: branches.filter((b) => b.id !== selectedBranchStep.id),
      };
    }
    if (!selectedCommit) return undefined;
    const others = branches.filter((b) => b.id !== selectedCommit.branch);
    const parents = parentChoices(selectedCommit.id);
    if (selectedCommit.type === "commit") return { kind: "commit", step: selectedCommit, others, parents };
    if (selectedCommit.type === "merge") return { kind: "merge", step: selectedCommit, others, parents };
    return { kind: "cherryPick", step: selectedCommit, sourceLabel: labelOf(selectedCommit.source), parents: parentChoices(selectedCommit.source) };
  })();

  const shell = useEditorShell({
    ir,
    layout,
    selectedId: view.selectedId,
    select: (id) => setView((v) => withSelected(v, id)),
    onDelete: deleteSelected,
    onPaste: (next) => h.pushIR(next),
    notify: setRejectHint,
    // "move" on a git graph is a step's place in time: the property window's
    // own ← →
    ...(selectedBranchStep !== undefined || selectedCommit !== undefined
      ? {
          moveItems: [
            { label: "← 前へ移動", run: () => moveSelected(-1) },
            { label: "→ 後ろへ移動", run: () => moveSelected(1) },
          ],
        }
      : {}),
    onEscape: () => {
      setRejectHint(undefined);
      setView({});
    },
    onUndo: h.undo,
    onRedo: h.redo,
  });

  const selectedStepId = selectedBranchStep?.id ?? selectedCommit?.id;

  return (
    <>
      <EditorToolbar
        shell={shell}
        history={h}
        file={mode === "standalone" ? { open: openFile, save: () => saveMmd(code, "gitgraph.mmd") } : undefined}
        tools={
          <>
            <button className="btn" onClick={addBranch}>+ Branch</button>
            <button className="btn" onClick={addCommit}>+ Commit</button>
          </>
        }
        settings={<DirectionSelect value={ir.direction} options={GIT_DIRECTIONS} onChange={(direction) => attempt({ type: "setDirection", direction })} />}
        selectionActions={<DeleteButton onClick={() => deleteSelected(shell.selection.ids)} />}
        notice={rejectHint}
      />
      <div className="canvas" ref={shell.canvasRef}>
        <ErrorBoundary>
          <GitGraphView
            layout={layout}
            viewState={{ selectedId: view.selectedId, selectedIds: shell.selection.ids }}
            select={shell.gestures}
            viewport={shell.viewport}
            onViewportChange={shell.setViewport}
            onElementClick={(id, additive) => {
              if (shell.selection.click(id, additive)) return;
              setRejectHint(undefined);
              setView({ selectedId: id });
            }}
            onBackgroundClick={() => setView({})}
          />
        </ErrorBoundary>
        <SelectionOverlay shell={shell} />
        {shell.selection.count <= 1 && selection && (
          <GitGraphPropertyWindow
            selection={selection}
            onRenameBranch={(name) =>
              selectedBranchStep && attempt({ type: "updateBranch", id: selectedBranchStep.id, name }, `branch:${selectedBranchStep.id}:name`)
            }
            onChangeOrder={(order) =>
              selectedBranchStep && attempt({ type: "updateBranch", id: selectedBranchStep.id, order }, `branch:${selectedBranchStep.id}:order`)
            }
            onMergeInto={(into) => {
              const from = selectedBranchStep?.id ?? (selectedMain ? GIT_MAIN_BRANCH : undefined);
              if (from !== undefined) mergeInto(from, into);
            }}
            onChangeName={(name) => selectedCommit && attempt({ type: "updateCommit", id: selectedCommit.id, patch: { name } }, `commit:${selectedCommit.id}:name`)}
            onChangeMessage={(message) =>
              selectedCommit && attempt({ type: "updateCommit", id: selectedCommit.id, patch: { message } }, `commit:${selectedCommit.id}:message`)
            }
            onChangeTags={(tags) => selectedCommit && attempt({ type: "updateCommit", id: selectedCommit.id, patch: { tags } })}
            onChangeType={(commitType) => selectedCommit && attempt({ type: "updateCommit", id: selectedCommit.id, patch: { commitType } })}
            onCherryPick={(onto, parent) => selectedCommit && cherryPick(selectedCommit.id, onto, parent)}
            onChangeParent={(parent) =>
              selectedCommit?.type === "cherryPick" &&
              attempt({ type: "updateCommit", id: selectedCommit.id, patch: { parent: parent === null ? null : (parent as GitCommitId) } })
            }
            onMove={moveSelected}
            onDelete={() => selectedStepId !== undefined && deleteSelected([selectedStepId])}
            onEditStart={() => {}}
            onEditEnd={h.endEdit}
          />
        )}
      </div>
      <CodePane
        code={code}
        parse={parseGitGraph}
        onCommit={(next) => h.pushIR(next, "code-pane")}
        onEditStart={() => {}}
        onEditEnd={h.endEdit}
        initialDraft={mode === "standalone" ? initial.recoveredText : undefined}
        loadWarnings={load.warnings}
        onValidityChange={setCodeValid}
        onMermaidValidityChange={setMermaidValid}
      />
    </>
  );
}
