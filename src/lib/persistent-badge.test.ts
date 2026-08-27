// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installPersistentBadge, supportsPersistentBadge } from './persistent-badge';

describe('persistent launcher', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('stays limited to the supported launcher hosts', () => {
    expect(supportsPersistentBadge('boards.greenhouse.io')).toBe(true);
    expect(supportsPersistentBadge('www.indeed.com')).toBe(true);
    expect(supportsPersistentBadge('example.com')).toBe(false);
  });

  it('mounts a keyboard-operable button that requests the real popup', () => {
    const sendMessage = vi.fn((_message, callback) => callback({ ok: true }));
    vi.stubGlobal('chrome', {
      runtime: {
        lastError: undefined,
        sendMessage,
      },
    });

    installPersistentBadge('boards.greenhouse.io');

    const launcher = document.querySelector<HTMLButtonElement>('#litos-persistent-btn');
    expect(launcher).toBeInstanceOf(HTMLButtonElement);
    expect(launcher?.type).toBe('button');
    expect(launcher?.tabIndex).toBe(0);
    expect(launcher?.getAttribute('aria-label')).toBe('Open Litos');

    launcher?.click();
    expect(sendMessage).toHaveBeenCalledWith({ type: 'OPEN_LITOS_POPUP' }, expect.any(Function));
  });

  it('does not mount outside the supported host list', () => {
    installPersistentBadge('example.com');
    expect(document.querySelector('#litos-persistent')).toBeNull();
  });
});
