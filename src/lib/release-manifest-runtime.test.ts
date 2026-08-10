import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import packageMetadata from '../../package.json';

describe('published extension release contract', () => {
  it('uses a new installable version for the SmartRecruiters handoff build', () => {
    expect(packageMetadata.version).toBe('0.5.10');
  });

  it('reports the runtime manifest version to the website pairing gate', () => {
    const background = readFileSync(new URL('../entrypoints/background.ts', import.meta.url), 'utf8');
    const ping = background.slice(background.indexOf("if (message?.type === 'LITOS_PING')"));
    expect(ping.slice(0, 900)).toMatch(/version: chrome\.runtime\.getManifest\(\)\.version/g);
  });

  it('keeps SmartRecruiters in the content-script manifest source', () => {
    const content = readFileSync(new URL('../entrypoints/content.ts', import.meta.url), 'utf8');
    const manifestMatches = content.slice(content.indexOf('matches: ['), content.indexOf('\n  ],', content.indexOf('matches: [')));
    expect(manifestMatches).toContain("'https://jobs.smartrecruiters.com/*'");
  });
});
