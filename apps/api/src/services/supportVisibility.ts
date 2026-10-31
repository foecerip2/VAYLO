/** Internal SQL predicate; each caller aliases support_tickets as t.
 * A draft chat with only system greetings is not a submitted support case.
 * Real tickets and any non-system text/photo history remain meaningful.
 */
export const SUPPORT_HAS_ACTIVITY_SQL = `(t.kind <> 'chat' or exists(
  select 1 from support_messages m where m.ticket_id=t.id and m.author<>'system'
  and (btrim(m.body)<>'' or exists(select 1 from support_attachments a where a.message_id=m.id))))`;
