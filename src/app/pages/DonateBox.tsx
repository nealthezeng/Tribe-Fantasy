import { useState } from 'react';

/** How a team donates: Venmo the treasurer with the team's code in the note (spec 2026-10-10 §6). */
export function DonateBox({ code, handle, creditsPerDollar }: { code: string; handle: string; creditsPerDollar: number }) {
  const [copied, setCopied] = useState(false);
  // Opens the Venmo app on a phone with the recipient and note filled in; private so it stays off the public feed.
  const venmo = `https://venmo.com/?${new URLSearchParams({ txn: 'pay', audience: 'private', recipients: handle,
    note: `Tribe Fantasy ${code}` })}`;
  return (
    <details className="card">
      <summary>Donate to the team · code <strong>{code}</strong></summary>
      <p>Venmo <a href={venmo} target="_blank" rel="noreferrer">@{handle}</a> and keep <strong>{code}</strong> in the
        note. Credits show up within about 10 minutes.</p>
      <button type="button" className="secondary"
        onClick={() => void navigator.clipboard.writeText(code).then(() => setCopied(true))}>
        {copied ? 'Copied' : `Copy ${code}`}
      </button>
      <p className="muted">Every dollar is a donation to the team fund. $1 = {creditsPerDollar} credits. Credits have no
        cash value and can't be refunded.</p>
    </details>
  );
}
