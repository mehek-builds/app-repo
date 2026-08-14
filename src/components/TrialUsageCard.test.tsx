// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntitlementSnapshotV2 } from '../lib/entitlements';
import TrialUsageCard from './TrialUsageCard';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-14T00:00:00.000Z'));
});

const snapshot: EntitlementSnapshotV2 = {
  schema_version: 2,
  policy_version: 'litos-entitlements-v2',
  account_id: 'trial-account',
  revision: 'trial-1',
  evaluated_at: '2026-08-14T00:00:00.000Z',
  access_class: 'trial_plus',
  product: 'litos_plus',
  term: null,
  features: {} as EntitlementSnapshotV2['features'],
  trial: {
    meter_policy: 'litos_plus_v2_lifetime',
    starts_at: '2026-08-14T00:00:00.000Z',
    ends_at: '2026-08-19T00:00:00.000Z',
    active: true,
    tailored_resumes_used: 1,
    tailored_resumes_limit: 5,
    cover_letters_used: 2,
    cover_letters_limit: 5,
    answer_applications_used: 3,
    answer_applications_limit: 5,
    outreach_companies_used: 4,
    outreach_companies_limit: 5,
    company_usage: [],
  },
  legacy_limits: null,
  subscription: null,
};

describe('TrialUsageCard', () => {
  it('shows time and every independent trial meter', () => {
    render(<TrialUsageCard snapshot={snapshot} onOpenPlans={() => {}} />);

    expect(screen.getByText('5 days left')).toBeTruthy();
    expect(screen.getByText('Tailored resumes')).toBeTruthy();
    expect(screen.getByText('4 of 5 left')).toBeTruthy();
    expect(screen.getByText('Cover letters')).toBeTruthy();
    expect(screen.getByText('3 of 5 left')).toBeTruthy();
    expect(screen.getByText('Answer applications')).toBeTruthy();
    expect(screen.getByText('2 of 5 left')).toBeTruthy();
    expect(screen.getByText('Outreach companies')).toBeTruthy();
    expect(screen.getByText('1 of 5 left')).toBeTruthy();
    expect(screen.getByText('Each outreach company includes up to 2 contacts and 2 drafts.')).toBeTruthy();
  });

  it('shows only neutral timing for a legacy active trial', () => {
    render(<TrialUsageCard snapshot={{
      ...snapshot,
      account_id: 'legacy-trial',
      trial: {
        meter_policy: 'legacy_monthly_allowances',
        starts_at: '2026-08-01T00:00:00.000Z',
        ends_at: '2026-08-19T00:00:00.000Z',
        active: true,
      },
    }} onOpenPlans={() => {}} />);

    expect(screen.getByText('Your original trial allowances stay unchanged until this trial ends.')).toBeTruthy();
    expect(screen.queryByText('Tailored resumes')).toBeNull();
    expect(screen.queryByText(/of 5 left/)).toBeNull();
  });
});
