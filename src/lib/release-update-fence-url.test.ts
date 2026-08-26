import { describe, expect, it } from 'vitest';
import {
  chromeMatchPatternMatchesUrl,
  contentScriptPersistsAfterReload,
} from './release-update-fence-url';

describe('release update fence URL provenance', () => {
  it('recognizes exact, wildcard-host, and path-scoped manifest matches', () => {
    expect(chromeMatchPatternMatchesUrl(
      'https://*.greenhouse.io/*',
      'https://boards.greenhouse.io/acme/jobs/123?source=litos',
    )).toBe(true);
    expect(chromeMatchPatternMatchesUrl(
      'https://*.greenhouse.io/*',
      'https://greenhouse.io/acme/jobs/123',
    )).toBe(true);
    expect(chromeMatchPatternMatchesUrl(
      'https://*.bamboohr.com/careers/*',
      'https://acme.bamboohr.com/settings/users',
    )).toBe(false);
    expect(chromeMatchPatternMatchesUrl(
      'https://jobs.example.com/*',
      'https://jobs.example.com.evil.test/apply',
    )).toBe(false);
  });

  it('marks a company-hosted one-shot injection as non-persistent', () => {
    const matches = ['https://*.greenhouse.io/*', 'https://jobs.smartrecruiters.com/*'];
    expect(contentScriptPersistsAfterReload(
      'https://careers.example.com/openings/123/apply',
      matches,
    )).toBe(false);
    expect(contentScriptPersistsAfterReload(undefined, matches)).toBeUndefined();
  });
});
