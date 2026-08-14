export type AccessClass =
  | 'free_new'
  | 'trial_plus'
  | 'free_grandfathered'
  | 'plus_paid'
  | 'legacy_paid';

export type LitosFeatureId =
  | 'application_fill'
  | 'application_tracking'
  | 'job_discovery'
  | 'base_resume_use'
  | 'saved_profile_use'
  | 'saved_answer_use'
  | 'document_management'
  | 'application_review'
  | 'manual_submission_controls'
  | 'account_data_controls'
  | 'ai_resume_tailoring'
  | 'ai_resume_feedback'
  | 'ai_cover_letter_generation'
  | 'ai_application_answer_generation'
  | 'saved_generated_versions'
  | 'contact_discovery'
  | 'outreach_email_generation'
  | 'networking_discovery'
  | 'referral_paths'
  | 'connected_companies'
  | 'advanced_job_insights'
  | 'recruiter_visibility'
  | 'hover_generation'
  | 'automatic_submission';

type TrialTiming = {
  starts_at: string;
  ends_at: string;
  active: boolean;
};

export type LegacyTrialEntitlementUsage = TrialTiming & {
  meter_policy: 'legacy_monthly_allowances';
};

export type V2TrialEntitlementUsage = TrialTiming & {
  meter_policy: 'litos_plus_v2_lifetime';
  tailored_resumes_used: number;
  tailored_resumes_limit: 5;
  cover_letters_used: number;
  cover_letters_limit: 5;
  answer_applications_used: number;
  answer_applications_limit: 5;
  outreach_companies_used: number;
  outreach_companies_limit: 5;
  company_usage: Array<{
    company_scope_key: string;
    company_name: string;
    contacts_used: number;
    contacts_limit: 2;
    drafts_used: number;
    drafts_limit: 2;
  }>;
};

export type TrialEntitlementUsage = LegacyTrialEntitlementUsage | V2TrialEntitlementUsage;

export interface EntitlementSnapshotV2 {
  schema_version: 2;
  policy_version: 'litos-entitlements-v2';
  account_id: string;
  revision: string;
  evaluated_at: string;
  access_class: AccessClass;
  product: 'litos_plus' | null;
  term: 'week' | 'month' | 'quarter' | 'year' | 'manual' | null;
  features: Record<LitosFeatureId, boolean>;
  trial: TrialEntitlementUsage | null;
  legacy_limits: null | {
    tailored_resumes_monthly: number;
    contacts_monthly: number;
    drafts_monthly: number;
    cover_letters_unmetered: boolean;
    application_answers_unmetered: boolean;
  };
  subscription: null | {
    provider: 'stripe' | 'lemonsqueezy' | 'manual';
    status: string;
    cancel_at_period_end: boolean;
    current_period_start: string | null;
    current_period_end: string | null;
    access_ends_at: string | null;
    management_available: boolean;
  };
}

export const ENTITLEMENT_CACHE_TTL_MS = 5 * 60_000;
const CURRENT_ACCOUNT_KEY = 'litos:entitlements:v2:current-account';
const CACHE_PREFIX = 'litos:entitlements:v2:';

type CachedEntitlements = {
  cached_at: number;
  snapshot: EntitlementSnapshotV2;
};

let cacheMutation: Promise<void> = Promise.resolve();

const ACCESS_CLASSES = new Set<AccessClass>([
  'free_new',
  'trial_plus',
  'free_grandfathered',
  'plus_paid',
  'legacy_paid',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeTrialEntitlement(value: unknown): TrialEntitlementUsage | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value) || typeof value.starts_at !== 'string' || typeof value.ends_at !== 'string') {
    throw new Error('Litos returned an invalid trial state.');
  }
  const timing = {
    starts_at: value.starts_at,
    ends_at: value.ends_at,
    active: value.active === true,
  };
  if (value.meter_policy === 'legacy_monthly_allowances') {
    return { ...timing, meter_policy: 'legacy_monthly_allowances' };
  }
  const numericKeys = [
    'tailored_resumes_used',
    'tailored_resumes_limit',
    'cover_letters_used',
    'cover_letters_limit',
    'answer_applications_used',
    'answer_applications_limit',
    'outreach_companies_used',
    'outreach_companies_limit',
  ] as const;
  if (
    value.meter_policy !== 'litos_plus_v2_lifetime'
    && !numericKeys.every((key) => typeof value[key] === 'number')
  ) throw new Error('Litos returned a trial state without a meter policy.');
  if (!numericKeys.every((key) => typeof value[key] === 'number' && Number.isFinite(value[key]))) {
    throw new Error('Litos returned invalid trial meters.');
  }
  if (!Array.isArray(value.company_usage)) throw new Error('Litos returned invalid company trial usage.');
  return {
    ...timing,
    meter_policy: 'litos_plus_v2_lifetime',
    tailored_resumes_used: value.tailored_resumes_used as number,
    tailored_resumes_limit: value.tailored_resumes_limit as 5,
    cover_letters_used: value.cover_letters_used as number,
    cover_letters_limit: value.cover_letters_limit as 5,
    answer_applications_used: value.answer_applications_used as number,
    answer_applications_limit: value.answer_applications_limit as 5,
    outreach_companies_used: value.outreach_companies_used as number,
    outreach_companies_limit: value.outreach_companies_limit as 5,
    company_usage: value.company_usage as V2TrialEntitlementUsage['company_usage'],
  };
}

function cacheKey(accountId: string): string {
  return `${CACHE_PREFIX}${accountId}`;
}

function localGet(keys: string[]): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (result) => {
      const message = chrome.runtime.lastError?.message;
      if (message) reject(new Error(`Could not access extension storage: ${message}`));
      else resolve(result);
    });
  });
}

function localSet(values: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(values, () => {
      const message = chrome.runtime.lastError?.message;
      if (message) reject(new Error(`Could not access extension storage: ${message}`));
      else resolve();
    });
  });
}

function localRemove(keys: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(keys, () => {
      const message = chrome.runtime.lastError?.message;
      if (message) reject(new Error(`Could not access extension storage: ${message}`));
      else resolve();
    });
  });
}

export function parseEntitlementSnapshot(value: unknown): EntitlementSnapshotV2 {
  const candidate = isRecord(value) && isRecord(value.entitlements) ? value.entitlements : value;
  if (!isRecord(candidate)) throw new Error('Litos returned an invalid plan state.');
  if (candidate.schema_version !== 2 || candidate.policy_version !== 'litos-entitlements-v2') {
    throw new Error('Litos returned an unsupported plan state.');
  }
  if (typeof candidate.account_id !== 'string' || !candidate.account_id.trim()) {
    throw new Error('Litos returned a plan state without an account owner.');
  }
  if (typeof candidate.revision !== 'string' || typeof candidate.evaluated_at !== 'string') {
    throw new Error('Litos returned an incomplete plan state.');
  }
  if (!ACCESS_CLASSES.has(candidate.access_class as AccessClass) || !isRecord(candidate.features)) {
    throw new Error('Litos returned an invalid access class.');
  }

  const features = Object.fromEntries(
    Object.entries(candidate.features).map(([key, enabled]) => [key, enabled === true]),
  ) as Record<LitosFeatureId, boolean>;
  features.application_fill = true;

  return {
    ...(candidate as unknown as EntitlementSnapshotV2),
    account_id: candidate.account_id.trim(),
    features,
    trial: normalizeTrialEntitlement(candidate.trial),
  };
}

export function featureEnabled(
  snapshot: EntitlementSnapshotV2 | null | undefined,
  feature: LitosFeatureId,
): boolean {
  return snapshot?.features?.[feature] === true;
}

export function isCachedEntitlementFresh(cachedAt: number, now = Date.now()): boolean {
  return Number.isFinite(cachedAt) && cachedAt <= now && now - cachedAt <= ENTITLEMENT_CACHE_TTL_MS;
}

export function preferNewerEntitlementSnapshot(
  current: EntitlementSnapshotV2 | null | undefined,
  incoming: EntitlementSnapshotV2,
): EntitlementSnapshotV2 {
  if (!current || current.account_id !== incoming.account_id) return incoming;
  const currentTime = Date.parse(current.evaluated_at);
  const incomingTime = Date.parse(incoming.evaluated_at);
  if (Number.isFinite(currentTime) && (!Number.isFinite(incomingTime) || incomingTime < currentTime)) {
    return current;
  }
  return incoming;
}

function serializeCacheMutation(operation: () => Promise<void>): Promise<void> {
  const result = cacheMutation.then(operation, operation);
  cacheMutation = result.then(() => undefined, () => undefined);
  return result;
}

export function cacheEntitlements(snapshot: EntitlementSnapshotV2): Promise<void> {
  return serializeCacheMutation(async () => {
    const prior = await localGet([CURRENT_ACCOUNT_KEY]);
    const priorAccount = typeof prior[CURRENT_ACCOUNT_KEY] === 'string' ? prior[CURRENT_ACCOUNT_KEY] : null;
    if (priorAccount && priorAccount !== snapshot.account_id) {
      await localRemove([cacheKey(priorAccount)]);
    } else if (priorAccount === snapshot.account_id) {
      const stored = await localGet([cacheKey(snapshot.account_id)]);
      const cached = stored[cacheKey(snapshot.account_id)];
      if (isRecord(cached)) {
        try {
          const current = parseEntitlementSnapshot(cached.snapshot);
          if (preferNewerEntitlementSnapshot(current, snapshot) === current) return;
        } catch {
          // Replace malformed cache state with the validated live snapshot below.
        }
      }
    }
    await localSet({
      [CURRENT_ACCOUNT_KEY]: snapshot.account_id,
      [cacheKey(snapshot.account_id)]: { cached_at: Date.now(), snapshot } satisfies CachedEntitlements,
    });
  });
}

export async function readCachedEntitlements(): Promise<CachedEntitlements | null> {
  const pointer = await localGet([CURRENT_ACCOUNT_KEY]);
  const accountId = typeof pointer[CURRENT_ACCOUNT_KEY] === 'string' ? pointer[CURRENT_ACCOUNT_KEY] : null;
  if (!accountId) return null;
  const stored = await localGet([cacheKey(accountId)]);
  const cached = stored[cacheKey(accountId)];
  if (!isRecord(cached) || typeof cached.cached_at !== 'number') return null;
  if (!isCachedEntitlementFresh(cached.cached_at)) {
    await localRemove([cacheKey(accountId)]);
    return null;
  }
  try {
    const snapshot = parseEntitlementSnapshot(cached.snapshot);
    if (snapshot.account_id !== accountId) return null;
    return { cached_at: cached.cached_at, snapshot };
  } catch {
    return null;
  }
}

export async function clearCachedEntitlements(): Promise<void> {
  const pointer = await localGet([CURRENT_ACCOUNT_KEY]);
  const accountId = typeof pointer[CURRENT_ACCOUNT_KEY] === 'string' ? pointer[CURRENT_ACCOUNT_KEY] : null;
  await localRemove([CURRENT_ACCOUNT_KEY, ...(accountId ? [cacheKey(accountId)] : [])]);
}

export function planLabel(snapshot: EntitlementSnapshotV2 | null | undefined): string {
  if (!snapshot) return 'Checking plan';
  if (snapshot.access_class === 'trial_plus') return 'Litos+ trial';
  if (snapshot.access_class === 'plus_paid' || snapshot.access_class === 'legacy_paid') {
    if (snapshot.subscription?.status === 'past_due') return 'Payment needs attention';
    if (snapshot.subscription?.cancel_at_period_end && snapshot.subscription.access_ends_at) {
      const date = new Date(snapshot.subscription.access_ends_at);
      return Number.isNaN(date.valueOf()) ? 'Litos+' : `Litos+ until ${date.toLocaleDateString()}`;
    }
    return 'Litos+';
  }
  if (snapshot.access_class === 'free_grandfathered') return 'Original plan';
  return 'Free';
}
