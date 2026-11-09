# Recon map: Telegram (Android, messenger)

Scope: Core messaging loop: sign in by phone, chat list, 1:1 and group chats, media/files, search, notifications, multi-device cloud sync. Then channels. Deferred: secret chats, calls, stories, bots/Mini Apps, Stars, Premium.
For: the user's own messenger (own product; must be rebranded before launch)
Date: 2026-11-09

> Confidence note: sources are the public FAQ, blog and API docs fetched without an account or screenshots. The Google Play page did not render text. Screens are inferred; items marked (verify) need the user's own account and screenshots in `replica/telegram/screens/`.

> Clean-room warning: Telegram's client code is open source under GPL. Do NOT read or copy it into your clone, or you inherit the GPL. Read only the public API/protocol docs. Do not reuse Telegram's servers, API credentials or network: your messenger needs its own backend and its own user base (see Out of scope).

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | Google Play listing | https://play.google.com/store/apps/details?id=org.telegram.messenger | text did not render; get screenshots manually |
| 2 | FAQ | https://telegram.org/faq | features and limits (read first 100k of 133k chars) |
| 3 | blog / changelog | https://telegram.org/blog | updates Mar to Aug 2026 |
| 4 | API docs | https://core.telegram.org/api | entities: peers, chats, channels, messages, dialogs, files, updates |
| 5 | user's own account | (needs user) | to confirm screens and states |

## Core loop

Open the app, see a list of conversations sorted by recent activity, send and receive messages and files instantly, and have everything synced to every device through the cloud.

## Screens

| ID | screen | route / how to reach | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S01 | Welcome / phone entry | first launch | start sign-in | phone input, country code | invalid number |
| S02 | Code verification | after S01 | SMS or in-app code | code input, resend timer | wrong code, expired, 2FA required |
| S03 | Profile setup | after first sign-in | name, photo | avatar picker | |
| S04 | Chat list | main | conversations by recency | rows with avatar, last message, unread badge, pinned, muted | empty, loading, filtered by folder, archived |
| S05 | Chat folders | chat list tabs | group chats into folders | tab bar | |
| S06 | Conversation | tap a chat | read and send messages | bubbles, composer, reply, reactions, typing indicator | empty, sending, failed, offline, scheduled |
| S07 | Attach menu | composer | photo, file, location, contact, poll | sheet | permission denied |
| S08 | Media viewer | tap media | photo/video viewer | pinch zoom, share | loading |
| S09 | Voice message recorder | composer hold | record and send | waveform | permission denied |
| S10 | New chat / contacts | FAB | start chat, contacts | contact list, search | no contacts permission |
| S11 | New group | FAB | name, members | member picker | |
| S12 | Group info / admin | chat header | members, permissions, admins | list, switches | |
| S13 | Channel | chat list | one-to-many posts with view counters | post cards | |
| S14 | Search | top bar | chats, messages, people | tabs | no results |
| S15 | Settings | menu | profile, notifications, privacy, data, devices | list | |
| S16 | Privacy and security | settings | phone visibility, last seen, 2FA | switches | |
| S17 | Notifications settings | settings | per chat and global | switches | |
| S18 | Active sessions | settings | devices signed in | list, terminate | |
| S19 | Message context menu | long press | reply, forward, edit, delete, pin | menu | |

## Flows

```
F01 Sign up
    S01 -> S02 -> S03 -> S04
    happy path clicks: 5
    edge: wrong code, number already used on another device, 2FA password, no SMS
F02 Send a text message
    S04 -> S06 -> type -> send
    happy path clicks: 3
    edge: offline (queue), send failure and retry, very long message
F03 Send a photo or file
    S06 -> S07 -> pick -> send
    happy path clicks: 4
    edge: size limit (2 GB), upload paused or resumed, no permission
F04 Create a group
    S10/S11 -> pick members -> name -> S06
    happy path clicks: 5
F05 Search a message
    S04 -> S14 -> result -> S06 (scroll to message)
F06 Sign in on a second device
    S01 -> S02 (code arrives in first device) -> S04 with full history
F07 Get a notification and reply
    push -> S06
```

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| Chat row | direct, group, channel | unread, muted, pinned, typing | S04 |
| Message bubble | text, photo, video, file, voice, reply, forward | sending, sent, delivered, read, failed, edited | S06 |
| Composer | text, with attachments, voice | empty, typing, recording | S06 |
| Reaction chip | emoji | selected | S06 |
| Unread badge | count, muted | | S04 |
| Bottom sheet | attach, context | | S07, S19 |
| Switch / list row | | on, off | S15-S17 |
| Toast / snackbar | undo, error | | all |
| Avatar | photo, initials | online | all |

## Inferred data model

```
User        id, phone, username, name, photo, created_at, settings
            evidence: S01-S03, S15; confidence: high
Session     id, user_id, device, ip, last_active
            evidence: S18; confidence: high
Contact     owner_id, contact_user_id, display_name
            evidence: S10; confidence: high
Chat        id, type (direct | group | channel), title, photo, owner_id, member_count
            evidence: API docs (chats, channels), S11-S13; confidence: high
Member      chat_id, user_id, role, permissions, joined_at
            evidence: S12; confidence: high
Message     id, chat_id, sender_id, text, entities (styled text), reply_to_id, forward_from, edited_at, sent_at, ttl
            evidence: S06, API docs (messages); confidence: high
Attachment  id, message_id, type, size, storage_key, mime
            evidence: S07, FAQ (2 GB limit); confidence: high
Reaction    message_id, user_id, emoji
            evidence: FAQ; confidence: medium
ReadState   chat_id, user_id, last_read_message_id
            evidence: unread badges; confidence: medium (guess)
Folder      id, user_id, name, chat_ids
            evidence: FAQ folders; confidence: high
Update      per-user sequence of events for sync
            evidence: API docs (updates); confidence: medium
```

Relationships: User 1-n Session, Chat n-n User via Member, Chat 1-n Message, Message 1-n Attachment, User 1-n Folder.

## Known public limits (FAQ)

Groups up to 200,000 members. Channels unlimited subscribers. Files 2 GB (4 GB Premium). Messages 32,768 chars on Premium rich editor. Polls up to 12 options. Folders: 30 on Premium (base not listed).

## Feature matrix

See `features.csv`. Must: 12, should: 9, could: 7, skip: 9.

## Out of scope (cannot or should not be cloned)

- Telegram's network: its users, their contacts and chat history. A messenger is worthless without people, so plan distribution.
- Telegram's servers, MTProto credentials and bot platform. Do not point your app at them.
- Telegram's GPL source code (clean room: do not read it).
- Stickers, GIF library (350M), emoji packs: licensed or user-owned content.
- Telegram Stars, collectible usernames, Premium economy.
- Voice/video calls at scale and live streams (large infrastructure) and AI features (deferred).
- Regulatory duties: moderation, data retention, lawful requests and age rules differ by country.
- Name, logo, copy, visual identity.

## Size

Screens 19, flows 7, entities 11. Hard parts: realtime delivery and reliable multi-device sync (update sequence, offline queue, ordering), end-to-end vs server-side encryption decision, media storage and resumable large uploads, push notifications (FCM), abuse and spam handling. Size: XL for the full app. Rescoped to 1:1 + group text/media chat with sync: L.
