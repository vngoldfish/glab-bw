"""Extract frames from video via ffmpeg (accurate end frame)."""

from __future__ import annotations

import asyncio
import logging
import secrets
import shutil
import subprocess
import time
from pathlib import Path

from app.core.config import settings
from app.services.output_storage import file_url_from_path

logger = logging.getLogger(__name__)


def _ffmpeg() -> str:
    path = shutil.which("ffmpeg")
    if not path:
        raise RuntimeError("ffmpeg not found — install ffmpeg to extract frames")
    return path


def _ffprobe() -> str | None:
    return shutil.which("ffprobe")


def video_duration_sec(video_path: Path) -> float | None:
    probe = _ffprobe()
    if not probe:
        return None
    try:
        out = subprocess.check_output(
            [
                probe,
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "format=duration",
                "-of",
                "csv=p=0",
                str(video_path.resolve()),
            ],
            text=True,
            timeout=30,
        ).strip()
        # csv may be "8.000000" or "8.000000,"
        return float(out.split(",")[0])
    except Exception:
        return None


_ffmpeg_semaphore = asyncio.Semaphore(2)


async def _run_ffmpeg_async(cmd: list[str], *, timeout: int = 120) -> None:
    """Run ffmpeg as an async subprocess with concurrency limiting and timeout."""
    async with _ffmpeg_semaphore:
        logger.info("ffmpeg async: %s", " ".join(cmd[:8]) + "…")
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            raise RuntimeError(f"ffmpeg timeout sau {timeout}s")
        if proc.returncode != 0:
            err = ((stderr or stdout or b"").decode("utf-8", errors="replace"))[-800:]
            raise RuntimeError(f"ffmpeg lỗi: {err}")


async def _run_ffmpeg(cmd: list[str], *, timeout: int = 120) -> None:
    await _run_ffmpeg_async(cmd, timeout=timeout)


async def _extract_start(ffmpeg: str, video_path: Path, dest: Path) -> bool:
    """First video frame."""
    try:
        await _run_ffmpeg(
            [
                ffmpeg,
                "-y",
                "-i",
                str(video_path),
                "-vf",
                "select=eq(n\\,0)",
                "-vsync",
                "vfr",
                "-frames:v",
                "1",
                "-q:v",
                "2",
                str(dest),
            ]
        )
        return dest.is_file() and dest.stat().st_size > 0
    except Exception as exc:
        logger.warning("start frame failed: %s", exc)
        return False


async def _extract_end(ffmpeg: str, video_path: Path, dest: Path) -> bool:
    """True last frame — try several strategies."""
    # 1) Seek from end (fast, usually correct)
    for offset in ("-0.04", "-0.1", "-0.25", "-1"):
        try:
            if dest.exists():
                dest.unlink()
            await _run_ffmpeg(
                [
                    ffmpeg,
                    "-y",
                    "-sseof",
                    offset,
                    "-i",
                    str(video_path),
                    "-frames:v",
                    "1",
                    "-q:v",
                    "2",
                    str(dest),
                ]
            )
            if dest.is_file() and dest.stat().st_size > 500:
                return True
        except Exception as exc:
            logger.debug("sseof %s failed: %s", offset, exc)

    # 2) Full decode, keep last written frame (slow but accurate)
    try:
        if dest.exists():
            dest.unlink()
        await _run_ffmpeg(
            [
                ffmpeg,
                "-y",
                "-i",
                str(video_path),
                "-update",
                "1",
                "-q:v",
                "2",
                str(dest),
            ],
            timeout=300,
        )
        if dest.is_file() and dest.stat().st_size > 500:
            return True
    except Exception as exc:
        logger.warning("update last-frame failed: %s", exc)

    # 3) duration-based accurate seek (ss after -i)
    dur = await asyncio.to_thread(video_duration_sec, video_path) or 0.0
    if dur > 0.05:
        ss = max(0.0, dur - 0.05)
        try:
            if dest.exists():
                dest.unlink()
            await _run_ffmpeg(
                [
                    ffmpeg,
                    "-y",
                    "-i",
                    str(video_path),
                    "-ss",
                    str(ss),
                    "-frames:v",
                    "1",
                    "-q:v",
                    "2",
                    str(dest),
                ]
            )
            if dest.is_file() and dest.stat().st_size > 500:
                return True
        except Exception as exc:
            logger.warning("duration seek end failed: %s", exc)

    return False


async def _extract_at_seconds(ffmpeg: str, video_path: Path, dest: Path, seconds: float) -> bool:
    """Accurate mid-seek: -ss after -i."""
    try:
        await _run_ffmpeg(
            [
                ffmpeg,
                "-y",
                "-i",
                str(video_path),
                "-ss",
                str(max(0.0, seconds)),
                "-frames:v",
                "1",
                "-q:v",
                "2",
                str(dest),
            ]
        )
        return dest.is_file() and dest.stat().st_size > 0
    except Exception as exc:
        logger.warning("seek %ss failed: %s", seconds, exc)
        return False


async def extract_frames(
    video_path: Path,
    *,
    positions: list[str] | None = None,
    output_dir: Path | None = None,
) -> list[dict]:
    """
    positions: start | end | middle | or seconds like "1.5"
    Returns list of {position, path, url}
    """
    video_path = video_path.resolve()
    if not video_path.is_file():
        raise FileNotFoundError(f"Video not found: {video_path}")
    ffmpeg = _ffmpeg()
    positions = positions or ["start", "end", "middle"]
    # normalize + dedupe order preserve
    norm: list[str] = []
    for p in positions:
        lab = str(p).strip().lower()
        if lab and lab not in norm:
            norm.append(lab)
    positions = norm or ["end"]

    data_root = settings.data_dir.resolve()
    out_root = (output_dir or (data_root / "G-Labs BW" / "extracted_frames")).resolve()
    # keep outputs under data_dir when possible
    try:
        out_root.relative_to(data_root)
    except ValueError:
        out_root = data_root / "G-Labs BW" / "extracted_frames"
    job_dir = out_root / secrets.token_hex(4)
    job_dir.mkdir(parents=True, exist_ok=True)

    duration = await asyncio.to_thread(video_duration_sec, video_path) or 0.0
    results: list[dict] = []

    for label in positions:
        if label in {"start", "first", "0"}:
            name = "start.png"
            dest = job_dir / name
            ok = await _extract_start(ffmpeg, video_path, dest)
        elif label in {"end", "last"}:
            name = "end.png"
            dest = job_dir / name
            ok = await _extract_end(ffmpeg, video_path, dest)
        elif label in {"middle", "mid", "center"}:
            name = "middle.png"
            dest = job_dir / name
            mid = duration / 2 if duration > 0 else 0.0
            ok = await _extract_at_seconds(ffmpeg, video_path, dest, mid)
        else:
            try:
                sec = float(label)
            except ValueError as exc:
                raise ValueError(f"Invalid position: {label}") from exc
            name = f"t{str(sec).replace('.', '_')}s.png"
            dest = job_dir / name
            ok = await _extract_at_seconds(ffmpeg, video_path, dest, sec)

        if not ok:
            logger.warning("Could not extract position=%s from %s", label, video_path.name)
            continue

        # Canonical position keys for workflow handles
        pos_key = label
        if label in {"first", "0"}:
            pos_key = "start"
        elif label in {"last"}:
            pos_key = "end"
        elif label in {"mid", "center"}:
            pos_key = "middle"

        dest = dest.resolve()
        results.append(
            {
                "position": pos_key,
                "path": dest.relative_to(data_root).as_posix(),
                "url": file_url_from_path(dest),
            }
        )

    if not results:
        raise RuntimeError("Could not extract any frames from video")
    return results


def cleanup_old_frames(max_age_hours: int = 24):
    """Remove extracted frame directories older than max_age_hours."""
    frames_dir = settings.data_dir / "G-Labs BW" / "extracted_frames"
    if not frames_dir.exists():
        return
    cutoff = time.time() - max_age_hours * 3600
    for d in frames_dir.iterdir():
        if d.is_dir():
            try:
                if d.stat().st_mtime < cutoff:
                    shutil.rmtree(d, ignore_errors=True)
            except OSError:
                pass
