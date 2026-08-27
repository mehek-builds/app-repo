export const EXPECTED_PERMISSIONS = ['activeTab', 'scripting', 'storage', 'clipboardWrite', 'alarms'];

export const EXPECTED_MINIMUM_CHROME_VERSION = '116';

export const EXPECTED_MANIFEST_NAME = 'Litos: AI Tailored Resumes & Application Autofill';

export const EXPECTED_MANIFEST_DESCRIPTION =
  'Litos fills job applications for free. Trial and Litos+ add tailored resumes, outreach, and opt-in auto-submit.';

export const EXPECTED_EXTERNAL_MATCHES = [
  'https://trylitos.com/*',
  'https://www.trylitos.com/*',
];

export const REQUIRED_RELEASE_MARKERS = [
  'hover_generation',
  'manual-submission-outcome',
  'LITOS_START_FREE_FILL',
  '/billing/actions',
];

export function contentScriptMatches(source, sourceName = 'content script source') {
  const start = source.indexOf('  matches: [');
  const end = source.indexOf('\n  ],', start);
  if (start < 0 || end < 0) {
    throw new Error(`Could not read the content-script matches from ${sourceName}.`);
  }

  const block = source.slice(start, end);
  const matches = [...block.matchAll(/^\s*['"](https:\/\/[^'"]+)['"],?\s*$/gm)]
    .map((match) => match[1]);
  if (matches.length === 0) {
    throw new Error(`No HTTPS content-script matches were found in ${sourceName}.`);
  }
  if (new Set(matches).size !== matches.length) {
    throw new Error(`Duplicate content-script matches were found in ${sourceName}.`);
  }
  return matches.sort();
}

export function sameOrderedValues(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}
