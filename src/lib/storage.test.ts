import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntitlementSnapshotV2 } from './entitlements';

const values: Record<string, unknown> = {};
const sessionValues: Record<string, unknown> = {};
let storageError: string | null = null;
let delaySessionWrite = false;
let releaseSessionWrite: (() => void) | null = null;
let sessionWriteStarted: Promise<void> | null = null;

Object.defineProperty(globalThis, 'chrome', {
  configurable: true,
  value: {
    runtime: {
      get lastError() {
        return storageError ? { message: storageError } : undefined;
      },
    },
    storage: {
      session: {
        get: vi.fn(async () => ({ ...sessionValues })),
        set: vi.fn(async (patch: Record<string, unknown>) => {
          if (!delaySessionWrite) { Object.assign(sessionValues, patch); return; }
          await new Promise<void>((resolve) => {
            sessionWriteStarted = Promise.resolve();
            releaseSessionWrite = () => { delaySessionWrite = false; Object.assign(sessionValues, patch); resolve(); };
          });
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete sessionValues[key];
        }),
      },
      local: {
        get: vi.fn((keys: string[], callback: (result: Record<string, unknown>) => void) => {
          callback(Object.fromEntries(keys.filter((key) => key in values).map((key) => [key, values[key]])));
        }),
        set: vi.fn((patch: Record<string, unknown>, callback: () => void) => {
          if (!storageError) Object.assign(values, patch);
          callback();
        }),
        remove: vi.fn((keys: string | string[], callback: () => void) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key];
          callback();
        }),
      },
    },
  },
});

const storage = await import('./storage');
const packetIdentity = await import('./packet-applicant-identity');
const entitlements = await import('./entitlements');
const { requestBackgroundSessionClear } = await import('./popup-session');
const { createSessionClearMessageHandler } = await import('./session-clear');

describe('extension auth storage', () => {
  beforeEach(() => {
    for (const key of Object.keys(values)) delete values[key];
    for (const key of Object.keys(sessionValues)) delete sessionValues[key];
    storageError = null;
    delaySessionWrite = false;
    releaseSessionWrite = null;
    sessionWriteStarted = null;
  });

  it('persists and reads back the sign-in token', async () => {
    await storage.setToken('token-123');
    await expect(storage.getToken()).resolves.toBe('token-123');
  });

  it('does not report onboarding success when Chrome rejects the write', async () => {
    storageError = 'Storage is unavailable';
    await expect(storage.setToken('token-123')).rejects.toThrow('Could not access extension storage');
  });

  it('keeps existing users signed in through the Volley key fallback', async () => {
    values.volley_token = 'legacy-token';
    await expect(storage.getToken()).resolves.toBe('legacy-token');
  });

  it('rotates the anonymous analytics identity on logout', async () => {
    values.litos_token = 'token-123';
    values.litos_profile = { school: 'USC' };
    values.litos_posthog_distinct_id = 'anonymous-id';

    await storage.clearAll();

    expect(values).not.toHaveProperty('litos_token');
    expect(values).not.toHaveProperty('litos_profile');
    expect(values).not.toHaveProperty('litos_posthog_distinct_id');
  });

  it('clears every tab packet identity on logout without touching unrelated session state', async () => {
    sessionValues['litos_packet_applicant_identity:4'] = { userId: 'user-a' };
    sessionValues['litos_packet_applicant_identity:9'] = { userId: 'user-a' };
    sessionValues['litos_gated_attended_continuation:4:0'] = { applicationId: 'app-a' };
    sessionValues['litos_pending_extension_submission:4'] = { applicationId: 'app-a' };
    sessionValues.litos_armed_handoffs = [{ applicationId: 'app-a' }];
    sessionValues.litos_extension_handoff_packet_bindings = { 'app-a': {} };
    sessionValues.litos_application_tabs = { 'app-a': 4 };
    sessionValues.pendingDrafts = [{ contact: { full_name: 'Prior account contact' } }];
    sessionValues.lastDetectedJob = { title: 'Old owner job' };
    sessionValues.unrelated = true;
    values.litos_posthog_event_queue = [{ distinctId: 'prior-account' }];
    values.captcha_stalls = [{ company: 'Prior account company' }];
    await storage.clearAll();
    expect(sessionValues).toEqual({ unrelated: true });
    expect(values).not.toHaveProperty('litos_posthog_event_queue');
    expect(values).not.toHaveProperty('captcha_stalls');
  });

  it('routes popup logout through one background-owned clear and fails closed without confirmation', async () => {
    await storage.setToken('owner-token');
    await storage.setProfile({ email: 'owner@example.com' } as never);
    let clearCalls = 0;
    await requestBackgroundSessionClear(((_message: unknown, callback: (response: { ok: boolean }) => void) => {
      clearCalls += 1;
      void storage.clearAll().then(() => callback({ ok: true }));
    }) as typeof chrome.runtime.sendMessage);
    expect(clearCalls).toBe(1);
    expect(await storage.getToken()).toBeNull();
    expect(await storage.getProfile()).toBeNull();

    await expect(requestBackgroundSessionClear(((_message: unknown, callback: (response: { ok: boolean; error: string }) => void) => {
      callback({ ok: false, error: 'background cleanup failed' });
    }) as typeof chrome.runtime.sendMessage)).rejects.toThrow('background cleanup failed');
  });

  it('handles popup logout internally and cannot reuse the prior account entitlement cache', async () => {
    await storage.setToken('owner-token');
    await storage.setProfile({ email: 'owner@example.com' } as never);
    await entitlements.cacheEntitlements({
      schema_version: 2,
      policy_version: 'litos-entitlements-v2',
      account_id: 'owner-account',
      revision: 'paid-1',
      evaluated_at: '2026-08-14T00:00:00.000Z',
      access_class: 'plus_paid',
      product: 'litos_plus',
      term: 'month',
      features: {
        application_fill: true,
        hover_generation: true,
        automatic_submission: true,
      } as EntitlementSnapshotV2['features'],
      trial: null,
      legacy_limits: null,
      subscription: null,
    });
    sessionValues.litos_pending_checkout = { plan_id: 'litos_plus_month' };

    const handleClear = createSessionClearMessageHandler(async () => {
      await Promise.all([
        storage.clearAll(),
        chrome.storage.session.remove('litos_pending_checkout'),
      ]);
    });
    await requestBackgroundSessionClear(((message: unknown, callback: (response: { ok: boolean }) => void) => {
      expect(handleClear(message, callback)).toBe(true);
    }) as typeof chrome.runtime.sendMessage);

    expect(await storage.getToken()).toBeNull();
    expect(await entitlements.readCachedEntitlements()).toBeNull();
    expect(sessionValues).not.toHaveProperty('litos_pending_checkout');

    const clearingEpoch = storage.currentAuthEpoch();
    expect(storage.authEpochIsCurrent(clearingEpoch)).toBe(false);
    storage.completeAuthSessionClear();
    expect(storage.currentAuthEpoch()).toBeGreaterThan(clearingEpoch);
    expect(storage.authEpochIsCurrent(storage.currentAuthEpoch())).toBe(true);
    expect(await entitlements.readCachedEntitlements()).toBeNull();
  });

  it('removes a packet write that finishes after logout invalidates its auth epoch', async () => {
    await storage.setToken('packet-owner-token');
    delaySessionWrite = true;
    const write = packetIdentity.storePacketApplicantIdentity({
      tabId: 7,
      userId: '33333333-3333-4333-8333-333333333333',
      applicationId: '22222222-2222-4222-8222-222222222222',
      email: 'app-2222222222-abcdef012345@apply.trylitos.com',
      portalUrl: 'https://acme.myworkdayjobs.com/job/1/apply',
      routeFingerprint: '11111111111111111111',
      expectedAuthEpoch: storage.currentAuthEpoch(),
    });
    while (!sessionWriteStarted) await Promise.resolve();
    const logout = requestBackgroundSessionClear(((_message: unknown, callback: (response: { ok: boolean }) => void) => {
      void storage.clearAll().then(() => callback({ ok: true }));
    }) as typeof chrome.runtime.sendMessage);
    releaseSessionWrite?.();
    await expect(write).rejects.toThrow('signed-in session changed');
    await logout;
    expect(sessionValues).toEqual({});
  });
});
