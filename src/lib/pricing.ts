export type LitosPlusPlanId = 'litos_plus_week' | 'litos_plus_month' | 'litos_plus_quarter';

export interface LitosPlusPlan {
  id: LitosPlusPlanId;
  duration: string;
  amount: string;
  daily: string;
  savings: string | null;
  renewal: string;
  mostPopular: boolean;
}

export const LITOS_PLUS_PLANS: readonly LitosPlusPlan[] = [
  {
    id: 'litos_plus_week',
    duration: '1 Week',
    amount: '$19.99',
    daily: '$2.85/day',
    savings: null,
    renewal: 'Renews weekly at $19.99 until canceled.',
    mostPopular: false,
  },
  {
    id: 'litos_plus_month',
    duration: '1 Month',
    amount: '$39.99',
    daily: '$1.33/day',
    savings: 'Save 53%',
    renewal: 'Renews monthly at $39.99 until canceled.',
    mostPopular: false,
  },
  {
    id: 'litos_plus_quarter',
    duration: '3 Months',
    amount: '$89.99',
    daily: '$0.99/day',
    savings: 'Save 65%',
    renewal: 'Renews every 3 months at $89.99 until canceled.',
    mostPopular: true,
  },
] as const;

export const DEFAULT_LITOS_PLUS_PLAN_ID: LitosPlusPlanId = 'litos_plus_quarter';

export function pricingUrl(planId: LitosPlusPlanId, trigger: string): string {
  const url = new URL('https://trylitos.com/pricing');
  url.searchParams.set('plan', planId);
  url.searchParams.set('surface', 'extension');
  url.searchParams.set('trigger', trigger);
  return url.toString();
}

