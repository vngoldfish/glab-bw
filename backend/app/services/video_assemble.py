"""Assemble / stitch multiple video clips into one file (G-Labs Video Editor parity).

Uses ffmpeg concat demuxer when all clips share similar streams, with re-encode
fallback for mismatched codecs/resolutions.
"""

from __future__ import annotations

import logging
import secrets
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

from app.core.config import settings
from app.services.output_storage import file_url_from_path, resolve_data_file

logger = logging.getLogger(__name__)


def _ffmpeg() -> str:
    path = shutil.which("ffmpeg")
    if not path:
        raise RuntimeError("ffmpeg not found — cài ffmpeg để dựng video")
    return path


def _ffprobe() -> str | None:
    return shutil.which("ffprobe")


_VIDEO_EXT = {".mp4", ".webm", ".mov", ".mkv", ".m4v"}
_AUDIO_EXT = {".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac", ".wma"}


def _resolve_data_source(source: str) -> Path:
    """Accept data-relative path, /api/files/... URL, or absolute under data_dir."""
    raw = (source or "").strip()
    if not raw:
        raise ValueError("Thiếu đường dẫn file")

    if raw.startswith("http://") or raw.startswith("https://"):
        parsed = urlparse(raw)
        path = unquote(parsed.path or "")
        if "/api/files/" in path:
            raw = path.split("/api/files/", 1)[1]
        else:
            raise ValueError(f"URL không phải file local: {source[:80]}")
    elif raw.startswith("/api/files/"):
        raw = unquote(raw[len("/api/files/") :])

    raw = raw.lstrip("/")
    path = resolve_data_file(raw)
    if not path.is_file():
        raise FileNotFoundError(f"Không thấy file: {raw}")
    return path


def resolve_clip_path(source: str) -> Path:
    path = _resolve_data_source(source)
    if path.suffix.lower() not in _VIDEO_EXT:
        raise ValueError(f"Không phải video: {path.name}")
    return path


def resolve_audio_path(source: str) -> Path:
    path = _resolve_data_source(source)
    # allow audio extracted from video too
    if path.suffix.lower() not in _AUDIO_EXT | _VIDEO_EXT:
        raise ValueError(f"Không phải audio/video: {path.name}")
    return path


def _find_font() -> str | None:
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/Library/Fonts/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    ]
    for c in candidates:
        if Path(c).is_file():
            return c
    return None


def _escape_drawtext(text: str) -> str:
    # ffmpeg drawtext special chars
    return (
        text.replace("\\", "\\\\")
        .replace(":", "\\:")
        .replace("'", "\u2019")  # curly apostrophe avoids quote hell
        .replace("%", "\\%")
    )


def _pct_to_xy(x_pct: float | None, y_pct: float | None) -> tuple[str, str] | None:
    """Map 0–100% (center of text) → ffmpeg drawtext x/y expressions."""
    if x_pct is None and y_pct is None:
        return None
    xp = 50.0 if x_pct is None else max(0.0, min(100.0, float(x_pct)))
    yp = 50.0 if y_pct is None else max(0.0, min(100.0, float(y_pct)))
    # Center of text box at (xp%, yp%) of frame
    x_expr = f"(w-text_w)*{xp / 100:.4f}"
    y_expr = f"(h-text_h)*{yp / 100:.4f}"
    return x_expr, y_expr


def _drawtext_filter(
    text: str,
    *,
    start: float,
    end: float,
    style: str = "subtitle",
    color: str = "white",
    font_size: int | None = None,
    x_pct: float | None = None,
    y_pct: float | None = None,
) -> str:
    style = (style or "subtitle").lower()
    # Default anchor % per style (user can override with x_pct/y_pct)
    style_anchor: dict[str, tuple[float, float, int, int, int]] = {
        # style: (x%, y%, fontsize, box, borderw)
        "title": (50, 48, 52, 0, 3),
        "subtitle": (50, 88, 30, 1, 0),
        "caption": (50, 92, 26, 1, 0),
        "lower": (18, 82, 34, 1, 0),
        "credit": (50, 96, 18, 0, 1),
        "top": (50, 10, 32, 1, 0),
        "center_box": (50, 50, 40, 1, 0),
        "news": (20, 90, 28, 1, 0),
    }
    ax, ay, def_fs, box, borderw = style_anchor.get(style, style_anchor["subtitle"])
    xp = float(x_pct) if x_pct is not None else ax
    yp = float(y_pct) if y_pct is not None else ay
    xy = _pct_to_xy(xp, yp)
    assert xy is not None
    x_expr, y_expr = xy
    fs = int(font_size or def_fs)
    safe = _escape_drawtext((text or "").strip() or " ")
    enable = f"between(t\\,{max(0.0, start):.3f}\\,{max(start + 0.05, end):.3f})"
    font = _find_font()
    parts = [
        f"text='{safe}'",
        f"fontsize={fs}",
        f"fontcolor={color or 'white'}",
        f"x={x_expr}",
        f"y={y_expr}",
        f"enable='{enable}'",
        "line_spacing=6",
    ]
    if font:
        parts.append(f"fontfile='{font.replace(':', '\\:')}'")
    if box:
        parts += ["box=1", "boxcolor=black@0.55", "boxborderw=12"]
    if borderw:
        parts += [f"borderw={borderw}", "bordercolor=black@0.8"]
    return "drawtext=" + ":".join(parts)


def probe_clip(path: Path) -> dict[str, Any]:
    probe = _ffprobe()
    info: dict[str, Any] = {
        "path": str(path),
        "name": path.name,
        "bytes": path.stat().st_size if path.is_file() else 0,
        "duration": None,
        "width": None,
        "height": None,
    }
    if not probe:
        return info
    try:
        out = subprocess.check_output(
            [
                probe,
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=width,height:format=duration",
                "-of",
                "json",
                str(path.resolve()),
            ],
            text=True,
            timeout=30,
        )
        import json

        data = json.loads(out)
        fmt = data.get("format") or {}
        streams = data.get("streams") or []
        if fmt.get("duration"):
            info["duration"] = float(fmt["duration"])
        if streams:
            info["width"] = streams[0].get("width")
            info["height"] = streams[0].get("height")
    except Exception as exc:
        logger.debug("ffprobe failed for %s: %s", path, exc)
    return info


def _escape_concat_path(path: Path) -> str:
    # concat demuxer: single quotes around path, escape single quotes
    s = path.resolve().as_posix()
    return s.replace("'", r"'\''")


def _run_ffmpeg(cmd: list[str], *, timeout: int = 600) -> None:
    logger.info("ffmpeg assemble: %s", " ".join(cmd[:8]) + "…")
    proc = subprocess.run(cmd, capture_output=True, timeout=timeout, text=True)
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "")[-800:]
        raise RuntimeError(f"ffmpeg lỗi: {err}")


def assemble_clips(
    clips: list[dict[str, Any]],
    *,
    output_folder: str | None = None,
    project_id: str | None = None,
    filename: str | None = None,
    reencode: bool = True,
) -> dict[str, Any]:
    """
    clips: [{ path|url, trim_start?, trim_end? }]
    trim_start / trim_end in seconds (optional).
    """
    if not clips:
        raise ValueError("Cần ít nhất 1 clip để dựng video")
    if len(clips) > 80:
        raise ValueError("Tối đa 80 clip / lần xuất")

    ffmpeg = _ffmpeg()
    resolved: list[tuple[Path, float | None, float | None]] = []
    for i, c in enumerate(clips):
        src = str(c.get("path") or c.get("url") or "")
        p = resolve_clip_path(src)
        ts = c.get("trim_start")
        te = c.get("trim_end")
        trim_start = float(ts) if ts is not None and str(ts) != "" else None
        trim_end = float(te) if te is not None and str(te) != "" else None
        if trim_start is not None and trim_start < 0:
            raise ValueError(f"Clip #{i + 1}: trim_start < 0")
        if trim_end is not None and trim_start is not None and trim_end <= trim_start:
            raise ValueError(f"Clip #{i + 1}: trim_end phải > trim_start")
        resolved.append((p, trim_start, trim_end))

    # Output dir
    if project_id:
        from app.services.project_outputs import project_root

        out_dir = project_root(project_id) / "exports"
    else:
        folder = (output_folder or "G-Labs BW/video_exports").strip()
        out_dir = (settings.data_dir / folder.replace("\\", "/")).resolve()
        root = settings.data_dir.resolve()
        if not str(out_dir).startswith(str(root)):
            raise ValueError("output_folder ngoài data/")
    out_dir.mkdir(parents=True, exist_ok=True)

    stamp = time.strftime("%Y%m%d_%H%M%S")
    safe_name = (filename or f"assembled_{stamp}_{secrets.token_hex(3)}.mp4").strip()
    if not safe_name.lower().endswith(".mp4"):
        safe_name += ".mp4"
    safe_name = "".join(ch for ch in safe_name if ch not in '<>:"|?*\\/') or f"assembled_{stamp}.mp4"
    dest = out_dir / safe_name

    work = Path(tempfile.mkdtemp(prefix="glab_assemble_"))
    try:
        # If any trim → always re-encode segments first
        needs_trim = any(ts is not None or te is not None for _, ts, te in resolved)
        segment_paths: list[Path] = []

        if needs_trim or reencode:
            for i, (src, ts, te) in enumerate(resolved):
                seg = work / f"seg_{i:03d}.mp4"
                cmd = [ffmpeg, "-y", "-hide_banner", "-loglevel", "error"]
                if ts is not None:
                    cmd += ["-ss", str(ts)]
                cmd += ["-i", str(src)]
                if te is not None:
                    if ts is not None:
                        cmd += ["-t", str(max(0.05, te - ts))]
                    else:
                        cmd += ["-t", str(te)]
                # Normalize to H.264 + AAC for reliable concat
                cmd += [
                    "-c:v",
                    "libx264",
                    "-preset",
                    "veryfast",
                    "-crf",
                    "20",
                    "-pix_fmt",
                    "yuv420p",
                    "-c:a",
                    "aac",
                    "-b:a",
                    "128k",
                    "-movflags",
                    "+faststart",
                    "-shortest",
                    str(seg),
                ]
                # Some clips have no audio — allow generate silent if fail, retry without audio map
                try:
                    _run_ffmpeg(cmd, timeout=300)
                except RuntimeError:
                    cmd_no_a = [
                        ffmpeg,
                        "-y",
                        "-hide_banner",
                        "-loglevel",
                        "error",
                    ]
                    if ts is not None:
                        cmd_no_a += ["-ss", str(ts)]
                    cmd_no_a += ["-i", str(src)]
                    if te is not None:
                        if ts is not None:
                            cmd_no_a += ["-t", str(max(0.05, te - ts))]
                        else:
                            cmd_no_a += ["-t", str(te)]
                    cmd_no_a += [
                        "-c:v",
                        "libx264",
                        "-preset",
                        "veryfast",
                        "-crf",
                        "20",
                        "-pix_fmt",
                        "yuv420p",
                        "-an",
                        "-movflags",
                        "+faststart",
                        str(seg),
                    ]
                    _run_ffmpeg(cmd_no_a, timeout=300)
                if not seg.is_file() or seg.stat().st_size < 100:
                    raise RuntimeError(f"Không tạo được segment #{i + 1}")
                segment_paths.append(seg)
        else:
            segment_paths = [p for p, _, _ in resolved]

        list_file = work / "concat.txt"
        lines = [f"file '{_escape_concat_path(p)}'" for p in segment_paths]
        list_file.write_text("\n".join(lines) + "\n", encoding="utf-8")

        # Prefer stream copy when we already re-encoded segments
        try:
            _run_ffmpeg(
                [
                    ffmpeg,
                    "-y",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-f",
                    "concat",
                    "-safe",
                    "0",
                    "-i",
                    str(list_file),
                    "-c",
                    "copy",
                    "-movflags",
                    "+faststart",
                    str(dest),
                ],
                timeout=600,
            )
        except RuntimeError:
            # Final re-encode concat
            _run_ffmpeg(
                [
                    ffmpeg,
                    "-y",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-f",
                    "concat",
                    "-safe",
                    "0",
                    "-i",
                    str(list_file),
                    "-c:v",
                    "libx264",
                    "-preset",
                    "veryfast",
                    "-crf",
                    "20",
                    "-pix_fmt",
                    "yuv420p",
                    "-c:a",
                    "aac",
                    "-b:a",
                    "128k",
                    "-movflags",
                    "+faststart",
                    str(dest),
                ],
                timeout=900,
            )

        if not dest.is_file() or dest.stat().st_size < 200:
            raise RuntimeError("Xuất video thất bại — file rỗng")

        meta = probe_clip(dest)
        rel = dest.resolve().relative_to(settings.data_dir.resolve()).as_posix()
        return {
            "ok": True,
            "path": rel,
            "url": file_url_from_path(dest),
            "name": dest.name,
            "bytes": dest.stat().st_size,
            "mb": round(dest.stat().st_size / (1024 * 1024), 3),
            "duration": meta.get("duration"),
            "width": meta.get("width"),
            "height": meta.get("height"),
            "clip_count": len(resolved),
            "folder": dest.parent.relative_to(settings.data_dir.resolve()).as_posix(),
        }
    finally:
        shutil.rmtree(work, ignore_errors=True)


def probe_sources(sources: list[str]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for s in sources:
        try:
            p = resolve_clip_path(s)
            info = probe_clip(p)
            rel = p.resolve().relative_to(settings.data_dir.resolve()).as_posix()
            info["path"] = rel
            info["url"] = file_url_from_path(p)
            info["ok"] = True
        except Exception as exc:
            out.append({"source": s, "ok": False, "error": str(exc)})
            continue
        out.append({**info, "ok": True})
    return out


def _has_audio_stream(path: Path) -> bool:
    probe = _ffprobe()
    if not probe:
        return False
    try:
        out = subprocess.check_output(
            [
                probe,
                "-v",
                "error",
                "-select_streams",
                "a",
                "-show_entries",
                "stream=index",
                "-of",
                "csv=p=0",
                str(path.resolve()),
            ],
            text=True,
            timeout=20,
        ).strip()
        return bool(out)
    except Exception:
        return False


def apply_audio_and_text(
    video_path: Path,
    *,
    audios: list[dict[str, Any]] | None = None,
    texts: list[dict[str, Any]] | None = None,
    dest: Path,
) -> Path:
    """
    Second pass: mix timeline audio + burn-in text overlays onto assembled video.

    audios: [{path|url, start?, trim_start?, trim_end?, volume?}]
    texts:  [{text, start, end, style?, color?, font_size?}]
    """
    audios = audios or []
    texts = texts or []
    if not audios and not texts:
        if dest.resolve() != video_path.resolve():
            shutil.copy2(video_path, dest)
        return dest

    ffmpeg = _ffmpeg()
    work = Path(tempfile.mkdtemp(prefix="glab_mix_"))
    try:
        # Resolve audio files
        audio_files: list[tuple[Path, float, float | None, float | None, float]] = []
        for i, a in enumerate(audios[:20]):
            src = str(a.get("path") or a.get("url") or "")
            p = resolve_audio_path(src)
            start = float(a.get("start") or 0)
            ts = a.get("trim_start")
            te = a.get("trim_end")
            trim_s = float(ts) if ts is not None and str(ts) != "" else None
            trim_e = float(te) if te is not None and str(te) != "" else None
            vol = float(a.get("volume") if a.get("volume") is not None else 1.0)
            vol = max(0.0, min(2.0, vol))
            audio_files.append((p, max(0.0, start), trim_s, trim_e, vol))

        cmd: list[str] = [ffmpeg, "-y", "-hide_banner", "-loglevel", "error", "-i", str(video_path)]
        for p, _, _, _, _ in audio_files:
            cmd += ["-i", str(p)]

        filter_parts: list[str] = []
        v_map = "0:v"
        # Text burn-in chain on video
        if texts:
            cur_in = "0:v"
            ti = 0
            for t in texts[:40]:
                content = str(t.get("text") or "").strip()
                if not content:
                    continue
                start = float(t.get("start") or 0)
                end = float(t.get("end") if t.get("end") is not None else start + 3)
                if end <= start:
                    end = start + 1.5
                x_pct = t.get("x_pct")
                y_pct = t.get("y_pct")
                try:
                    x_pct_f = float(x_pct) if x_pct is not None and str(x_pct) != "" else None
                except (TypeError, ValueError):
                    x_pct_f = None
                try:
                    y_pct_f = float(y_pct) if y_pct is not None and str(y_pct) != "" else None
                except (TypeError, ValueError):
                    y_pct_f = None
                dt = _drawtext_filter(
                    content,
                    start=start,
                    end=end,
                    style=str(t.get("style") or "subtitle"),
                    color=str(t.get("color") or "white"),
                    font_size=int(t["font_size"]) if t.get("font_size") else None,
                    x_pct=x_pct_f,
                    y_pct=y_pct_f,
                )
                out_l = f"vtxt{ti}"
                filter_parts.append(f"[{cur_in}]{dt}[{out_l}]")
                cur_in = out_l
                ti += 1
            if ti:
                v_map = f"[{cur_in}]"
        # else keep stream map 0:v

        # Audio mix
        base_has_a = _has_audio_stream(video_path)
        a_inputs: list[str] = []
        if base_has_a:
            filter_parts.append("[0:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[a0]")
            a_inputs.append("[a0]")
        else:
            # silent base matching video duration
            filter_parts.append(
                "anullsrc=channel_layout=stereo:sample_rate=44100[a0]"
            )
            a_inputs.append("[a0]")

        for i, (p, start, trim_s, trim_e, vol) in enumerate(audio_files):
            idx = i + 1  # input index
            chain = f"[{idx}:a]"
            # trim source
            if trim_s is not None or trim_e is not None:
                ss = float(trim_s or 0)
                if trim_e is not None:
                    dur = max(0.05, float(trim_e) - ss)
                    chain = f"[{idx}:a]atrim=start={ss}:duration={dur},asetpts=PTS-STARTPTS"
                else:
                    chain = f"[{idx}:a]atrim=start={ss},asetpts=PTS-STARTPTS"
            else:
                chain = f"[{idx}:a]asetpts=PTS-STARTPTS"
            delay_ms = int(round(start * 1000))
            # adelay needs per-channel
            chain += f",adelay={delay_ms}|{delay_ms},volume={vol:.3f},aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[a{idx}]"
            filter_parts.append(chain)
            a_inputs.append(f"[a{idx}]")

        n_a = len(a_inputs)
        if n_a == 1:
            filter_parts.append(f"{a_inputs[0]}volume=1[aout]")
        else:
            mix = (
                "".join(a_inputs)
                + f"amix=inputs={n_a}:duration=first:dropout_transition=0:normalize=0[aout]"
            )
            filter_parts.append(mix)

        fc = ";".join(filter_parts)
        cmd += ["-filter_complex", fc]
        cmd += ["-map", v_map, "-map", "[aout]"]
        cmd += [
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "20",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-shortest",
            "-movflags",
            "+faststart",
            str(dest),
        ]
        _run_ffmpeg(cmd, timeout=900)
        if not dest.is_file() or dest.stat().st_size < 200:
            raise RuntimeError("Xuất audio/text thất bại")
        return dest
    finally:
        shutil.rmtree(work, ignore_errors=True)


def assemble_timeline(
    clips: list[dict[str, Any]],
    *,
    audios: list[dict[str, Any]] | None = None,
    texts: list[dict[str, Any]] | None = None,
    project_id: str | None = None,
    output_folder: str | None = None,
    filename: str | None = None,
    reencode: bool = True,
) -> dict[str, Any]:
    """Concat videos then mix audio + burn text (NLE-style export)."""
    stamp = time.strftime("%Y%m%d_%H%M%S")
    temp_rel = f"temp/assemble/{secrets.token_hex(4)}"
    stage = assemble_clips(
        clips,
        project_id=None,
        output_folder=temp_rel,
        filename=f"base_{stamp}.mp4",
        reencode=reencode,
    )
    base_path = resolve_data_file(stage["path"])

    if project_id:
        from app.services.project_outputs import project_root

        out_dir = project_root(project_id) / "exports"
    else:
        folder = (output_folder or "G-Labs BW/video_exports").strip()
        out_dir = (settings.data_dir / folder.replace("\\", "/")).resolve()
        root = settings.data_dir.resolve()
        if not str(out_dir).startswith(str(root)):
            raise ValueError("output_folder ngoài data/")
    out_dir.mkdir(parents=True, exist_ok=True)
    safe_name = (filename or f"timeline_{stamp}_{secrets.token_hex(3)}.mp4").strip()
    if not safe_name.lower().endswith(".mp4"):
        safe_name += ".mp4"
    safe_name = (
        "".join(ch for ch in safe_name if ch not in '<>:"|?*\\/') or f"timeline_{stamp}.mp4"
    )
    dest = out_dir / safe_name

    audios = list(audios or [])
    texts = list(texts or [])
    if audios or texts:
        apply_audio_and_text(base_path, audios=audios, texts=texts, dest=dest)
    else:
        shutil.copy2(base_path, dest)

    try:
        base_path.unlink(missing_ok=True)
        # remove empty temp folder
        base_path.parent.rmdir()
    except Exception:
        pass

    meta = probe_clip(dest)
    rel = dest.resolve().relative_to(settings.data_dir.resolve()).as_posix()
    return {
        "ok": True,
        "path": rel,
        "url": file_url_from_path(dest),
        "name": dest.name,
        "bytes": dest.stat().st_size,
        "mb": round(dest.stat().st_size / (1024 * 1024), 3),
        "duration": meta.get("duration"),
        "width": meta.get("width"),
        "height": meta.get("height"),
        "clip_count": len(clips),
        "audio_count": len(audios),
        "text_count": len(texts),
        "folder": dest.parent.relative_to(settings.data_dir.resolve()).as_posix(),
    }


def save_upload_bytes(
    data: bytes,
    *,
    filename: str,
    project_id: str | None = None,
    kind: str = "audio",
) -> dict[str, Any]:
    """Save uploaded audio/media into project or temp library."""
    if not data:
        raise ValueError("File rỗng")
    if len(data) > 80 * 1024 * 1024:
        raise ValueError("File quá lớn (max 80MB)")
    suffix = Path(filename or "audio.mp3").suffix.lower() or ".mp3"
    if kind == "audio" and suffix not in _AUDIO_EXT | _VIDEO_EXT:
        suffix = ".mp3"
    name = f"{secrets.token_hex(5)}{suffix}"
    if project_id:
        from app.services.project_outputs import project_root

        folder = project_root(project_id) / ("audio" if kind == "audio" else "uploads")
    else:
        folder = settings.data_dir / "G-Labs BW" / "audio_library"
    folder.mkdir(parents=True, exist_ok=True)
    dest = folder / name
    dest.write_bytes(data)
    rel = dest.resolve().relative_to(settings.data_dir.resolve()).as_posix()
    return {
        "ok": True,
        "path": rel,
        "url": file_url_from_path(dest),
        "name": filename or name,
        "bytes": len(data),
        "mb": round(len(data) / (1024 * 1024), 3),
    }
