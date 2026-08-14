import { freeFillPortalMatches, isValidFreeFillApplicationId } from './free-fill-handoff';
import type { OutreachDraftType } from './types';

export type ExtensionPremiumActionFeature =
  | 'ai_resume_tailoring'
  | 'contact_discovery'
  | 'outreach_email_generation'
  | 'automatic_submission';

export type ExtensionPremiumActionKind = 'application' | 'job' | 'extension_screen';

export type ExtensionPremiumContactSnapshot = {
  id: string;
  full_name: string;
  title: string;
  persona: 'alumni' | 'near_peer' | 'senior_ic' | 'hiring_manager' | 'recruiter';
  company_domain: string;
  school_match: boolean;
  linkedin_url?: string;
  email?: string;
  tier: 'green' | 'amber' | 'blue';
  status: 'verified' | 'likely' | 'linkedin_only' | 'none';
};

export type OutreachPremiumActionContext = {
  application_id: string;
  contact_id: string;
  contact: ExtensionPremiumContactSnapshot;
  company: string;
  role: string;
  portal_url?: string;
  operation_id: string;
  draft_type: OutreachDraftType;
  draft_subject?: string;
  draft_body?: string;
};

export type ExtensionPremiumActionContext = {
  feature_key: ExtensionPremiumActionFeature;
  kind: ExtensionPremiumActionKind;
  screen?: 'main' | 'draft' | 'autofill_setup';
  application_id?: string;
  job_id?: string;
  contact_id?: string;
  company?: string;
  role?: string;
  portal_url?: string;
  contact?: ExtensionPremiumContactSnapshot;
  operation_id?: string;
  draft_type?: OutreachDraftType;
  draft_subject?: string;
  draft_body?: string;
};

export type PendingExtensionPremiumAction = ExtensionPremiumActionContext & {
  action_nonce: string;
  account_id: string;
  return_route: string;
  created_at: number;
  expires_at: number;
  consumed_at?: number;
};

export type ServerPremiumAction = {
  feature_key?: unknown;
  application_id?: unknown;
  job_id?: unknown;
  contact_id?: unknown;
  return_route?: unknown;
  state?: unknown;
  expires_at?: unknown;
};

const FEATURE_BY_TRIGGER: Record<string, ExtensionPremiumActionFeature> = {
  ai_resume_tailoring: 'ai_resume_tailoring',
  contact_discovery: 'contact_discovery',
  outreach_email_generation: 'outreach_email_generation',
  automatic_submission: 'automatic_submission',
};

const FEATURES = new Set<ExtensionPremiumActionFeature>(Object.values(FEATURE_BY_TRIGGER));
const KINDS = new Set<ExtensionPremiumActionKind>(['application', 'job', 'extension_screen']);
const PERSONAS = new Set(['alumni', 'near_peer', 'senior_ic', 'hiring_manager', 'recruiter']);
const TIERS = new Set(['green', 'amber', 'blue']);
const CONTACT_STATUSES = new Set(['verified', 'likely', 'linkedin_only', 'none']);
const DRAFT_TYPES = new Set<OutreachDraftType>(['first_note', 'follow_up', 'thank_you', 'referral_ask', 'offer_stage']);

function boundedText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/g, ' ').trim().slice(0, max);
  return normalized || null;
}

function safePortalUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    const normalized = url.toString();
    return normalized.length <= 2048 ? normalized : null;
  } catch {
    return null;
  }
}

function optionalBoundedText(value: unknown, max: number): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return null;
  return value.slice(0, max);
}

function sanitizePremiumContact(value: unknown): ExtensionPremiumContactSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (!isValidFreeFillApplicationId(candidate.id)) return null;
  const fullName = boundedText(candidate.full_name, 200);
  const title = boundedText(candidate.title, 200);
  const companyDomain = boundedText(candidate.company_domain, 253)?.toLowerCase() ?? null;
  const linkedinUrl = candidate.linkedin_url === undefined || candidate.linkedin_url === ''
    ? undefined
    : safePortalUrl(candidate.linkedin_url);
  const email = candidate.email === undefined || candidate.email === ''
    ? undefined
    : boundedText(candidate.email, 320)?.toLowerCase() ?? null;
  if (
    !fullName
    || !title
    || !companyDomain
    || !/^[a-z0-9.-]+$/i.test(companyDomain)
    || companyDomain.includes('..')
    || typeof candidate.persona !== 'string'
    || !PERSONAS.has(candidate.persona)
    || typeof candidate.school_match !== 'boolean'
    || linkedinUrl === null
    || email === null
    || (email !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    || typeof candidate.tier !== 'string'
    || !TIERS.has(candidate.tier)
    || typeof candidate.status !== 'string'
    || !CONTACT_STATUSES.has(candidate.status)
  ) return null;
  return {
    id: candidate.id.toLowerCase(),
    full_name: fullName,
    title,
    persona: candidate.persona as ExtensionPremiumContactSnapshot['persona'],
    company_domain: companyDomain,
    school_match: candidate.school_match,
    ...(linkedinUrl ? { linkedin_url: linkedinUrl } : {}),
    ...(email ? { email } : {}),
    tier: candidate.tier as ExtensionPremiumContactSnapshot['tier'],
    status: candidate.status as ExtensionPremiumContactSnapshot['status'],
  };
}

export function premiumActionFeatureForTrigger(trigger: unknown): ExtensionPremiumActionFeature | null {
  if (typeof trigger !== 'string') return null;
  return FEATURE_BY_TRIGGER[trigger.trim()] ?? null;
}

export function sanitizeExtensionPremiumAction(
  trigger: unknown,
  value: unknown,
): ExtensionPremiumActionContext | null {
  const feature = premiumActionFeatureForTrigger(trigger);
  if (!feature) return null;
  if (feature === 'automatic_submission') {
    return { feature_key: feature, kind: 'extension_screen', screen: 'autofill_setup' };
  }
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const portalUrl = safePortalUrl(candidate.portal_url);
  if (candidate.portal_url !== undefined && candidate.portal_url !== null && !portalUrl) return null;
  const company = boundedText(candidate.company, 160);
  const role = boundedText(candidate.role, 200);
  if (!company || !role) return null;
  const applicationId = isValidFreeFillApplicationId(candidate.application_id)
    ? candidate.application_id.toLowerCase()
    : undefined;
  if (feature === 'outreach_email_generation') {
    const contact = sanitizePremiumContact(candidate.contact);
    const contactId = isValidFreeFillApplicationId(candidate.contact_id)
      ? candidate.contact_id.toLowerCase()
      : null;
    const operationId = isValidFreeFillApplicationId(candidate.operation_id)
      ? candidate.operation_id.toLowerCase()
      : null;
    const draftType = candidate.draft_type === undefined
      ? 'first_note'
      : typeof candidate.draft_type === 'string' && DRAFT_TYPES.has(candidate.draft_type as OutreachDraftType)
        ? candidate.draft_type as OutreachDraftType
        : null;
    const draftSubject = optionalBoundedText(candidate.draft_subject, 500);
    const draftBody = optionalBoundedText(candidate.draft_body, 20_000);
    if (
      !contact
      || !applicationId
      || !contactId
      || contact.id !== contactId
      || !operationId
      || !draftType
      || draftSubject === null
      || draftBody === null
    ) return null;
    return {
      feature_key: feature,
      kind: 'extension_screen',
      screen: 'draft',
      application_id: applicationId,
      contact_id: contactId,
      contact,
      company,
      role,
      ...(portalUrl ? { portal_url: portalUrl } : {}),
      operation_id: operationId,
      draft_type: draftType,
      ...(draftSubject === undefined ? {} : { draft_subject: draftSubject }),
      ...(draftBody === undefined ? {} : { draft_body: draftBody }),
    };
  }
  if (!portalUrl) {
    return feature === 'contact_discovery'
      && applicationId
      ? { feature_key: feature, kind: 'extension_screen', screen: 'main', application_id: applicationId, company, role }
      : null;
  }
  const jobId = isValidFreeFillApplicationId(candidate.job_id)
    ? candidate.job_id.toLowerCase()
    : undefined;
  return {
    feature_key: feature,
    kind: applicationId ? 'application' : 'job',
    ...(applicationId ? { application_id: applicationId } : {}),
    ...(jobId ? { job_id: jobId } : {}),
    company,
    role,
    portal_url: portalUrl,
  };
}

export function parsePendingExtensionPremiumAction(value: unknown): PendingExtensionPremiumAction | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.action_nonce !== 'string'
    || candidate.action_nonce.length < 20
    || candidate.action_nonce.length > 200
    || typeof candidate.account_id !== 'string'
    || !candidate.account_id
    || typeof candidate.feature_key !== 'string'
    || !FEATURES.has(candidate.feature_key as ExtensionPremiumActionFeature)
    || typeof candidate.kind !== 'string'
    || !KINDS.has(candidate.kind as ExtensionPremiumActionKind)
    || typeof candidate.return_route !== 'string'
    || !candidate.return_route.startsWith('/billing/')
    || typeof candidate.created_at !== 'number'
    || !Number.isFinite(candidate.created_at)
    || typeof candidate.expires_at !== 'number'
    || !Number.isFinite(candidate.expires_at)
    || (candidate.consumed_at !== undefined
      && (typeof candidate.consumed_at !== 'number' || !Number.isFinite(candidate.consumed_at)))
  ) return null;
  const applicationId = candidate.application_id === undefined
    ? undefined
    : isValidFreeFillApplicationId(candidate.application_id)
      ? candidate.application_id.toLowerCase()
      : null;
  const jobId = candidate.job_id === undefined
    ? undefined
    : isValidFreeFillApplicationId(candidate.job_id)
      ? candidate.job_id.toLowerCase()
      : null;
  const contactId = candidate.contact_id === undefined
    ? undefined
    : isValidFreeFillApplicationId(candidate.contact_id)
      ? candidate.contact_id.toLowerCase()
      : null;
  if (applicationId === null || jobId === null || contactId === null) return null;
  let extensionContext: ExtensionPremiumActionContext | null = null;
  if (candidate.kind === 'extension_screen') {
    if (candidate.feature_key === 'automatic_submission' && candidate.screen === 'autofill_setup') {
      extensionContext = sanitizeExtensionPremiumAction('automatic_submission', null);
    } else if (candidate.feature_key === 'contact_discovery' && candidate.screen === 'main') {
      extensionContext = sanitizeExtensionPremiumAction('contact_discovery', candidate);
    } else if (candidate.feature_key === 'outreach_email_generation' && candidate.screen === 'draft') {
      extensionContext = sanitizeExtensionPremiumAction('outreach_email_generation', candidate);
    }
    if (!extensionContext || extensionContext.kind !== 'extension_screen') return null;
  } else {
    if (!safePortalUrl(candidate.portal_url) || !boundedText(candidate.company, 160) || !boundedText(candidate.role, 200)) {
      return null;
    }
  }
  return {
    action_nonce: candidate.action_nonce,
    account_id: candidate.account_id,
    ...(extensionContext ?? {
      feature_key: candidate.feature_key as ExtensionPremiumActionFeature,
      kind: candidate.kind as ExtensionPremiumActionKind,
      company: boundedText(candidate.company, 160)!,
      role: boundedText(candidate.role, 200)!,
      portal_url: safePortalUrl(candidate.portal_url)!,
    }),
    return_route: candidate.return_route,
    created_at: candidate.created_at,
    expires_at: candidate.expires_at,
    ...(candidate.consumed_at === undefined ? {} : { consumed_at: candidate.consumed_at as number }),
    ...(applicationId ? { application_id: applicationId } : {}),
    ...(jobId ? { job_id: jobId } : {}),
    ...(contactId ? { contact_id: contactId } : {}),
  };
}

export function serverPremiumActionMatches(
  pending: PendingExtensionPremiumAction,
  server: ServerPremiumAction | null,
  allowedStates: readonly string[] = ['pending'],
): boolean {
  if (!server || !allowedStates.includes(String(server.state))) return false;
  const serverApplicationId = typeof server.application_id === 'string' ? server.application_id.toLowerCase() : undefined;
  const serverJobId = typeof server.job_id === 'string' ? server.job_id.toLowerCase() : undefined;
  const serverContactId = typeof server.contact_id === 'string' ? server.contact_id.toLowerCase() : undefined;
  return server.feature_key === pending.feature_key
    && serverApplicationId === pending.application_id
    && serverJobId === pending.job_id
    && serverContactId === pending.contact_id
    && server.return_route === pending.return_route;
}

export function verifiedServerPremiumActionExpiry(
  pending: PendingExtensionPremiumAction,
  server: ServerPremiumAction | null,
  allowedStates: readonly string[] = ['pending'],
  now = Date.now(),
): number | null {
  if (!serverPremiumActionMatches(pending, server, allowedStates) || typeof server?.expires_at !== 'string') {
    return null;
  }
  const expiresAt = Date.parse(server.expires_at);
  return Number.isFinite(expiresAt) && expiresAt > now ? expiresAt : null;
}

export function premiumRetryPortalMatches(pending: PendingExtensionPremiumAction, currentUrl: string): boolean {
  return Boolean(pending.portal_url && freeFillPortalMatches(pending.portal_url, currentUrl));
}

export function premiumRetryControlSelector(feature: ExtensionPremiumActionFeature): string | null {
  if (feature === 'ai_resume_tailoring') return '#wp-resume-yes';
  if (feature === 'contact_discovery' || feature === 'outreach_email_generation') return '#wp-yes';
  return null;
}
