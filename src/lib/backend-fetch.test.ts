import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_BASE } from './config';
import { backendFetch } from './backend-fetch';

describe('backendFetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('adds the extension contract and bearer token without dropping caller headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await backendFetch(
      '/profile',
      { headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'request-1' } },
      { token: 'session-token' },
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(url).toBe(`${API_BASE}/profile`);
    expect(headers.get('Authorization')).toBe('Bearer session-token');
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get('X-Litos-Client')).toBe('extension');
    expect(headers.get('X-Litos-Version')).toBe('0.5.7');
    expect(headers.get('X-Request-Id')).toBe('request-1');
  });

  it('keeps an existing signal when no timeout policy is requested', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await backendFetch('/v1/meta', { signal: controller.signal });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBe(controller.signal);
  });
});
