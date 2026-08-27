import type { Profile } from './types';
import { ANALYTICS_ID_KEY, ANALYTICS_QUEUE_KEY, CAPTCHA_STALLS_KEY } from './storage-keys';

// Litos is the current product name. RoleQuick and Volley keys remain read-only migration
// aliases so an extension update never signs out an existing user or loses their settings.
const TOKEN_KEY = 'litos_token';
const PROFILE_KEY = 'litos_profile';
const AUTO_SUBMIT_KEY = 'litos_auto_submit_enabled';
const PORTAL_SALT_KEY = 'litos_portal_salt';
const PORTAL_ACCOUNTS_KEY = 'litos_portal_accounts';
const PENDING_PORTAL_ACCOUNTS_KEY = 'litos_pending_portal_accounts';

let authEpoch = 0;
let authSessionActive = true;
let portalAccountMutation: Promise<void> = Promise.resolve();

export function currentAuthEpoch(): number {
  return authEpoch;
}

export function authEpochIsCurrent(expectedEpoch: number): boolean {
  return authSessionActive && Number.isSafeInteger(expectedEpoch) && expectedEpoch === authEpoch;
}

/** Fence every in-process account callback before logout starts its bounded evidence drain. */
export function deactivateAuthSessionForClear(): number {
  if (authSessionActive) {
    authEpoch += 1;
    authSessionActive = false;
  }
  return authEpoch;
}

/**
 * Called by the background only after every account-owned local and session value has been
 * removed. Advancing once more invalidates work that began during the asynchronous clear, while
 * reactivation lets a later popup sign-in use the now-empty background context without waiting
 * for the MV3 worker to restart.
 */
export function completeAuthSessionClear(): void {
  authEpoch += 1;
  authSessionActive = true;
}

function serializePortalAccountMutation<T>(operation: () => Promise<T>): Promise<T> {
  const result = portalAccountMutation.then(operation, operation);
  portalAccountMutation = result.then(() => undefined, () => undefined);
  return result;
}

const TOKEN_ALIASES = ['rolequick_token', 'volley_token'] as const;
const PROFILE_ALIASES = ['rolequick_profile', 'volley_profile'] as const;
const AUTO_SUBMIT_ALIASES = ['rolequick_auto_submit_enabled', 'volley_auto_submit_enabled'] as const;

const KEY_GROUPS: ReadonlyArray<readonly [current: string, ...aliases: string[]]> = [
  [TOKEN_KEY, ...TOKEN_ALIASES],
  [PROFILE_KEY, ...PROFILE_ALIASES],
  [AUTO_SUBMIT_KEY, ...AUTO_SUBMIT_ALIASES],
];

const ALL_KEYS: string[] = KEY_GROUPS.flatMap((group) => [...group]);

// Prefer the new key; fall back to the legacy Volley-era key so an existing install that has
// not migrated yet still reads its saved value.
function lastStorageError(): Error | null {
  const message = chrome.runtime.lastError?.message;
  return message ? new Error(`Could not access extension storage: ${message}`) : null;
}

function chromeStorageGetCompat<T>(key: string, aliases: readonly string[]): Promise<T | null> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get([key, ...aliases], (result) => {
      const error = lastStorageError();
      if (error) {
        reject(error);
        return;
      }
      const current = result[key] as T | undefined;
      const migrated = aliases.map((alias) => result[alias] as T | undefined).find((value) => value !== undefined);
      resolve(current ?? migrated ?? null);
    });
  });
}

function chromeStorageSet(key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [key]: value }, () => {
      const error = lastStorageError();
      if (error) reject(error);
      else resolve();
    });
  });
}

function chromeStorageRemove(keys: string | string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(keys, () => {
      const error = lastStorageError();
      if (error) reject(error);
      else resolve();
    });
  });
}

// One-time copy of any legacy Volley-era value into its new key when the new key is absent.
// Safe to call on every startup: it writes only when the new key is missing and the legacy key
// is present, and it leaves the legacy value in place as a fallback (clears remove both names).
export async function migrateLegacyStorage(): Promise<void> {
  await new Promise<void>((resolve) => {
    chrome.storage.local.get(ALL_KEYS, (result) => {
      const patch: Record<string, unknown> = {};
      for (const [current, ...aliases] of KEY_GROUPS) {
        const migrated = aliases.map((alias) => result[alias]).find((value) => value !== undefined);
        if (result[current] === undefined && migrated !== undefined) {
          patch[current] = migrated;
        }
      }
      if (Object.keys(patch).length === 0) {
        resolve();
        return;
      }
      chrome.storage.local.set(patch, () => resolve());
    });
  });
}

export async function getToken(): Promise<string | null> {
  return chromeStorageGetCompat<string>(TOKEN_KEY, TOKEN_ALIASES);
}

export async function setToken(token: string): Promise<void> {
  await chromeStorageSet(TOKEN_KEY, token);
  if ((await getToken()) !== token) throw new Error('Your sign-in could not be saved. Please try again.');
  authEpoch += 1;
  authSessionActive = true;
}

export async function clearToken(): Promise<void> {
  // Remove both names so the legacy-key fallback in getToken() cannot bring a cleared token back.
  return chromeStorageRemove([TOKEN_KEY, ...TOKEN_ALIASES]);
}

export async function getProfile(): Promise<Profile | null> {
  return chromeStorageGetCompat<Profile>(PROFILE_KEY, PROFILE_ALIASES);
}

export async function setProfile(profile: Profile): Promise<void> {
  await chromeStorageSet(PROFILE_KEY, profile);
  if (!(await getProfile())) throw new Error('Your profile could not be saved. Please try again.');
}

export async function clearAll(): Promise<void> {
  // Logout clears the token and profile (both new and legacy names). The auto-submit
  // preference and device salt stay in place, matching the original logout behavior. Account
  // authorizations are user-scoped and must be removed so the next Litos user on this Chrome
  // profile cannot inherit another person's employer account. Rotate the anonymous analytics id
  // as well so two accounts on one Chrome profile are never linked.
  deactivateAuthSessionForClear();
  await serializePortalAccountMutation(async () => {
    const entitlementPointer = await chromeStorageGetCompat<string>('litos:entitlements:v2:current-account', []);
    await chromeStorageRemove([
      TOKEN_KEY,
      ...TOKEN_ALIASES,
      PROFILE_KEY,
      ...PROFILE_ALIASES,
      ANALYTICS_ID_KEY,
      ANALYTICS_QUEUE_KEY,
      CAPTCHA_STALLS_KEY,
      PORTAL_ACCOUNTS_KEY,
      PENDING_PORTAL_ACCOUNTS_KEY,
      'litos:entitlements:v2:current-account',
      ...(entitlementPointer ? [`litos:entitlements:v2:${entitlementPointer}`] : []),
    ]);
    const session = chrome.storage.session;
    if (session) {
      const stored = await session.get(null);
      const userScopedSessionKeys = Object.keys(stored).filter((key) =>
        key.startsWith('litos_packet_applicant_identity:')
        || key.startsWith('litos_gated_attended_continuation:')
        || key.startsWith('litos_pending_extension_submission:')
        || key === 'litos_armed_handoffs'
        || key === 'litos_extension_handoff_packet_bindings'
        || key === 'litos_application_tabs'
        || key === 'pendingDrafts'
        || key === 'lastDetectedJob');
      if (userScopedSessionKeys.length) await session.remove(userScopedSessionKeys);
    }
  });
}

// Off by default: fill-and-stop (highlight Submit, student clicks) unless the student has
// explicitly opted in to the cancelable auto-submit countdown in the extension popup.
export async function getAutoSubmitEnabled(): Promise<boolean> {
  return (await chromeStorageGetCompat<boolean>(AUTO_SUBMIT_KEY, AUTO_SUBMIT_ALIASES)) ?? false;
}

export async function setAutoSubmitEnabled(enabled: boolean): Promise<void> {
  return chromeStorageSet(AUTO_SUBMIT_KEY, enabled);
}

// Per-install random salt for deriving reproducible per-tenant portal passwords (portal-password.ts).
// Generated once, lazily, then stable for the life of the install. Deliberately NOT cleared by
// clearAll(): a logout must not change the password Litos would re-derive for a Workday account the
// student already created, or they'd be locked out of their own application.
//
// Two content scripts in different tabs can hit the generate-then-write window at the same time.
// chrome.storage has no compare-and-swap, so this cannot be made truly atomic: the in-flight promise
// collapses the common same-context race, and the re-read after writing adopts whichever salt
// actually landed rather than trusting the one we just generated. The residual cross-tab window is
// closed downstream instead - every provisioned account records the salt fingerprint it was created
// under, so a stale salt is DETECTED at fill time and skipped, never silently used (see
// portal-password.ts and the account records below).
let portalSaltInFlight: Promise<string> | null = null;

export async function getPortalSalt(): Promise<string> {
  if (portalSaltInFlight) return portalSaltInFlight;
  portalSaltInFlight = (async () => {
    const existing = await chromeStorageGetCompat<string>(PORTAL_SALT_KEY, []);
    if (existing) return existing;
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const salt = btoa(String.fromCharCode(...bytes));
    await chromeStorageSet(PORTAL_SALT_KEY, salt);
    return (await chromeStorageGetCompat<string>(PORTAL_SALT_KEY, [])) ?? salt;
  })();
  try {
    return await portalSaltInFlight;
  } finally {
    portalSaltInFlight = null;
  }
}

// Which portal accounts Litos actually provisioned, and under which salt. This is the record that
// makes re-login safe: Litos re-fills a password ONLY where this says it set that password itself
// and the salt still matches. No record (account made by hand, or on another device) means no fill,
// which is why a wrong password can never be submitted on the student's behalf.
export interface PortalAccountRecord {
  userId: string;
  host: string;
  email: string;
  applicationId: string;
  saltFingerprint: string;
  createdAt: number;
}

export interface PendingPortalAccountRecord {
  userId: string;
  host: string;
  email: string;
  saltFingerprint: string;
  applicationId: string;
  requestedAt: number;
}

export function portalAccountStorageKey(userId: string, host: string, applicationId: string, email: string): string {
  return `${userId.toLowerCase()}\n${host.trim().toLowerCase().replace(/^www\./, '')}\n${applicationId.toLowerCase()}\n${email.trim().toLowerCase()}`;
}

export async function getPortalAccounts(): Promise<Record<string, PortalAccountRecord>> {
  return (await chromeStorageGetCompat<Record<string, PortalAccountRecord>>(PORTAL_ACCOUNTS_KEY, [])) ?? {};
}

export async function getPortalAccount(userId: string, host: string, applicationId: string, email: string): Promise<PortalAccountRecord | null> {
  return (await getPortalAccounts())[portalAccountStorageKey(userId, host, applicationId, email)] ?? null;
}

export async function recordPortalAccount(record: PortalAccountRecord): Promise<void> {
  await serializePortalAccountMutation(async () => {
    const accounts = await getPortalAccounts();
    const key = portalAccountStorageKey(record.userId, record.host, record.applicationId, record.email);
    if (accounts[key]) return;
    accounts[key] = { ...record, host: record.host.toLowerCase(), email: record.email.toLowerCase() };
    await chromeStorageSet(PORTAL_ACCOUNTS_KEY, accounts);
  });
}

export async function getPendingPortalAccounts(): Promise<Record<string, PendingPortalAccountRecord>> {
  return (await chromeStorageGetCompat<Record<string, PendingPortalAccountRecord>>(PENDING_PORTAL_ACCOUNTS_KEY, [])) ?? {};
}

export async function getPendingPortalAccount(userId: string, host: string, applicationId: string, email: string): Promise<PendingPortalAccountRecord | null> {
  return (await getPendingPortalAccounts())[portalAccountStorageKey(userId, host, applicationId, email)] ?? null;
}

export async function recordPendingPortalAccount(record: PendingPortalAccountRecord, expectedEpoch = currentAuthEpoch()): Promise<boolean> {
  return serializePortalAccountMutation(async () => {
    if (!authEpochIsCurrent(expectedEpoch)) return false;
    const key = portalAccountStorageKey(record.userId, record.host, record.applicationId, record.email);
    const active = await getPortalAccounts();
    if (active[key]) return false;
    const pending = await getPendingPortalAccounts();
    if (pending[key]) return false;
    pending[key] = { ...record, host: record.host.toLowerCase(), email: record.email.toLowerCase() };
    await chromeStorageSet(PENDING_PORTAL_ACCOUNTS_KEY, pending);
    if (!authEpochIsCurrent(expectedEpoch)) {
      const current = await getPendingPortalAccounts();
      delete current[key];
      await chromeStorageSet(PENDING_PORTAL_ACCOUNTS_KEY, current);
      return false;
    }
    return true;
  });
}

export async function pendingPortalAccountClaimIsCurrent(
  expectedEpoch: number,
  userId: string,
  host: string,
  applicationId: string,
  email: string,
): Promise<boolean> {
  return serializePortalAccountMutation(async () => {
    if (!authEpochIsCurrent(expectedEpoch)) return false;
    return Boolean((await getPendingPortalAccounts())[portalAccountStorageKey(userId, host, applicationId, email)]);
  });
}

export async function activatePendingPortalAccount(
  userId: string,
  host: string,
  email: string,
  applicationId: string,
  createdAt = Date.now(),
): Promise<boolean> {
  return serializePortalAccountMutation(async () => {
    const key = portalAccountStorageKey(userId, host, applicationId, email);
    const pending = await getPendingPortalAccounts();
    const claim = pending[key];
    if (!claim || claim.applicationId !== applicationId) return false;
    const active = await getPortalAccounts();
    if (!active[key]) {
      active[key] = {
        userId: claim.userId,
        host: claim.host,
        email: claim.email,
        applicationId: claim.applicationId,
        saltFingerprint: claim.saltFingerprint,
        createdAt,
      };
      await chromeStorageSet(PORTAL_ACCOUNTS_KEY, active);
    }
    delete pending[key];
    await chromeStorageSet(PENDING_PORTAL_ACCOUNTS_KEY, pending);
    return true;
  });
}

export async function abandonPendingPortalAccount(userId: string, host: string, email: string, applicationId: string): Promise<boolean> {
  return serializePortalAccountMutation(async () => {
    const key = portalAccountStorageKey(userId, host, applicationId, email);
    const pending = await getPendingPortalAccounts();
    if (pending[key]?.applicationId !== applicationId) return false;
    delete pending[key];
    await chromeStorageSet(PENDING_PORTAL_ACCOUNTS_KEY, pending);
    return true;
  });
}
