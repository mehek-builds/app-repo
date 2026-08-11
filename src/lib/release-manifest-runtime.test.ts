import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import packageMetadata from '../../package.json';

describe('published extension release contract', () => {
  it('uses a new installable version for the SmartRecruiters handoff build', () => {
    expect(packageMetadata.version).toBe('0.5.11');
  });

  it('reports the runtime manifest version to the website pairing gate', () => {
    const background = readFileSync(new URL('../entrypoints/background.ts', import.meta.url), 'utf8');
    const ping = background.slice(background.indexOf("if (message?.type === 'LITOS_PING')"));
    expect(ping.slice(0, 900)).toMatch(/version: chrome\.runtime\.getManifest\(\)\.version/g);
  });

  it('keeps every attended ATS in the content-script manifest source', () => {
    const content = readFileSync(new URL('../entrypoints/content.ts', import.meta.url), 'utf8');
    const manifestMatches = content.slice(content.indexOf('matches: ['), content.indexOf('\n  ],', content.indexOf('matches: [')));
    expect(manifestMatches).toContain("'https://jobs.smartrecruiters.com/*'");
    expect(manifestMatches).toContain("'https://jobs.jobvite.com/*/job/*'");
    expect(manifestMatches).toContain("'https://*.icims.com/jobs/*'");
    expect(manifestMatches).toContain("'https://*.bamboohr.com/careers/*'");
  });

  it('makes the built-artifact verifier require every attended ATS match', () => {
    const verifier = readFileSync(new URL('../../scripts/verify-built-manifest.mjs', import.meta.url), 'utf8');
    expect(verifier).toContain("'https://jobs.smartrecruiters.com/*'");
    expect(verifier).toContain("'https://jobs.jobvite.com/*/job/*'");
    expect(verifier).toContain("'https://*.icims.com/jobs/*'");
    expect(verifier).toContain("'https://*.bamboohr.com/careers/*'");
    expect(verifier).toContain("'https://trylitos.com/*'");
    expect(verifier).toContain("'https://www.trylitos.com/*'");
    expect(verifier).toContain('unexpected externally_connectable matches');
  });

  it('keeps localhost external messaging available only in development builds', () => {
    const config = readFileSync(new URL('../../wxt.config.ts', import.meta.url), 'utf8');
    const background = readFileSync(new URL('../entrypoints/background.ts', import.meta.url), 'utf8');
    expect(config).toMatch(/command === 'serve'[\s\S]*?http:\/\/localhost/);
    expect(background).toMatch(/import\.meta\.env\.DEV && \/\^http:/);
    expect(config).not.toContain("'https://role-quick-website.vercel.app/*'");
  });
});
