import { useState } from "react";
import { deleteStoredEntry, listStoredEntries, type StoredEntry } from "./persistence";

export interface FilesPanelProps {
  readonly onLoad: (entry: StoredEntry) => void;
  readonly onDeleted: (entry: StoredEntry) => void;
  readonly onClose: () => void;
}

function fmtTime(t: number | null): string {
  return t === null ? "—" : new Date(t).toLocaleString();
}

/** File-manager view over everything gMermaid keeps in localStorage. */
export function FilesPanel({ onLoad, onDeleted, onClose }: FilesPanelProps) {
  const [entries, setEntries] = useState<StoredEntry[]>(() => listStoredEntries());

  function handleDelete(entry: StoredEntry) {
    if (!confirm(`Delete "${entry.key}"?`)) return;
    deleteStoredEntry(entry.key);
    setEntries(listStoredEntries());
    onDeleted(entry);
  }

  return (
    <div className="files-overlay" onClick={onClose}>
      <div className="files-panel" onClick={(e) => e.stopPropagation()}>
        <div className="files-header">
          <h3>Browser storage</h3>
          <button onClick={onClose}>✕</button>
        </div>
        {entries.length === 0 ? (
          <div className="hint" style={{ padding: 12 }}>No stored diagrams.</div>
        ) : (
          <table className="files-table">
            <thead>
              <tr>
                <th>Key</th>
                <th>Kind</th>
                <th>Updated</th>
                <th>Chars</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.key}>
                  <td title={e.code.slice(0, 500)}>{e.key}</td>
                  <td>{e.kind}</td>
                  <td>{fmtTime(e.updatedAt)}</td>
                  <td>{e.bytes}</td>
                  <td>
                    <button disabled={e.kind === "unknown"} onClick={() => onLoad(e)}>Load</button>{" "}
                    <button className="danger" onClick={() => handleDelete(e)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="hint" style={{ padding: "8px 12px" }}>
          自動保存エントリは編集すると再作成されます。Delete 後にエディタも初期状態へ戻ります。
        </div>
      </div>
    </div>
  );
}
