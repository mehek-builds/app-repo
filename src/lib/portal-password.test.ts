import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mirrors storage.test.ts's chrome.storage.local stub: portal-password.ts reads its salt through
// storage.ts, so the derivation can't run at all without working extension storage. Node's own
// WebCrypto backs crypto.subtle here, so this file deliberately stays on the default node
// environment rather than opting into jsdom (whose crypto is only partially implemented).
const values: Record<string, unknown> = {};
let delayPendingWrite = false;
let releasePendingWrite: (() => void) | null = null;
let pendingWriteStarted: Promise<void> | null = null;

Object.defineProperty(globalThis, 'chrome', {
  configurable: true,
  value: {
    runtime: {
      get lastError() {
        return undefined;
      },
    },
    storage: {
      local: {
        get: vi.fn((keys: string[], callback: (result: Record<string, unknown>) => void) => {
          callback(Object.fromEntries(keys.filter((key) => key in values).map((key) => [key, values[key]])));
        }),
        set: vi.fn((patch: Record<string, unknown>, callback: () => void) => {
          if (delayPendingWrite && 'litos_pending_portal_accounts' in patch) {
            pendingWriteStarted = new Promise((resolve) => {
              releasePendingWrite = () => { delayPendingWrite = false; Object.assign(values, patch); callback(); resolve(); };
            });
            return;
          }
          Object.assign(values, patch);
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

const { derivePortalPassword, portalKeyForHost, currentSaltFingerprint } = await import('./portal-password');
const storage = await import('./storage');
const { runBoundedWorkdayAccountAction } = await import('./workday-account-flow');
const { requestBackgroundSessionClear } = await import('./popup-session');

const TENANT = 'acme.myworkdayjobs.com';
const EMAIL = 'application-1@apply.example.com';
const USER = '33333333-3333-4333-8333-333333333333';
const APP = 'application-1';

describe('portalKeyForHost', () => {
  it('strips a www. prefix so one tenant never derives two different passwords', () => {
    expect(portalKeyForHost('www.acme.myworkdayjobs.com')).toBe(TENANT);
  });

  it('lowercases the host', () => {
    expect(portalKeyForHost('ACME.MyWorkdayJobs.com')).toBe(TENANT);
  });
});

describe('derivePortalPassword', () => {
  beforeEach(async () => {
    for (const key of Object.keys(values)) delete values[key];
    delayPendingWrite = false;
    releasePendingWrite = null;
    pendingWriteStarted = null;
    await storage.setToken('test-token');
  });

  it('is deterministic: the same tenant always re-derives the same password', async () => {
    // The load-bearing property. Litos stores no password at rest, so logging the student back in
    // later works only if this is reproducible from the salt plus the hostname.
    const first = await derivePortalPassword(TENANT);
    expect(await derivePortalPassword(TENANT)).toBe(first);
  });

  it('derives a different password per tenant so one portal breach cannot open the rest', async () => {
    const acme = await derivePortalPassword(TENANT);
    expect(await derivePortalPassword('globex.myworkdayjobs.com')).not.toBe(acme);
  });

  it('treats www. and case variants of one tenant as the same account', async () => {
    const plain = await derivePortalPassword(TENANT);
    expect(await derivePortalPassword('www.acme.myworkdayjobs.com')).toBe(plain);
    expect(await derivePortalPassword('ACME.MyWorkdayJobs.com')).toBe(plain);
  });

  it('satisfies Workday complexity classes by construction', async () => {
    // Guaranteed by the trailing digit/special/Aa, not by luck in the random slice, so a strict
    // tenant can never reject the generated password.
    const password = await derivePortalPassword(TENANT);
    expect(password).toHaveLength(18);
    expect(password).toMatch(/[A-Z]/);
    expect(password).toMatch(/[a-z]/);
    expect(password).toMatch(/[0-9]/);
    expect(password).toMatch(/[!@#$%*?]/);
  });

  it('really depends on the salt: a reinstall derives a different password', async () => {
    const before = await derivePortalPassword(TENANT);
    for (const key of Object.keys(values)) delete values[key]; // cleared storage / fresh install
    expect(await derivePortalPassword(TENANT)).not.toBe(before);
  });

  it('generates the salt once rather than regenerating it per call', async () => {
    await derivePortalPassword(TENANT);
    const salt = values.litos_portal_salt;
    expect(salt).toBeTypeOf('string');
    await derivePortalPassword('globex.myworkdayjobs.com');
    expect(values.litos_portal_salt).toBe(salt);
  });

  it('hands concurrent callers the same salt', async () => {
    // Two tabs can hit the generate-then-write window together. If they end up on different salts,
    // whichever account was provisioned under the loser gets a password nobody can re-derive.
    const [a, b, c] = await Promise.all([
      derivePortalPassword(TENANT),
      derivePortalPassword(TENANT),
      derivePortalPassword(TENANT),
    ]);
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it('keeps the salt through logout but clears user-scoped account authorization', async () => {
    const before = await derivePortalPassword(TENANT);
    await storage.recordPortalAccount({ userId: USER, host: TENANT, email: EMAIL, applicationId: APP, saltFingerprint: 'fingerprint1', createdAt: 1 });
    await storage.clearAll();
    expect(await derivePortalPassword(TENANT)).toBe(before);
    expect(await storage.getPortalAccounts()).toEqual({});
  });
});

describe('salt fingerprint and provisioned-account records', () => {
  beforeEach(async () => {
    for (const key of Object.keys(values)) delete values[key];
    delayPendingWrite = false;
    releasePendingWrite = null;
    pendingWriteStarted = null;
    await storage.setToken('test-token');
  });

  it('is stable for one salt and changes when the salt does', async () => {
    const first = await currentSaltFingerprint();
    expect(await currentSaltFingerprint()).toBe(first);
    for (const key of Object.keys(values)) delete values[key]; // reinstall
    expect(await currentSaltFingerprint()).not.toBe(first);
  });

  it('does not leak the salt itself', async () => {
    const fingerprint = await currentSaltFingerprint();
    expect(fingerprint).toHaveLength(12);
    expect(values.litos_portal_salt).not.toContain(fingerprint);
  });

  it('remembers which tenants Litos provisioned, and under which salt', async () => {
    const saltFingerprint = await currentSaltFingerprint();
    await storage.recordPortalAccount({ userId: USER, host: TENANT, email: EMAIL, applicationId: APP, saltFingerprint, createdAt: 1 });
    expect(await storage.getPortalAccount(USER, TENANT, APP, EMAIL)).toEqual({
      userId: USER,
      host: TENANT,
      email: EMAIL,
      applicationId: APP,
      saltFingerprint,
      createdAt: 1,
    });
  });

  it('keeps the first record for a host so salt drift stays detectable', async () => {
    // Overwriting on re-provision would stamp the CURRENT salt onto an account created under an
    // older one, which is exactly the mismatch the record exists to catch.
    await storage.recordPortalAccount({ userId: USER, host: TENANT, email: EMAIL, applicationId: APP, saltFingerprint: 'original0000', createdAt: 1 });
    await storage.recordPortalAccount({ userId: USER, host: TENANT, email: EMAIL, applicationId: APP, saltFingerprint: 'drifted00000', createdAt: 2 });
    expect((await storage.getPortalAccount(USER, TENANT, APP, EMAIL))?.saltFingerprint).toBe('original0000');
  });

  it('returns an empty map before anything is provisioned', async () => {
    expect(await storage.getPortalAccounts()).toEqual({});
  });

  it('activates only a pending account claim and never stores a raw password', async () => {
    await storage.recordPendingPortalAccount({
      userId: USER,
      host: TENANT,
      email: EMAIL,
      saltFingerprint: 'fingerprint1',
      applicationId: 'application-1',
      requestedAt: 1,
    });
    expect(JSON.stringify(values)).not.toContain('Derived1!Aa');
    expect(await storage.activatePendingPortalAccount(USER, TENANT, EMAIL, APP, 2)).toBe(true);
    expect(await storage.getPortalAccount(USER, TENANT, APP, EMAIL)).toEqual({
      userId: USER,
      host: TENANT,
      email: EMAIL,
      applicationId: APP,
      saltFingerprint: 'fingerprint1',
      createdAt: 2,
    });
    expect(await storage.getPendingPortalAccounts()).toEqual({});
  });

  it('scopes crash-recovery claims to the exact application packet', async () => {
    expect(await storage.recordPendingPortalAccount({
      userId: USER,
      host: TENANT,
      email: EMAIL,
      saltFingerprint: 'first000000',
      applicationId: 'application-1',
      requestedAt: 1,
    })).toBe(true);
    expect(await storage.recordPendingPortalAccount({
      userId: USER,
      host: TENANT,
      email: EMAIL,
      saltFingerprint: 'second00000',
      applicationId: 'application-2',
      requestedAt: 2,
    })).toBe(true);
    expect((await storage.getPendingPortalAccount(USER, TENANT, APP, EMAIL))?.applicationId).toBe(APP);
    await storage.abandonPendingPortalAccount(USER, TENANT, EMAIL, APP);
    expect(await storage.getPendingPortalAccount(USER, TENANT, 'application-2', EMAIL)).not.toBeNull();
    await storage.abandonPendingPortalAccount(USER, TENANT, EMAIL, 'application-2');
    expect(await storage.getPendingPortalAccounts()).toEqual({});
  });

  it('serializes concurrent first claims so only one tab can create the same account', async () => {
    const claims = await Promise.all([
      storage.recordPendingPortalAccount({ userId: USER, host: TENANT, email: EMAIL, saltFingerprint: 'fingerprint1', applicationId: APP, requestedAt: 1 }),
      storage.recordPendingPortalAccount({ userId: USER, host: TENANT, email: EMAIL, saltFingerprint: 'fingerprint1', applicationId: APP, requestedAt: 1 }),
      storage.recordPendingPortalAccount({ userId: USER, host: TENANT, email: EMAIL, saltFingerprint: 'fingerprint1', applicationId: APP, requestedAt: 1 }),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it('invalidates a delayed claim during logout and never permits its account click', async () => {
    delayPendingWrite = true;
    const expectedEpoch = storage.currentAuthEpoch();
    const click = vi.fn();
    const control = { isConnected: true, click } as unknown as HTMLButtonElement;
    const action = runBoundedWorkdayAccountAction({
      action: 'create',
      control,
      resolveControl: () => control,
      inspectGate: () => ({ kind: 'clear' }),
      claim: () => storage.recordPendingPortalAccount({
        userId: USER, host: TENANT, email: EMAIL, applicationId: APP,
        saltFingerprint: 'fingerprint1', requestedAt: 1,
      }, expectedEpoch),
    });
    while (!pendingWriteStarted) await Promise.resolve();
    const logout = requestBackgroundSessionClear(((_message: unknown, callback: (response: { ok: boolean }) => void) => {
      void storage.clearAll().then(() => callback({ ok: true }));
    }) as typeof chrome.runtime.sendMessage);
    releasePendingWrite?.();
    expect(await action).toMatchObject({ started: false, reason: 'claim_denied' });
    await logout;
    expect(await storage.getPendingPortalAccounts()).toEqual({});
    expect(click).not.toHaveBeenCalled();
  });

  it('binds records to the exact alias and never authorizes a rotated packet email', async () => {
    await storage.recordPortalAccount({ userId: USER, host: TENANT, email: EMAIL, applicationId: APP, saltFingerprint: 'fingerprint1', createdAt: 1 });
    expect(await storage.getPortalAccount(USER, TENANT, APP, EMAIL.toUpperCase())).not.toBeNull();
    expect(await storage.getPortalAccount(USER, TENANT, APP, 'application-2@apply.example.com')).toBeNull();
  });

  it('abandons only the exact pending application claim', async () => {
    await storage.recordPendingPortalAccount({ userId: USER, host: TENANT, email: EMAIL, saltFingerprint: 'fingerprint1', applicationId: APP, requestedAt: 1 });
    expect(await storage.abandonPendingPortalAccount(USER, TENANT, EMAIL, 'application-2')).toBe(false);
    expect(await storage.getPendingPortalAccount(USER, TENANT, APP, EMAIL)).not.toBeNull();
    expect(await storage.abandonPendingPortalAccount(USER, TENANT, EMAIL, APP)).toBe(true);
    expect(await storage.getPendingPortalAccount(USER, TENANT, APP, EMAIL)).toBeNull();
  });
});
