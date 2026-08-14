import { describe, expect, it } from 'vitest';
import {
  featureEnabled,
  isCachedEntitlementFresh,
  parseEntitlementSnapshot,
  planLabel,
  preferNewerEntitlementSnapshot,
  type EntitlementSnapshotV2,
} from './entitlements';

function snapshot(patch: Partial<EntitlementSnapshotV2> = {}): EntitlementSnapshotV2 {
  return {
    schema_version: 2,
    policy_version: 'litos-entitlements-v2',
    account_id: 'account-1',
    revision: '1',
    evaluated_at: '2026-08-14T00:00:00.000Z',
    access_class: 'free_new',
    product: null,
    term: null,
    features: {
      application_fill: true,
      hover_generation: false,
      automatic_submission: false,
      ai_resume_tailoring: false,
    } as EntitlementSnapshotV2['features'],
    trial: null,
    legacy_limits: null,
    subscription: null,
    ...patch,
  };
}

describe('entitlement snapshots', () => {
  it('keeps factual filling enabled and new Free automatic submission disabled', () => {
    const parsed = parseEntitlementSnapshot(snapshot());
    expect(featureEnabled(parsed, 'application_fill')).toBe(true);
    expect(featureEnabled(parsed, 'automatic_submission')).toBe(false);
    expect(featureEnabled(parsed, 'hover_generation')).toBe(false);
    expect(featureEnabled(parsed, 'ai_resume_tailoring')).toBe(false);
    expect(planLabel(parsed)).toBe('Free');
  });

  it('fails closed when a feature value is not exactly true', () => {
    const parsed = parseEntitlementSnapshot(snapshot({
      features: {
        application_fill: false,
        automatic_submission: 'true',
      } as unknown as EntitlementSnapshotV2['features'],
    }));
    expect(featureEnabled(parsed, 'application_fill')).toBe(true);
    expect(featureEnabled(parsed, 'automatic_submission')).toBe(false);
  });

  it('labels trial, paid, and original plans without exposing migration jargon', () => {
    expect(planLabel(snapshot({ access_class: 'trial_plus', product: 'litos_plus' }))).toBe('Litos+ trial');
    expect(planLabel(snapshot({ access_class: 'plus_paid', product: 'litos_plus' }))).toBe('Litos+');
    expect(planLabel(snapshot({ access_class: 'free_grandfathered' }))).toBe('Original plan');
  });

  it('preserves a legacy active-trial marker without inventing v2 meters', () => {
    const parsed = parseEntitlementSnapshot(snapshot({
      access_class: 'trial_plus',
      product: 'litos_plus',
      trial: {
        meter_policy: 'legacy_monthly_allowances',
        starts_at: '2026-08-01T00:00:00.000Z',
        ends_at: '2026-08-20T00:00:00.000Z',
        active: true,
      },
    }));

    expect(parsed.trial).toEqual({
      meter_policy: 'legacy_monthly_allowances',
      starts_at: '2026-08-01T00:00:00.000Z',
      ends_at: '2026-08-20T00:00:00.000Z',
      active: true,
    });
    expect(parsed.trial).not.toHaveProperty('tailored_resumes_limit');
  });

  it('rejects an unsupported policy version and missing account owner', () => {
    expect(() => parseEntitlementSnapshot({ ...snapshot(), schema_version: 1 })).toThrow('unsupported');
    expect(() => parseEntitlementSnapshot({ ...snapshot(), account_id: '' })).toThrow('account owner');
  });

  it('treats display cache as fresh for five minutes only', () => {
    const now = 1_000_000;
    expect(isCachedEntitlementFresh(now - 299_999, now)).toBe(true);
    expect(isCachedEntitlementFresh(now - 300_001, now)).toBe(false);
    expect(isCachedEntitlementFresh(now + 1, now)).toBe(false);
  });

  it('does not let a slower older response replace a newer snapshot for the same account', () => {
    const paid = snapshot({
      revision: 'paid-newer',
      evaluated_at: '2026-08-14T00:00:02.000Z',
      access_class: 'plus_paid',
      product: 'litos_plus',
    });
    const olderFree = snapshot({ revision: 'free-older', evaluated_at: '2026-08-14T00:00:01.000Z' });
    expect(preferNewerEntitlementSnapshot(paid, olderFree)).toBe(paid);
    expect(preferNewerEntitlementSnapshot(olderFree, paid)).toBe(paid);
  });
});
