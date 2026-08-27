// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  installPersistentBadge,
  shouldInstallPersistentBadge,
  supportsPersistentBadge,
} from './persistent-badge';

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

  it('mounts a keyboard-operable button', () => {
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
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('does not mount outside the supported host list', () => {
    installPersistentBadge('example.com');
    expect(document.querySelector('#litos-persistent')).toBeNull();
  });

  it('does not mount in a nested frame when a supported top page owns the launcher', () => {
    installPersistentBadge('boards.greenhouse.io', {
      isTopFrame: false,
      ancestorHostnames: ['www.linkedin.com'],
    });
    expect(document.querySelector('#litos-persistent')).toBeNull();
  });

  it('keeps the only launcher inside a Greenhouse embed on a company site', () => {
    expect(shouldInstallPersistentBadge('boards.greenhouse.io', {
      isTopFrame: false,
      ancestorHostnames: ['careers.example.com'],
    })).toBe(true);
    expect(shouldInstallPersistentBadge('boards.greenhouse.io', {
      isTopFrame: false,
      ancestorHostnames: [],
    })).toBe(true);
  });

  it('suppresses a nested launcher when any supported ancestor already owns one', () => {
    expect(shouldInstallPersistentBadge('boards.greenhouse.io', {
      isTopFrame: false,
      ancestorHostnames: ['careers.example.com', 'jobs.lever.co'],
    })).toBe(false);
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

  it('keeps the delayed validation card in the shared stack and within the viewport', () => {
    const content = readFileSync('src/entrypoints/content.ts', 'utf8');
    const validation = content.slice(
      content.indexOf('function armValidationAuthority'),
      content.indexOf('// Result of the background resume-gen round trip'),
    );

    expect(validation).toContain('getCardStack().appendChild(host)');
    expect(validation).toContain('max-width:calc(100vw - 40px);box-sizing:border-box;overflow-wrap:anywhere;');
    expect(validation).not.toContain('document.documentElement.appendChild(host)');
  });

  it('wraps long status and error content in the resume assistant', () => {
    const content = readFileSync('src/entrypoints/content.ts', 'utf8');
    const shell = content.slice(
      content.indexOf('function resumeFillCardShell'),
      content.indexOf('function injectResumeFillCard'),
    );

    expect(shell).toContain('id="wp-resume-status"');
    expect(shell).toContain('white-space:normal;overflow-wrap:anywhere;');
    expect(shell).not.toContain('text-overflow:ellipsis');
  });

  it('wraps dynamic outreach and submission failures inside employer-page cards', () => {
    const content = readFileSync('src/entrypoints/content.ts', 'utf8');
    const outreach = content.slice(
      content.indexOf('const renderActions ='),
      content.indexOf("if (response.api_error?.status === 402)"),
    );
    const submit = content.slice(
      content.indexOf('function injectSubmitCard'),
      content.indexOf('// v2: resume-gen'),
    );

    expect(outreach.match(/overflow-wrap:anywhere/g)?.length).toBeGreaterThanOrEqual(4);
    expect(submit).toContain('style="line-height:1.4;min-width:0;"');
    expect(submit).toContain('white-space:normal;overflow-wrap:anywhere;');
  });
});
