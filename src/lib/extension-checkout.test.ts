import { describe, expect, it } from 'vitest';
import {
  checkoutReturnMismatch,
  parsePendingExtensionCheckout,
  verifiedServerCheckoutExpiry,
  type PendingExtensionCheckout,
} from './extension-checkout';

const pending: PendingExtensionCheckout = {
  plan_id: 'litos_plus_quarter',
  trigger: 'ai_resume_tailoring',
  offer_id: 'offer-a',
  account_id: 'account-a',
  action_nonce: 'pending-action-nonce-1234567890',
  created_at: 1,
  expires_at: 2,
};

describe('extension-owned checkout return', () => {
  it('accepts only the exact offer and extension account that started checkout', () => {
    expect(checkoutReturnMismatch(pending, 'offer-a', pending.action_nonce, 'account-a')).toBeNull();
    expect(checkoutReturnMismatch(pending, 'offer-b', pending.action_nonce, 'account-a')).toMatchObject({ code: 'checkout_context_mismatch' });
    expect(checkoutReturnMismatch(pending, 'offer-a', pending.action_nonce, 'account-b')).toMatchObject({ code: 'checkout_account_changed' });
    expect(checkoutReturnMismatch(null, 'offer-a', pending.action_nonce, 'account-a')).toMatchObject({ code: 'checkout_context_missing' });
    expect(checkoutReturnMismatch(pending, 'offer-a', 'different-action-nonce-12345', 'account-a')).toMatchObject({ code: 'checkout_action_mismatch' });
    expect(checkoutReturnMismatch(pending, 'offer-a', undefined, 'account-a')).toMatchObject({ code: 'checkout_action_mismatch' });
  });

  it('rejects legacy pending data without an owner and offer binding', () => {
    expect(parsePendingExtensionCheckout({ plan_id: pending.plan_id, trigger: pending.trigger, created_at: 1 })).toBeNull();
    expect(parsePendingExtensionCheckout({ ...pending, expires_at: pending.created_at })).toBeNull();
    expect(parsePendingExtensionCheckout(pending)).toEqual(pending);
  });

  it('accepts the exact backend offer expiry after a shorter local window elapsed', () => {
    const now = Date.parse('2026-08-14T10:20:00.000Z');
    const expiresAt = Date.parse('2026-08-14T10:31:00.000Z');
    const server = {
      offer_id: pending.offer_id,
      plan_id: pending.plan_id,
      status: 'paid',
      expires_at: new Date(expiresAt).toISOString(),
    };

    expect(verifiedServerCheckoutExpiry(server, pending.offer_id, pending.plan_id, now)).toBe(expiresAt);
    expect(verifiedServerCheckoutExpiry({ ...server, offer_id: 'offer-b' }, pending.offer_id, pending.plan_id, now)).toBeNull();
    expect(verifiedServerCheckoutExpiry({ ...server, plan_id: 'litos_plus_week' }, pending.offer_id, pending.plan_id, now)).toBeNull();
    expect(verifiedServerCheckoutExpiry({ ...server, status: 'creating' }, pending.offer_id, pending.plan_id, now)).toBeNull();
    expect(verifiedServerCheckoutExpiry({ ...server, status: 'expired' }, pending.offer_id, pending.plan_id, now)).toBeNull();
    expect(verifiedServerCheckoutExpiry({ ...server, expires_at: new Date(now).toISOString() }, pending.offer_id, pending.plan_id, now)).toBeNull();
  });
});
