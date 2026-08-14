export type PendingExtensionCheckout = {
  plan_id: 'litos_plus_week' | 'litos_plus_month' | 'litos_plus_quarter';
  trigger: string;
  offer_id: string;
  account_id: string;
  action_nonce?: string;
  created_at: number;
  expires_at: number;
};

export type ServerExtensionCheckoutOffer = {
  offer_id?: unknown;
  plan_id?: unknown;
  status?: unknown;
  expires_at?: unknown;
};

export type CheckoutReturnMismatch = { error: string; code: string };

export function parsePendingExtensionCheckout(value: unknown): PendingExtensionCheckout | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const validPlan = candidate.plan_id === 'litos_plus_week'
    || candidate.plan_id === 'litos_plus_month'
    || candidate.plan_id === 'litos_plus_quarter';
  if (
    !validPlan
    || typeof candidate.trigger !== 'string'
    || typeof candidate.offer_id !== 'string'
    || !candidate.offer_id
    || typeof candidate.account_id !== 'string'
    || !candidate.account_id
    || (candidate.action_nonce !== undefined && (
      typeof candidate.action_nonce !== 'string'
      || candidate.action_nonce.length < 20
      || candidate.action_nonce.length > 200
    ))
    || typeof candidate.created_at !== 'number'
    || !Number.isFinite(candidate.created_at)
    || typeof candidate.expires_at !== 'number'
    || !Number.isFinite(candidate.expires_at)
    || candidate.expires_at <= candidate.created_at
  ) return null;
  return candidate as PendingExtensionCheckout;
}

export function verifiedServerCheckoutExpiry(
  server: ServerExtensionCheckoutOffer | null,
  expectedOfferId: string,
  expectedPlanId: PendingExtensionCheckout['plan_id'],
  now = Date.now(),
): number | null {
  if (
    !server
    || server.offer_id !== expectedOfferId
    || server.plan_id !== expectedPlanId
    || (server.status !== 'checkout_created'
      && server.status !== 'paid')
    || typeof server.expires_at !== 'string'
  ) return null;
  const expiresAt = Date.parse(server.expires_at);
  return Number.isFinite(expiresAt) && expiresAt > now ? expiresAt : null;
}

export function checkoutReturnMismatch(
  pending: PendingExtensionCheckout | null,
  returnOfferId: unknown,
  returnActionNonce: unknown,
  currentAccountId: string,
): CheckoutReturnMismatch | null {
  if (!pending) {
    return {
      error: 'This extension no longer has the checkout account context. Open Litos and refresh Plan.',
      code: 'checkout_context_missing',
    };
  }
  if (typeof returnOfferId !== 'string' || returnOfferId !== pending.offer_id) {
    return {
      error: 'This Stripe return does not match the checkout started by the Litos extension.',
      code: 'checkout_context_mismatch',
    };
  }
  if (currentAccountId !== pending.account_id) {
    return {
      error: 'The Litos extension account changed during checkout. Sign back in to the purchasing account.',
      code: 'checkout_account_changed',
    };
  }
  if (
    (pending.action_nonce !== undefined || returnActionNonce !== undefined)
    && (typeof returnActionNonce !== 'string' || returnActionNonce !== pending.action_nonce)
  ) {
    return {
      error: 'This Stripe return does not match the saved extension action.',
      code: 'checkout_action_mismatch',
    };
  }
  return null;
}
