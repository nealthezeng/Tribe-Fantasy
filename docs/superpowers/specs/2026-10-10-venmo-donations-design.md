# Venmo donations — design

Date: 2026-10-10 · Status: APPROVED 2026-10-10 · BUILT (branch venmo-donations) · Board: t222 · Migration: 0021 · Tag: m12-venmo

## 1. Goal

Donations arrive by Venmo and turn into credits with no treasurer typing. A donor pays the
treasurer's Venmo with their team's **donation code** in the note; within ~10 minutes the team has
`dollars × credits_per_dollar` credits. Club sports has approved collecting donations (2026-10-10).

## 2. User rulings (2026-10-10)

- **Venmo account:** the user's own Venmo. Already flagged once (money custody pitfall), user
  decided — don't re-raise. A later switch to a team account is a settings change (§6).
- **Matching = team code only** (no payer-name or fuzzy matching).
- **Codes are easy to type:** 4 consonants, no digits, case-insensitive, anywhere in the note.
- **Payments without a code are personal** and are skipped silently — counted, never listed,
  their payer/note never stored.
- **Source = Venmo's "paid you" emails, never the personal inbox.** The user's personal Gmail
  forwards only Venmo receipts (a Gmail filter) to a **dedicated Gmail** that holds nothing else.
  Only the dedicated mailbox's credentials ever reach Supabase.
- **Credits immediately** (no per-donation approval). Safety = Gmail's own DKIM verdict (§5) +
  stable refs (no double credit) + an "uncredited receipts" list for the treasurer.
- **CSV upload dropped** (possible later as monthly reconciliation).

## 3. User setup (runbook goes in `docs/setup-supabase.md`)

1. New Gmail, e.g. `tribefantasy.venmo@gmail.com`; 2-Step Verification on; create an app password.
2. Personal Gmail → Settings → Forwarding → add the new address, confirm the link it receives.
3. Personal Gmail filter: from `venmo@venmo.com`, has the words `"paid you"` → Forward to the new
   address (may also label it).
4. Supabase secrets `VENMO_GMAIL_USER`, `VENMO_GMAIL_APP_PASSWORD` (`CRON_SECRET` reused from M10).
5. Deploy Edge Function `venmo-intake` (Verify JWT off); `cron.schedule('venmo-intake', '*/10 * * * *', …)`
   with the same pg_net + `x-cron-secret` call as `notify`.
6. Season settings: set `venmo_handle`, turn `donations_enabled` on.

Stop all intake: `select cron.unschedule('venmo-intake');`

## 4. Database — `0021_venmo.sql`

### Donation codes
- Alphabet `BCDFGHJKMNPQRSTVWXZ` (19 letters: no vowels, no Y, no L) → 19⁴ ≈ 130k codes; no real
  words, no I/L/O/0 look-alikes.
- `memberships.donation_code text not null unique check (donation_code ~ '^[BCDFGHJKMNPQRSTVWXZ]{4}$')`.
  Filled by `private.new_donation_code()` (random, retry while taken) as the column default;
  existing rows backfilled in the migration. Unique across all seasons, never reused.
- Readable wherever memberships are (league members + staff). Knowing another team's code only
  lets you gift them credits — harmless.

### Ledger idempotency
- `credit_ledger.source_ref text unique` (null for every existing and manual row).

### Shared donation insert
- `private.insert_donation(p_membership, p_dollars, p_note, p_created_by, p_source_ref) returns bigint`
  holds the body of today's `record_donation` (NOT_FOUND / DONATIONS_DISABLED / INVALID_AMOUNT /
  INVALID_NOTE, credits = round(dollars × credits_per_dollar), audit row). `record_donation` is
  redefined to `require_treasurer()` then call it — same signature, same behaviour.

### Receipts
`private.venmo_receipts` (not API-exposed; "Run without RLS" is fine):
`id bigint identity pk, message_id text not null unique, received_at timestamptz, status text not null,
payer text, dollars numeric(10,2), note text, code text, membership_id uuid references memberships on delete set null,
ledger_id bigint references credit_ledger on delete set null, created_at timestamptz default now()`.

`status` ∈ `credited | no_code | unknown_code | ambiguous | unsigned | unparsed | disabled | duplicate`.
For `no_code` and `unsigned`, payer/dollars/note stay NULL (personal payments, possible forgeries).

### `private.ingest_venmo_receipt(p_message_id, p_auth_results text[], p_subject, p_text, p_received_at) returns text`
Called by the Edge Function (direct DB connection), never by clients; returns the status.
Every decision lives here so PGlite tests cover it — the function is a pipe, like `notify`.
1. `message_id` already in `venmo_receipts` → return its status, do nothing (re-delivery).
2. **Signed?** `p_auth_results[1]` (the top header = added by Gmail on receipt) must start with
   `mx.google.com;` and contain `dkim=pass` for `venmo.com` (`header.i=@venmo.com` or
   `header.d=venmo.com`). Else `unsigned`. Lower headers are ignored — a sender can forge those.
3. **Parse:** subject → payer, dollars (real subject pattern: see §10). Note, payment id
   and the exact body patterns are fixed from the user's sample (§8 gate). Fails → `unparsed`.
4. **Code:** upper-case the note, take every whole word matching the code pattern, keep those
   that exist. None found → `no_code` if no code-shaped word, else `unknown_code`; two different
   known codes → `ambiguous`.
5. **Credit:** `insert_donation(membership, dollars, 'Venmo ' || payer || ': ' || note, NULL,
   'venmo:' || payment_id)` (falls back to `'msg:' || message_id` if the email has no payment id).
   DONATIONS_DISABLED → `disabled`; unique violation on `source_ref` → `duplicate`; INVALID_* →
   `unparsed`. Success → `credited` + `ledger_id`.
Insert the `venmo_receipts` row in every case.

### `public.list_venmo_receipts()` — treasurer only
Last 30 days of rows whose status isn't `credited`/`no_code`, newest first (with team label), plus
the 30-day `no_code` count. Read-only, so not audited.

## 5. Edge Function `venmo-intake` (`supabase/functions/venmo-intake/index.ts`)
- `x-cron-secret` check; `npm:imapflow` to `imap.gmail.com:993` with the dedicated account;
  `npm:mailparser` for headers + text; `npm:postgres` via `SUPABASE_DB_URL` (same as `notify`).
- For each UNSEEN message in INBOX (max 50 per run): pass Message-ID, all `Authentication-Results`
  headers in order, subject, plain text (HTML converted), date to `ingest_venmo_receipt`; mark
  `\Seen` only after the SQL call returns. A failing call leaves it unseen → retried next run;
  `message_id` uniqueness makes the retry safe.
- Logs `{seen, credited, other}` per run. Untestable locally (no Deno) → smoke test after deploy.
- Risk to check at deploy: outbound 993 from Supabase Edge (only 25/587 are documented as blocked).

## 6. App
- **Setting** `venmo_handle: string | null` (default null; `^@?[A-Za-z0-9_-]{5,30}$`, stored without
  `@`). New `nullable(handle)` check in `src/core/settings.ts`; editor gets the field.
- **Home team card** (owner only, when `donations_enabled` and `venmo_handle` set): "Donate to the
  team: Venmo **@handle**, put **BKRT** in the note. $1 = 20 credits; credits have no cash value."
  Code copyable (button).
- **Admin → Wallets:** "Venmo receipts not credited" list (date, payer, $, note, reason in plain
  words) + "N other Venmo payments without a code skipped". Fix = the existing Record donation form.
- **Rules page FAQ:** how to donate by Venmo, code in the note, credits within ~10 minutes.
- Backup tab: `venmo_receipts` is private → not in BACKUP_TABLES; `donation_code`/`source_ref`
  come along with their tables.

## 7. Tests
- PGlite DB (`tests/db/venmo.test.ts`): code backfill + uniqueness + default on new team; every
  ingest status incl. forged lower `Authentication-Results`, re-delivered message, same payment
  twice (different message id) → `duplicate`, donations off, lower-case code, two codes, note
  with a code-shaped unknown word; `record_donation` unchanged (existing tests); RPC gate
  (`list_venmo_receipts` treasurer-only, `ingest_venmo_receipt` not executable by anon/authenticated).
- App: settings validator for `venmo_handle`; Home card shows/hides; Wallets list renders reasons.
- Fixtures come from the user's real receipt email (§8).

## 8. Gate before planning Task 1
The user forwards one real Venmo "paid you" email to the dedicated inbox and saves it **unedited**
as `.eml` (Gmail ⋮ → Download message) in the repo folder (git-ignored). From it we fix: the
subject pattern, where the note and payment id sit in the text, and the exact Gmail
`Authentication-Results` line after forwarding (confirms DKIM survives). If DKIM does NOT survive
forwarding, stop and revisit §2 (fallback: pending list + approve).

## 9. Not doing
Donor receipt emails (could reuse the M10 outbox later), CSV reconciliation, refunds/chargebacks
(treasurer uses Adjust credits), per-donation caps beyond the existing $10,000 check.

## 10. Amendments (2026-10-10, build)
- Real subject is `<payer> paid $<amount> to your Venmo account. …`; payer and amount are read from the subject.
- Venmo's text/plain part is empty, so the function converts the HTML with html-to-text (wordwrap off); the note and
  the alphanumeric TRANSACTION ID come from that text.
- Trust = Gmail's top Authentication-Results header with quoted strings and parenthesised comments stripped (they echo
  the sender's MAIL FROM), `dkim=pass` directly followed by `header.i`/`header.d` for venmo.com. PLUS the receipt's last
  "Sent to @handle" must equal the season's `venmo_handle` (blocks replays of genuine receipts for payments to someone
  else); `unsigned` therefore also means wrong/missing handle.
- Drift (amount block not found) → `unparsed`.
- Payment id and Sent-to are the LAST matches in the text, so the note can't set them. Only the note's first line is
  scanned for codes.
- The Donate box has a prefilled private Venmo link (note `Tribe Fantasy <code>`).
- A deleted team's code can be handed out again (dropping "never reused").
- `record_donation` keeps its signature (the shared body is `private.insert_donation`).
- Go-live order as in the runbook (`docs/setup-supabase.md`): paste 0021, push, Gmail setup, function, settings,
  smoke test, cron.
