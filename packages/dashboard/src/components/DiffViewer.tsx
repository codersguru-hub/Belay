import { useState } from "react";
import type { StudioDiffPayload } from "@belay/contracts";

interface DiffViewerProps {
  diff: StudioDiffPayload | null;
  conflictAdvice?: string | null;
  onClose?: () => void;
}

export function DiffViewer({ diff, conflictAdvice, onClose }: DiffViewerProps) {
  const [viewMode, setViewMode] = useState<"unified" | "split">("unified");
  const [turnFilter, setTurnFilter] = useState("Last Turn");
  const [unmodifiedCollapsed, setUnmodifiedCollapsed] = useState(true);
  const [showLineNumbers, setShowLineNumbers] = useState(true);

  if (!diff) {
    return (
      <div className="diff-empty-state">
        <div className="diff-tabs-bar">
          <div className="diff-tab active">
            <span className="tab-icon">📋</span>
            <span>Diff Review</span>
          </div>
          {onClose && (
            <button type="button" className="btn-icon-subtle active right-pane-close" onClick={onClose} title="Collapse review pane" aria-label="Collapse review pane">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <line x1="15" y1="3" x2="15" y2="21"/>
              </svg>
            </button>
          )}
        </div>
        <div className="diff-empty-content">
          <div className="diff-empty-icon" aria-hidden="true">📄</div>
          <h3>No File Selected for Review</h3>
          <p>Click "Review" on any file modified by an agent to inspect the changes.</p>
        </div>
      </div>
    );
  }

  const fileName = diff.filePath.split("/").pop() || diff.filePath;

  return (
    <div className="diff-viewer-container" aria-label={`Diff view for ${diff.filePath}`}>
      {/* 1. TOP TAB BAR */}
      <div className="diff-tabs-bar">
        <div className="diff-tab active" title={diff.filePath}>
          <span className="tab-icon">📋</span>
          <span className="diff-tab-filename">{fileName}</span>
        </div>
        <div className="diff-tab-actions">
          {onClose && (
            <button type="button" className="btn-icon-subtle active" onClick={onClose} title="Collapse review pane" aria-label="Collapse review pane">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <line x1="15" y1="3" x2="15" y2="21"/>
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* 2. SUB-TOOLBAR */}
      <div className="diff-sub-toolbar">
        <div className="diff-toolbar-left">
          <select
            className="diff-turn-select"
            value={turnFilter}
            aria-label="Filter diff by turn"
            onChange={(e) => setTurnFilter(e.target.value)}
          >
            <option value="Last Turn">Last Turn</option>
            <option value="All Changes">All Changes</option>
            <option value="Uncommitted">Uncommitted</option>
          </select>
          <button type="button" className="btn-toolbar-action" title="More options">···</button>
        </div>
        <div className="diff-toolbar-right">
          <button
            type="button"
            className={`btn-toolbar-toggle ${viewMode === "unified" ? "active" : ""}`}
            title="Unified / Split View"
            onClick={() => setViewMode((m) => (m === "unified" ? "split" : "unified"))}
          >
            {viewMode === "unified" ? "Unified" : "Split"}
          </button>
          <button
            type="button"
            className={`btn-toolbar-toggle ${showLineNumbers ? "active" : ""}`}
            title="Toggle line numbers"
            onClick={() => setShowLineNumbers((v) => !v)}
          >
            #
          </button>
        </div>
      </div>

      {/* 3. ACTIVE FILE HEADER */}
      <div className="diff-file-header">
        <div className="diff-file-info">
          <span className="file-type-icon">📄</span>
          <span className="diff-file-path" title={diff.filePath}>
            {diff.filePath.split(/[\\/]/).pop()}
          </span>
          <span className="diff-full-path muted">{diff.filePath}</span>
        </div>
        <div className="diff-stats">
          <span className="diff-stat-add">+{diff.additions}</span>
          <span className="diff-stat-del">-{diff.deletions}</span>
        </div>
      </div>

      {/* 4. CONFLICT ADVISORY (if any) */}
      {conflictAdvice && (
        <div className="diff-conflict-banner">
          <span className="eyebrow amber">GEMINI CONFLICT ADVISORY</span>
          <p>{conflictAdvice}</p>
        </div>
      )}

      {/* 5. UNMODIFIED LINES ACCORDION */}
      <div
        className="diff-unmodified-banner"
        onClick={() => setUnmodifiedCollapsed((v) => !v)}
        title="Toggle diff hunks overview"
      >
        <span>
          {unmodifiedCollapsed
            ? `${diff.hunks.length} diff hunk${diff.hunks.length === 1 ? "" : "s"} · +${diff.additions} added, -${diff.deletions} deleted`
            : "▲ Hide diff summary"}
        </span>
      </div>

      {/* 6. DIFF CONTENT / HUNKS */}
      <div className="diff-hunks-scroll">
        {diff.hunks.length === 0 ? (
          <div className="diff-no-hunks">File modified without unified hunks.</div>
        ) : (
          diff.hunks.map((hunk, hunkIdx) => {
            const lines = hunk.content.split("\n");
            let oldLineNum = hunk.oldStart;
            let newLineNum = hunk.newStart;

            return (
              <div key={hunkIdx} className="diff-hunk-block">
                <div className="diff-hunk-header">
                  @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
                </div>
                <table className="diff-table">
                  <tbody>
                    {lines.map((line, lineIdx) => {
                      if (!line && lineIdx === lines.length - 1) return null;

                      let rowType = "context";
                      let oldDisplay = "";
                      let newDisplay = "";

                      if (line.startsWith("+")) {
                        rowType = "addition";
                        newDisplay = String(newLineNum++);
                      } else if (line.startsWith("-")) {
                        rowType = "deletion";
                        oldDisplay = String(oldLineNum++);
                      } else if (line.startsWith("@@")) {
                        return null; // Skip header line inside table
                      } else {
                        oldDisplay = String(oldLineNum++);
                        newDisplay = String(newLineNum++);
                      }

                      return (
                        <tr key={lineIdx} className={`diff-row diff-${rowType}`}>
                          {showLineNumbers && (
                            <>
                              <td className="diff-line-num diff-old-num">{oldDisplay}</td>
                              <td className="diff-line-num diff-new-num">{newDisplay}</td>
                            </>
                          )}
                          <td className="diff-line-marker">
                            {rowType === "addition" ? "+" : rowType === "deletion" ? "-" : " "}
                          </td>
                          <td className="diff-line-content">
                            <pre>{line.slice(1) || " "}</pre>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
