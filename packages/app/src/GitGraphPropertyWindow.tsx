import { useEffect, useState } from "react";
import { GIT_COMMIT_TYPES, type GitCherryPickStep, type GitCommitStep, type GitCommitType, type GitMergeStep } from "@gmermaid/ir";

export interface GitBranchChoice {
  readonly id: string;
  readonly name: string;
}

export type GitGraphSelection =
  | { kind: "branch"; id: string; name: string; order: number | undefined; isMain: boolean; others: readonly GitBranchChoice[] }
  | { kind: "commit"; step: GitCommitStep; others: readonly GitBranchChoice[]; parents: readonly GitBranchChoice[] }
  | { kind: "merge"; step: GitMergeStep; others: readonly GitBranchChoice[]; parents: readonly GitBranchChoice[] }
  | { kind: "cherryPick"; step: GitCherryPickStep; sourceLabel: string; parents: readonly GitBranchChoice[] };

export interface GitGraphPropertyWindowProps {
  readonly selection: GitGraphSelection;
  readonly onRenameBranch: (name: string) => void;
  /** Empty = clear. */
  readonly onChangeOrder: (order: number | null) => void;
  /** Merge the selected branch into `into`. */
  readonly onMergeInto: (into: string) => void;
  /** `null` clears. */
  readonly onChangeName: (name: string | null) => void;
  readonly onChangeMessage: (message: string | null) => void;
  readonly onChangeTags: (tags: readonly string[]) => void;
  readonly onChangeType: (type: GitCommitType) => void;
  /** Cherry-pick the selected commit onto `onto`, optionally via `parent`. */
  readonly onCherryPick: (onto: string, parent: string | undefined) => void;
  readonly onChangeParent: (parent: string | null) => void;
  /** -1 = earlier, +1 = later. */
  readonly onMove: (delta: -1 | 1) => void;
  readonly onDelete: () => void;
  /** Why the last edit was refused, or undefined. */
  readonly rejectHint?: string | undefined;
  readonly onEditStart: () => void;
  readonly onEditEnd: () => void;
}

/** A text field that commits on blur / Enter, so a tag list can be typed
 * through states (`a,` `a, b`) that the IR itself never holds. */
function DraftField({
  label,
  value,
  onCommit,
  resetKey,
  onFocus,
  onBlur,
}: {
  label: string;
  value: string;
  onCommit: (text: string) => void;
  resetKey: string;
  onFocus: () => void;
  onBlur: () => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value, resetKey]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <label>
      {label}
      <input
        value={draft}
        onFocus={onFocus}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          commit();
          onBlur();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
      />
    </label>
  );
}

function MoveButtons({ onMove }: { onMove: (delta: -1 | 1) => void }) {
  return (
    <div className="row-buttons">
      <button onClick={() => onMove(-1)}>← Earlier</button>
      <button onClick={() => onMove(1)}>Later →</button>
    </div>
  );
}

const splitTags = (text: string): string[] =>
  text
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t !== "");

export function GitGraphPropertyWindow(props: GitGraphPropertyWindowProps) {
  const { selection, onEditStart, onEditEnd } = props;
  const [target, setTarget] = useState("");
  const [parent, setParent] = useState("");
  // the choice belongs to the selection: a stale target would merge elsewhere
  const key = selection.kind === "branch" ? selection.id : selection.step.id;
  useEffect(() => {
    setTarget("");
    setParent("");
  }, [key]);

  const others = selection.kind === "cherryPick" ? [] : selection.others;
  const chosen = others.some((o) => o.id === target) ? target : (others[0]?.id ?? "");
  const parents = selection.kind === "branch" ? [] : selection.parents;
  const chosenParent = parents.some((p) => p.id === parent) ? parent : (parents[0]?.id ?? "");

  return (
    <div className="property-window">
      {selection.kind === "branch" ? (
        <>
          <h3>Branch</h3>
          {selection.isMain ? (
            <p className="hint">`main` is mermaid&apos;s implicit first branch: it has no line of its own to edit.</p>
          ) : (
            <>
              <label>
                Branch name
                <input value={selection.name} onFocus={onEditStart} onBlur={onEditEnd} onChange={(e) => props.onRenameBranch(e.target.value)} />
              </label>
              <label>
                Lane order
                <input
                  type="number"
                  min={0}
                  placeholder="auto"
                  value={selection.order ?? ""}
                  onFocus={onEditStart}
                  onBlur={onEditEnd}
                  onChange={(e) => props.onChangeOrder(e.target.value === "" ? null : Number(e.target.value))}
                />
              </label>
              <MoveButtons onMove={props.onMove} />
            </>
          )}
          {others.length > 0 && (
            <>
              <label>
                Merge into
                <select aria-label="Merge into" value={chosen} onChange={(e) => setTarget(e.target.value)}>
                  {others.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="row-buttons">
                <button onClick={() => props.onMergeInto(chosen)}>Merge</button>
              </div>
            </>
          )}
        </>
      ) : selection.kind === "cherryPick" ? (
        <>
          <h3>Cherry-pick</h3>
          <p className="hint">Copies {selection.sourceLabel} onto this branch.</p>
          {parents.length > 0 && (
            <label>
              Parent
              <select
                aria-label="Parent"
                value={selection.step.parent ?? ""}
                onChange={(e) => props.onChangeParent(e.target.value === "" ? null : e.target.value)}
              >
                <option value="">(none)</option>
                {parents.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <DraftField
            label="Tags"
            value={selection.step.tags.join(", ")}
            resetKey={selection.step.id}
            onCommit={(t) => props.onChangeTags(splitTags(t))}
            onFocus={onEditStart}
            onBlur={onEditEnd}
          />
          <MoveButtons onMove={props.onMove} />
        </>
      ) : (
        <>
          <h3>{selection.kind === "merge" ? "Merge commit" : "Commit"}</h3>
          <label>
            Commit id
            <input
              value={selection.step.name ?? ""}
              placeholder="auto"
              onFocus={onEditStart}
              onBlur={onEditEnd}
              onChange={(e) => props.onChangeName(e.target.value === "" ? null : e.target.value)}
            />
          </label>
          {selection.kind === "commit" && (
            <label>
              Message
              <input
                value={selection.step.message ?? ""}
                onFocus={onEditStart}
                onBlur={onEditEnd}
                onChange={(e) => props.onChangeMessage(e.target.value === "" ? null : e.target.value)}
              />
            </label>
          )}
          <DraftField
            label="Tags"
            value={selection.step.tags.join(", ")}
            resetKey={selection.step.id}
            onCommit={(t) => props.onChangeTags(splitTags(t))}
            onFocus={onEditStart}
            onBlur={onEditEnd}
          />
          <label>
            Type
            <select
              aria-label="Commit type"
              value={selection.step.commitType}
              onChange={(e) => props.onChangeType(e.target.value as GitCommitType)}
            >
              {GIT_COMMIT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <MoveButtons onMove={props.onMove} />
          {selection.kind === "commit" || selection.kind === "merge" ? (
            selection.others.length > 0 && (
              <>
                <label>
                  Cherry-pick onto
                  <select aria-label="Cherry-pick onto" value={chosen} onChange={(e) => setTarget(e.target.value)}>
                    {selection.others.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </label>
                {selection.kind === "merge" && (
                  <label>
                    Via parent
                    <select aria-label="Cherry-pick parent" value={chosenParent} onChange={(e) => setParent(e.target.value)}>
                      {parents.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <div className="row-buttons">
                  <button onClick={() => props.onCherryPick(chosen, selection.kind === "merge" ? chosenParent || undefined : undefined)}>
                    Cherry-pick
                  </button>
                </div>
              </>
            )
          ) : null}
        </>
      )}
      {props.rejectHint !== undefined && <div className="hint">{props.rejectHint}</div>}
      {!(selection.kind === "branch" && selection.isMain) && (
        <button className="danger" onClick={props.onDelete}>
          Delete {selection.kind === "branch" ? "branch" : "commit"}
        </button>
      )}
    </div>
  );
}
