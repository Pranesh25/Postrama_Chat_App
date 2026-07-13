"""Iteration 3: message edit/delete, chat delete, profile update + WS broadcasts."""
import asyncio
import json
import uuid
from datetime import datetime, timezone, timedelta

import pytest
import websockets


def _ws_url(base_url: str, token: str) -> str:
    return base_url.replace("https://", "wss://").replace("http://", "ws://") + f"/api/ws?token={token}"


# ---------- PATCH /api/messages/{id} ----------
class TestEditMessage:
    @pytest.fixture
    def chat_and_msg(self, api, base_url, seed):
        h1 = {"Authorization": f"Bearer {seed['t1']}"}
        chat = api.post(f"{base_url}/api/chats",
                        json={"member_ids": [seed["u2"]], "is_group": False}, headers=h1).json()
        m = api.post(f"{base_url}/api/messages",
                     json={"chat_id": chat["chat_id"], "text": "original TEST"}, headers=h1).json()
        return chat, m

    def test_edit_requires_auth(self, api, base_url, chat_and_msg):
        _, m = chat_and_msg
        r = api.patch(f"{base_url}/api/messages/{m['message_id']}", json={"text": "no"})
        assert r.status_code == 401

    def test_edit_by_sender_success(self, api, base_url, seed, chat_and_msg):
        _, m = chat_and_msg
        h1 = {"Authorization": f"Bearer {seed['t1']}"}
        r = api.patch(f"{base_url}/api/messages/{m['message_id']}",
                      json={"text": "edited TEST"}, headers=h1)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["text"] == "edited TEST"
        assert j["edited_at"] is not None
        assert j["message_id"] == m["message_id"]
        assert "_id" not in j
        # regression: baseline msg fetch also exposes edited_at
        msgs = api.get(f"{base_url}/api/chats/{j['chat_id']}/messages", headers=h1).json()
        target = next(x for x in msgs if x["message_id"] == m["message_id"])
        assert target["text"] == "edited TEST"
        assert target["edited_at"] is not None

    def test_edit_by_non_sender_forbidden(self, api, base_url, seed, chat_and_msg):
        _, m = chat_and_msg
        h2 = {"Authorization": f"Bearer {seed['t2']}"}
        r = api.patch(f"{base_url}/api/messages/{m['message_id']}",
                      json={"text": "hack"}, headers=h2)
        assert r.status_code == 403

    def test_edit_empty_rejected(self, api, base_url, seed, chat_and_msg):
        _, m = chat_and_msg
        h1 = {"Authorization": f"Bearer {seed['t1']}"}
        r = api.patch(f"{base_url}/api/messages/{m['message_id']}",
                      json={"text": "   "}, headers=h1)
        assert r.status_code == 400

    def test_edit_not_found(self, api, base_url, seed):
        h1 = {"Authorization": f"Bearer {seed['t1']}"}
        r = api.patch(f"{base_url}/api/messages/msg_doesnotexist",
                      json={"text": "x"}, headers=h1)
        assert r.status_code == 404

    def test_edit_last_msg_updates_chat_preview(self, api, base_url, seed, chat_and_msg):
        chat, m = chat_and_msg
        h1 = {"Authorization": f"Bearer {seed['t1']}"}
        # ensure this is the last message: fetch chat list & confirm preview
        api.patch(f"{base_url}/api/messages/{m['message_id']}",
                  json={"text": "preview-check TEST"}, headers=h1)
        chats = api.get(f"{base_url}/api/chats", headers=h1).json()
        target = next(c for c in chats if c["chat_id"] == chat["chat_id"])
        assert target["last_message"] == "preview-check TEST"


# ---------- DELETE /api/messages/{id} ----------
class TestDeleteMessage:
    def test_delete_requires_auth(self, api, base_url):
        r = api.delete(f"{base_url}/api/messages/msg_x")
        assert r.status_code == 401

    def test_delete_by_non_sender_forbidden(self, api, base_url, seed):
        h1 = {"Authorization": f"Bearer {seed['t1']}"}
        h2 = {"Authorization": f"Bearer {seed['t2']}"}
        chat = api.post(f"{base_url}/api/chats",
                        json={"member_ids": [seed["u2"]], "is_group": False}, headers=h1).json()
        m = api.post(f"{base_url}/api/messages",
                     json={"chat_id": chat["chat_id"], "text": "mine TEST"}, headers=h1).json()
        r = api.delete(f"{base_url}/api/messages/{m['message_id']}", headers=h2)
        assert r.status_code == 403
        # still exists
        got = api.get(f"{base_url}/api/chats/{chat['chat_id']}/messages", headers=h1).json()
        assert any(x["message_id"] == m["message_id"] for x in got)

    def test_delete_success_removes_message(self, api, base_url, seed):
        h1 = {"Authorization": f"Bearer {seed['t1']}"}
        chat = api.post(f"{base_url}/api/chats",
                        json={"member_ids": [seed["u2"]], "is_group": False}, headers=h1).json()
        m = api.post(f"{base_url}/api/messages",
                     json={"chat_id": chat["chat_id"], "text": "to-delete TEST"}, headers=h1).json()
        r = api.delete(f"{base_url}/api/messages/{m['message_id']}", headers=h1)
        assert r.status_code == 200 and r.json()["ok"] is True
        got = api.get(f"{base_url}/api/chats/{chat['chat_id']}/messages", headers=h1).json()
        assert not any(x["message_id"] == m["message_id"] for x in got)

    def test_delete_recomputes_preview_from_prior(self, api, base_url, seed):
        h1 = {"Authorization": f"Bearer {seed['t1']}"}
        chat = api.post(f"{base_url}/api/chats",
                        json={"member_ids": [seed["u2"]], "is_group": False}, headers=h1).json()
        api.post(f"{base_url}/api/messages",
                 json={"chat_id": chat["chat_id"], "text": "first TEST"}, headers=h1)
        m2 = api.post(f"{base_url}/api/messages",
                      json={"chat_id": chat["chat_id"], "text": "last TEST"}, headers=h1).json()
        # delete last -> preview should fall back to "first TEST"
        api.delete(f"{base_url}/api/messages/{m2['message_id']}", headers=h1)
        chats = api.get(f"{base_url}/api/chats", headers=h1).json()
        target = next(c for c in chats if c["chat_id"] == chat["chat_id"])
        assert target["last_message"] == "first TEST"
        assert target["last_sender_id"] == seed["u1"]

    def test_delete_only_msg_nulls_preview(self, api, base_url, seed):
        h1 = {"Authorization": f"Bearer {seed['t1']}"}
        # Fresh chat with u3 to avoid interference
        chat = api.post(f"{base_url}/api/chats",
                        json={"member_ids": [seed["u3"]], "is_group": False}, headers=h1).json()
        m = api.post(f"{base_url}/api/messages",
                     json={"chat_id": chat["chat_id"], "text": "solo TEST"}, headers=h1).json()
        api.delete(f"{base_url}/api/messages/{m['message_id']}", headers=h1)
        chats = api.get(f"{base_url}/api/chats", headers=h1).json()
        target = next(c for c in chats if c["chat_id"] == chat["chat_id"])
        assert target["last_message"] is None
        assert target["last_sender_id"] is None


# ---------- DELETE /api/chats/{id} ----------
class TestDeleteChat:
    def test_delete_requires_auth(self, api, base_url):
        r = api.delete(f"{base_url}/api/chats/chat_x")
        assert r.status_code == 401

    def test_delete_non_member_404(self, api, base_url, seed):
        h1 = {"Authorization": f"Bearer {seed['t1']}"}
        h3 = {"Authorization": f"Bearer {seed['t3']}"}
        chat = api.post(f"{base_url}/api/chats",
                        json={"member_ids": [seed["u2"]], "is_group": False}, headers=h1).json()
        r = api.delete(f"{base_url}/api/chats/{chat['chat_id']}", headers=h3)
        assert r.status_code == 404

    def test_delete_1on1_full_delete(self, api, base_url, seed, mongo):
        h1 = {"Authorization": f"Bearer {seed['t1']}"}
        chat = api.post(f"{base_url}/api/chats",
                        json={"member_ids": [seed["u2"]], "is_group": False}, headers=h1).json()
        api.post(f"{base_url}/api/messages",
                 json={"chat_id": chat["chat_id"], "text": "will die TEST"}, headers=h1)
        r = api.delete(f"{base_url}/api/chats/{chat['chat_id']}", headers=h1)
        assert r.status_code == 200 and r.json()["ok"] is True
        # DB: chat gone + messages gone
        assert mongo.chats.find_one({"chat_id": chat["chat_id"]}) is None
        assert mongo.messages.count_documents({"chat_id": chat["chat_id"]}) == 0
        # non-member (u2) can no longer see
        h2 = {"Authorization": f"Bearer {seed['t2']}"}
        chats2 = api.get(f"{base_url}/api/chats", headers=h2).json()
        assert not any(c["chat_id"] == chat["chat_id"] for c in chats2)

    def test_delete_group_leaves_when_others_remain(self, api, base_url, seed, mongo):
        h1 = {"Authorization": f"Bearer {seed['t1']}"}
        r = api.post(f"{base_url}/api/chats",
                     json={"member_ids": [seed["u2"], seed["u3"]],
                           "is_group": True, "name": "TEST Grp Leave"}, headers=h1)
        chat = r.json()
        # u1 sends msg then leaves
        api.post(f"{base_url}/api/messages",
                 json={"chat_id": chat["chat_id"], "text": "before leave"}, headers=h1)
        r = api.delete(f"{base_url}/api/chats/{chat['chat_id']}", headers=h1)
        assert r.status_code == 200
        # chat still exists; u1 removed; u2/u3 remain; messages retained
        cdoc = mongo.chats.find_one({"chat_id": chat["chat_id"]}, {"_id": 0})
        assert cdoc is not None
        assert seed["u1"] not in cdoc["members"]
        assert set(cdoc["members"]) == {seed["u2"], seed["u3"]}
        assert mongo.messages.count_documents({"chat_id": chat["chat_id"]}) >= 1
        # u1 no longer sees it in list
        chats1 = api.get(f"{base_url}/api/chats", headers=h1).json()
        assert not any(c["chat_id"] == chat["chat_id"] for c in chats1)
        # u2 still sees it
        h2 = {"Authorization": f"Bearer {seed['t2']}"}
        chats2 = api.get(f"{base_url}/api/chats", headers=h2).json()
        assert any(c["chat_id"] == chat["chat_id"] for c in chats2)

    def test_delete_group_last_member_full_delete(self, api, base_url, seed, mongo):
        # Group with only u1 + u2. When one leaves, remaining <=1 => full delete.
        h1 = {"Authorization": f"Bearer {seed['t1']}"}
        r = api.post(f"{base_url}/api/chats",
                     json={"member_ids": [seed["u2"]], "is_group": True, "name": "TEST 2p grp"},
                     headers=h1)
        chat = r.json()
        api.post(f"{base_url}/api/messages",
                 json={"chat_id": chat["chat_id"], "text": "grp msg"}, headers=h1)
        r = api.delete(f"{base_url}/api/chats/{chat['chat_id']}", headers=h1)
        assert r.status_code == 200
        assert mongo.chats.find_one({"chat_id": chat["chat_id"]}) is None
        assert mongo.messages.count_documents({"chat_id": chat["chat_id"]}) == 0


# ---------- PATCH /api/me ----------
class TestUpdateMe:
    def test_patch_me_requires_auth(self, api, base_url):
        r = api.patch(f"{base_url}/api/me", json={"name": "x"})
        assert r.status_code == 401

    def test_patch_name(self, api, base_url, seed):
        h = {"Authorization": f"Bearer {seed['t1']}"}
        new_name = f"TEST Updated {uuid.uuid4().hex[:6]}"
        r = api.patch(f"{base_url}/api/me", json={"name": new_name}, headers=h)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["name"] == new_name
        assert j["user_id"] == seed["u1"]
        assert "_id" not in j
        # verify via GET /me
        me = api.get(f"{base_url}/api/me", headers=h).json()
        assert me["name"] == new_name

    def test_patch_picture(self, api, base_url, seed):
        h = {"Authorization": f"Bearer {seed['t1']}"}
        pic = "data:image/png;base64,iVBORw0KGgoAAAANS="
        r = api.patch(f"{base_url}/api/me", json={"picture": pic}, headers=h)
        assert r.status_code == 200
        assert r.json()["picture"] == pic

    def test_patch_name_trimmed_and_capped(self, api, base_url, seed):
        h = {"Authorization": f"Bearer {seed['t1']}"}
        long_name = "TEST " + "x" * 200
        r = api.patch(f"{base_url}/api/me", json={"name": long_name}, headers=h)
        assert r.status_code == 200
        assert len(r.json()["name"]) <= 80

    def test_patch_empty_name_ignored(self, api, base_url, seed):
        h = {"Authorization": f"Bearer {seed['t1']}"}
        before = api.get(f"{base_url}/api/me", headers=h).json()["name"]
        r = api.patch(f"{base_url}/api/me", json={"name": "   "}, headers=h)
        assert r.status_code == 200
        assert r.json()["name"] == before


# ---------- WebSocket broadcasts for new endpoints ----------
class TestNewEndpointBroadcasts:
    def test_ws_message_updated_and_deleted(self, api, base_url, seed):
        h1 = {"Authorization": f"Bearer {seed['t1']}"}
        chat = api.post(f"{base_url}/api/chats",
                        json={"member_ids": [seed["u2"]], "is_group": False}, headers=h1).json()
        chat_id = chat["chat_id"]

        async def run():
            u2_url = _ws_url(base_url, seed["t2"])
            async with websockets.connect(u2_url) as ws2:
                await asyncio.sleep(0.5)
                # send a message
                m = api.post(f"{base_url}/api/messages",
                             json={"chat_id": chat_id, "text": "before edit"},
                             headers=h1).json()
                # edit it
                api.patch(f"{base_url}/api/messages/{m['message_id']}",
                          json={"text": "after edit"}, headers=h1)
                # delete it
                api.delete(f"{base_url}/api/messages/{m['message_id']}", headers=h1)

                got_upd, got_del = None, None

                async def collect():
                    nonlocal got_upd, got_del
                    while got_upd is None or got_del is None:
                        raw = await ws2.recv()
                        data = json.loads(raw)
                        if data.get("type") == "message_updated" and data.get("chat_id") == chat_id:
                            got_upd = data
                        elif data.get("type") == "message_deleted" and data.get("chat_id") == chat_id:
                            got_del = data
                try:
                    await asyncio.wait_for(collect(), timeout=8)
                except asyncio.TimeoutError:
                    pass
                return got_upd, got_del, m["message_id"]

        upd, deld, mid = asyncio.run(run())
        assert upd is not None, "expected 'message_updated' ws event"
        assert upd["message"]["text"] == "after edit"
        assert upd["message"]["edited_at"] is not None
        assert deld is not None, "expected 'message_deleted' ws event"
        assert deld["message_id"] == mid

    def test_ws_chat_deleted_broadcast(self, api, base_url, seed):
        h1 = {"Authorization": f"Bearer {seed['t1']}"}
        chat = api.post(f"{base_url}/api/chats",
                        json={"member_ids": [seed["u2"]], "is_group": False}, headers=h1).json()
        chat_id = chat["chat_id"]

        async def run():
            u2_url = _ws_url(base_url, seed["t2"])
            async with websockets.connect(u2_url) as ws2:
                await asyncio.sleep(0.5)
                api.delete(f"{base_url}/api/chats/{chat_id}", headers=h1)
                got = None

                async def collect():
                    nonlocal got
                    while got is None:
                        raw = await ws2.recv()
                        data = json.loads(raw)
                        if data.get("type") == "chat_deleted" and data.get("chat_id") == chat_id:
                            got = data
                try:
                    await asyncio.wait_for(collect(), timeout=6)
                except asyncio.TimeoutError:
                    pass
                return got

        evt = asyncio.run(run())
        assert evt is not None, "expected 'chat_deleted' ws event"
        assert evt["by"] == seed["u1"]

    def test_ws_profile_updated_broadcast(self, api, base_url, seed):
        # Ensure u1 and u2 share a chat so u2 is a "contact"
        h1 = {"Authorization": f"Bearer {seed['t1']}"}
        api.post(f"{base_url}/api/chats",
                 json={"member_ids": [seed["u2"]], "is_group": False}, headers=h1)
        new_name = f"TEST WSProfile {uuid.uuid4().hex[:5]}"

        async def run():
            u2_url = _ws_url(base_url, seed["t2"])
            async with websockets.connect(u2_url) as ws2:
                await asyncio.sleep(0.5)
                api.patch(f"{base_url}/api/me", json={"name": new_name}, headers=h1)
                got = None

                async def collect():
                    nonlocal got
                    while got is None:
                        raw = await ws2.recv()
                        data = json.loads(raw)
                        if data.get("type") == "profile_updated" and data.get("user", {}).get("user_id") == seed["u1"]:
                            got = data
                try:
                    await asyncio.wait_for(collect(), timeout=6)
                except asyncio.TimeoutError:
                    pass
                return got

        evt = asyncio.run(run())
        assert evt is not None, "expected 'profile_updated' ws event"
        assert evt["user"]["name"] == new_name


# ---------- Regression: message serializer includes edited_at ----------
class TestRegressionSerializer:
    def test_send_message_response_has_edited_at_field(self, api, base_url, seed):
        h1 = {"Authorization": f"Bearer {seed['t1']}"}
        chat = api.post(f"{base_url}/api/chats",
                        json={"member_ids": [seed["u2"]], "is_group": False}, headers=h1).json()
        r = api.post(f"{base_url}/api/messages",
                     json={"chat_id": chat["chat_id"], "text": "regr TEST"}, headers=h1)
        assert r.status_code == 200
        j = r.json()
        assert "edited_at" in j
        assert j["edited_at"] is None  # fresh message
