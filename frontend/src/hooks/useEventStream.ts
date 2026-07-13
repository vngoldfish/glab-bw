import { useState, useEffect, useRef, useCallback } from "react";

/* ── Types ───────────────────────────────────────────────────── */

export interface ProgressEvent {
  type:
    | "task_status"
    | "task_progress"
    | "workflow_log"
    | "system_log"
    | "heartbeat"
    | "connected";
  timestamp: number;
  task_id: string;
  task_type: string;
  step: string;
  percent: number; // 0-100, -1 = indeterminate
  status: string;
  message: string;
  level: string;
  data: Record<string, unknown>;
}

export interface ActiveTask {
  task_id: string;
  task_type: string;
  step: string;
  percent: number;
  status: string;
  prompt: string;
  startedAt: number;
}

export interface LogEntry {
  id: number;
  timestamp: number;
  message: string;
  level: string;
  type: string;
  taskId: string;
}

interface UseEventStreamReturn {
  logs: LogEntry[];
  activeTasks: ActiveTask[];
  connected: boolean;
  clearLogs: () => void;
}

/* ── Constants ───────────────────────────────────────────────── */

const MAX_LOG_LINES = 200;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 16000;

let _logIdCounter = 0;

/* ── Hook ────────────────────────────────────────────────────── */

export function useEventStream(url = "/api/events/stream"): UseEventStreamReturn {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [activeTasks, setActiveTasks] = useState<ActiveTask[]>([]);
  const [connected, setConnected] = useState(false);

  const reconnectDelay = useRef(RECONNECT_BASE_MS);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const esRef = useRef<EventSource | null>(null);

  const clearLogs = useCallback(() => setLogs([]), []);

  useEffect(() => {
    let unmounted = false;

    function connect() {
      if (unmounted) return;

      const es = new EventSource(url);
      esRef.current = es;

      es.onopen = () => {
        if (unmounted) return;
        setConnected(true);
        reconnectDelay.current = RECONNECT_BASE_MS; // reset backoff
      };

      es.onmessage = (ev) => {
        if (unmounted) return;
        try {
          const event: ProgressEvent = JSON.parse(ev.data);
          handleEvent(event);
        } catch {
          // ignore malformed events
        }
      };

      es.onerror = () => {
        if (unmounted) return;
        es.close();
        esRef.current = null;
        setConnected(false);

        // Exponential backoff reconnect
        const delay = reconnectDelay.current;
        reconnectDelay.current = Math.min(delay * 2, RECONNECT_MAX_MS);
        reconnectTimer.current = setTimeout(connect, delay);
      };
    }

    function handleEvent(event: ProgressEvent) {
      switch (event.type) {
        case "task_status":
          handleTaskStatus(event);
          break;
        case "task_progress":
          handleTaskProgress(event);
          break;
        case "workflow_log":
        case "system_log":
          appendLog(event);
          break;
        case "heartbeat":
        case "connected":
          break; // no-op
      }
    }

    function handleTaskStatus(event: ProgressEvent) {
      const { task_id, task_type, status, message } = event;

      if (status === "running") {
        setActiveTasks((prev) => {
          // Don't duplicate
          if (prev.some((t) => t.task_id === task_id)) {
            return prev.map((t) =>
              t.task_id === task_id ? { ...t, status, step: message } : t
            );
          }
          return [
            ...prev,
            {
              task_id,
              task_type,
              step: message,
              percent: 0,
              status,
              prompt: message,
              startedAt: event.timestamp,
            },
          ];
        });
      } else if (status === "completed" || status === "failed") {
        // Keep briefly for UI feedback, then remove
        setActiveTasks((prev) =>
          prev.map((t) =>
            t.task_id === task_id
              ? { ...t, status, step: message, percent: status === "completed" ? 100 : t.percent }
              : t
          )
        );
        setTimeout(() => {
          setActiveTasks((prev) => prev.filter((t) => t.task_id !== task_id));
        }, 3000);
      }

      // Also log status changes
      appendLog(event);
    }

    function handleTaskProgress(event: ProgressEvent) {
      setActiveTasks((prev) =>
        prev.map((t) =>
          t.task_id === event.task_id
            ? { ...t, step: event.step, percent: event.percent }
            : t
        )
      );
    }

    function appendLog(event: ProgressEvent) {
      const entry: LogEntry = {
        id: ++_logIdCounter,
        timestamp: event.timestamp,
        message: event.message || event.step || "",
        level: event.level || "INFO",
        type: event.type,
        taskId: event.task_id || "",
      };
      if (!entry.message) return;

      setLogs((prev) => {
        const next = [...prev, entry];
        // Circular buffer: keep last MAX_LOG_LINES
        return next.length > MAX_LOG_LINES
          ? next.slice(next.length - MAX_LOG_LINES)
          : next;
      });
    }

    connect();

    return () => {
      unmounted = true;
      esRef.current?.close();
      esRef.current = null;
      clearTimeout(reconnectTimer.current);
    };
  }, [url]);

  return { logs, activeTasks, connected, clearLogs };
}
