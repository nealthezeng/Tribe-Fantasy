/** A credit_ledger row as the client reads it (with LEDGER_COLUMNS). */
export interface LedgerEntry {
  id: number;
  kind: 'allowance' | 'donation' | 'adjustment' | 'bid';
  amount: number;
  dollars: number | string | null; // numeric(10,2)
  note: string | null;
  created_at: string;
  stages: { name: string } | null;
}

export const LEDGER_COLUMNS = 'id, kind, amount, dollars, note, created_at, stages(name)';

export const balance = (entries: Pick<LedgerEntry, 'amount'>[]) => entries.reduce((sum, e) => sum + e.amount, 0);

/** 1 → '1 credit', 115 → '115 credits'. */
export const credits = (n: number) => `${n} ${Math.abs(n) === 1 ? 'credit' : 'credits'}`;

/** 67%; under 1% keeps one significant figure, so a sliver never reads 0%. */
export const pct = (share: number) => {
  const x = Number(share);
  return `${x < 0.01 ? Number((x * 100).toPrecision(1)) : Math.round(x * 100)}%`;
};

export function entryLabel(e: LedgerEntry): string {
  switch (e.kind) {
    case 'allowance': return `Allowance — ${e.stages?.name ?? 'tournament'}`;
    case 'donation': return `Donation to the team — $${Number(e.dollars).toFixed(2)}`;
    case 'adjustment': return `Adjustment — ${e.note ?? ''}`;
    case 'bid': return `Shares — ${e.stages?.name ?? 'tournament'}`;
  }
}
