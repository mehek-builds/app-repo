import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const background = readFileSync(new URL('../entrypoints/background.ts', import.meta.url), 'utf8');

describe('persistent launcher background runtime', () => {
  it('falls back when openPopup is missing or rejects', () => {
    const helper = background.slice(
      background.indexOf('const openLitosSurface ='),
      background.indexOf("chrome.storage.session.get('lastDetectedJob')"),
    );

    expect(helper).toContain("typeof openPopup === 'function'");
    expect(helper).toContain("Promise.reject(new Error('chrome.action.openPopup is unavailable'))");
    expect(helper).toContain('await chrome.windows.create({');
  });

  it('shares one in-flight surface request across repeated launcher activations', () => {
    const helper = background.slice(
      background.indexOf('let openLitosSurfacePromise'),
      background.indexOf("chrome.storage.session.get('lastDetectedJob')"),
    );

    expect(helper).toContain('if (openLitosSurfacePromise) return openLitosSurfacePromise');
    expect(helper).toContain('openLitosSurfacePromise = request');
    expect(helper).toContain('if (openLitosSurfacePromise === request) openLitosSurfacePromise = null');
  });
});
