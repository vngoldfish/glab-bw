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

/* ── Global State Singleton (Tab/Route Switching Resiliency) ─── */

let globalActiveTasks: ActiveTask[] = [];
let globalLogs: LogEntry[] = [];
let _logIdCounter = 0;

const activeTasksSetters = new Set<(tasks: ActiveTask[]) => void>();
const logsSetters = new Set<(logs: LogEntry[]) => void>();

function notifyActiveTasksChange() {
  activeTasksSetters.forEach((setter) => setter([...globalActiveTasks]));
}

function notifyLogsChange() {
  logsSetters.forEach((setter) => setter([...globalLogs]));
}

async function syncActiveTasksFromBackend() {
  try {
    const res = await window.fetch("/api/batch/tasks/recent");
    if (!res.ok) return;
    const tasks = await res.json();
    const runningTasks = tasks.filter((t: any) => t.status === "running" || t.status === "queued");

    const active: ActiveTask[] = runningTasks.map((t: any) => ({
      task_id: t.task_id,
      task_type: t.task_type,
      step: t.step || t.message || t.prompt || "",
      percent: t.percent !== undefined ? t.percent : 0,
      status: t.status,
      prompt: t.prompt,
      startedAt: t.created_at || Date.now(),
      data: { row_id: t.row_id },
    }));

    globalActiveTasks = active;
    notifyActiveTasksChange();
  } catch (err) {
    console.error("Failed to sync active tasks from backend:", err);
  }
}

function updateGlobalStateWithEvent(event: ProgressEvent) {
  if (event.type === "task_status") {
    const { task_id, task_type, status, message } = event;

    if (status === "running") {
      if (!globalActiveTasks.some((t) => t.task_id === task_id)) {
        globalActiveTasks.push({
          task_id,
          task_type,
          step: message,
          percent: 0,
          status,
          prompt: message,
          startedAt: event.timestamp,
          data: event.data,
        });
      } else {
        globalActiveTasks = globalActiveTasks.map((t) =>
          t.task_id === task_id ? { ...t, status, step: message, data: event.data || t.data } : t
        );
      }
    } else if (status === "completed" || status === "failed") {
      globalActiveTasks = globalActiveTasks.map((t) =>
        t.task_id === task_id
          ? { ...t, status, step: message, percent: status === "completed" ? 100 : t.percent, data: event.data || t.data }
          : t
      );
      setTimeout(() => {
        globalActiveTasks = globalActiveTasks.filter((t) => t.task_id !== task_id);
        notifyActiveTasksChange();
      }, 3000);
    }
    appendGlobalLog(event);
  } else if (event.type === "task_progress") {
    globalActiveTasks = globalActiveTasks.map((t) =>
      t.task_id === event.task_id
        ? { ...t, step: event.step, percent: event.percent, data: event.data || t.data }
        : t
    );
  } else if (event.type === "workflow_log" || event.type === "system_log") {
    appendGlobalLog(event);
  }
}

function appendGlobalLog(event: ProgressEvent) {
  const entry: LogEntry = {
    id: ++_logIdCounter,
    timestamp: event.timestamp,
    message: event.message || event.step || "",
    level: event.level || "INFO",
    type: event.type,
    taskId: event.task_id || "",
  };
  if (!entry.message) return;
  globalLogs.push(entry);
  if (globalLogs.length > MAX_LOG_LINES) {
    globalLogs = globalLogs.slice(globalLogs.length - MAX_LOG_LINES);
  }
}

/* ── Singleton SSE Manager ────────────────────────────────────── */

interface SSEManager {
  es: EventSource | null;
  connected: boolean;
  listeners: Set<(ev: ProgressEvent) => void>;
  connListeners: Set<(c: boolean) => void>;
  reconnectDelay: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
}

const manager: SSEManager = {
  es: null,
  connected: false,
  listeners: new Set(),
  connListeners: new Set(),
  reconnectDelay: RECONNECT_BASE_MS,
  reconnectTimer: null,
};

function connectGlobal(url: string) {
  if (manager.es) return;

  const es = new EventSource(url);
  manager.es = es;

  es.onopen = () => {
    manager.connected = true;
    manager.reconnectDelay = RECONNECT_BASE_MS;
    manager.connListeners.forEach((lis) => lis(true));
    void syncActiveTasksFromBackend();
  };

  es.onmessage = (ev) => {
    try {
      const event: ProgressEvent = JSON.parse(ev.data);
      updateGlobalStateWithEvent(event);
      notifyActiveTasksChange();
      notifyLogsChange();
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

    const delay = manager.reconnectDelay;
    manager.reconnectDelay = Math.min(delay * 2, RECONNECT_MAX_MS);
    if (manager.reconnectTimer) clearTimeout(manager.reconnectTimer);
    manager.reconnectTimer = setTimeout(() => {
      connectGlobal(url);
    }, delay);
  };
}

/* ── Hook ────────────────────────────────────────────────────── */

export function useEventStream(url = "/api/events/stream"): UseEventStreamReturn {
  const [logs, setLogs] = useState<LogEntry[]>(() => globalLogs);
  const [activeTasks, setActiveTasks] = useState<ActiveTask[]>(() => globalActiveTasks);
  const [connected, setConnected] = useState(manager.connected);

  const clearLogs = useCallback(() => {
    globalLogs = [];
    notifyLogsChange();
  }, []);

  useEffect(() => {
    activeTasksSetters.add(setActiveTasks);
    logsSetters.add(setLogs);

    // Initial sync
    setActiveTasks([...globalActiveTasks]);
    setLogs([...globalLogs]);
    void syncActiveTasksFromBackend();

    const onConnChange = (c: boolean) => setConnected(c);
    manager.connListeners.add(onConnChange);
    setConnected(manager.connected);

    connectGlobal(url);

    // Dummy listener to keep manager alive
    const dummyListener = () => {};
    manager.listeners.add(dummyListener);

    return () => {
      activeTasksSetters.delete(setActiveTasks);
      logsSetters.delete(setLogs);
      manager.listeners.delete(dummyListener);
      manager.connListeners.delete(onConnChange);
    };
  }, [url]);

  return { logs, activeTasks, connected, clearLogs };
}
