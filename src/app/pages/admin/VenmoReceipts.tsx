import { Loading } from '../../components/Loading';
import { api, type VenmoReceipt } from '../../lib/rpc';
import { useLoad } from '../../lib/useLoad';

const REASON: Record<VenmoReceipt['status'], string> = {
  unknown_code: 'No team has that code',
  ambiguous: 'More than one team code in the note',
  unsigned: 'Not a verified Venmo email',
  unparsed: "Couldn't read the amount (or over $10,000)",
  disabled: 'Donations were turned off',
  duplicate: 'Already credited (same Venmo payment)',
};

/** Venmo receipts that didn't become credits. Fix one with "Record a donation" below. */
export function VenmoReceipts() {
  const list = useLoad(() => api.listVenmoReceipts(), []);
  const receipts = list.data?.receipts ?? [];
  return (
    <details className="section">
      <summary>Venmo receipts not credited ({receipts.length})</summary>
      {!list.data && !list.error && <Loading />}
      {list.error && <p className="error" role="alert">{list.error}</p>}
      {list.data && receipts.length === 0 && <p className="muted">Every Venmo donation in the last 30 days was credited.</p>}
      <ul className="list">
        {receipts.map((r) => (
          <li key={r.id}>
            <span>
              {r.payer ?? '—'}{r.note ? `: ${r.note}` : ''} <small>{new Date(r.received_at).toLocaleString()}</small>
              <br /><small className="muted">{REASON[r.status]}{r.team ? ` · ${r.team}` : ''}</small>
            </span>
            <strong className="num">{r.dollars === null ? '' : `$${Number(r.dollars).toFixed(2)}`}</strong>
          </li>
        ))}
      </ul>
      {list.data && list.data.skipped > 0 && (
        <p className="muted">{list.data.skipped} other Venmo payments without a team code were skipped.</p>
      )}
    </details>
  );
}
