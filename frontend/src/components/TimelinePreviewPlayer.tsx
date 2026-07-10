/**
 * Inline full-timeline monitor — play composed V+A+T without export / without popup.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { mediaUrl } from "../api";

export interface PreviewVClip {
  id: string;
  url: string;
  name: string;
  duration: number | null;
  trimStart: string;
  trimEnd: string;
}

export interface PreviewVLayout {
  clip: PreviewVClip;
  start: number;
  duration: number;
  end: number;
}

export interface PreviewAClip {
  id: string;
  url: string;
  name: string;
  start: number;
  duration: number | null;
  volume: number;
  trimStart: string;
  trimEnd: string;
}

export interface PreviewTClip {
  id: string;
  text: string;
  start: number;
  end: number;
  style: string;
  color: string;
  xPct?: number;
  yPct?: number;
}

interface Props {
  videoLayout: PreviewVLayout[];
  audios: PreviewAClip[];
  texts: PreviewTClip[];
  totalDur: number;
  /** When true, panel is visible (parent toggles). */
  active: boolean;
  /** Sync master time to parent playhead */
  onMasterChange?: (t: number) => void;
  /** Parent forces seek (e.g. click timeline ruler) */
  externalSeek?: { t: number; n: number } | null;
  selectedTextId?: string | null;
  onTextPosition?: (id: string, xPct: number, yPct: number) => void;
}

function fmt(sec: number) {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  const f = Math.floor((s % 1) * 10);
  if (m > 0) return `${m}:${String(r).padStart(2, "0")}`;
  return `0:${String(r).padStart(2, "0")}${f ? `.${f}` : ""}`;
}

function trimRange(
  c: { duration: number | null; trimStart: string; trimEnd: string },
  fallbackDur: number,
) {
  const d = c.duration && c.duration > 0 ? c.duration : fallbackDur;
  const ts = c.trimStart === "" ? 0 : Number(c.trimStart);
  const te = c.trimEnd === "" ? d : Number(c.trimEnd);
  const start = Number.isFinite(ts) && ts >= 0 ? ts : 0;
  const end =
    Number.isFinite(te) && te > start ? te : Math.max(start + 0.1, d || start + 3);
  return { ts: start, te: end };
}

const STYLE_DEFAULT_POS: Record<string, { x: number; y: number; fs: string; box: boolean }> = {
  title: { x: 50, y: 48, fs: "clamp(18px, 3.2vw, 36px)", box: false },
  subtitle: { x: 50, y: 88, fs: "clamp(14px, 2.4vw, 22px)", box: true },
  caption: { x: 50, y: 92, fs: "clamp(13px, 2vw, 20px)", box: true },
  lower: { x: 18, y: 82, fs: "clamp(14px, 2.4vw, 24px)", box: true },
  credit: { x: 50, y: 96, fs: "clamp(11px, 1.6vw, 14px)", box: false },
  top: { x: 50, y: 10, fs: "clamp(14px, 2.4vw, 24px)", box: true },
  center_box: { x: 50, y: 50, fs: "clamp(16px, 2.8vw, 30px)", box: true },
  news: { x: 20, y: 90, fs: "clamp(13px, 2.2vw, 20px)", box: true },
};

function textStyleCss(
  style: string,
  xPct?: number,
  yPct?: number,
  draggable?: boolean,
): CSSProperties {
  const d = STYLE_DEFAULT_POS[style] || STYLE_DEFAULT_POS.subtitle;
  const x = xPct ?? d.x;
  const y = yPct ?? d.y;
  return {
    position: "absolute",
    left: `${x}%`,
    top: `${y}%`,
    transform: "translate(-50%, -50%)",
    maxWidth: "90%",
    textAlign: "center",
    fontWeight: style === "credit" ? 500 : 700,
    fontSize: d.fs,
    lineHeight: 1.35,
    textShadow: "0 2px 8px rgba(0,0,0,0.85)",
    padding: "6px 12px",
    borderRadius: 8,
    background: d.box ? "rgba(0,0,0,0.55)" : undefined,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    cursor: draggable ? "grab" : "default",
    pointerEvents: draggable ? "auto" : "none",
    userSelect: "none",
    touchAction: "none",
  };
}

export default function TimelinePreviewPlayer({
  videoLayout,
  audios,
  texts,
  totalDur,
  active,
  onMasterChange,
  externalSeek,
  selectedTextId,
  onTextPosition,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const audioMap = useRef<Map<string, HTMLAudioElement>>(new Map());
  const [master, setMaster] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [clipIdx, setClipIdx] = useState(0);
  const [status, setStatus] = useState("Sẵn sàng");
  const playingRef = useRef(false);
  const masterRef = useRef(0);
  const clipIdxRef = useRef(0);
  const loadingRef = useRef(false);
  const lastExternalN = useRef<number | null>(null);
  const dragTextId = useRef<string | null>(null);

  const safeTotal = Math.max(totalDur, 0.1);

  const activeTexts = useMemo(
    () => texts.filter((t) => master >= t.start && master < t.end && t.text.trim()),
    [texts, master],
  );

  const setMasterBoth = useCallback(
    (t: number) => {
      masterRef.current = t;
      setMaster(t);
      onMasterChange?.(t);
    },
    [onMasterChange],
  );

  const pauseAllAudio = useCallback(() => {
    audioMap.current.forEach((el) => el.pause());
  }, []);

  const syncAudios = useCallback(
    (t: number, isPlaying: boolean) => {
      for (const a of audios) {
        let el = audioMap.current.get(a.id);
        if (!el) {
          el = new Audio(mediaUrl(a.url));
          el.preload = "auto";
          audioMap.current.set(a.id, el);
        }
        el.volume = Math.max(0, Math.min(1, a.volume));
        const fallback = a.duration && a.duration > 0 ? a.duration : 30;
        const { ts, te } = trimRange(a, fallback);
        const clipDur = te - ts;
        const local = t - a.start + ts;
        const inRange = t >= a.start && t < a.start + clipDur && local >= ts && local < te;
        if (!inRange || !isPlaying) {
          if (!el.paused) el.pause();
          continue;
        }
        if (Math.abs(el.currentTime - local) > 0.35) {
          try {
            el.currentTime = Math.max(0, local);
          } catch {
            /* */
          }
        }
        if (el.paused && isPlaying) void el.play().catch(() => undefined);
      }
    },
    [audios],
  );

  const loadClipAtMaster = useCallback(
    async (t: number, autoplay: boolean) => {
      if (!videoLayout.length || loadingRef.current) return;
      const v = videoRef.current;
      if (!v) return;

      let idx = videoLayout.findIndex((x) => t >= x.start && t < x.end - 0.001);
      if (idx < 0) idx = t >= (videoLayout.at(-1)?.end ?? 0) ? videoLayout.length - 1 : 0;
      const item = videoLayout[idx];
      if (!item) return;

      const { ts, te } = trimRange(item.clip, item.duration);
      const local = Math.min(te - 0.05, Math.max(ts, ts + (t - item.start)));

      loadingRef.current = true;
      try {
        const src = mediaUrl(item.clip.url);
        const needSwap = v.getAttribute("data-clip-id") !== item.clip.id;
        if (needSwap) {
          setStatus(`Clip ${idx + 1}: ${item.clip.name}`);
          v.setAttribute("data-clip-id", item.clip.id);
          v.src = src;
          v.load();
          await new Promise<void>((resolve) => {
            const done = () => {
              v.removeEventListener("loadeddata", done);
              v.removeEventListener("error", done);
              resolve();
            };
            v.addEventListener("loadeddata", done);
            v.addEventListener("error", done);
            setTimeout(done, 4000);
          });
        }
        try {
          if (Math.abs(v.currentTime - local) > 0.12) v.currentTime = local;
        } catch {
          /* */
        }
        clipIdxRef.current = idx;
        setClipIdx(idx);
        setStatus(item.clip.name);
        if (autoplay && playingRef.current) await v.play().catch(() => undefined);
      } finally {
        loadingRef.current = false;
      }
    },
    [videoLayout],
  );

  // When monitor becomes active, load current position
  useEffect(() => {
    if (!active) {
      playingRef.current = false;
      setPlaying(false);
      pauseAllAudio();
      videoRef.current?.pause();
      return;
    }
    void loadClipAtMaster(masterRef.current, false);
  }, [active, loadClipAtMaster, pauseAllAudio]);

  // Rebuild when timeline structure changes while active
  useEffect(() => {
    if (!active) return;
    void loadClipAtMaster(masterRef.current, playingRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoLayout, active]);

  // External seek from timeline ruler click
  useEffect(() => {
    if (!active || externalSeek == null) return;
    if (lastExternalN.current === externalSeek.n) return;
    lastExternalN.current = externalSeek.n;
    const t = Math.max(0, Math.min(safeTotal, externalSeek.t));
    setMasterBoth(t);
    void loadClipAtMaster(t, playingRef.current);
    syncAudios(t, playingRef.current);
  }, [externalSeek, active, safeTotal, loadClipAtMaster, syncAudios, setMasterBoth]);

  const togglePlay = () => {
    if (!videoLayout.length) return;
    if (playingRef.current) {
      playingRef.current = false;
      setPlaying(false);
      videoRef.current?.pause();
      pauseAllAudio();
      return;
    }
    if (masterRef.current >= safeTotal - 0.05) {
      setMasterBoth(0);
    }
    playingRef.current = true;
    setPlaying(true);
    void (async () => {
      await loadClipAtMaster(masterRef.current, true);
      syncAudios(masterRef.current, true);
    })();
  };

  const seekMaster = (t: number) => {
    const nt = Math.max(0, Math.min(safeTotal, t));
    setMasterBoth(nt);
    void loadClipAtMaster(nt, playingRef.current);
    syncAudios(nt, playingRef.current);
  };

  const onVideoTimeUpdate = () => {
    if (!playingRef.current || !videoLayout.length) return;
    const v = videoRef.current;
    if (!v) return;
    const idx = clipIdxRef.current;
    const item = videoLayout[idx];
    if (!item) return;
    const { ts, te } = trimRange(item.clip, item.duration);
    const local = v.currentTime;

    if (local >= te - 0.08 || v.ended) {
      const nextT = item.end;
      if (nextT >= safeTotal - 0.02 || idx >= videoLayout.length - 1) {
        setMasterBoth(safeTotal);
        playingRef.current = false;
        setPlaying(false);
        v.pause();
        pauseAllAudio();
        setStatus("Hết timeline");
        return;
      }
      setMasterBoth(nextT);
      void loadClipAtMaster(nextT, true);
      syncAudios(nextT, true);
      return;
    }

    const m = item.start + (local - ts);
    setMasterBoth(m);
    syncAudios(m, true);
  };

  function onTextPointerDown(e: ReactPointerEvent, id: string) {
    e.stopPropagation();
    e.preventDefault();
    dragTextId.current = id;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }

  function onTextPointerMove(e: ReactPointerEvent) {
    if (!dragTextId.current || !onTextPosition || !stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const xPct = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    const yPct = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
    onTextPosition(dragTextId.current, xPct, yPct);
  }

  function onTextPointerUp(e: ReactPointerEvent) {
    if (dragTextId.current) {
      try {
        (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
      } catch {
        /* */
      }
    }
    dragTextId.current = null;
  }

  if (!active) return null;

  return (
    <div className="nle-monitor">
      <div
        className="nle-monitor-stage"
        ref={stageRef}
        onPointerMove={onTextPointerMove}
        onPointerUp={onTextPointerUp}
        onPointerLeave={onTextPointerUp}
      >
        {!videoLayout.length ? (
          <div className="nle-monitor-empty">
            Thêm clip vào track V — bật monitor để xem ghép trực tiếp khi chỉnh sửa
          </div>
        ) : (
          <>
            <video
              ref={videoRef}
              className="nle-monitor-video"
              playsInline
              preload="auto"
              onTimeUpdate={onVideoTimeUpdate}
              onEnded={onVideoTimeUpdate}
              onClick={togglePlay}
            />
            {activeTexts.map((t) => {
              const selected = selectedTextId === t.id;
              return (
                <div
                  key={t.id}
                  className={`nle-monitor-text${selected ? " is-selected" : ""}`}
                  style={{
                    ...textStyleCss(t.style, t.xPct, t.yPct, Boolean(onTextPosition)),
                    color: t.color || "#fff",
                    outline: selected ? "2px solid #fbbf24" : undefined,
                    boxShadow: selected ? "0 0 0 1px rgba(0,0,0,0.5)" : undefined,
                  }}
                  onPointerDown={(e) => onTextPointerDown(e, t.id)}
                  title="Kéo để đổi vị trí"
                >
                  {t.text}
                </div>
              );
            })}
            {!playing && !dragTextId.current && (
              <button type="button" className="nle-monitor-playfab" onClick={togglePlay}>
                ▶
              </button>
            )}
          </>
        )}
      </div>

      <div className="nle-monitor-bar">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={togglePlay}
          disabled={!videoLayout.length}
        >
          {playing ? "⏸" : "▶"}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => seekMaster(0)}
          disabled={!videoLayout.length}
        >
          ⏮
        </button>
        <span className="nle-monitor-time">
          {fmt(master)} / {fmt(safeTotal)}
        </span>
        <input
          type="range"
          className="nle-monitor-seek"
          min={0}
          max={safeTotal}
          step={0.05}
          value={Math.min(master, safeTotal)}
          onChange={(e) => seekMaster(Number(e.target.value))}
          disabled={!videoLayout.length}
        />
        <span className="muted nle-monitor-meta" title={status}>
          #{clipIdx + 1}
          {videoLayout[clipIdx] ? ` ${videoLayout[clipIdx].clip.name}` : ""}
        </span>
      </div>
    </div>
  );
}
