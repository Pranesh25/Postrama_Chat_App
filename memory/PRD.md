# Product Requirements Document — Bubble Chat

## Overview
Bubble is a real-time messaging mobile app (React Native / Expo) that supports 1-on-1 and group chats with Google Sign-In, image sharing, typing indicators, read receipts, presence, and offline message queuing.

## Users
Anyone with a Google account. No manual sign-up flow.

## Core Features
1. **Authentication** — Emergent-managed Google OAuth. Session token stored in expo-secure-store (mobile) / localStorage (web), 7-day expiry.
2. **Chats list** — All conversations, last message preview, unread count, timestamp, online indicator for 1-on-1s.
3. **1-on-1 & Group chats** — Create direct chats or named group chats with 2+ others. Existing 1-on-1s are reused.
4. **Real-time messaging** — WebSocket `/api/ws` for live message delivery, typing indicators, read receipts, presence.
5. **Image sharing** — Pick from gallery, sent as base64 in message.
6. **Typing indicators** — Broadcast per-chat via WS with auto-timeout.
7. **Read receipts** — Single tick (sent) → double tick (read) with color change when other members read.
8. **Presence** — Online dot on avatars, "online" / "offline" text in chat header, updated via WS.
9. **Offline queue** — Messages composed while disconnected are queued in AsyncStorage and flushed on reconnect.
10. **Profile** — Avatar, name, email, sign out.

## Tech Stack
- Frontend: Expo Router (file-based routing), TypeScript, react-native-safe-area-context, react-native-gesture-handler, expo-image, expo-image-picker, expo-web-browser, expo-secure-store, expo-haptics, expo-font (loads Fredoka/Nunito), Ionicons.
- Backend: FastAPI + Motor (MongoDB) + WebSockets, httpx for Emergent OAuth session lookup.
- DB: `users`, `user_sessions`, `chats`, `messages` collections with unique indexes and 7-day TTL on sessions.

## Screens
- `/login` — Google Sign-In (auto-redirects to /chats when authenticated).
- `/chats` — Conversation list + FAB to New Chat.
- `/chat/[id]` — Message thread with composer.
- `/new-chat` — Search users, toggle group mode, create chat.
- `/profile` — Profile card + Sign out.

## API Endpoints
- `POST /api/auth/session` — Exchange session_id for session_token.
- `GET /api/me` — Current user.
- `POST /api/auth/logout` — Invalidate session.
- `GET /api/users/search?q=` — Find users by name/email.
- `GET /api/chats` — List my chats with members + unread count.
- `POST /api/chats` — Create/find 1-on-1 or group chat.
- `GET /api/chats/{chat_id}/messages` — Message history.
- `POST /api/messages` — Send text/image message.
- `POST /api/chats/{chat_id}/read` — Mark chat as read.
- `WS /api/ws?token=` — Real-time events: `message`, `typing`, `read`, `presence`.

## Design
Warm "Bubble" personality — cream surface (#FCFAF8) with coral (#FF6B4A) accents, Fredoka display + Nunito body fonts, generous spacing, pill-shaped inputs, floating action button, bubble-shaped chat messages (right = brand-coral for self, left = white with border for others).

## Business Enhancement
"Nudge" quick-reactions (future): tap-and-hold a bubble to send heart / thumbs-up haptic reactions — drives engagement and DAU by giving users a low-friction way to respond without typing.
