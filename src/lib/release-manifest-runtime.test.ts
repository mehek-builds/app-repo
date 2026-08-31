import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import packageMetadata from '../../package.json';

describe('published extension release contract', () => {
  it('uses a new installable version for the current release', () => {
    expect(packageMetadata.version).toBe('0.6.5');
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

  it('makes the built-artifact verifier require the exact source and permission allowlists', () => {
    const verifier = readFileSync(new URL('../../scripts/verify-built-manifest.mjs', import.meta.url), 'utf8');
    const contract = readFileSync(new URL('../../scripts/manifest-contract.mjs', import.meta.url), 'utf8');
    expect(verifier).toContain('contentScriptMatches');
    expect(verifier).toContain('EXPECTED_PERMISSIONS');
    expect(verifier).toContain('EXPECTED_EXTERNAL_MATCHES');
    expect(verifier).toContain('unexpected host_permissions');
    expect(verifier).toContain("contentScript.run_at !== 'document_idle'");
    expect(verifier).toContain("manifest.background?.service_worker !== 'background.js'");
    expect(verifier).toContain('unexpected externally_connectable matches');
    expect(contract).toContain("'https://trylitos.com/*'");
    expect(contract).toContain("'https://www.trylitos.com/*'");
  });

  it('keeps localhost external messaging available only in development builds', () => {
    const config = readFileSync(new URL('../../wxt.config.ts', import.meta.url), 'utf8');
    const background = readFileSync(new URL('../entrypoints/background.ts', import.meta.url), 'utf8');
    expect(config).toMatch(/command === 'serve'[\s\S]*?http:\/\/localhost/);
    expect(background).toMatch(/import\.meta\.env\.DEV && \/\^http:/);
    expect(config).not.toContain("'https://role-quick-website.vercel.app/*'");
  });

  it('uses the approved Free, Trial, and Litos+ store summary', () => {
    const config = readFileSync(new URL('../../wxt.config.ts', import.meta.url), 'utf8');
    expect(config).toContain(
      '${PRODUCT_NAME} fills job applications for free. Trial and Litos+ add tailored resumes, outreach, and opt-in auto-submit.',
    );
  });

  it('fails publishing closed unless the ZIP matches the current build', () => {
    const packageMetadata = readFileSync(new URL('../../package.json', import.meta.url), 'utf8');
    const publisher = readFileSync(new URL('../../scripts/publish-to-webstore.mjs', import.meta.url), 'utf8');
    const verifier = readFileSync(new URL('../../scripts/verify-release-zip.mjs', import.meta.url), 'utf8');
    const contract = readFileSync(new URL('../../scripts/manifest-contract.mjs', import.meta.url), 'utf8');
    expect(packageMetadata).toContain('node scripts/verify-release-zip.mjs');
    expect(publisher).toContain('verifyBuiltManifest()');
    expect(publisher).toContain('verifyReleaseZip(fileURLToPath(zipPath))');
    expect(publisher).toContain('CWS_EXPECTED_ZIP_SHA256');
    expect(verifier).toContain('is stale. Rebuild the ZIP from the current output.');
    expect(contract).toContain('LITOS_START_FREE_FILL');
  });
});
