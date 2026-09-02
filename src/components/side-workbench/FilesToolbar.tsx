/** Dual-row breadcrumb — grok-app FilesWorkspace / ResourceViewer (MIT). */
import { pathCrumbs } from "../../lib/file-tab-chip-label.ts";

export function FilesToolbar({
  projectName,
  relPath,
  onPopOut,
  canPopOut,
}: {
  projectName?: string | null;
  relPath?: string | null;
  onPopOut?: () => void;
  canPopOut?: boolean;
}) {
  const crumbs = [
    ...(projectName ? [projectName] : []),
    ...pathCrumbs(relPath),
  ];
  return (
    <div className="sw-files-toolbar">
      <div className="sw-files-toolbar__crumbs" title={relPath || ""}>
        {crumbs.length === 0 ? (
          <span className="sw-files-toolbar__muted">这次生成的</span>
        ) : (
          crumbs.map((c, i) => (
            <span key={`${c}-${i}`} className="sw-files-toolbar__crumb-wrap">
              {i > 0 ? (
                <span className="sw-files-toolbar__sep" aria-hidden>
                  ›
                </span>
              ) : null}
              <span
                className={
                  "sw-files-toolbar__crumb" +
                  (i === crumbs.length - 1 ? " is-current" : "")
                }
              >
                {c}
              </span>
            </span>
          ))
        )}
      </div>
      {canPopOut && onPopOut ? (
        <button
          type="button"
          className="btn ghost btn-sm"
          onClick={onPopOut}
        >
          拖到另一块屏
        </button>
      ) : null}
    </div>
  );
}
