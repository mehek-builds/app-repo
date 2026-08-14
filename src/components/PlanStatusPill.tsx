import React from 'react';
import { planLabel, type EntitlementSnapshotV2 } from '../lib/entitlements';

export default function PlanStatusPill({
  snapshot,
  onOpen,
}: {
  snapshot: EntitlementSnapshotV2 | null;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="inline-flex min-h-11 items-center rounded-control bg-brand-50 px-2.5 font-mono text-[10px] font-medium uppercase tracking-[0.04em] text-brand-800 transition-colors hover:bg-brand-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
      aria-label={`${planLabel(snapshot)}. Open plan details.`}
    >
      {planLabel(snapshot)}
    </button>
  );
}
