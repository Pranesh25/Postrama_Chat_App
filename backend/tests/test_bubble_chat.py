"""Bubble chat backend E2E: REST endpoints + WebSocket."""
import asyncio
import json
import pytest
import requests
import websockets


# ---------- Health ----------
def test_root(api, base_url):
    r = api.get(f"{base_url}/api/")
    assert r.status_code == 200
    assert r.json().get("message") == "Bubble API"


# ---------- Auth: /me + logout ----------
class TestAuth:
    def test_me_requires_bearer(self, api, base_url):
        r = api.get(f"{base_url}/api/me")
        assert r.status_code == 401

    def test_me_invalid_token(self, api, base_url):
        r = api.get(f"{base_url}/api/me", headers={"Authorization": "Bearer BOGUS"})
        assert r.status_code == 401

    def test_me_success(self, api, base_url, seed):
        r = api.get(f"{base_url}/api/me", headers={"Authorization": f"Bearer {seed['t1']}"})
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["user_id"] == seed["u1"]
        assert "_id" not in j
        assert "email" in j and "name" in j

    def test_logout_ok(self, api, base_url, mongo, seed):
        # create a throwaway session for u1
        from datetime import datetime, timezone, timedelta
        import uuid
        tok = f"TEST_logout_{uuid.uuid4().hex}"
        mongo.user_sessions.insert_one({
            "session_token": tok, "user_id": seed["u1"],
            "created_at": datetime.now(timezone.utc),
            "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
        })
        r = api.post(f"{base_url}/api/auth/logout", headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 200 and r.json()["ok"] is True
        # after logout, using the token should 401
        r2 = api.get(f"{base_url}/api/me", headers={"Authorization": f"Bearer {tok}"})
        assert r2.status_code == 401

    def test_auth_session_bad_id(self, api, base_url):
        # Emergent lookup will fail for bogus session id -> 401
        r = api.post(f"{base_url}/api/auth/session", json={"session_id": "TEST_bogus"})
        assert r.status_code == 401


# ---------- Users search ----------
class TestUsers:
    def test_search_requires_auth(self, api, base_url):
        r = api.get(f"{base_url}/api/users/search?q=alice")
        assert r.status_code == 401

    def test_search_by_name(self, api, base_url, seed):
        r = api.get(f"{base_url}/api/users/search?q=bob",
                    headers={"Authorization": f"Bearer {seed['t1']}"})
        assert r.status_code == 200
        arr = r.json()
        assert isinstance(arr, list)
        emails = [u["email"] for u in arr]
        assert any("bob" in e for e in emails)
        # excludes self
        assert all(u["user_id"] != seed["u1"] for u in arr)
        # no _id leaks
        for u in arr:
            assert "_id" not in u


# ---------- Chats CRUD ----------
class TestChats:
    def test_create_1on1_and_reuse(self, api, base_url, seed):
        h = {"Authorization": f"Bearer {seed['t1']}"}
        r = api.post(f"{base_url}/api/chats", json={"member_ids": [seed["u2"]], "is_group": False}, headers=h)
        assert r.status_code == 200, r.text
        c1 = r.json()
        assert c1["is_group"] is False
        assert set(c1["members"]) == {seed["u1"], seed["u2"]}
        assert "_id" not in c1

        # calling again should return the SAME chat (reuse)
        r2 = api.post(f"{base_url}/api/chats", json={"member_ids": [seed["u2"]], "is_group": False}, headers=h)
        assert r2.status_code == 200
        assert r2.json()["chat_id"] == c1["chat_id"]

    def test_create_group(self, api, base_url, seed):
        h = {"Authorization": f"Bearer {seed['t1']}"}
        r = api.post(f"{base_url}/api/chats",
                     json={"member_ids": [seed["u2"], seed["u3"]], "is_group": True, "name": "TEST Group"},
                     headers=h)
        assert r.status_code == 200
        c = r.json()
        assert c["is_group"] is True
        assert c["name"] == "TEST Group"
        assert set(c["members"]) == {seed["u1"], seed["u2"], seed["u3"]}

    def test_list_chats(self, api, base_url, seed):
        # ensure at least one chat
        h = {"Authorization": f"Bearer {seed['t1']}"}
        api.post(f"{base_url}/api/chats", json={"member_ids": [seed["u2"]], "is_group": False}, headers=h)
        r = api.get(f"{base_url}/api/chats", headers=h)
        assert r.status_code == 200
        chats = r.json()
        assert isinstance(chats, list) and len(chats) >= 1
        for c in chats:
            assert "_id" not in c
            assert "unread" in c
            # members should be enriched to user objects
            assert isinstance(c["members"], list) and "user_id" in c["members"][0]
            for m in c["members"]:
                assert "_id" not in m


# ---------- Messages ----------
class TestMessages:
    @pytest.fixture
    def chat(self, api, base_url, seed):
        h = {"Authorization": f"Bearer {seed['t1']}"}
        r = api.post(f"{base_url}/api/chats", json={"member_ids": [seed["u2"]], "is_group": False}, headers=h)
        return r.json()

    def test_send_text_and_fetch(self, api, base_url, seed, chat):
        h1 = {"Authorization": f"Bearer {seed['t1']}"}
        r = api.post(f"{base_url}/api/messages",
                     json={"chat_id": chat["chat_id"], "text": "hello TEST", "client_id": "c1"},
                     headers=h1)
        assert r.status_code == 200, r.text
        m = r.json()
        assert m["text"] == "hello TEST"
        assert m["sender_id"] == seed["u1"]
        assert "_id" not in m
        # get messages as recipient
        h2 = {"Authorization": f"Bearer {seed['t2']}"}
        r2 = api.get(f"{base_url}/api/chats/{chat['chat_id']}/messages", headers=h2)
        assert r2.status_code == 200
        msgs = r2.json()
        assert any(x["text"] == "hello TEST" for x in msgs)
        for x in msgs:
            assert "_id" not in x

    def test_send_image(self, api, base_url, seed, chat):
        h1 = {"Authorization": f"Bearer {seed['t1']}"}
        img_b64 = "data:image/png;base64,iVBORw0KGgo="
        r = api.post(f"{base_url}/api/messages",
                     json={"chat_id": chat["chat_id"], "image": img_b64},
                     headers=h1)
        assert r.status_code == 200
        assert r.json()["image"] == img_b64

    def test_send_empty_rejected(self, api, base_url, seed, chat):
        h1 = {"Authorization": f"Bearer {seed['t1']}"}
        r = api.post(f"{base_url}/api/messages",
                     json={"chat_id": chat["chat_id"]}, headers=h1)
        assert r.status_code == 400

    def test_send_to_foreign_chat(self, api, base_url, seed, chat):
        # u3 is NOT a member -> 404
        h3 = {"Authorization": f"Bearer {seed['t3']}"}
        r = api.post(f"{base_url}/api/messages",
                     json={"chat_id": chat["chat_id"], "text": "hi"}, headers=h3)
        assert r.status_code == 404

    def test_messages_ordering(self, api, base_url, seed, chat):
        h1 = {"Authorization": f"Bearer {seed['t1']}"}
        for i in range(3):
            api.post(f"{base_url}/api/messages",
                     json={"chat_id": chat["chat_id"], "text": f"ord {i}"}, headers=h1)
        r = api.get(f"{base_url}/api/chats/{chat['chat_id']}/messages", headers=h1)
        arr = r.json()
        ts = [x["created_at"] for x in arr]
        assert ts == sorted(ts), "messages must be sorted by created_at ascending"

    def test_read_marks_and_unread(self, api, base_url, seed, chat):
        h1 = {"Authorization": f"Bearer {seed['t1']}"}
        h2 = {"Authorization": f"Bearer {seed['t2']}"}
        api.post(f"{base_url}/api/messages",
                 json={"chat_id": chat["chat_id"], "text": "unread ping"}, headers=h1)
        # unread for u2 should be > 0
        cl = api.get(f"{base_url}/api/chats", headers=h2).json()
        this = [c for c in cl if c["chat_id"] == chat["chat_id"]][0]
        assert this["unread"] >= 1
        # mark read
        r = api.post(f"{base_url}/api/chats/{chat['chat_id']}/read", headers=h2)
        assert r.status_code == 200
        cl2 = api.get(f"{base_url}/api/chats", headers=h2).json()
        this2 = [c for c in cl2 if c["chat_id"] == chat["chat_id"]][0]
        assert this2["unread"] == 0


# ---------- WebSocket ----------
def _ws_url(base_url: str, token: str) -> str:
    return base_url.replace("https://", "wss://").replace("http://", "ws://") + f"/api/ws?token={token}"


class TestWebSocket:
    def test_ws_unauthorized_close(self, base_url):
        async def run():
            url = _ws_url(base_url, "BOGUS_TOKEN")
            try:
                async with websockets.connect(url) as ws:
                    await ws.recv()
                return None
            except websockets.exceptions.InvalidStatus as e:
                # HTTP-level reject (e.g. 401/403) before upgrade
                return ("http", e.response.status_code)
            except websockets.exceptions.ConnectionClosed as e:
                return ("close", e.code)
        result = asyncio.run(run())
        assert result is not None, "expected ws to be rejected"
        kind, code = result
        # Backend closes with 4401 after accept; ingress may translate. Accept either 4401 or HTTP 401/403.
        assert code in (4401, 401, 403), f"unexpected reject: {result}"

    def test_ws_message_and_typing_events(self, base_url, seed, api):
        # Ensure chat exists between u1 and u2
        h1 = {"Authorization": f"Bearer {seed['t1']}"}
        chat = api.post(f"{base_url}/api/chats",
                        json={"member_ids": [seed["u2"]], "is_group": False},
                        headers=h1).json()
        chat_id = chat["chat_id"]

        async def run():
            url2 = _ws_url(base_url, seed["t2"])
            url1 = _ws_url(base_url, seed["t1"])
            async with websockets.connect(url2) as ws2, websockets.connect(url1) as ws1:
                # let connect complete
                await asyncio.sleep(0.5)

                # 1) u1 sends message via REST -> u2 should receive ws "message"
                api.post(f"{base_url}/api/messages",
                         json={"chat_id": chat_id, "text": "WS TEST"}, headers=h1)

                got_msg = None
                got_typing = None
                # collect events for up to 4s
                async def collect():
                    nonlocal got_msg, got_typing
                    while got_msg is None or got_typing is None:
                        raw = await ws2.recv()
                        data = json.loads(raw)
                        if data.get("type") == "message" and data.get("chat_id") == chat_id:
                            got_msg = data
                        elif data.get("type") == "typing" and data.get("chat_id") == chat_id:
                            got_typing = data
                # send typing from u1
                await ws1.send(json.dumps({"type": "typing", "chat_id": chat_id, "is_typing": True}))
                try:
                    await asyncio.wait_for(collect(), timeout=6)
                except asyncio.TimeoutError:
                    pass
                return got_msg, got_typing

        msg_evt, typing_evt = asyncio.run(run())
        assert msg_evt is not None, "did not receive ws message event"
        assert msg_evt["message"]["text"] == "WS TEST"
        assert typing_evt is not None, "did not receive ws typing event"
        assert typing_evt["is_typing"] is True
        assert typing_evt["user_id"] == seed["u1"]

    def test_ws_presence_updates_db(self, base_url, seed, mongo):
        async def run():
            url = _ws_url(base_url, seed["t3"])
            async with websockets.connect(url) as ws:
                await asyncio.sleep(0.8)
                # ping/pong sanity
                await ws.send(json.dumps({"type": "ping"}))
                pong = await asyncio.wait_for(ws.recv(), timeout=3)
                assert json.loads(pong)["type"] == "pong"
                online = mongo.users.find_one({"user_id": seed["u3"]}, {"_id": 0, "online": 1})["online"]
                assert online is True
            await asyncio.sleep(0.8)
            offline = mongo.users.find_one({"user_id": seed["u3"]}, {"_id": 0, "online": 1})["online"]
            assert offline is False

        asyncio.run(run())
