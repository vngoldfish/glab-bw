import { useState, useEffect, useCallback } from "react";

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
  data?: Record<string, any>;
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

/* ── Singleton EventStream State ──────────────────────────────── */

interface SSEManager {
  es: EventSource | null;
  connected: boolean;
  listeners: Set<(ev: ProgressEvent) => void>;
  connListeners: Set<(c: boolean) => void>;
  reconnectDelay: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  cleanupTimer: ReturnType<typeof setTimeout> | null;
}

const manager: SSEManager = {
  es: null,
  connected: false,
  listeners: new Set(),
  connListeners: new Set(),
  reconnectDelay: RECONNECT_BASE_MS,
  reconnectTimer: null,
  cleanupTimer: null,
};

function connectGlobal(url: string) {
  if (manager.es) return;

  const es = new EventSource(url);
  manager.es = es;

  es.onopen = () => {
    manager.connected = true;
    manager.reconnectDelay = RECONNECT_BASE_MS;
    manager.connListeners.forEach((lis) => lis(true));
  };

  es.onmessage = (ev) => {
    try {
      const event: ProgressEvent = JSON.parse(ev.data);
      manager.listeners.forEach((lis) => lis(event));
    } catch {
      // ignore malformed
    }
  };

  es.onerror = () => {
    es.close();
    manager.es = null;
    manager.connected = false;
    manager.connListeners.forEach((lis) => lis(false));

    // Exponential backoff reconnect
    const delay = manager.reconnectDelay;
    manager.reconnectDelay = Math.min(delay * 2, RECONNECT_MAX_MS);
    if (manager.reconnectTimer) clearTimeout(manager.reconnectTimer);
    manager.reconnectTimer = setTimeout(() => {
      // Re-verify we still have listeners before reconnecting
      if (manager.listeners.size > 0) {
        connectGlobal(url);
      }
    }, delay);
  };
}

function disconnectGlobal() {
  if (manager.reconnectTimer) clearTimeout(manager.reconnectTimer);
  manager.reconnectTimer = null;
  if (manager.es) {
    manager.es.close();
    manager.es = null;
  }
  manager.connected = false;
  manager.connListeners.forEach((lis) => lis(false));
}

/* ── Hook ────────────────────────────────────────────────────── */

export function useEventStream(url = "/api/events/stream"): UseEventStreamReturn {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [activeTasks, setActiveTasks] = useState<ActiveTask[]>([]);
  const [connected, setConnected] = useState(manager.connected);

  const clearLogs = useCallback(() => setLogs([]), []);

  useEffect(() => {
    // 1. Listen for connection status changes
    const onConnChange = (c: boolean) => setConnected(c);
    manager.connListeners.add(onConnChange);
    setConnected(manager.connected);

    // Cancel cleanup if we mount again
    if (manager.cleanupTimer) {
      clearTimeout(manager.cleanupTimer);
      manager.cleanupTimer = null;
    }

    // 2. Connect if not connected
    connectGlobal(url);

    // 3. Listen for events
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
      }
    }

    function handleTaskStatus(event: ProgressEvent) {
      const { task_id, task_type, status, message } = event;

      if (status === "running") {
        setActiveTasks((prev) => {
          // Don't duplicate
          if (prev.some((t) => t.task_id === task_id)) {
            return prev.map((t) =>
              t.task_id === task_id ? { ...t, status, step: message, data: event.data || t.data } : t
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
              data: event.data,
            },
          ];
        });
      } else if (status === "completed" || status === "failed") {
        // Keep briefly for UI feedback, then remove
        setActiveTasks((prev) =>
          prev.map((t) =>
            t.task_id === task_id
              ? { ...t, status, step: message, percent: status === "completed" ? 100 : t.percent, data: event.data || t.data }
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
            ? { ...t, step: event.step, percent: event.percent, data: event.data || t.data }
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

    manager.listeners.add(handleEvent);

    return () => {
      manager.listeners.delete(handleEvent);
      manager.connListeners.delete(onConnChange);

      // If no listeners left, close connection after a 10s delay (debounce tab switching / redirects)
      if (manager.listeners.size === 0) {
        if (manager.cleanupTimer) clearTimeout(manager.cleanupTimer);
        manager.cleanupTimer = setTimeout(() => {
          if (manager.listeners.size === 0) {
            disconnectGlobal();
          }
        }, 10000);
      }
    };
  }, [url]);

  return { logs, activeTasks, connected, clearLogs };
}
