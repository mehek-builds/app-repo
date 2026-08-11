import { readFileSync } from 'node:fs';

const packageMetadata = JSON.parse(readFileSync('package.json', 'utf8'));
const manifest = JSON.parse(readFileSync('.output/chrome-mv3/manifest.json', 'utf8'));
const matches = (manifest.content_scripts ?? []).flatMap((entry) => entry.matches ?? []);
const externalMatches = manifest.externally_connectable?.matches ?? [];

if (manifest.version !== packageMetadata.version) {
  console.error(`Built manifest version ${manifest.version ?? 'missing'} does not match package ${packageMetadata.version}.`);
  process.exit(1);
}

const requiredAtsMatches = [
  'https://jobs.smartrecruiters.com/*',
  'https://jobs.jobvite.com/*/job/*',
  'https://*.icims.com/jobs/*',
  'https://*.bamboohr.com/careers/*',
];
for (const required of requiredAtsMatches) {
  if (!matches.includes(required)) {
    console.error(`Built manifest does not include required ATS match ${required}.`);
    process.exit(1);
  }
}

const expectedExternalMatches = [
  'https://trylitos.com/*',
  'https://www.trylitos.com/*',
];
if (JSON.stringify(externalMatches) !== JSON.stringify(expectedExternalMatches)) {
  console.error(`Built manifest has unexpected externally_connectable matches: ${JSON.stringify(externalMatches)}.`);
  process.exit(1);
}

console.log(`Built Chrome manifest ${manifest.version} includes the required ATS matches and production-only website origins.`);
