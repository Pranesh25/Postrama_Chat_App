"""Iteration 2 tests: mark-all-read, meetings, reminders + auth + regression."""
import asyncio
import json
import pytest
import websockets


def _auth(t):
    return {"Authorization": f"Bearer {t}"}


# ---------- Auth gates on new endpoints ----------
class TestAuthGates:
    def test_mark_all_read_401(self, api, base_url):
        r = api.post(f"{base_url}/api/chats/mark-all-read")
        assert r.status_code == 401

    def test_meetings_post_401(self, api, base_url):
        r = api.post(f"{base_url}/api/meetings", json={"title": "x", "starts_at": "2026-02-01T10:00:00Z"})
        assert r.status_code == 401

    def test_meetings_get_401(self, api, base_url):
        r = api.get(f"{base_url}/api/meetings")
        assert r.status_code == 401

    def test_reminders_post_401(self, api, base_url):
        r = api.post(f"{base_url}/api/reminders", json={"title": "x", "remind_at": "2026-02-01T10:00:00Z"})
        assert r.status_code == 401

    def test_reminders_get_401(self, api, base_url):
        r = api.get(f"{base_url}/api/reminders")
        assert r.status_code == 401


# ---------- Mark-all-read ----------
class TestMarkAllRead:
    def test_bulk_marks_all_chats_read(self, api, base_url, seed):
        h1, h2 = _auth(seed["t1"]), _auth(seed["t2"])
        # Create 2 chats where u2 receives messages from u1 and u3
        c_a = api.post(f"{base_url}/api/chats",
                       json={"member_ids": [seed["u2"]], "is_group": False}, headers=h1).json()
        h3 = _auth(seed["t3"])
        c_b = api.post(f"{base_url}/api/chats",
                       json={"member_ids": [seed["u2"]], "is_group": False}, headers=h3).json()
        api.post(f"{base_url}/api/messages",
                 json={"chat_id": c_a["chat_id"], "text": "TEST unread A"}, headers=h1)
        api.post(f"{base_url}/api/messages",
                 json={"chat_id": c_b["chat_id"], "text": "TEST unread B"}, headers=h3)

        # u2 should have unread > 0 across those chats
        chats = api.get(f"{base_url}/api/chats", headers=h2).json()
        total_unread = sum(c["unread"] for c in chats if c["chat_id"] in (c_a["chat_id"], c_b["chat_id"]))
        assert total_unread >= 2

        # bulk mark-all-read
        r = api.post(f"{base_url}/api/chats/mark-all-read", headers=h2)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        assert isinstance(body.get("count"), int) and body["count"] >= 2

        # unread must be 0 for all u2's chats now
        chats2 = api.get(f"{base_url}/api/chats", headers=h2).json()
        for c in chats2:
            assert c["unread"] == 0, f"chat {c['chat_id']} still has unread={c['unread']}"

    def test_mark_all_read_broadcasts_read_ws(self, api, base_url, seed):
        h1, h2 = _auth(seed["t1"]), _auth(seed["t2"])
        chat = api.post(f"{base_url}/api/chats",
                        json={"member_ids": [seed["u2"]], "is_group": False}, headers=h1).json()
        api.post(f"{base_url}/api/messages",
                 json={"chat_id": chat["chat_id"], "text": "TEST ws read"}, headers=h1)

        async def run():
            url = base_url.replace("https://", "wss://").replace("http://", "ws://") + f"/api/ws?token={seed['t1']}"
            async with websockets.connect(url) as ws:
                await asyncio.sleep(0.5)
                # trigger mark-all-read as u2
                api.post(f"{base_url}/api/chats/mark-all-read", headers=h2)
                got = None
                try:
                    while True:
                        raw = await asyncio.wait_for(ws.recv(), timeout=4)
                        data = json.loads(raw)
                        if data.get("type") == "read" and data.get("chat_id") == chat["chat_id"] \
                                and data.get("user_id") == seed["u2"]:
                            got = data
                            break
                except asyncio.TimeoutError:
                    pass
                return got

        evt = asyncio.run(run())
        assert evt is not None, "Expected WS 'read' broadcast after mark-all-read"


# ---------- Meetings ----------
class TestMeetings:
    def test_create_meeting_without_chat(self, api, base_url, seed):
        h1 = _auth(seed["t1"])
        payload = {"title": "TEST Standup", "starts_at": "2026-02-01T10:00:00Z", "description": "daily"}
        r = api.post(f"{base_url}/api/meetings", json=payload, headers=h1)
        assert r.status_code == 200, r.text
        m = r.json()
        assert m["title"] == "TEST Standup"
        assert m["starts_at"] == "2026-02-01T10:00:00Z"
        assert m["description"] == "daily"
        assert m["chat_id"] is None
        assert m["owner_id"] == seed["u1"]
        assert m["meeting_id"].startswith("mtg_")
        assert "_id" not in m

    def test_create_meeting_with_chat_posts_message_and_ws(self, api, base_url, seed):
        h1, h2 = _auth(seed["t1"]), _auth(seed["t2"])
        chat = api.post(f"{base_url}/api/chats",
                        json={"member_ids": [seed["u2"]], "is_group": False}, headers=h1).json()

        async def run():
            url = base_url.replace("https://", "wss://").replace("http://", "ws://") + f"/api/ws?token={seed['t2']}"
            async with websockets.connect(url) as ws:
                await asyncio.sleep(0.5)
                payload = {
                    "title": "TEST Kickoff",
                    "starts_at": "2026-03-01T15:00:00Z",
                    "description": "kickoff meeting",
                    "chat_id": chat["chat_id"],
                }
                r = api.post(f"{base_url}/api/meetings", json=payload, headers=h1)
                assert r.status_code == 200, r.text
                meeting = r.json()
                assert meeting["chat_id"] == chat["chat_id"]
                assert "_id" not in meeting

                got = None
                try:
                    while True:
                        raw = await asyncio.wait_for(ws.recv(), timeout=5)
                        data = json.loads(raw)
                        if data.get("type") == "message" and data.get("chat_id") == chat["chat_id"]:
                            got = data
                            break
                except asyncio.TimeoutError:
                    pass
                return meeting, got

        meeting, evt = asyncio.run(run())
        assert evt is not None, "expected WS message broadcast for chat meeting"
        text = evt["message"]["text"]
        assert "TEST Kickoff" in text
        assert "2026-03-01T15:00:00Z" in text
        assert "kickoff meeting" in text
        # message must persist in chat
        msgs = api.get(f"{base_url}/api/chats/{chat['chat_id']}/messages", headers=_auth(seed["t2"])).json()
        assert any("TEST Kickoff" in (m.get("text") or "") for m in msgs)

    def test_list_meetings_sorted_by_starts_at(self, api, base_url, seed):
        h1 = _auth(seed["t1"])
        # add out-of-order
        api.post(f"{base_url}/api/meetings",
                 json={"title": "TEST z", "starts_at": "2027-01-01T00:00:00Z"}, headers=h1)
        api.post(f"{base_url}/api/meetings",
                 json={"title": "TEST a", "starts_at": "2025-01-01T00:00:00Z"}, headers=h1)
        r = api.get(f"{base_url}/api/meetings", headers=h1)
        assert r.status_code == 200
        arr = r.json()
        assert isinstance(arr, list) and len(arr) >= 2
        starts = [m["starts_at"] for m in arr]
        assert starts == sorted(starts), f"meetings not sorted asc by starts_at: {starts}"
        for m in arr:
            assert "_id" not in m
            assert m["owner_id"] == seed["u1"]

    def test_list_meetings_scoped_to_owner(self, api, base_url, seed):
        # u3 should not see u1's meetings
        h3 = _auth(seed["t3"])
        r = api.get(f"{base_url}/api/meetings", headers=h3)
        assert r.status_code == 200
        for m in r.json():
            assert m["owner_id"] == seed["u3"]


# ---------- Reminders ----------
class TestReminders:
    def test_create_and_list_reminders(self, api, base_url, seed):
        h1 = _auth(seed["t1"])
        r = api.post(f"{base_url}/api/reminders",
                     json={"title": "TEST call mom", "remind_at": "2026-02-15T09:00:00Z",
                           "description": "birthday"},
                     headers=h1)
        assert r.status_code == 200, r.text
        rem = r.json()
        assert rem["title"] == "TEST call mom"
        assert rem["remind_at"] == "2026-02-15T09:00:00Z"
        assert rem["description"] == "birthday"
        assert rem["owner_id"] == seed["u1"]
        assert rem["reminder_id"].startswith("rem_")
        assert "_id" not in rem

        # list
        lst = api.get(f"{base_url}/api/reminders", headers=h1)
        assert lst.status_code == 200
        arr = lst.json()
        assert any(x["reminder_id"] == rem["reminder_id"] for x in arr)
        for x in arr:
            assert "_id" not in x
            assert x["owner_id"] == seed["u1"]

    def test_list_reminders_sorted_by_remind_at(self, api, base_url, seed):
        h2 = _auth(seed["t2"])
        api.post(f"{base_url}/api/reminders",
                 json={"title": "TEST later", "remind_at": "2027-06-01T00:00:00Z"}, headers=h2)
        api.post(f"{base_url}/api/reminders",
                 json={"title": "TEST sooner", "remind_at": "2026-01-01T00:00:00Z"}, headers=h2)
        arr = api.get(f"{base_url}/api/reminders", headers=h2).json()
        assert len(arr) >= 2
        ts = [x["remind_at"] for x in arr]
        assert ts == sorted(ts)


# ---------- Regression: iter-1 endpoints ----------
class TestRegression:
    def test_me_still_works(self, api, base_url, seed):
        r = api.get(f"{base_url}/api/me", headers=_auth(seed["t1"]))
        assert r.status_code == 200
        assert r.json()["user_id"] == seed["u1"]
        assert "_id" not in r.json()

    def test_chats_list_still_works(self, api, base_url, seed):
        r = api.get(f"{base_url}/api/chats", headers=_auth(seed["t1"]))
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_users_search_still_works(self, api, base_url, seed):
        r = api.get(f"{base_url}/api/users/search?q=bob", headers=_auth(seed["t1"]))
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_messages_send_still_works(self, api, base_url, seed):
        h1 = _auth(seed["t1"])
        chat = api.post(f"{base_url}/api/chats",
                        json={"member_ids": [seed["u2"]], "is_group": False}, headers=h1).json()
        r = api.post(f"{base_url}/api/messages",
                     json={"chat_id": chat["chat_id"], "text": "TEST regression"}, headers=h1)
        assert r.status_code == 200
        assert r.json()["text"] == "TEST regression"


# ---------- Cleanup for meetings/reminders (session scope) ----------
@pytest.fixture(scope="session", autouse=True)
def _cleanup_meetings_reminders(mongo, seed):
    yield
    uids = [seed["u1"], seed["u2"], seed["u3"]]
    mongo.meetings.delete_many({"owner_id": {"$in": uids}})
    mongo.reminders.delete_many({"owner_id": {"$in": uids}})
