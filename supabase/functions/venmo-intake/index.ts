// Venmo receipts → credits (spec docs/superpowers/specs/2026-10-10-venmo-donations-design.md §5). Runs on Supabase
// Edge Functions (Deno), deployed by pasting this file into the dashboard with "Verify JWT" OFF; pg_cron calls it every
// 10 minutes (docs/setup-supabase.md). Every decision lives in SQL (0021_venmo.sql): this only fetches mail.
// Reads ONLY the dedicated Venmo Gmail. Secrets: CRON_SECRET, VENMO_GMAIL_USER, VENMO_GMAIL_APP_PASSWORD.
import postgres from 'npm:postgres@3';
import { ImapFlow } from 'npm:imapflow@1';
import { simpleParser } from 'npm:mailparser@3';
import { htmlToText } from 'npm:html-to-text@9';

declare const Deno: { env: { get(key: string): string | undefined }; serve(handler: (req: Request) => Promise<Response>): void };

const env = (key: string) => {
  const v = Deno.env.get(key);
  if (!v) throw new Error(`missing secret ${key}`);
  return v;
};

Deno.serve(async (req) => {
  if (req.headers.get('x-cron-secret') !== env('CRON_SECRET')) return new Response('unauthorized', { status: 401 });
  const sql = postgres(env('SUPABASE_DB_URL'), { max: 1, prepare: false });
  const imap = new ImapFlow({
    host: 'imap.gmail.com', port: 993, secure: true, logger: false,
    auth: { user: env('VENMO_GMAIL_USER'), pass: env('VENMO_GMAIL_APP_PASSWORD') },
  });
  const counts: Record<string, number> = {};
  try {
    await imap.connect();
    const lock = await imap.getMailboxLock('INBOX');
    try {
      const uids = ((await imap.search({ seen: false }, { uid: true })) || []).slice(0, 50);
      for (const uid of uids) {
        try {
          const msg = await imap.fetchOne(String(uid), { source: true }, { uid: true });
          if (!msg || !msg.source) continue;
          const mail = await simpleParser(msg.source);
          // Always the HTML when there is one (Venmo's text/plain part is empty), so SQL sees one layout: no wrapping, note on one line.
          const text = mail.html ? htmlToText(mail.html, { wordwrap: false }) : (mail.text ?? '');
          // Top first: the first is the one Gmail added on receipt (the only one SQL trusts).
          const auth = mail.headerLines.filter((h) => h.key === 'authentication-results')
            .map((h) => h.line.replace(/^authentication-results:\s*/i, '').replace(/\r?\n\s+/g, ' '));
          const [{ s }] = await sql`select private.ingest_venmo_receipt(${mail.messageId ?? `uid:${uid}`},
            ${sql.array(auth)}::text[], ${mail.subject ?? ''}, ${text}, ${mail.date ?? null}) as s`;
          counts[s] = (counts[s] ?? 0) + 1;
          await imap.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
        } catch (e) {
          // Leave it unseen so the next run retries; the Message-ID makes a retry safe.
          console.error(String(e));
          counts.error = (counts.error ?? 0) + 1;
          await imap.messageFlagsRemove(String(uid), ['\\Seen'], { uid: true }).catch(() => {});
        }
      }
    } finally {
      lock.release();
    }
    await imap.logout();
  } finally {
    await sql.end();
  }
  console.log(JSON.stringify(counts));
  return Response.json(counts);
});
