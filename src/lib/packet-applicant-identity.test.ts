import { beforeEach, describe, expect, it, vi } from 'vitest';

const sessionValues: Record<string, unknown> = {};

Object.defineProperty(globalThis, 'chrome', {
  configurable: true,
  value: {
    storage: {
      session: {
        get: vi.fn(async (key: string | null) => key === null ? { ...sessionValues } : key in sessionValues ? { [key]: sessionValues[key] } : {}),
        set: vi.fn(async (patch: Record<string, unknown>) => Object.assign(sessionValues, patch)),
        remove: vi.fn(async (key: string | string[]) => { for (const item of Array.isArray(key) ? key : [key]) delete sessionValues[item]; }),
      },
    },
  },
});

const identity = await import('./packet-applicant-identity');
const { runBoundedWorkdayAccountAction } = await import('./workday-account-flow');

describe('packet applicant identity across Workday navigation', () => {
  const userId = '33333333-3333-4333-8333-333333333333';
  beforeEach(() => {
    for (const key of Object.keys(sessionValues)) delete sessionValues[key];
  });

  it('survives navigation from a Workday job URL to its account creation route in the same tab', async () => {
    await identity.storePacketApplicantIdentity({
      tabId: 42,
      userId,
      applicationId: '22222222-2222-4222-8222-222222222222',
      email: 'App-2222222222-abcdef012345@Apply.TryLitos.com',
      portalUrl: 'https://acme.wd5.myworkdayjobs.com/en-US/jobs/job/engineer',
      routeFingerprint: '11111111111111111111',
      now: 1_000,
    });
    await expect(identity.readPacketApplicantIdentity({
      tabId: 42,
      userId,
      portalUrl: 'https://acme.wd5.myworkdayjobs.com/en-US/jobs/createAccount',
      now: 2_000,
    })).resolves.toMatchObject({
      applicationId: '22222222-2222-4222-8222-222222222222',
      email: 'app-2222222222-abcdef012345@apply.trylitos.com',
    });
  });

  it('fails closed before signup when no packet identity exists', async () => {
    await expect(identity.readPacketApplicantIdentity({
      tabId: 42,
      userId,
      portalUrl: 'https://acme.wd5.myworkdayjobs.com/en-US/jobs/createAccount',
    })).resolves.toBeNull();
  });

  it('does not leak a packet identity into another tab or employer portal', async () => {
    await identity.storePacketApplicantIdentity({
      tabId: 42,
      userId,
      applicationId: '22222222-2222-4222-8222-222222222222',
      email: 'app-2222222222-abcdef012345@apply.trylitos.com',
      portalUrl: 'https://acme.wd5.myworkdayjobs.com/job/engineer',
      routeFingerprint: '11111111111111111111',
      now: 1_000,
    });
    await expect(identity.readPacketApplicantIdentity({
      tabId: 43,
      userId,
      portalUrl: 'https://acme.wd5.myworkdayjobs.com/createAccount',
      now: 2_000,
    })).resolves.toBeNull();
    await expect(identity.readPacketApplicantIdentity({
      tabId: 42,
      userId,
      portalUrl: 'https://globex.myworkdayjobs.com/createAccount',
      now: 2_000,
    })).resolves.toBeNull();
  });

  it('does not let a second signed-in user reuse the first user packet in the same tab', async () => {
    await identity.storePacketApplicantIdentity({
      tabId: 42,
      userId,
      applicationId: '22222222-2222-4222-8222-222222222222',
      email: 'app-2222222222-abcdef012345@apply.trylitos.com',
      portalUrl: 'https://acme.wd5.myworkdayjobs.com/job/engineer',
      routeFingerprint: '11111111111111111111',
    });
    const current = await identity.readPacketApplicantIdentity({
      tabId: 42,
      userId: '44444444-4444-4444-8444-444444444444',
      portalUrl: 'https://acme.wd5.myworkdayjobs.com/createAccount',
    });
    expect(current).toBeNull();
    const click = vi.fn();
    if (current) {
      await runBoundedWorkdayAccountAction({
        action: 'create',
        control: { isConnected: true, click } as unknown as HTMLButtonElement,
        inspectGate: () => ({ kind: 'clear' }),
      });
    }
    expect(click).not.toHaveBeenCalled();
    await identity.clearAllPacketApplicantIdentities();
    await expect(identity.peekPacketApplicantIdentity({
      tabId: 42,
      portalUrl: 'https://acme.wd5.myworkdayjobs.com/createAccount',
    })).resolves.toBeNull();
  });

  it('fails closed when the receiving route switches before Workday account creation', () => {
    const prepared = {
      applicationId: '22222222-2222-4222-8222-222222222222',
      email: 'applications+app-2222222222-abcdef012345@trylitos.com',
      portalKey: 'acme.wd5.myworkdayjobs.com',
      storedAt: 1_000,
      routeFingerprint: '11111111111111111111',
    };
    expect(identity.packetIdentityMatchesCurrentRoute(prepared, {
      tracking_active: true,
      domain: 'applications.trylitos.com',
      route_generation_fingerprint: '11111111111111111111',
    })).toBe(false);
  });

  it('accepts only the current healthy dedicated or mailbox route for this application', () => {
    const prepared = {
      applicationId: '22222222-2222-4222-8222-222222222222',
      email: 'app-2222222222-abcdef012345@applications.trylitos.com',
      portalKey: 'acme.wd5.myworkdayjobs.com',
      storedAt: 1_000,
      routeFingerprint: '11111111111111111111',
    };
    expect(identity.packetIdentityMatchesCurrentRoute(prepared, {
      tracking_active: true,
      domain: 'applications.trylitos.com',
      route_generation_fingerprint: '11111111111111111111',
    })).toBe(true);
    expect(identity.packetIdentityMatchesCurrentRoute({
      ...prepared,
      email: 'applications+app-2222222222-abcdef012345@trylitos.com',
    }, {
      tracking_active: true,
      domain: 'applications@trylitos.com',
      route_generation_fingerprint: '11111111111111111111',
    })).toBe(true);
    expect(identity.packetIdentityMatchesCurrentRoute(prepared, {
      tracking_active: false,
      domain: 'applications.trylitos.com',
      route_generation_fingerprint: '11111111111111111111',
    })).toBe(false);
  });

  it('fails closed when the alias secret rotates without changing the domain', () => {
    const prepared = {
      applicationId: '22222222-2222-4222-8222-222222222222',
      email: 'app-2222222222-abcdef012345@applications.trylitos.com',
      routeFingerprint: '11111111111111111111',
    };
    expect(identity.packetIdentityMatchesCurrentRoute(prepared, {
      tracking_active: true,
      domain: 'applications.trylitos.com',
      route_generation_fingerprint: '22222222222222222222',
    })).toBe(false);
  });
});
