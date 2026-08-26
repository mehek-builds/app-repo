import {
  applicationFormIdentityKey,
  handoffKey,
  handoffMatches,
} from './web-handoff';

export type FreeFillHandoffFailureCode =
  | 'authentication_required'
  | 'invalid_application'
  | 'unsafe_portal_url'
  | 'application_not_found'
  | 'portal_mismatch'
  | 'account_changed'
  | 'invalid_handoff_response'
  | 'handoff_failed';

export type FreeFillHandoffFailure = {
  ok: false;
  error: string;
  code: FreeFillHandoffFailureCode;
};

export type FreeFillHandoffSuccess = {
  ok: true;
  applicationId: string;
  portalUrl: string;
  accountId: string;
  authEpoch: number;
};

export type FreeFillHandoffResult = FreeFillHandoffFailure | FreeFillHandoffSuccess;

export class FreeFillHandoffRequestError extends Error {
  readonly code: FreeFillHandoffFailureCode;

  constructor(code: FreeFillHandoffFailureCode, message: string) {
    super(message);
    this.name = 'FreeFillHandoffRequestError';
    this.code = code;
  }
}

type ParsedRequest = {
  applicationId: string;
  portalUrl: string;
};

type VerifiedProof = {
  applicationId: string;
  portalUrl: string;
  accountId: string;
};

export type FreeFillHandoffDependencies = {
  currentAuthEpoch: () => number;
  authEpochIsCurrent: (epoch: number) => boolean;
  getToken: () => Promise<string | null>;
  readAccount: (token: string, authEpoch: number) => Promise<{ account_id: string }>;
  readFillData: (
    token: string,
    applicationId: string,
    portalUrl: string,
    authEpoch: number,
  ) => Promise<unknown>;
};

const APPLICATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidFreeFillApplicationId(value: unknown): value is string {
  return typeof value === 'string' && APPLICATION_ID.test(value);
}

function failure(code: FreeFillHandoffFailureCode, error: string): FreeFillHandoffFailure {
  return { ok: false, error, code };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safePortalUrl(value: unknown): { url: string; identity: string } | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
    parsed.hash = '';
    const identity = applicationFormIdentityKey(parsed.toString());
    return identity ? { url: parsed.toString(), identity } : null;
  } catch {
    return null;
  }
}

export function freeFillPortalMatches(canonicalPortalUrl: unknown, livePortalUrl: unknown): boolean {
  const canonical = safePortalUrl(canonicalPortalUrl);
  const live = safePortalUrl(livePortalUrl);
  if (!canonical || !live) return false;
  if (canonical.identity === live.identity) return true;
  const canonicalKey = handoffKey(canonical.url);
  const liveKey = handoffKey(live.url);
  if (!canonicalKey || !liveKey || canonicalKey === liveKey) return false;
  return handoffMatches(canonicalKey, liveKey);
}

export function parseFreeFillHandoffRequest(value: unknown): ParsedRequest | FreeFillHandoffFailure {
  if (!isRecord(value) || !isValidFreeFillApplicationId(value.application_id)) {
    return failure('invalid_application', 'This Tracker application could not be identified.');
  }
  const portal = safePortalUrl(value.portal_url);
  if (!portal) return failure('unsafe_portal_url', 'This application does not have a secure company URL.');
  return {
    applicationId: value.application_id.toLowerCase(),
    portalUrl: portal.url,
  };
}

export function verifyFreeFillHandoffProof(
  request: ParsedRequest,
  accountId: string,
  value: unknown,
): VerifiedProof | FreeFillHandoffFailure {
  if (!isRecord(value)) {
    return failure('invalid_handoff_response', 'Litos could not verify this saved application.');
  }
  const proofApplicationId = typeof value.application_id === 'string' ? value.application_id.toLowerCase() : '';
  const proofAccountId = typeof value.account_id === 'string' ? value.account_id : '';
  const proofPortal = safePortalUrl(value.portal_url);
  if (!APPLICATION_ID.test(proofApplicationId) || !proofAccountId || !proofPortal) {
    return failure('invalid_handoff_response', 'Litos could not verify this saved application.');
  }
  if (proofApplicationId !== request.applicationId) {
    return failure('application_not_found', 'This Tracker application is no longer available to this account.');
  }
  if (proofAccountId !== accountId) {
    return failure('account_changed', 'The Litos account changed while this application was being opened.');
  }
  if (!freeFillPortalMatches(proofPortal.url, request.portalUrl)) {
    return failure('portal_mismatch', 'The company URL no longer matches this Tracker application.');
  }

  if (isRecord(value.application)) {
    const nestedId = typeof value.application.id === 'string' ? value.application.id.toLowerCase() : '';
    if (nestedId && nestedId !== request.applicationId) {
      return failure('invalid_handoff_response', 'Litos returned a different saved application.');
    }
    if (typeof value.application.portal_url === 'string') {
      const nestedPortal = safePortalUrl(value.application.portal_url);
      if (!nestedPortal || !freeFillPortalMatches(nestedPortal.url, request.portalUrl)) {
        return failure('portal_mismatch', 'The company URL no longer matches this Tracker application.');
      }
    }
  }

  return {
    applicationId: proofApplicationId,
    portalUrl: proofPortal.url,
    accountId: proofAccountId,
  };
}

export async function prepareFreeFillHandoff(
  message: unknown,
  dependencies: FreeFillHandoffDependencies,
): Promise<FreeFillHandoffResult> {
  const request = parseFreeFillHandoffRequest(message);
  if ('ok' in request) return request;
  const authEpoch = dependencies.currentAuthEpoch();
  try {
    const token = await dependencies.getToken();
    if (!dependencies.authEpochIsCurrent(authEpoch)) {
      return failure('account_changed', 'The Litos account changed while this application was being opened.');
    }
    if (!token) return failure('authentication_required', 'Sign in to Litos in the extension first.');

    const account = await dependencies.readAccount(token, authEpoch);
    if (!dependencies.authEpochIsCurrent(authEpoch)) {
      return failure('account_changed', 'The Litos account changed while this application was being opened.');
    }
    if (!account.account_id) {
      return failure('invalid_handoff_response', 'Litos could not verify the extension account.');
    }

    const fillData = await dependencies.readFillData(
      token,
      request.applicationId,
      request.portalUrl,
      authEpoch,
    );
    if (!dependencies.authEpochIsCurrent(authEpoch)) {
      return failure('account_changed', 'The Litos account changed while this application was being opened.');
    }
    const proof = verifyFreeFillHandoffProof(request, account.account_id, fillData);
    return 'ok' in proof
      ? proof
      : { ok: true, ...proof, authEpoch };
  } catch (error) {
    if (!dependencies.authEpochIsCurrent(authEpoch)) {
      return failure('account_changed', 'The Litos account changed while this application was being opened.');
    }
    if (error instanceof FreeFillHandoffRequestError) return failure(error.code, error.message);
    return failure('handoff_failed', 'Litos could not open this saved application. Try again.');
  }
}
