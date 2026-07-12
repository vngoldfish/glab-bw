from io import BytesIO
from pathlib import Path

from PIL import Image

from app.providers.base import ProviderError


class UpscaleService:
    """Lightweight upscale placeholder.

    Real-ESRGAN can be wired in later; for now we use high-quality Lanczos resize.
    """

    SUPPORTED = {"2K": 2048, "4K": 4096}

    def upscale_image(self, image_bytes: bytes, targets: list[str]) -> list[bytes]:
        if not targets:
            return [image_bytes]

        image = Image.open(BytesIO(image_bytes)).convert("RGB")
        width, height = image.size
        long_edge = max(width, height)
        results: list[bytes] = []

        for target in targets:
            if target not in self.SUPPORTED:
                continue
            desired = self.SUPPORTED[target]
            if desired <= long_edge:
                raise ProviderError(
                    f"Upscale to {target} failed: source too small ({long_edge}px)",
                    error_code=0,
                )
            scale = desired / long_edge
            new_size = (max(1, int(width * scale)), max(1, int(height * scale)))
            upscaled = image.resize(new_size, Image.Resampling.LANCZOS)
            buffer = BytesIO()
            upscaled.save(buffer, format="PNG")
            results.append(buffer.getvalue())

        if targets and not results:
            raise ProviderError("No valid upscale targets", error_code=0)
        return results or [image_bytes]

    def save_bytes(self, data: bytes, filename: str, output_dir: Path) -> Path:
        output_dir.mkdir(parents=True, exist_ok=True)
        path = output_dir / filename
        if path.exists():
            import datetime
            try:
                mtime = path.stat().st_mtime
                dt = datetime.datetime.fromtimestamp(mtime)
                time_str = dt.strftime("%H%M%S")
                new_name = f"{path.stem}_old_{time_str}{path.suffix}"
                new_path = path.parent / new_name
                counter = 1
                while new_path.exists():
                    new_name = f"{path.stem}_old_{time_str}_{counter}{path.suffix}"
                    new_path = path.parent / new_name
                    counter += 1
                path.rename(new_path)
            except Exception:
                pass
        path.write_bytes(data)
        return path


upscale_service = UpscaleService()