import { beforeEach, describe, expect, it, vi } from 'vitest';

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
const { requestBackgroundSessionClear } = await import('./popup-session');

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
    sessionValues.unrelated = true;
    await storage.clearAll();
    expect(sessionValues).toEqual({ unrelated: true });
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
