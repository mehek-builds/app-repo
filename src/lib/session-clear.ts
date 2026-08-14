export type SessionClearResponse = { ok: true } | { ok: false; error: string };

export function createSessionClearMessageHandler(clearSession: () => Promise<void>) {
  return (
    message: unknown,
    sendResponse: (response: SessionClearResponse) => void,
  ): boolean => {
    const type = message && typeof message === 'object'
      ? (message as { type?: unknown }).type
      : undefined;
    if (type !== 'LITOS_CLEAR_SESSION') return false;

    clearSession()
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({
        ok: false,
        error: 'Litos could not clear the extension session. Nothing changed in the popup.',
      }));
    return true;
  };
}
