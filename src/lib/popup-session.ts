type SessionClearResponse = { ok?: boolean; error?: string } | undefined;

export function requestBackgroundSessionClear(
  sendMessage: typeof chrome.runtime.sendMessage = chrome.runtime.sendMessage.bind(chrome.runtime),
): Promise<void> {
  return new Promise((resolve, reject) => {
    sendMessage({ type: 'LITOS_CLEAR_SESSION' }, (response: SessionClearResponse) => {
      const runtimeError = chrome.runtime.lastError?.message;
      if (runtimeError || response?.ok !== true) {
        reject(new Error(response?.error ?? runtimeError ?? 'Litos could not sign out safely. Try again.'));
        return;
      }
      resolve();
    });
  });
}
