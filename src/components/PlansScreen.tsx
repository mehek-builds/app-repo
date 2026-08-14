import React, { useMemo, useState } from 'react';
import type { EntitlementSnapshotV2 } from '../lib/entitlements';
import {
  DEFAULT_LITOS_PLUS_PLAN_ID,
  LITOS_PLUS_PLANS,
  type LitosPlusPlanId,
} from '../lib/pricing';
import { PopupHeader, primaryButtonClass, quietButtonClass } from './ui';

const FEATURES = [
  'Unlimited tailored resumes, cover letters, and application answers',
  'Unlimited contact discovery and outreach drafts',
  'Network paths, connected companies, and advanced job insights',
  'Paid plans can start tailoring when you hover a detected job',
  'Opt-in automatic submission with the existing review and safety checks',
] as const;

function isPaid(snapshot: EntitlementSnapshotV2 | null): boolean {
  return snapshot?.access_class === 'plus_paid' || snapshot?.access_class === 'legacy_paid';
}

export default function PlansScreen({
  snapshot,
  trigger = 'manual',
  onBack,
  onContinue,
  onManageBilling,
}: {
  snapshot: EntitlementSnapshotV2 | null;
  trigger?: string;
  onBack: () => void;
  onContinue: (
    planId: LitosPlusPlanId,
    trigger: string,
  ) => void | Promise<{ ok: boolean; error?: string }>;
  onManageBilling: () => void;
}) {
  const [selectedId, setSelectedId] = useState<LitosPlusPlanId>(DEFAULT_LITOS_PLUS_PLAN_ID);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const selected = useMemo(
    () => LITOS_PLUS_PLANS.find((plan) => plan.id === selectedId) ?? LITOS_PLUS_PLANS[2],
    [selectedId],
  );

  const continueToCheckout = async () => {
    setCheckoutBusy(true);
    setCheckoutError(null);
    try {
      const result = await onContinue(selected.id, trigger);
      if (result && !result.ok) setCheckoutError(result.error ?? 'Litos+ options could not open.');
    } catch (error) {
      setCheckoutError(error instanceof Error ? error.message : 'Litos+ options could not open.');
    } finally {
      setCheckoutBusy(false);
    }
  };

  return (
    <div className="flex min-h-full animate-fade-in flex-col bg-white">
      <PopupHeader title="Litos+" subtitle="One feature set. Pick your term." onBack={onBack} />
      <main className="flex flex-1 flex-col gap-5 px-4 py-4">
        <section aria-labelledby="plan-comparison-title">
          <h2 id="plan-comparison-title" className="text-base font-medium text-gray-950">Keep filling free. Add the work around it.</h2>
          <div className="mt-3 grid grid-cols-2 overflow-hidden rounded-inner border border-gray-200 text-xs">
            <div className="bg-gray-50 px-3 py-2 font-medium text-gray-700">Free</div>
            <div className="bg-brand-50 px-3 py-2 font-medium text-brand-800">Litos+</div>
            <div className="border-t border-gray-200 px-3 py-2 text-gray-700">Unlimited form filling</div>
            <div className="border-t border-gray-200 px-3 py-2 text-gray-950">Everything in Free</div>
            <div className="border-t border-gray-200 px-3 py-2 text-gray-700">You submit each form</div>
            <div className="border-t border-gray-200 px-3 py-2 text-gray-950">Automatic submission is opt-in</div>
          </div>
        </section>

        <ul className="space-y-2 text-xs leading-5 text-gray-700" aria-label="Litos+ features">
          {FEATURES.map((feature) => (
            <li key={feature} className="flex gap-2">
              <span className="font-mono text-brand-800" aria-hidden="true">+</span>
              <span>{feature}</span>
            </li>
          ))}
        </ul>

        {!isPaid(snapshot) && (
          <fieldset className="space-y-2">
            <legend className="mb-2 text-xs font-medium text-gray-700">Billing term</legend>
            {LITOS_PLUS_PLANS.map((plan) => {
              const selectedPlan = plan.id === selectedId;
              return (
                <label
                  key={plan.id}
                  className={`relative flex min-h-16 cursor-pointer items-center gap-3 rounded-inner border px-3 py-2 transition-colors ${
                    selectedPlan ? 'border-brand-400 bg-brand-50' : 'border-gray-300 bg-white hover:border-gray-400'
                  }`}
                >
                  <input
                    type="radio"
                    name="litos-plus-term"
                    value={plan.id}
                    checked={selectedPlan}
                    onChange={() => setSelectedId(plan.id)}
                    className="h-4 w-4 accent-brand-600"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-950">{plan.duration}</span>
                      {plan.mostPopular && (
                        <span className="rounded-control bg-brand-100 px-2 py-0.5 font-mono text-[9px] font-medium uppercase tracking-[0.04em] text-brand-800">
                          Most popular
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block font-mono text-[11px] text-gray-600">
                      {plan.daily}{plan.savings ? `, ${plan.savings}` : ''}
                    </span>
                  </span>
                  <span className="text-right font-mono text-sm font-medium text-gray-950">{plan.amount}</span>
                </label>
              );
            })}
          </fieldset>
        )}

        <div className="mt-auto border-t border-gray-200 pt-4">
          {isPaid(snapshot) ? (
            <button type="button" onClick={onManageBilling} className={`${primaryButtonClass} w-full`}>
              Manage billing
            </button>
          ) : (
            <>
              <p className="mb-3 text-xs leading-5 text-gray-600">{selected.renewal} Cancel from Account on trylitos.com.</p>
              {checkoutError && <p role="alert" className="mb-3 text-xs leading-5 text-red-700">{checkoutError}</p>}
              <button type="button" disabled={checkoutBusy} onClick={() => void continueToCheckout()} className={`${primaryButtonClass} w-full`}>
                {checkoutBusy ? 'Opening secure checkout...' : `Continue with ${selected.duration.toLowerCase()}`}
              </button>
            </>
          )}
          <button type="button" onClick={onBack} className={`${quietButtonClass} mt-2 w-full`}>
            Continue free
          </button>
          <p className="mt-2 text-center text-[11px] text-gray-600">
            Payment opens on trylitos.com. Card details stay with Stripe.
          </p>
        </div>
      </main>
    </div>
  );
}
