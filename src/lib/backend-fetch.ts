import { API_BASE } from './config';
import { litosClientHeaders } from './product';

export interface BackendFetchOptions {
  token?: string;
  timeoutMs?: number;
}

/**
 * Fetch a Litos backend route with the extension identity and optional session.
 *
 * Keeping transport policy here prevents background tasks and popup API calls
 * from drifting on client headers, authorization, or timeout behavior.
 */
export function backendFetch(
  path: string,
  init: RequestInit = {},
  options: BackendFetchOptions = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(litosClientHeaders())) {
    headers.set(name, value);
  }
  if (options.token) {
    headers.set('Authorization', `Bearer ${options.token}`);
  }

  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    signal:
      options.timeoutMs === undefined
        ? init.signal
        : AbortSignal.timeout(options.timeoutMs),
  });
}
