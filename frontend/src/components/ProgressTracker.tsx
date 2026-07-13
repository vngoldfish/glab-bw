import { useRef, useEffect, useState, useCallback, memo } from "react";
import { useEventStream, type ActiveTask, type LogEntry } from "../hooks/useEventStream";
import "./ProgressTracker.css";

/* ── Helpers ─────────────────────────────────────────────────── */

const TASK_ICONS: Record<string, string> = {
  image: "🖼️",
  video: "🎬",
  grok: "⚡",
  meta: "🌀",
  openai: "🤖",
  workflow: "🔀",
};

function formatTime(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString("vi-VN", { hour12: false });
}

function taskLabel(t: ActiveTask): string {
  const icon = TASK_ICONS[t.task_type] || "⚙️";
  const type = t.task_type.charAt(0).toUpperCase() + t.task_type.slice(1);
  return `${icon} ${type} — ${t.task_id.slice(0, 8)}`;
}

/* ── Task Item (memoized) ────────────────────────────────────── */

const TaskItem = memo(function TaskItem({ task }: { task: ActiveTask }) {
  const pct = task.percent;
  const isIndeterminate = pct < 0;
  const displayPct = isIndeterminate ? "" : `${pct}%`;

  let fillClass = "pt-progress-fill";
  if (isIndeterminate) fillClass += " indeterminate";
  if (task.status === "completed") fillClass += " completed";
  if (task.status === "failed") fillClass += " failed";

  return (
    <div className="pt-task-item">
      <div className="pt-task-header">
        <span className="pt-task-name">{taskLabel(task)}</span>
        {displayPct && <span className="pt-task-percent">{displayPct}</span>}
      </div>
      {task.step && <div className="pt-task-step">{task.step}</div>}
      <div className="pt-progress-track">
        <div
          className={fillClass}
          style={{ width: isIndeterminate ? undefined : `${Math.max(pct, 2)}%` }}
        />
      </div>
    </div>
  );
});

/* ── Log Entry (memoized) ────────────────────────────────────── */

const LogEntryRow = memo(function LogEntryRow({ entry }: { entry: LogEntry }) {
  return (
    <li className="pt-log-entry">
      <span className="pt-log-time">{formatTime(entry.timestamp)}</span>
      <span className={`pt-log-level ${entry.level}`}>{entry.level}</span>
      <span className="pt-log-msg">{entry.message}</span>
    </li>
  );
});

/* ── Main Component ──────────────────────────────────────────── */

function ProgressTracker() {
  const { logs, activeTasks, connected, clearLogs } = useEventStream();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("pt_collapsed") === "true";
    } catch {
      return false;
    }
  });

  const logListRef = useRef<HTMLUListElement>(null);
  const autoScrollRef = useRef(true);

  // Persist collapsed state
  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem("pt_collapsed", String(next)); } catch { /* */ }
      return next;
    });
  }, []);

  // Auto-scroll log list using requestAnimationFrame
  useEffect(() => {
    if (!autoScrollRef.current || collapsed) return;
    const el = logListRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [logs, collapsed]);

  // Detect manual scroll to disable auto-scroll
  const handleLogScroll = useCallback(() => {
    const el = logListRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
    autoScrollRef.current = atBottom;
  }, []);

  const runningCount = activeTasks.filter((t) => t.status === "running").length;
  const hasContent = activeTasks.length > 0 || logs.length > 0;

  return (
    <div className={`progress-tracker ${collapsed ? "collapsed" : ""}`}>
      {/* Header */}
      <div className="pt-header" onClick={toggleCollapsed}>
        <div className="pt-header-left">
          <span className="pt-header-icon">📊</span>
          <span className="pt-header-title">Live Progress</span>
          <span className={`pt-status-dot ${connected ? "connected" : ""}`} />
        </div>
        <div className="pt-header-right">
          {runningCount > 0 && (
            <span className="pt-badge">{runningCount}</span>
          )}
          <button
            className={`pt-toggle-btn ${collapsed ? "" : "expanded"}`}
            title={collapsed ? "Mở rộng" : "Thu nhỏ"}
          >
            ▼
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="pt-body">
        {/* Active Tasks */}
        {activeTasks.length > 0 && (
          <div className="pt-tasks">
            {activeTasks.map((task) => (
              <TaskItem key={task.task_id} task={task} />
            ))}
          </div>
        )}

        {/* Log Stream */}
        <div className="pt-log-header">
          <span className="pt-log-title">📋 Logs</span>
          {logs.length > 0 && (
            <button className="pt-clear-btn" onClick={clearLogs}>
              Clear
            </button>
          )}
        </div>

        {hasContent ? (
          <ul
            ref={logListRef}
            className="pt-log-list"
            onScroll={handleLogScroll}
          >
            {logs.map((entry) => (
              <LogEntryRow key={entry.id} entry={entry} />
            ))}
          </ul>
        ) : (
          <div className="pt-empty">
            <div className="pt-empty-icon">📡</div>
            {connected
              ? "Đang chờ events..."
              : "Đang kết nối tới server..."}
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(ProgressTracker);
