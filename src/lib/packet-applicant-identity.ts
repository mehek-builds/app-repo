const KEY_PREFIX = 'litos_packet_applicant_identity';
const MAX_AGE_MS = 6 * 60 * 60_000;

export type PacketApplicantIdentity = {
  userId: string;
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
  userId: string;
  applicationId: string;
  email: string;
  portalUrl: string;
  routeFingerprint: string;
  expectedAuthEpoch?: number;
  now?: number;
}): Promise<void> {
  const expectedAuthEpoch = input.expectedAuthEpoch ?? currentAuthEpoch();
  if (!authEpochIsCurrent(expectedAuthEpoch)) throw new Error('The signed-in session changed before the packet could be stored');
  const email = normalizedEmail(input.email);
  const portalKey = packetPortalKey(input.portalUrl);
  if (!email || !portalKey || !input.applicationId.trim() || !isUuid(input.userId)) {
    throw new Error('A complete packet applicant identity is required');
  }
  if (!/^[a-f0-9]{20}$/i.test(input.routeFingerprint)) {
    throw new Error('A current application email route fingerprint is required');
  }
  const identity: PacketApplicantIdentity = {
    userId: input.userId.toLowerCase(),
    applicationId: input.applicationId,
    email,
    portalKey,
    routeFingerprint: input.routeFingerprint.toLowerCase(),
    storedAt: input.now ?? Date.now(),
  };
  await chrome.storage.session.set({ [storageKey(input.tabId)]: identity });
  if (!authEpochIsCurrent(expectedAuthEpoch)) {
    await chrome.storage.session.remove(storageKey(input.tabId));
    throw new Error('The signed-in session changed before the packet could be stored');
  }
}

export async function peekPacketApplicantIdentity(input: {
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
    || !isUuid(identity.userId)
    || typeof identity.routeFingerprint !== 'string'
    || !/^[a-f0-9]{20}$/.test(identity.routeFingerprint)
    || !Number.isFinite(identity.storedAt)
    || now - identity.storedAt > MAX_AGE_MS
    || identity.storedAt > now + 60_000
  ) return null;
  return { ...identity, email };
}

export async function readPacketApplicantIdentity(input: {
  tabId: number;
  portalUrl: string;
  userId: string;
  now?: number;
}): Promise<PacketApplicantIdentity | null> {
  const identity = await peekPacketApplicantIdentity(input);
  if (!identity || !isUuid(input.userId) || identity.userId !== input.userId.toLowerCase()) return null;
  return identity;
}

export async function clearPacketApplicantIdentity(tabId: number): Promise<void> {
  await chrome.storage.session.remove(storageKey(tabId));
}

export async function clearAllPacketApplicantIdentities(): Promise<void> {
  const stored = await chrome.storage.session.get(null);
  const keys = Object.keys(stored).filter((key) => key.startsWith(`${KEY_PREFIX}:`));
  if (keys.length) await chrome.storage.session.remove(keys);
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

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
import { authEpochIsCurrent, currentAuthEpoch } from './storage';
