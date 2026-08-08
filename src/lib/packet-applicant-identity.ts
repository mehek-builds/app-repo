const KEY_PREFIX = 'litos_packet_applicant_identity';
const MAX_AGE_MS = 6 * 60 * 60_000;

export type PacketApplicantIdentity = {
  applicationId: string;
  email: string;
  portalKey: string;
  storedAt: number;
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
  now?: number;
}): Promise<void> {
  const email = normalizedEmail(input.email);
  const portalKey = packetPortalKey(input.portalUrl);
  if (!email || !portalKey || !input.applicationId.trim()) {
    throw new Error('A complete packet applicant identity is required');
  }
  const identity: PacketApplicantIdentity = {
    applicationId: input.applicationId,
    email,
    portalKey,
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
    || !Number.isFinite(identity.storedAt)
    || now - identity.storedAt > MAX_AGE_MS
    || identity.storedAt > now + 60_000
  ) return null;
  return { ...identity, email };
}

export async function clearPacketApplicantIdentity(tabId: number): Promise<void> {
  await chrome.storage.session.remove(storageKey(tabId));
}
