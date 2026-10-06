// M10 email sender (spec docs/superpowers/specs/2026-10-05-m10-notifications-design.md §5). Runs on Supabase Edge
// Functions (Deno), deployed by pasting this file into the dashboard with "Verify JWT" OFF; pg_cron calls it every
// minute (docs/setup-supabase.md). Every decision lives in SQL (0016_notify.sql): this only sends what it's handed.
// Secrets: CRON_SECRET, GMAIL_USER, GMAIL_APP_PASSWORD. SUPABASE_DB_URL is provided by Supabase.
import postgres from 'npm:postgres@3';
import nodemailer from 'npm:nodemailer@6';

declare const Deno: { env: { get(key: string): string | undefined }; serve(handler: (req: Request) => Promise<Response>): void };

const env = (key: string) => {
  const v = Deno.env.get(key);
  if (!v) throw new Error(`missing secret ${key}`);
  return v;
};

Deno.serve(async (req) => {
  if (req.headers.get('x-cron-secret') !== env('CRON_SECRET')) return new Response('unauthorized', { status: 401 });
  const sql = postgres(env('SUPABASE_DB_URL'), { max: 1, prepare: false });
  // Port 465 (implicit TLS): Supabase blocks outbound 25 and 587.
  const mail = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true, pool: true,
    auth: { user: env('GMAIL_USER'), pass: env('GMAIL_APP_PASSWORD') },
  });
  let sent = 0, failed = 0;
  try {
    const [{ n: queued }] = await sql`select private.queue_bid_reminders() as n`;
    const rows = await sql`select id, email, subject, body from private.claim_outbox(50)`;
    for (const r of rows) {
      try {
        await mail.sendMail({ from: `Tribe Fantasy <${env('GMAIL_USER')}>`, to: r.email, subject: r.subject, text: r.body });
        await sql`select private.mark_outbox(${r.id}, null)`;
        sent++;
      } catch (e) {
        await sql`select private.mark_outbox(${r.id}, ${String(e)})`;
        failed++;
      }
    }
    console.log(JSON.stringify({ queued, sent, failed }));
    return Response.json({ queued, sent, failed });
  } finally {
    mail.close();
    await sql.end();
  }
});
