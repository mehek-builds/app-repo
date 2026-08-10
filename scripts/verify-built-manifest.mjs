import { readFileSync } from 'node:fs';

const packageMetadata = JSON.parse(readFileSync('package.json', 'utf8'));
const manifest = JSON.parse(readFileSync('.output/chrome-mv3/manifest.json', 'utf8'));
const matches = (manifest.content_scripts ?? []).flatMap((entry) => entry.matches ?? []);

if (manifest.version !== packageMetadata.version) {
  console.error(`Built manifest version ${manifest.version ?? 'missing'} does not match package ${packageMetadata.version}.`);
  process.exit(1);
}

if (!matches.includes('https://jobs.smartrecruiters.com/*')) {
  console.error('Built manifest does not include the SmartRecruiters application host.');
  process.exit(1);
}

console.log(`Built Chrome manifest ${manifest.version} includes SmartRecruiters.`);
