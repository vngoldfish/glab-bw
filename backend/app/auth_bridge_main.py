"""Auth Bridge server for G-Labs Auth Helper Chrome extension (port 18923)."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import auth_bridge as auth_bridge_routes

app = FastAPI(title="G-Labs BW Auth Bridge", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(auth_bridge_routes.router)


@app.get("/")
async def root() -> dict:
    from app.services.auth_bridge import auth_bridge

    return {"name": "G-Labs BW Auth Bridge", **auth_bridge.status_payload()}