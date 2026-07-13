"""Bubble chat app backend - FastAPI + MongoDB + WebSockets."""
from fastapi import FastAPI, APIRouter, Header, HTTPException, WebSocket, WebSocketDisconnect, Query
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import json
import uuid
import asyncio
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Set
from datetime import datetime, timezone, timedelta
import httpx

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


# ============= Models =============
def now_utc() -> datetime:
    return datetime.now(timezone.utc)


class UserPublic(BaseModel):
    user_id: str
    email: str
    name: str
    picture: Optional[str] = None
    online: bool = False
    last_seen: Optional[datetime] = None


class SessionExchange(BaseModel):
    session_id: str


class Chat(BaseModel):
    chat_id: str
    is_group: bool
    name: Optional[str] = None
    members: List[str]
    created_by: str
    created_at: datetime
    last_message: Optional[str] = None
    last_message_at: Optional[datetime] = None
    last_sender_id: Optional[str] = None


class Message(BaseModel):
    message_id: str
    chat_id: str
    sender_id: str
    text: Optional[str] = None
    image: Optional[str] = None  # base64
    created_at: datetime
    read_by: List[str] = []


class CreateChatBody(BaseModel):
    member_ids: List[str]
    is_group: bool = False
    name: Optional[str] = None


class SendMessageBody(BaseModel):
    chat_id: str
    text: Optional[str] = None
    image: Optional[str] = None
    client_id: Optional[str] = None  # for offline dedup


# ============= Auth =============
async def get_current_user(authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization.split(" ", 1)[1].strip()
    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")
    exp = session.get("expires_at")
    if exp:
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        if exp < now_utc():
            raise HTTPException(status_code=401, detail="Session expired")
    user = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


@api_router.post("/auth/session")
async def auth_session(body: SessionExchange):
    """Exchange Emergent session_id for a persistent session_token, upsert user."""
    async with httpx.AsyncClient(timeout=15) as http:
        r = await http.get(
            "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
            headers={"X-Session-ID": body.session_id},
        )
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="Session lookup failed")
    data = r.json()
    email = data["email"]
    name = data.get("name") or email.split("@")[0]
    picture = data.get("picture")
    session_token = data["session_token"]

    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
        await db.users.update_one(
            {"user_id": user_id},
            {"$set": {"name": name, "picture": picture, "last_seen": now_utc()}},
        )
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one({
            "user_id": user_id,
            "email": email,
            "name": name,
            "picture": picture,
            "online": False,
            "last_seen": now_utc(),
            "created_at": now_utc(),
        })

    await db.user_sessions.insert_one({
        "session_token": session_token,
        "user_id": user_id,
        "created_at": now_utc(),
        "expires_at": now_utc() + timedelta(days=7),
    })

    user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    return {"session_token": session_token, "user": _clean_user(user)}


def _clean_user(u: dict) -> dict:
    return {
        "user_id": u["user_id"],
        "email": u["email"],
        "name": u["name"],
        "picture": u.get("picture"),
        "online": u.get("online", False),
        "last_seen": u.get("last_seen"),
    }


@api_router.get("/auth/me")
async def auth_me(user=None):
    return await auth_me_impl(user)


async def auth_me_impl(user):
    pass


@api_router.get("/me")
async def me_get(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    return _clean_user(user)


@api_router.post("/auth/logout")
async def logout(authorization: Optional[str] = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1].strip()
        await db.user_sessions.delete_one({"session_token": token})
    return {"ok": True}


# ============= Users =============
@api_router.get("/users/search")
async def users_search(q: str = "", authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    query = {"user_id": {"$ne": user["user_id"]}}
    if q:
        query["$or"] = [
            {"name": {"$regex": q, "$options": "i"}},
            {"email": {"$regex": q, "$options": "i"}},
        ]
    users = await db.users.find(query, {"_id": 0}).limit(50).to_list(50)
    return [_clean_user(u) for u in users]


# ============= Chats =============
@api_router.get("/chats")
async def list_chats(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    chats = await db.chats.find({"members": user["user_id"]}, {"_id": 0}).sort("last_message_at", -1).to_list(200)
    # enrich with member info & unread count
    result = []
    for c in chats:
        member_ids = c["members"]
        members = await db.users.find({"user_id": {"$in": member_ids}}, {"_id": 0}).to_list(100)
        unread = await db.messages.count_documents({
            "chat_id": c["chat_id"],
            "sender_id": {"$ne": user["user_id"]},
            "read_by": {"$ne": user["user_id"]},
        })
        result.append({
            **c,
            "members": [_clean_user(m) for m in members],
            "unread": unread,
        })
    return result


@api_router.post("/chats")
async def create_chat(body: CreateChatBody, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    members = list(set(body.member_ids + [user["user_id"]]))
    if not body.is_group and len(members) == 2:
        # find existing 1-1 chat
        existing = await db.chats.find_one({
            "is_group": False,
            "members": {"$all": members, "$size": 2},
        }, {"_id": 0})
        if existing:
            return existing
    chat = {
        "chat_id": f"chat_{uuid.uuid4().hex[:12]}",
        "is_group": body.is_group or len(members) > 2,
        "name": body.name,
        "members": members,
        "created_by": user["user_id"],
        "created_at": now_utc(),
        "last_message": None,
        "last_message_at": now_utc(),
        "last_sender_id": None,
    }
    await db.chats.insert_one(chat.copy())
    chat.pop("_id", None)
    return chat


@api_router.get("/chats/{chat_id}/messages")
async def get_messages(chat_id: str, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    chat = await db.chats.find_one({"chat_id": chat_id, "members": user["user_id"]}, {"_id": 0})
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    msgs = await db.messages.find({"chat_id": chat_id}, {"_id": 0}).sort("created_at", 1).to_list(500)
    return msgs


@api_router.post("/messages")
async def send_message(body: SendMessageBody, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    chat = await db.chats.find_one({"chat_id": body.chat_id, "members": user["user_id"]}, {"_id": 0})
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    if not body.text and not body.image:
        raise HTTPException(status_code=400, detail="Empty message")

    msg = {
        "message_id": f"msg_{uuid.uuid4().hex[:12]}",
        "chat_id": body.chat_id,
        "sender_id": user["user_id"],
        "text": body.text,
        "image": body.image,
        "created_at": now_utc(),
        "read_by": [user["user_id"]],
        "client_id": body.client_id,
    }
    await db.messages.insert_one(msg.copy())
    msg.pop("_id", None)

    preview = "📷 Photo" if body.image and not body.text else (body.text or "")
    await db.chats.update_one(
        {"chat_id": body.chat_id},
        {"$set": {
            "last_message": preview[:200],
            "last_message_at": now_utc(),
            "last_sender_id": user["user_id"],
        }},
    )

    # push to connected members via WS
    await manager.broadcast_to_chat(chat["members"], {
        "type": "message",
        "chat_id": body.chat_id,
        "message": _serialize_msg(msg),
    })
    return _serialize_msg(msg)


@api_router.post("/chats/{chat_id}/read")
async def mark_read(chat_id: str, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    await db.messages.update_many(
        {"chat_id": chat_id, "read_by": {"$ne": user["user_id"]}},
        {"$addToSet": {"read_by": user["user_id"]}},
    )
    # notify chat members
    chat = await db.chats.find_one({"chat_id": chat_id}, {"_id": 0})
    if chat:
        await manager.broadcast_to_chat(chat["members"], {
            "type": "read",
            "chat_id": chat_id,
            "user_id": user["user_id"],
        })
    return {"ok": True}


def _serialize_msg(m: dict) -> dict:
    return {
        "message_id": m["message_id"],
        "chat_id": m["chat_id"],
        "sender_id": m["sender_id"],
        "text": m.get("text"),
        "image": m.get("image"),
        "created_at": m["created_at"].isoformat() if isinstance(m["created_at"], datetime) else m["created_at"],
        "read_by": m.get("read_by", []),
        "client_id": m.get("client_id"),
    }


# ============= WebSocket manager =============
class ConnectionManager:
    def __init__(self):
        self.connections: Dict[str, Set[WebSocket]] = {}

    async def connect(self, user_id: str, ws: WebSocket):
        await ws.accept()
        self.connections.setdefault(user_id, set()).add(ws)
        await db.users.update_one({"user_id": user_id}, {"$set": {"online": True, "last_seen": now_utc()}})
        await self.broadcast_presence(user_id, True)

    async def disconnect(self, user_id: str, ws: WebSocket):
        conns = self.connections.get(user_id, set())
        conns.discard(ws)
        if not conns:
            self.connections.pop(user_id, None)
            await db.users.update_one({"user_id": user_id}, {"$set": {"online": False, "last_seen": now_utc()}})
            await self.broadcast_presence(user_id, False)

    async def send(self, user_id: str, data: dict):
        for ws in list(self.connections.get(user_id, [])):
            try:
                await ws.send_text(json.dumps(data, default=str))
            except Exception:
                pass

    async def broadcast_to_chat(self, member_ids: List[str], data: dict):
        for uid in member_ids:
            await self.send(uid, data)

    async def broadcast_presence(self, user_id: str, online: bool):
        # find contacts (people in shared chats)
        chats = await db.chats.find({"members": user_id}, {"_id": 0, "members": 1}).to_list(500)
        contacts: Set[str] = set()
        for c in chats:
            for m in c["members"]:
                if m != user_id:
                    contacts.add(m)
        for uid in contacts:
            await self.send(uid, {"type": "presence", "user_id": user_id, "online": online})


manager = ConnectionManager()


@app.websocket("/api/ws")
async def websocket_endpoint(websocket: WebSocket, token: str = Query(...)):
    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session:
        await websocket.close(code=4401)
        return
    user_id = session["user_id"]
    await manager.connect(user_id, websocket)
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw)
            except Exception:
                continue
            t = data.get("type")
            if t == "typing":
                chat_id = data.get("chat_id")
                chat = await db.chats.find_one({"chat_id": chat_id}, {"_id": 0, "members": 1})
                if chat:
                    for m in chat["members"]:
                        if m != user_id:
                            await manager.send(m, {"type": "typing", "chat_id": chat_id, "user_id": user_id, "is_typing": bool(data.get("is_typing"))})
            elif t == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
    except WebSocketDisconnect:
        await manager.disconnect(user_id, websocket)
    except Exception as e:
        logger.exception("ws error: %s", e)
        await manager.disconnect(user_id, websocket)


# ============= Startup =============
@app.on_event("startup")
async def on_startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("user_id", unique=True)
    await db.user_sessions.create_index("session_token", unique=True)
    await db.user_sessions.create_index("user_id")
    await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
    await db.chats.create_index("chat_id", unique=True)
    await db.chats.create_index("members")
    await db.messages.create_index("chat_id")
    await db.messages.create_index("message_id", unique=True)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()


@api_router.get("/")
async def root():
    return {"message": "Bubble API"}


app.include_router(api_router)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
