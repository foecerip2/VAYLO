# Components (messenger). Values come from tokens.json. Written without screenshots: sizes are sensible defaults, verify against the original when screenshots exist. Icons: Lucide (MIT). Font: Inter (OFL). No assets from the original.

Touch target minimum 48px everywhere. All text AA (see contrast report). Support dark and light via tokens. Respect reduced motion.

Button
  variants  primary, secondary, ghost, danger
  sizes     sm 32px, md 40px, lg 48px
  states    default, pressed, focus-visible (2px ring accent), disabled, loading
  tokens    bg accent, text on-accent, radius md, type sm/600
  a11y      real button, label kept while loading (aria-busy)
  used on   S01, S02, S03, S11

TextField
  variants  text, phone (country code), code (6 boxes), search
  states    default, focus, filled, error (text danger + message), disabled
  tokens    border border-input, radius md, height 48
  a11y      label always present, error linked via aria-describedby, OTP autofill supported
  used on   S01, S02, S03, S14

Avatar
  variants  photo, initials (colour from a hash of the id, from a fixed 8-colour palette that passes AA), group, channel
  sizes     sm 32, md 40, list 52, profile 96
  states    default, online (dot, online)
  used on   S04, S06, S10, S12

ChatRow  (72px)
  variants  direct, group, channel
  slots     avatar, title (1 line, ellipsis), last message preview (1 line), time, badge, pin/mute icons, typing text
  states    default, pressed, unread (title weight 600, badge), muted (badge-muted), pinned, selected (multi-select)
  a11y      one focusable row, label "Name, N unread, last message, time"; swipe actions have button alternatives
  used on   S04, S10, S14

UnreadBadge
  variants  count (99+), dot
  tokens    badge / on-badge, muted uses badge-muted, pill radius
  used on   S04

MessageBubble
  variants  text, photo, video, file, voice, reply-quote, forwarded, deleted ("message deleted")
  sides     incoming (bubble-in, left), outgoing (bubble-out, right); max width 78%; radius bubble with a tighter corner on the tail side; group consecutive messages
  meta      time + status (sending clock, sent, delivered, read) in meta-out/text-muted, edited label
  states    default, selected, highlighted (search jump), failed (danger icon + tap to retry), sending
  a11y      each bubble readable as "sender, text, time, status"; long press has a menu button alternative
  used on   S06

Composer
  variants  idle, typing, replying/editing (strip above), recording voice
  slots     attach button, multiline field (max 6 lines), emoji, send/mic swap
  states    disabled (offline shows queue note), error
  a11y      send button label changes (Send / Record voice message)
  used on   S06

ReactionChip
  tokens    surface bg, accent border when mine, count
  used on   S06

BottomSheet
  variants  attach (grid of 6), message actions (list), picker
  behaviour drag to dismiss, scrim, back button closes, focus trapped
  used on   S07, S19

ListRow / Switch  (settings)
  states    default, pressed, switch on/off, disabled
  a11y      row toggles its switch, role switch with state
  used on   S15, S16, S17, S18

TopBar
  variants  title, chat header (avatar, name, status line "online"/"typing…"), search mode, selection mode (count + actions)
  height    56
  used on   S04, S06, S12, S14

Tabs (folders)
  states    default, selected (accent underline), unread count
  used on   S05

Snackbar
  variants  info, undo (e.g. "Message deleted. Undo"), error
  behaviour 4s, pausable, announced via live region
  used on   all

EmptyState
  slots     simple original illustration (to be made), title, one action
  used on   S04 (no chats), S10 (no contacts permission), S14 (no results)

Skeleton / Offline banner
  chat list skeleton rows, "Connecting…" banner under TopBar when offline
  used on   S04, S06

Motion: 120ms for press, 200ms for sheets and send animation, ease cubic-bezier(.2,.8,.2,1); disable with prefers-reduced-motion.
