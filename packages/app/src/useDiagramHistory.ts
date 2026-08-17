import { useRef, useState } from "react";
import { coalesce, commit, initHistory, redo, undo, type History } from "@gmermaid/ir";

// Keyed transaction: consecutive updates with the SAME key coalesce into
// one undo step (one focus session of one field, one drag). Any keyless
// action, or a different key, always commits its own step.
export interface DiagramHistory<T, A> {
  readonly ir: T;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  dispatch(action: A, txnKey?: string): void;
  pushIR(next: T, txnKey?: string): void;
  undo(): void;
  redo(): void;
  endEdit(): void;
}

export function useDiagramHistory<T, A>(
  makeInitial: () => T,
  apply: (ir: T, action: A) => T,
): DiagramHistory<T, A> {
  const [history, setHistory] = useState<History<T>>(() => initHistory(makeInitial()));
  const txn = useRef<{ key: string | null; committed: boolean }>({ key: null, committed: false });

  function record(h: History<T>, next: T, txnKey: string | undefined): History<T> {
    if (txnKey !== undefined && txn.current.key === txnKey && txn.current.committed) {
      return coalesce(h, next);
    }
    const committed = commit(h, next);
    txn.current =
      txnKey !== undefined && committed !== h
        ? { key: txnKey, committed: true }
        : { key: null, committed: false };
    return committed;
  }

  const endEdit = () => {
    txn.current = { key: null, committed: false };
  };

  return {
    ir: history.present,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    dispatch: (action, txnKey) => setHistory((h) => record(h, apply(h.present, action), txnKey)),
    pushIR: (next, txnKey) => setHistory((h) => record(h, next, txnKey)),
    undo: () => {
      endEdit();
      setHistory(undo);
    },
    redo: () => {
      endEdit();
      setHistory(redo);
    },
    endEdit,
  };
}
