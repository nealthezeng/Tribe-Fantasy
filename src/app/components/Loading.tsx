/** A resting placeholder in a card's shape while data loads. Screen readers hear "Loading…". */
export function Loading() {
  return (
    <div className="skeleton" role="status">
      <span className="sr-only">Loading…</span>
      <span aria-hidden="true" />
      <span aria-hidden="true" />
      <span aria-hidden="true" />
    </div>
  );
}
