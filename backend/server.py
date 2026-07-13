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
    voice: Optional[str] = None  # base64 audio data URL
    voice_duration: Optional[int] = None  # seconds
    file: Optional[Dict] = None  # {name, mime, data_b64, size}
    contact: Optional[Dict] = None  # {name, phone, email}
    reply_to: Optional[str] = None  # message_id of the message being replied to
    ciphertext: Optional[str] = None
    nonce: Optional[str] = None
    encrypted: bool = False
    client_id: Optional[str] = None


class EditMessageBody(BaseModel):
    text: str


class UpdateProfileBody(BaseModel):
    name: Optional[str] = None
    picture: Optional[str] = None


class ReactionBody(BaseModel):
    emoji: str


class PublicKeyBody(BaseModel):
    public_key: str  # base64-encoded X25519 public key


class ChatEncryptionBody(BaseModel):
    encrypted: bool


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
        "public_key": u.get("public_key"),
    }


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
            "encrypted": bool(c.get("encrypted", False)),
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
    if not body.text and not body.image and not body.voice and not body.file and not body.contact and not body.ciphertext:
        raise HTTPException(status_code=400, detail="Empty message")

    msg = {
        "message_id": f"msg_{uuid.uuid4().hex[:12]}",
        "chat_id": body.chat_id,
        "sender_id": user["user_id"],
        "text": body.text,
        "image": body.image,
        "voice": body.voice,
        "voice_duration": body.voice_duration,
        "file": body.file,
        "contact": body.contact,
        "reply_to": body.reply_to,
        "ciphertext": body.ciphertext,
        "nonce": body.nonce,
        "encrypted": body.encrypted,
        "reactions": {},
        "created_at": now_utc(),
        "read_by": [user["user_id"]],
        "client_id": body.client_id,
    }
    await db.messages.insert_one(msg.copy())
    msg.pop("_id", None)

    if body.encrypted:
        preview = "🔒 Encrypted message"
    elif body.voice:
        preview = "🎤 Voice message"
    elif body.file:
        preview = f"📎 {body.file.get('name', 'File')}"
    elif body.contact:
        preview = f"👤 {body.contact.get('name', 'Contact')}"
    elif body.image and not body.text:
        preview = "📷 Photo"
    else:
        preview = body.text or ""
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


@api_router.patch("/messages/{message_id}")
async def edit_message(message_id: str, body: EditMessageBody, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    msg = await db.messages.find_one({"message_id": message_id}, {"_id": 0})
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    if msg["sender_id"] != user["user_id"]:
        raise HTTPException(status_code=403, detail="Can only edit your own messages")
    new_text = (body.text or "").strip()
    if not new_text:
        raise HTTPException(status_code=400, detail="Empty text")
    await db.messages.update_one(
        {"message_id": message_id},
        {"$set": {"text": new_text, "edited_at": now_utc()}},
    )
    updated = await db.messages.find_one({"message_id": message_id}, {"_id": 0})
    chat = await db.chats.find_one({"chat_id": msg["chat_id"]}, {"_id": 0})
    # bump preview if this was the last message
    if chat and chat.get("last_sender_id") == user["user_id"]:
        last = await db.messages.find({"chat_id": msg["chat_id"]}, {"_id": 0}).sort("created_at", -1).limit(1).to_list(1)
        if last and last[0]["message_id"] == message_id:
            preview = "📷 Photo" if updated.get("image") and not updated.get("text") else (updated.get("text") or "")
            await db.chats.update_one({"chat_id": msg["chat_id"]}, {"$set": {"last_message": preview[:200]}})
    if chat:
        await manager.broadcast_to_chat(chat["members"], {
            "type": "message_updated",
            "chat_id": msg["chat_id"],
            "message": _serialize_msg(updated),
        })
    return _serialize_msg(updated)


@api_router.delete("/messages/{message_id}")
async def delete_message(message_id: str, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    msg = await db.messages.find_one({"message_id": message_id}, {"_id": 0})
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    if msg["sender_id"] != user["user_id"]:
        raise HTTPException(status_code=403, detail="Can only delete your own messages")
    await db.messages.delete_one({"message_id": message_id})
    chat = await db.chats.find_one({"chat_id": msg["chat_id"]}, {"_id": 0})
    # re-compute chat preview from latest remaining message
    if chat:
        latest = await db.messages.find({"chat_id": msg["chat_id"]}, {"_id": 0}).sort("created_at", -1).limit(1).to_list(1)
        if latest:
            m = latest[0]
            preview = "📷 Photo" if m.get("image") and not m.get("text") else (m.get("text") or "")
            await db.chats.update_one({"chat_id": msg["chat_id"]}, {"$set": {"last_message": preview[:200], "last_message_at": m["created_at"], "last_sender_id": m["sender_id"]}})
        else:
            await db.chats.update_one({"chat_id": msg["chat_id"]}, {"$set": {"last_message": None, "last_sender_id": None}})
        await manager.broadcast_to_chat(chat["members"], {
            "type": "message_deleted",
            "chat_id": msg["chat_id"],
            "message_id": message_id,
        })
    return {"ok": True}


@api_router.delete("/chats/{chat_id}")
async def delete_chat(chat_id: str, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    chat = await db.chats.find_one({"chat_id": chat_id, "members": user["user_id"]}, {"_id": 0})
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    members = list(chat["members"])
    remaining = [m for m in members if m != user["user_id"]]
    if len(remaining) <= 1 or not chat.get("is_group"):
        # 1-on-1 or last-member group: fully delete chat + messages
        await db.messages.delete_many({"chat_id": chat_id})
        await db.chats.delete_one({"chat_id": chat_id})
    else:
        # group with others still in: just leave
        await db.chats.update_one({"chat_id": chat_id}, {"$set": {"members": remaining}})
    await manager.broadcast_to_chat(members, {
        "type": "chat_deleted",
        "chat_id": chat_id,
        "by": user["user_id"],
    })
    return {"ok": True}


@api_router.patch("/me")
async def update_me(body: UpdateProfileBody, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    patch: dict = {}
    if body.name is not None:
        n = body.name.strip()
        if n:
            patch["name"] = n[:80]
    if body.picture is not None:
        patch["picture"] = body.picture
    if patch:
        await db.users.update_one({"user_id": user["user_id"]}, {"$set": patch})
    updated = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    chats = await db.chats.find({"members": user["user_id"]}, {"_id": 0, "members": 1}).to_list(500)
    contacts: set = set()
    for c in chats:
        for m in c["members"]:
            if m != user["user_id"]:
                contacts.add(m)
    for uid in contacts:
        await manager.send(uid, {"type": "profile_updated", "user": _clean_user(updated)})
    return _clean_user(updated)


# ============= Reactions =============
@api_router.post("/messages/{message_id}/reactions")
async def toggle_reaction(message_id: str, body: ReactionBody, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    msg = await db.messages.find_one({"message_id": message_id}, {"_id": 0})
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    chat = await db.chats.find_one({"chat_id": msg["chat_id"], "members": user["user_id"]}, {"_id": 0})
    if not chat:
        raise HTTPException(status_code=403, detail="Not a member of this chat")
    emoji = (body.emoji or "").strip()
    if not emoji or len(emoji) > 8:
        raise HTTPException(status_code=400, detail="Invalid emoji")
    reactions = dict(msg.get("reactions") or {})
    users_for_emoji = list(reactions.get(emoji, []))
    if user["user_id"] in users_for_emoji:
        users_for_emoji.remove(user["user_id"])
    else:
        users_for_emoji.append(user["user_id"])
    if users_for_emoji:
        reactions[emoji] = users_for_emoji
    else:
        reactions.pop(emoji, None)
    await db.messages.update_one({"message_id": message_id}, {"$set": {"reactions": reactions}})
    await manager.broadcast_to_chat(chat["members"], {
        "type": "message_reaction",
        "chat_id": msg["chat_id"],
        "message_id": message_id,
        "reactions": reactions,
    })
    return {"reactions": reactions}


# ============= E2EE key exchange =============
@api_router.post("/keys")
async def upload_public_key(body: PublicKeyBody, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"public_key": body.public_key}})
    return {"ok": True}


@api_router.get("/users/{user_id}/key")
async def get_public_key(user_id: str, authorization: Optional[str] = Header(None)):
    await get_current_user(authorization)
    u = await db.users.find_one({"user_id": user_id}, {"_id": 0, "public_key": 1, "user_id": 1})
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    return {"user_id": user_id, "public_key": u.get("public_key")}


@api_router.patch("/chats/{chat_id}/encryption")
async def toggle_chat_encryption(chat_id: str, body: ChatEncryptionBody, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    chat = await db.chats.find_one({"chat_id": chat_id, "members": user["user_id"]}, {"_id": 0})
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    if chat.get("is_group"):
        raise HTTPException(status_code=400, detail="E2EE for groups is not supported yet")
    await db.chats.update_one({"chat_id": chat_id}, {"$set": {"encrypted": body.encrypted}})
    await manager.broadcast_to_chat(chat["members"], {
        "type": "chat_encryption",
        "chat_id": chat_id,
        "encrypted": body.encrypted,
        "by": user["user_id"],
    })
    return {"ok": True, "encrypted": body.encrypted}


@api_router.post("/chats/mark-all-read")
async def mark_all_read(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    chats = await db.chats.find({"members": user["user_id"]}, {"_id": 0, "chat_id": 1, "members": 1}).to_list(500)
    for c in chats:
        await db.messages.update_many(
            {"chat_id": c["chat_id"], "read_by": {"$ne": user["user_id"]}},
            {"$addToSet": {"read_by": user["user_id"]}},
        )
        await manager.broadcast_to_chat(c["members"], {
            "type": "read", "chat_id": c["chat_id"], "user_id": user["user_id"],
        })
    return {"ok": True, "count": len(chats)}


# ============= Meetings & Reminders =============
class MeetingCreate(BaseModel):
    title: str
    starts_at: str  # ISO datetime
    description: Optional[str] = None
    chat_id: Optional[str] = None  # optional - post to a chat


class ReminderCreate(BaseModel):
    title: str
    remind_at: str
    description: Optional[str] = None


@api_router.post("/meetings")
async def create_meeting(body: MeetingCreate, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    meeting = {
        "meeting_id": f"mtg_{uuid.uuid4().hex[:12]}",
        "title": body.title,
        "starts_at": body.starts_at,
        "description": body.description,
        "chat_id": body.chat_id,
        "owner_id": user["user_id"],
        "created_at": now_utc(),
    }
    await db.meetings.insert_one(meeting.copy())
    meeting.pop("_id", None)

    if body.chat_id:
        chat = await db.chats.find_one({"chat_id": body.chat_id, "members": user["user_id"]}, {"_id": 0})
        if chat:
            preview = f"📅 Meeting: {body.title}\n🕒 {body.starts_at}"
            if body.description:
                preview += f"\n📝 {body.description}"
            msg = {
                "message_id": f"msg_{uuid.uuid4().hex[:12]}",
                "chat_id": body.chat_id,
                "sender_id": user["user_id"],
                "text": preview,
                "image": None,
                "created_at": now_utc(),
                "read_by": [user["user_id"]],
            }
            await db.messages.insert_one(msg.copy())
            msg.pop("_id", None)
            await db.chats.update_one(
                {"chat_id": body.chat_id},
                {"$set": {"last_message": f"📅 Meeting: {body.title}", "last_message_at": now_utc(), "last_sender_id": user["user_id"]}},
            )
            await manager.broadcast_to_chat(chat["members"], {
                "type": "message", "chat_id": body.chat_id, "message": _serialize_msg(msg),
            })
    return meeting


@api_router.get("/meetings")
async def list_meetings(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    items = await db.meetings.find({"owner_id": user["user_id"]}, {"_id": 0}).sort("starts_at", 1).to_list(200)
    return items


@api_router.post("/reminders")
async def create_reminder(body: ReminderCreate, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    reminder = {
        "reminder_id": f"rem_{uuid.uuid4().hex[:12]}",
        "title": body.title,
        "remind_at": body.remind_at,
        "description": body.description,
        "owner_id": user["user_id"],
        "created_at": now_utc(),
    }
    await db.reminders.insert_one(reminder.copy())
    reminder.pop("_id", None)
    return reminder


@api_router.get("/reminders")
async def list_reminders(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    items = await db.reminders.find({"owner_id": user["user_id"]}, {"_id": 0}).sort("remind_at", 1).to_list(200)
    return items


def _serialize_msg(m: dict) -> dict:
    return {
        "message_id": m["message_id"],
        "chat_id": m["chat_id"],
        "sender_id": m["sender_id"],
        "text": m.get("text"),
        "image": m.get("image"),
        "voice": m.get("voice"),
        "voice_duration": m.get("voice_duration"),
        "file": m.get("file"),
        "contact": m.get("contact"),
        "reply_to": m.get("reply_to"),
        "ciphertext": m.get("ciphertext"),
        "nonce": m.get("nonce"),
        "encrypted": bool(m.get("encrypted")),
        "reactions": m.get("reactions", {}),
        "created_at": m["created_at"].isoformat() if isinstance(m["created_at"], datetime) else m["created_at"],
        "edited_at": m["edited_at"].isoformat() if isinstance(m.get("edited_at"), datetime) else m.get("edited_at"),
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
MOCK_USERS = [
    {"user_id": "mock_alice", "email": "alice@bubble.app", "name": "Alice Chen", "picture": "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&q=80"},
    {"user_id": "mock_bob", "email": "bob@bubble.app", "name": "Bob Martinez", "picture": "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&q=80"},
    {"user_id": "mock_sarah", "email": "sarah@bubble.app", "name": "Sarah Kim", "picture": "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=200&q=80"},
    {"user_id": "mock_david", "email": "david@bubble.app", "name": "David Park", "picture": "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=200&q=80"},
    {"user_id": "mock_emma", "email": "emma@bubble.app", "name": "Emma Wilson", "picture": "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=200&q=80"},
]


async def ensure_mock_users():
    for m in MOCK_USERS:
        await db.users.update_one(
            {"user_id": m["user_id"]},
            {"$setOnInsert": {**m, "online": False, "last_seen": now_utc(), "created_at": now_utc()}},
            upsert=True,
        )


async def seed_demo_chats_for(user_id: str):
    """Seed 4 rich chats for a given user, only if they don't exist yet."""
    existing = await db.chats.count_documents({"members": user_id, "demo": True})
    if existing > 0:
        return

    now = now_utc()

    def ago(minutes: int) -> datetime:
        return now - timedelta(minutes=minutes)

    # Chat 1: Alice - direct
    c1_id = f"chat_{uuid.uuid4().hex[:12]}"
    c1_msgs = [
        ("mock_alice", "Hey! How was your weekend? ☀️", 60 * 24 * 2),
        (user_id, "It was great, hiked the ridge trail!", 60 * 24 * 2 - 5),
        ("mock_alice", "No way, I've been wanting to do that", 60 * 24 * 2 - 8),
        ("mock_alice", "How long did it take?", 60 * 24 * 2 - 8),
        (user_id, "About 4 hours round trip", 60 * 24 * 2 - 10),
        (user_id, "Views were unreal 🏔️", 60 * 24 * 2 - 10),
        ("mock_alice", "Ok I'm in. This weekend?", 60 * 24 - 30),
        (user_id, "Saturday morning?", 60 * 24 - 20),
        ("mock_alice", "Perfect. 7am parking lot?", 15),
        ("mock_alice", "Bring water and snacks ✌️", 8),
    ]
    # Chat 2: Bob - work
    c2_id = f"chat_{uuid.uuid4().hex[:12]}"
    c2_msgs = [
        ("mock_bob", "Did you see the latest mock from the design team?", 60 * 5),
        (user_id, "Yeah, the coral is 🔥", 60 * 5 - 3),
        ("mock_bob", "Agreed. I think we ship Friday.", 60 * 5 - 5),
        ("mock_bob", "Can you review PR #482 when you get a sec?", 60 * 3),
        (user_id, "On it", 60 * 3 - 2),
        (user_id, "Left some comments, mostly nits", 60 * 2),
        ("mock_bob", "Thanks! Addressing them now", 45),
        ("mock_bob", "Merged 🚀", 3),
    ]
    # Chat 3: Weekend Trip group
    c3_id = f"chat_{uuid.uuid4().hex[:12]}"
    c3_msgs = [
        ("mock_sarah", "Ok trip fam, who's driving? 🚗", 60 * 24),
        ("mock_alice", "I can drive if we take my car", 60 * 24 - 5),
        ("mock_bob", "Sarah + Alice = pilots. I'll DJ", 60 * 24 - 10),
        (user_id, "🎧 emergency snack purchases only please", 60 * 24 - 12),
        ("mock_sarah", "Rented the cabin! 3 bedrooms, hot tub, mountain views", 60 * 8),
        ("mock_sarah", "$62/person for 3 nights", 60 * 8),
        ("mock_alice", "Steal ✨", 60 * 8 - 2),
        (user_id, "Venmo incoming", 60 * 8 - 3),
        ("mock_bob", "What time we heading out Friday?", 60 * 2),
        ("mock_sarah", "3pm from Alice's place", 60),
        ("mock_alice", "See you Friday 🥳", 20),
    ]
    # Chat 4: Family group
    c4_id = f"chat_{uuid.uuid4().hex[:12]}"
    c4_msgs = [
        ("mock_emma", "Sunday dinner at 6? Bringing lasagna 🍝", 60 * 24 * 3),
        ("mock_david", "Yes please!!", 60 * 24 * 3 - 15),
        (user_id, "I'll bring wine 🍷", 60 * 24 * 3 - 20),
        ("mock_emma", "Perfect", 60 * 24 * 3 - 25),
        ("mock_david", "Mom asked if you got her voicemail?", 60 * 24),
        (user_id, "Yes! Calling her tonight", 60 * 24 - 2),
        ("mock_emma", "She misses you 💕", 60 * 24 - 5),
        ("mock_david", "Btw did anyone see grandpa's photo album?", 60 * 6),
        ("mock_emma", "It's on the shelf in the living room I think", 60 * 6 - 3),
        (user_id, "I moved it upstairs, sorry! Will bring Sunday", 60 * 3),
        ("mock_emma", "You're the best 🌟", 30),
    ]

    chats_to_insert = [
        {"chat_id": c1_id, "is_group": False, "name": None,
         "members": [user_id, "mock_alice"], "msgs": c1_msgs},
        {"chat_id": c2_id, "is_group": False, "name": None,
         "members": [user_id, "mock_bob"], "msgs": c2_msgs},
        {"chat_id": c3_id, "is_group": True, "name": "Weekend Trip 🏖️",
         "members": [user_id, "mock_alice", "mock_bob", "mock_sarah"], "msgs": c3_msgs},
        {"chat_id": c4_id, "is_group": True, "name": "Family",
         "members": [user_id, "mock_david", "mock_emma"], "msgs": c4_msgs},
    ]

    for c in chats_to_insert:
        last_msg = c["msgs"][-1]
        last_at = ago(last_msg[2])
        await db.chats.insert_one({
            "chat_id": c["chat_id"], "is_group": c["is_group"], "name": c["name"],
            "members": c["members"], "created_by": user_id,
            "created_at": ago(60 * 24 * 5),
            "last_message": last_msg[1][:200], "last_message_at": last_at, "last_sender_id": last_msg[0],
            "demo": True,
        })
        for sender, text, mins_ago in c["msgs"]:
            await db.messages.insert_one({
                "message_id": f"msg_{uuid.uuid4().hex[:12]}",
                "chat_id": c["chat_id"], "sender_id": sender,
                "text": text, "image": None,
                "created_at": ago(mins_ago),
                "read_by": [sender] + ([user_id] if sender != user_id and mins_ago > 30 else []),
            })


@api_router.post("/demo-login")
async def demo_login():
    """Instantly log in as a fresh Demo User with pre-seeded chats. No OAuth needed."""
    await ensure_mock_users()
    demo_uid = f"demo_{uuid.uuid4().hex[:10]}"
    demo_email = f"{demo_uid}@bubble.app"
    await db.users.insert_one({
        "user_id": demo_uid,
        "email": demo_email,
        "name": "You (Demo)",
        "picture": None,
        "online": False,
        "last_seen": now_utc(),
        "created_at": now_utc(),
        "is_demo": True,
    })
    session_token = f"demo_{uuid.uuid4().hex}"
    await db.user_sessions.insert_one({
        "session_token": session_token,
        "user_id": demo_uid,
        "created_at": now_utc(),
        "expires_at": now_utc() + timedelta(days=1),
    })
    await seed_demo_chats_for(demo_uid)
    user = await db.users.find_one({"user_id": demo_uid}, {"_id": 0})
    return {"session_token": session_token, "user": _clean_user(user)}


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
    await ensure_mock_users()


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
