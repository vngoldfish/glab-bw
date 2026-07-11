from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from app.core.config import settings
from app.services import reference_storage

router = APIRouter()


class ReferenceUpdateRequest(BaseModel):
    name: str | None = None
    label: str | None = None
    category: str | None = None


class AddReferenceFromPathRequest(BaseModel):
    filePath: str
    category: str = "other"
    label: str | None = None


@router.get("/references")
async def list_references() -> dict:
    return reference_storage.list_references()


@router.post("/references")
async def upload_references(
    files: list[UploadFile] = File(...),
    names: str = Form(""),
    labels: str = Form(""),
    categories: str = Form(""),
) -> dict:
    if not files:
        raise HTTPException(status_code=400, detail={"error": "Chưa chọn file ảnh"})

    name_list = [part.strip() for part in names.split("|")] if names else []
    label_list = [part.strip() for part in labels.split("|")] if labels else []
    category_list = [part.strip() for part in categories.split("|")] if categories else []

    created: list[dict] = []
    errors: list[str] = []

    for index, upload in enumerate(files):
        try:
            raw = await upload.read()
            mime = upload.content_type or "image/png"
            item = reference_storage.add_reference(
                raw,
                mime,
                name=name_list[index] if index < len(name_list) else None,
                label=label_list[index] if index < len(label_list) else (upload.filename or None),
                category=category_list[index] if index < len(category_list) else "other",
            )
            created.append(item)
        except ValueError as exc:
            errors.append(f"{upload.filename or 'file'}: {exc}")
        except Exception as exc:
            errors.append(f"{upload.filename or 'file'}: {exc}")

    if not created and errors:
        raise HTTPException(status_code=400, detail={"error": "; ".join(errors)})

    return {"references": created, "errors": errors}


@router.post("/references/from-path")
async def add_reference_from_path(body: AddReferenceFromPathRequest) -> dict:
    from pathlib import Path
    import mimetypes
    p = Path(body.filePath)
    if not p.is_absolute():
        p = (settings.data_dir / p).resolve()
    else:
        p = p.resolve()

    if not p.is_file():
        raise HTTPException(status_code=400, detail={"error": f"File không tồn tại hoặc không hợp lệ: {body.filePath} (Resolved: {p})"})
    
    try:
        raw = p.read_bytes()
        mime = mimetypes.guess_type(str(p))[0] or "image/png"
        item = reference_storage.add_reference(
            raw,
            mime,
            label=body.label or p.name,
            category=body.category,
        )
        return {"reference": item}
    except Exception as exc:
        raise HTTPException(status_code=500, detail={"error": str(exc)})


@router.patch("/references/{ref_id}")
async def patch_reference(ref_id: str, body: ReferenceUpdateRequest) -> dict:
    try:
        item = reference_storage.update_reference(
            ref_id,
            body.model_dump(exclude_unset=True),
        )
    except KeyError:
        raise HTTPException(status_code=404, detail={"error": "Không tìm thấy ảnh tham chiếu"}) from None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"error": str(exc)}) from None
    return {"reference": item}


@router.put("/references/{ref_id}/image")
async def replace_reference_image(ref_id: str, file: UploadFile = File(...)) -> dict:
    try:
        raw = await file.read()
        item = reference_storage.replace_reference_image(
            ref_id,
            raw,
            file.content_type or "image/png",
        )
    except KeyError:
        raise HTTPException(status_code=404, detail={"error": "Không tìm thấy ảnh tham chiếu"}) from None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"error": str(exc)}) from None
    return {"reference": item}


@router.delete("/references/{ref_id}")
async def delete_reference(ref_id: str) -> dict:
    try:
        reference_storage.delete_reference(ref_id)
    except KeyError:
        raise HTTPException(status_code=404, detail={"error": "Không tìm thấy ảnh tham chiếu"}) from None
    return {"ok": True}