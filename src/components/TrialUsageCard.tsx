import React from 'react';
import type { EntitlementSnapshotV2 } from '../lib/entitlements';

function timeLeftLabel(endsAt: string, now = Date.now()): string {
  const remaining = new Date(endsAt).valueOf() - now;
  if (!Number.isFinite(remaining) || remaining <= 0) return 'Trial ending';
  const hours = Math.ceil(remaining / 3_600_000);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'} left`;
  const days = Math.ceil(hours / 24);
  return `${days} days left`;
}

export default function TrialUsageCard({
  snapshot,
  onOpenPlans,
}: {
  snapshot: EntitlementSnapshotV2;
  onOpenPlans: () => void;
}) {
  if (snapshot.access_class !== 'trial_plus' || !snapshot.trial) return null;
  const trial = snapshot.trial;
  const legacyTrial = trial.meter_policy === 'legacy_monthly_allowances';
  const meters = legacyTrial ? [] : [
    {
      label: 'Tailored resumes',
      remaining: Math.max(0, trial.tailored_resumes_limit - trial.tailored_resumes_used),
      limit: trial.tailored_resumes_limit,
    },
    {
      label: 'Cover letters',
      remaining: Math.max(0, trial.cover_letters_limit - trial.cover_letters_used),
      limit: trial.cover_letters_limit,
    },
    {
      label: 'Answer applications',
      remaining: Math.max(0, trial.answer_applications_limit - trial.answer_applications_used),
      limit: trial.answer_applications_limit,
    },
    {
      label: 'Outreach companies',
      remaining: Math.max(0, trial.outreach_companies_limit - trial.outreach_companies_used),
      limit: trial.outreach_companies_limit,
    },
  ] as const;

  return (
    <section className="rounded-inner bg-brand-50 px-3 py-3" aria-labelledby="trial-usage-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="trial-usage-title" className="text-sm font-medium text-gray-950">Litos+ trial</h2>
          <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.04em] text-brand-800">
            {timeLeftLabel(trial.ends_at)}
          </p>
        </div>
        <button type="button" onClick={onOpenPlans} className="min-h-11 text-xs font-medium text-brand-800 underline-offset-4 hover:underline">
          See plans
        </button>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-brand-100 pt-2">
        {meters.map((meter) => (
          <div key={meter.label}>
            <dt className="text-[11px] leading-4 text-gray-600">{meter.label}</dt>
            <dd className="font-mono text-xs text-gray-950">{meter.remaining} of {meter.limit} left</dd>
          </div>
        ))}
      </dl>
      {legacyTrial ? (
        <p className="mt-2 border-t border-brand-100 pt-2 text-[11px] leading-4 text-gray-600">
          Your original trial allowances stay unchanged until this trial ends.
        </p>
      ) : (
        <p className="mt-2 text-[11px] leading-4 text-gray-600">
          Each outreach company includes up to 2 contacts and 2 drafts.
        </p>
      )}
    </section>
  );
}
