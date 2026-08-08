const KEY_PREFIX = 'litos_packet_applicant_identity';
const MAX_AGE_MS = 6 * 60 * 60_000;

export type PacketApplicantIdentity = {
  applicationId: string;
  email: string;
  portalKey: string;
  routeFingerprint: string;
  storedAt: number;
};

export type ApplicationEmailRouteState = {
  tracking_active?: unknown;
  domain?: unknown;
  route_generation_fingerprint?: unknown;
};

function storageKey(tabId: number): string {
  return `${KEY_PREFIX}:${tabId}`;
}

function normalizedEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null;
}

export function packetPortalKey(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

export async function storePacketApplicantIdentity(input: {
  tabId: number;
  applicationId: string;
  email: string;
  portalUrl: string;
  routeFingerprint: string;
  now?: number;
}): Promise<void> {
  const email = normalizedEmail(input.email);
  const portalKey = packetPortalKey(input.portalUrl);
  if (!email || !portalKey || !input.applicationId.trim()) {
    throw new Error('A complete packet applicant identity is required');
  }
  if (!/^[a-f0-9]{20}$/i.test(input.routeFingerprint)) {
    throw new Error('A current application email route fingerprint is required');
  }
  const identity: PacketApplicantIdentity = {
    applicationId: input.applicationId,
    email,
    portalKey,
    routeFingerprint: input.routeFingerprint.toLowerCase(),
    storedAt: input.now ?? Date.now(),
  };
  await chrome.storage.session.set({ [storageKey(input.tabId)]: identity });
}

export async function readPacketApplicantIdentity(input: {
  tabId: number;
  portalUrl: string;
  now?: number;
}): Promise<PacketApplicantIdentity | null> {
  const key = storageKey(input.tabId);
  const stored = await chrome.storage.session.get(key);
  const identity = stored[key] as PacketApplicantIdentity | undefined;
  const portalKey = packetPortalKey(input.portalUrl);
  const email = normalizedEmail(identity?.email);
  const now = input.now ?? Date.now();
  if (
    !identity
    || !email
    || !portalKey
    || identity.portalKey !== portalKey
    || typeof identity.applicationId !== 'string'
    || !identity.applicationId
    || typeof identity.routeFingerprint !== 'string'
    || !/^[a-f0-9]{20}$/.test(identity.routeFingerprint)
    || !Number.isFinite(identity.storedAt)
    || now - identity.storedAt > MAX_AGE_MS
    || identity.storedAt > now + 60_000
  ) return null;
  return { ...identity, email };
}

export async function clearPacketApplicantIdentity(tabId: number): Promise<void> {
  await chrome.storage.session.remove(storageKey(tabId));
}

export function packetIdentityMatchesCurrentRoute(
  identity: Pick<PacketApplicantIdentity, 'applicationId' | 'email' | 'routeFingerprint'>,
  route: ApplicationEmailRouteState,
): boolean {
  const fingerprint = (route as { route_generation_fingerprint?: unknown }).route_generation_fingerprint;
  if (
    route.tracking_active !== true
    || typeof route.domain !== 'string'
    || typeof fingerprint !== 'string'
    || !/^[a-f0-9]{20}$/.test(fingerprint)
    || fingerprint !== identity.routeFingerprint
  ) return false;
  const routeLabel = route.domain.trim().toLowerCase();
  const applicationPrefix = identity.applicationId.replace(/-/g, '').slice(0, 10).toLowerCase();
  if (!/^[a-f0-9]{10}$/.test(applicationPrefix)) return false;
  const dedicated = routeLabel.match(/^([a-z0-9.-]+\.[a-z]{2,})$/i);
  const mailbox = routeLabel.match(/^([a-z0-9.!#$%&'*+/=?^_`{|}~-]+)@([a-z0-9.-]+\.[a-z]{2,})$/i);
  const expectedLocalPrefix = mailbox
    ? `${mailbox[1]}+app-${applicationPrefix}-`
    : `app-${applicationPrefix}-`;
  const expectedDomain = mailbox?.[2] ?? dedicated?.[1];
  if (!expectedDomain) return false;
  return new RegExp(`^${escapeRegex(expectedLocalPrefix)}[a-f0-9]{12}@${escapeRegex(expectedDomain)}$`)
    .test(identity.email);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
