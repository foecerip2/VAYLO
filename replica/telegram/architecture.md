# Architecture: your messenger (a rebuild of Telegram's core features)

Source: `replica/telegram/recon.md`. Slice: 1:1 and group chat with media, search, push and multi-device sync. Channels second.

## Stack

| layer | choice | why |
| --- | --- | --- |
| mobile | Expo (React Native), Android first | one codebase, Android is the recon platform |
| web | Next.js + TypeScript | later, reuses the same API |
| database | Postgres on Supabase | one DB, RLS, built-in realtime |
| realtime | Supabase Realtime (WebSocket), fall back to a Fly.io Node WS gateway if load needs it | no custom protocol for v1 |
| auth | Phone OTP via Twilio Verify, Supabase Auth custom flow | phone sign-in is the core UX |
| files | Cloudflare R2 with presigned multipart uploads | cheap egress, resumable large files |
| push | Firebase Cloud Messaging via Expo notifications | Android standard |
| jobs | Inngest | scheduled messages, TTL deletes, code cleanup |
| payments | none in v1 | not a must-have |
| hosting | Supabase + Vercel (API routes) + Fly (WS if needed) | managed |

No MTProto, no Telegram servers or credentials. Own protocol: JSON over HTTPS plus WebSocket.

## Schema

Tables: 13 (users, sessions, login_codes, contacts, chats, members, messages, attachments, reactions, folders, folder_chats, updates, plus RLS policies). Access rules: row level security, membership-based. Full SQL in `replica/telegram/schema.sql`.

Key decisions:
- `messages.seq` is gapless per chat; clients sync by "give me seq > N".
- `messages (sender_id, client_msg_id)` is unique, so a retried send never duplicates.
- `chats.direct_key` is unique, so two users have exactly one direct chat.
- `updates` is a per-user log with `pts`; a new device replays from 0, an old one from its last pts.
- Message body capped at 4096 chars (Telegram's higher cap is a Premium feature).
- Attachments capped at 2 GB, matching the public limit.
- Not encrypted end-to-end in v1 (server can search and sync). Secret chats are a separate design.

## API

| method path | does | who | input | output | flow |
| --- | --- | --- | --- | --- | --- |
| POST /auth/code | send OTP | anyone, rate limited | phone | ok | F01 |
| POST /auth/verify | verify OTP, create session | anyone | phone, code, device | token, user | F01, F06 |
| POST /auth/2fa | submit password | pending session | password | token | F01 |
| PATCH /me | name, photo, username, privacy | self | fields | user | F01 |
| GET /chats | chat list with last message, unread | self | cursor, folder | chats | F07 |
| POST /chats | create group or direct | self | type, members, title | chat | F04 |
| GET /chats/:id/messages | history | member | before_seq, limit | messages | F02 |
| POST /chats/:id/messages | send | member | client_msg_id, body, attachments | message | F02, F03 |
| PATCH /messages/:id | edit | sender | body | message | F02 |
| DELETE /messages/:id | delete | sender or admin | scope | ok | F02 |
| POST /messages/:id/reactions | react | member | emoji | ok | F02 |
| POST /chats/:id/read | mark read | member | seq | ok | F02 |
| POST /uploads | start multipart upload | self | size, mime | upload urls | F03 |
| POST /uploads/:id/complete | finish upload | self | etags | attachment | F03 |
| GET /search | chats, people, messages | self | q, scope | results | F05 |
| GET /updates | pull updates after pts | self | pts | updates | F06 |
| POST /contacts/sync | match phone hashes | self | hashed numbers | users | F04 |
| GET/DELETE /sessions | list and revoke devices | self | | sessions | F06 |
| PUT /push-token | register FCM token | self | token | ok | F07 |
| members add/remove/role | group admin | admin | | members | F04 |

Webhooks in: Twilio delivery status, FCM invalid-token feedback. Webhooks out: none.
Realtime channel per user (`user:{id}`) carries update events; typing indicators go over a presence channel and are never stored.
Jobs: `send_scheduled` (every minute), `expire_messages` (every minute, for TTL), `purge_login_codes` (hourly), `cleanup_orphan_uploads` (daily), `push_fanout` (event driven).

## The parts that bite

- **Ordering and sync:** assign `seq` in a single transaction per chat (row lock on the chat or a per-chat counter). Clients must tolerate gaps and out-of-order delivery by sorting on seq.
- **Idempotency:** `client_msg_id` on send; OTP verification attempts are counted; webhooks (Twilio) are processed once.
- **Races:** two admins removing the same member; read pointer only moves forward (`greatest`).
- **Offline:** client keeps an outbox of unsent messages and retries with the same `client_msg_id`.
- **Large files:** multipart presigned uploads, resumable, size and mime checks server side, virus scanning for public groups.
- **Push:** payloads carry no message body by default for privacy; fetch on wake.
- **Rate limits and spam:** per-phone and per-IP OTP limits (SMS pumping fraud is real), per-user message rate, new-account limits on mass invites.
- **Search:** Postgres full text is enough for v1; move to Typesense when history gets large.
- **Privacy and legal:** phone numbers hashed in contact matching; GDPR deletion must cascade messages and files; moderation and abuse reporting required for groups and channels; storage region per country rules.
- **Encryption:** TLS plus encryption at rest in v1; be honest in marketing, do not claim end-to-end.
- **Cost:** SMS verification is the biggest early cost per signup.

## Build order

1. **Vertical slice** (S01, S02, S03, S04, S06): phone OTP sign in; users, sessions, login_codes, chats, members, messages; routes auth/*, GET /chats, POST /chats (direct), messages GET/POST; realtime on one chat. Proves sync and delivery.
2. **Must-haves:**
   - Media: S07, S08, attachments, uploads routes.
   - Groups: S10, S11, S12, member routes, permissions.
   - Search S14, push (FCM) S17, privacy S15-S16, read state and delivery status.
   - Multi-device: `updates`, `/updates`, sessions S18.
3. **Should-haves:** reactions, typing, voice messages S09, archive/pin, channels S13, contacts sync, 2FA, per-chat notifications.
4. **Could-haves:** folders S05, scheduled messages, polls, auto-delete, dark theme.
5. **Fixes from replica-entrepreneur** once it has run (read real reviews of Telegram and WhatsApp-class apps).

Riskiest three: multi-device sync correctness, SMS fraud and cost, media at scale.
