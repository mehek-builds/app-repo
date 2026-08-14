import { describe, expect, it } from 'vitest';
import {
  parsePendingExtensionPremiumAction,
  premiumRetryControlSelector,
  sanitizeExtensionPremiumAction,
  serverPremiumActionMatches,
  verifiedServerPremiumActionExpiry,
  type PendingExtensionPremiumAction,
} from './extension-premium-action';

const pending: PendingExtensionPremiumAction = {
  action_nonce: 'action-nonce-12345678901234567890',
  account_id: 'account-a',
  feature_key: 'ai_resume_tailoring',
  kind: 'application',
  application_id: '123e4567-e89b-12d3-a456-426614174000',
  company: 'Acme',
  role: 'Engineer',
  portal_url: 'https://jobs.example.com/acme/engineer',
  return_route: '/billing/return?surface=extension',
  created_at: 10,
  expires_at: 20,
};

const outreachContact = {
  id: '223e4567-e89b-42d3-a456-426614174000',
  full_name: 'Marcus Lee',
  title: 'Software Engineer',
  persona: 'alumni' as const,
  company_domain: 'acme.com',
  school_match: true,
  linkedin_url: 'https://www.linkedin.com/in/marcus-lee',
  email: 'marcus@acme.com',
  tier: 'green' as const,
  status: 'verified' as const,
};

describe('extension premium action binding', () => {
  it('sanitizes only bounded HTTPS job context and derives the action kind', () => {
    expect(sanitizeExtensionPremiumAction('ai_resume_tailoring', {
      application_id: pending.application_id,
      company: '  Acme   Corp ',
      role: ' Engineer ',
      portal_url: 'https://jobs.example.com/acme/engineer',
    })).toMatchObject({
      feature_key: 'ai_resume_tailoring',
      kind: 'application',
      application_id: pending.application_id,
      company: 'Acme Corp',
    });
    expect(sanitizeExtensionPremiumAction('contact_discovery', {
      company: 'Acme', role: 'Engineer', portal_url: 'http://jobs.example.com/apply',
    })).toBeNull();
    expect(sanitizeExtensionPremiumAction('automatic_submission', null)).toEqual({
      feature_key: 'automatic_submission',
      kind: 'extension_screen',
      screen: 'autofill_setup',
    });
    expect(sanitizeExtensionPremiumAction('contact_discovery', {
      application_id: pending.application_id, company: 'Acme', role: 'Engineer',
    })).toEqual({
      feature_key: 'contact_discovery',
      kind: 'extension_screen',
      screen: 'main',
      application_id: pending.application_id,
      company: 'Acme',
      role: 'Engineer',
    });
  });

  it.each([
    ['without a URL', undefined],
    ['with a URL', 'https://jobs.example.com/acme/engineer'],
  ])('keeps selected-contact outreach on the DraftEditor extension screen %s', (_label, portalUrl) => {
    const action = sanitizeExtensionPremiumAction('outreach_email_generation', {
      application_id: pending.application_id,
      contact_id: outreachContact.id,
      contact: outreachContact,
      company: 'Acme',
      role: 'Engineer',
      ...(portalUrl ? { portal_url: portalUrl } : {}),
      operation_id: '323e4567-e89b-42d3-a456-426614174000',
      draft_type: 'follow_up',
      draft_subject: 'Existing subject',
      draft_body: 'Existing body',
    });
    expect(action).toMatchObject({
      feature_key: 'outreach_email_generation',
      kind: 'extension_screen',
      screen: 'draft',
      application_id: pending.application_id,
      contact_id: outreachContact.id,
      contact: outreachContact,
      company: 'Acme',
      role: 'Engineer',
      operation_id: '323e4567-e89b-42d3-a456-426614174000',
      draft_type: 'follow_up',
    });
    expect(action?.portal_url).toBe(portalUrl);
  });

  it('rejects stored context without owner, nonce, or exact restorable context', () => {
    expect(parsePendingExtensionPremiumAction(pending)).toEqual(pending);
    expect(parsePendingExtensionPremiumAction({
      ...pending,
      feature_key: 'contact_discovery',
      kind: 'extension_screen',
      screen: 'main',
      portal_url: undefined,
    })).toMatchObject({
      feature_key: 'contact_discovery',
      kind: 'extension_screen',
      screen: 'main',
      company: 'Acme',
      role: 'Engineer',
    });
    expect(parsePendingExtensionPremiumAction({ ...pending, account_id: '' })).toBeNull();
    expect(parsePendingExtensionPremiumAction({ ...pending, portal_url: 'https://user:secret@jobs.example.com' })).toBeNull();

    const outreach = sanitizeExtensionPremiumAction('outreach_email_generation', {
      application_id: pending.application_id,
      contact_id: outreachContact.id,
      contact: outreachContact,
      company: 'Acme',
      role: 'Engineer',
      operation_id: '323e4567-e89b-42d3-a456-426614174000',
      draft_type: 'first_note',
    });
    const storedOutreach = {
      ...outreach!,
      action_nonce: pending.action_nonce,
      account_id: pending.account_id,
      return_route: pending.return_route,
      created_at: pending.created_at,
      expires_at: pending.expires_at,
      consumed_at: 15,
    };
    expect(parsePendingExtensionPremiumAction(storedOutreach)).toEqual(storedOutreach);
    expect(parsePendingExtensionPremiumAction({
      ...storedOutreach,
      contact_id: '423e4567-e89b-42d3-a456-426614174000',
    })).toBeNull();
  });

  it('requires server feature, ids, return route, and pending state to match', () => {
    const server = {
      feature_key: pending.feature_key,
      application_id: pending.application_id,
      job_id: null,
      return_route: pending.return_route,
      state: 'pending',
    };
    expect(serverPremiumActionMatches(pending, server)).toBe(true);
    expect(serverPremiumActionMatches(pending, { ...server, application_id: crypto.randomUUID() })).toBe(false);
    expect(serverPremiumActionMatches(pending, { ...server, state: 'consumed' })).toBe(false);
    expect(serverPremiumActionMatches(pending, { ...server, state: 'consumed' }, ['pending', 'consumed'])).toBe(true);

    const outreach = sanitizeExtensionPremiumAction('outreach_email_generation', {
      application_id: pending.application_id,
      contact_id: outreachContact.id,
      contact: outreachContact,
      company: 'Acme',
      role: 'Engineer',
      operation_id: '323e4567-e89b-42d3-a456-426614174000',
    });
    const outreachPending = {
      ...outreach!,
      action_nonce: pending.action_nonce,
      account_id: pending.account_id,
      return_route: pending.return_route,
      created_at: pending.created_at,
      expires_at: pending.expires_at,
    };
    const outreachServer = {
      feature_key: 'outreach_email_generation',
      application_id: pending.application_id,
      job_id: null,
      contact_id: outreachContact.id,
      return_route: pending.return_route,
      state: 'consumed',
    };
    expect(serverPremiumActionMatches(outreachPending, outreachServer, ['consumed'])).toBe(true);
    expect(serverPremiumActionMatches(outreachPending, {
      ...outreachServer,
      contact_id: '423e4567-e89b-42d3-a456-426614174000',
    }, ['consumed'])).toBe(false);
  });

  it('replaces a stale local deadline only with the exact owner-scoped server action expiry', () => {
    const now = Date.parse('2026-08-14T10:20:00.000Z');
    const expiresAt = Date.parse('2026-08-14T10:31:00.000Z');
    const server = {
      feature_key: pending.feature_key,
      application_id: pending.application_id,
      job_id: null,
      contact_id: null,
      return_route: pending.return_route,
      state: 'pending',
      expires_at: new Date(expiresAt).toISOString(),
    };

    expect(pending.expires_at).toBeLessThan(now);
    expect(verifiedServerPremiumActionExpiry(pending, server, ['pending'], now)).toBe(expiresAt);
    expect(verifiedServerPremiumActionExpiry({ ...pending, application_id: crypto.randomUUID() }, server, ['pending'], now)).toBeNull();
    expect(verifiedServerPremiumActionExpiry({ ...pending }, { ...server, state: 'consumed' }, ['pending'], now)).toBeNull();
    expect(verifiedServerPremiumActionExpiry({ ...pending }, { ...server, expires_at: new Date(now).toISOString() }, ['pending'], now)).toBeNull();
  });

  it('maps retry to Litos-owned controls only', () => {
    expect(premiumRetryControlSelector('ai_resume_tailoring')).toBe('#wp-resume-yes');
    expect(premiumRetryControlSelector('contact_discovery')).toBe('#wp-yes');
    expect(premiumRetryControlSelector('outreach_email_generation')).toBe('#wp-yes');
    expect(premiumRetryControlSelector('automatic_submission')).toBeNull();
  });
});
