// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
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
    expect(launcher?.style.bottom).toBe('calc(20px + var(--litos-card-stack-clearance))');
    expect(document.querySelector<HTMLElement>('#litos-persistent-tip')?.style.bottom)
      .toBe('calc(68px + var(--litos-card-stack-clearance))');

    launcher?.click();
    expect(sendMessage).toHaveBeenCalledWith({ type: 'OPEN_LITOS_POPUP' }, expect.any(Function));
  });

  it('does not mount outside the supported host list', () => {
    installPersistentBadge('example.com');
    expect(document.querySelector('#litos-persistent')).toBeNull();
  });

  it('moves the launcher and tooltip above the live shared card stack', () => {
    const content = readFileSync('src/entrypoints/content.ts', 'utf8');
    const stackStart = content.indexOf('function getCardStack');
    const stackEnd = content.indexOf('function cardShell', stackStart);
    const stack = content.slice(stackStart, stackEnd);

    expect(stack).toContain("document.getElementById('litos-persistent')");
    expect(stack).toContain('new ResizeObserver(syncPersistentBadgeClearance).observe(stack)');
    expect(stack).toContain("persistentBadge.style.setProperty('--litos-card-stack-clearance'");
    expect(stack).toContain('stackHeight + gap');
  });
});
