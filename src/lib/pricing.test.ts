import { describe, expect, it } from 'vitest';
import { DEFAULT_LITOS_PLUS_PLAN_ID, LITOS_PLUS_PLANS, pricingUrl } from './pricing';

describe('Litos+ pricing contract', () => {
  it('exposes the exact approved terms with one shared feature bundle', () => {
    expect(LITOS_PLUS_PLANS.map((plan) => [plan.id, plan.duration, plan.amount, plan.daily, plan.savings])).toEqual([
      ['litos_plus_week', '1 Week', '$19.99', '$2.85/day', null],
      ['litos_plus_month', '1 Month', '$39.99', '$1.33/day', 'Save 53%'],
      ['litos_plus_quarter', '3 Months', '$89.99', '$0.99/day', 'Save 65%'],
    ]);
    expect(DEFAULT_LITOS_PLUS_PLAN_ID).toBe('litos_plus_quarter');
    expect(LITOS_PLUS_PLANS.filter((plan) => plan.mostPopular).map((plan) => plan.id)).toEqual(['litos_plus_quarter']);
  });

  it('opens only the owned pricing origin with term and trigger context', () => {
    const url = new URL(pricingUrl('litos_plus_month', 'automatic_submission'));
    expect(url.origin).toBe('https://trylitos.com');
    expect(url.pathname).toBe('/pricing');
    expect(url.searchParams.get('plan')).toBe('litos_plus_month');
    expect(url.searchParams.get('trigger')).toBe('automatic_submission');
  });
});
