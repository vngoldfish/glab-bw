"""Extract frames from video via ffmpeg (G-Labs frame_extract node)."""

from __future__ import annotations

import logging
import secrets
import shutil
import subprocess
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
                "-show_entries",
                "format=duration",
                "of",
                "default=noprint_wrappers=1:nokey=1",
                str(video_path),
            ],
            text=True,
            timeout=30,
        ).strip()
        return float(out)
    except Exception:
        return None


def extract_frames(
    video_path: Path,
    *,
    positions: list[str] | None = None,
    output_dir: Path | None = None,
) -> list[dict]:
    """
    positions: start | end | middle | or seconds like "1.5"
    Returns list of {position, path, url}
    """
    if not video_path.is_file():
        raise FileNotFoundError(f"Video not found: {video_path}")
    ffmpeg = _ffmpeg()
    positions = positions or ["start", "end", "middle"]
    out_root = output_dir or (settings.data_dir / "G-Labs BW" / "extracted_frames")
    job_dir = out_root / secrets.token_hex(4)
    job_dir.mkdir(parents=True, exist_ok=True)

    duration = video_duration_sec(video_path) or 0.0
    results: list[dict] = []

    for pos in positions:
        label = pos.strip().lower()
        if label in {"start", "first", "0"}:
            ss = "0"
            name = "start.png"
        elif label in {"end", "last"}:
            # near end
            if duration and duration > 0.2:
                ss = str(max(0.0, duration - 0.15))
            else:
                ss = "0"
            name = "end.png"
        elif label in {"middle", "mid", "center"}:
            ss = str(duration / 2 if duration > 0 else 0)
            name = "middle.png"
        else:
            # numeric seconds
            try:
                ss = str(float(label))
                name = f"t{ss.replace('.', '_')}s.png"
            except ValueError as exc:
                raise ValueError(f"Invalid position: {pos}") from exc

        dest = job_dir / name
        cmd = [
            ffmpeg,
            "-y",
            "-ss",
            ss,
            "-i",
            str(video_path),
            "-frames:v",
            "1",
            "-q:v",
            "2",
            str(dest),
        ]
        try:
            subprocess.run(
                cmd,
                check=True,
                capture_output=True,
                timeout=60,
            )
        except subprocess.CalledProcessError as exc:
            err = (exc.stderr or b"").decode("utf-8", errors="replace")[:300]
            logger.warning("ffmpeg frame extract failed pos=%s: %s", pos, err)
            continue
        if dest.is_file() and dest.stat().st_size > 0:
            results.append(
                {
                    "position": label,
                    "path": dest.relative_to(settings.data_dir).as_posix(),
                    "url": file_url_from_path(dest),
                }
            )

    if not results:
        raise RuntimeError("Could not extract any frames from video")
    return results
