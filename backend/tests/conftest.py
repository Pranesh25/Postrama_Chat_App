"""Shared fixtures: seed two test users + sessions directly into MongoDB."""
import os
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

# Public base URL (from frontend/.env EXPO_PUBLIC_BACKEND_URL)
BASE_URL = "https://chat-kotlin-react.preview.emergentagent.com"


def _mk_user(mdb, tag: str):
    uid = f"user_TEST_{tag}_{uuid.uuid4().hex[:6]}"
    token = f"TEST_tok_{uuid.uuid4().hex}"
    now = datetime.now(timezone.utc)
    mdb.users.insert_one({
        "user_id": uid,
        "email": f"TEST_{tag}_{uid[-6:]}@example.com",
        "name": f"TEST User {tag}",
        "picture": None,
        "online": False,
        "last_seen": now,
        "created_at": now,
    })
    mdb.user_sessions.insert_one({
        "session_token": token,
        "user_id": uid,
        "created_at": now,
        "expires_at": now + timedelta(days=7),
    })
    return uid, token


@pytest.fixture(scope="session")
def mongo():
    c = MongoClient(MONGO_URL)
    yield c[DB_NAME]
    c.close()


@pytest.fixture(scope="session")
def seed(mongo):
    """Create two test users + sessions. Cleanup at end."""
    u1, t1 = _mk_user(mongo, "alice")
    u2, t2 = _mk_user(mongo, "bob")
    u3, t3 = _mk_user(mongo, "carol")
    data = {
        "u1": u1, "t1": t1,
        "u2": u2, "t2": t2,
        "u3": u3, "t3": t3,
    }
    yield data
    # Cleanup TEST_ data
    uids = [u1, u2, u3]
    mongo.users.delete_many({"user_id": {"$in": uids}})
    mongo.user_sessions.delete_many({"user_id": {"$in": uids}})
    chats = list(mongo.chats.find({"members": {"$in": uids}}, {"chat_id": 1}))
    cids = [c["chat_id"] for c in chats]
    mongo.chats.delete_many({"chat_id": {"$in": cids}})
    mongo.messages.delete_many({"chat_id": {"$in": cids}})


@pytest.fixture
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture
def base_url():
    return BASE_URL
