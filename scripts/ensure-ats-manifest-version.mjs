import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { contentScriptMatches } from './manifest-contract.mjs';

const CONTENT_PATH = 'src/entrypoints/content.ts';
const PACKAGE_PATH = 'package.json';

function gitShow(ref, path) {
  return execFileSync('git', ['show', `${ref}:${path}`], { encoding: 'utf8' });
}

const baseRef = process.env.GITHUB_BASE_REF
  ? `origin/${process.env.GITHUB_BASE_REF}`
  : process.env.LITOS_RELEASE_BASE || 'origin/main';
const currentPackage = JSON.parse(readFileSync(PACKAGE_PATH, 'utf8'));
const currentMatches = contentScriptMatches(readFileSync(CONTENT_PATH, 'utf8'), CONTENT_PATH);

let basePackage;
let baseMatches;
try {
  basePackage = JSON.parse(gitShow(baseRef, PACKAGE_PATH));
  baseMatches = contentScriptMatches(gitShow(baseRef, CONTENT_PATH), `${baseRef}:${CONTENT_PATH}`);
} catch (error) {
  console.error(`Could not compare the ATS manifest with ${baseRef}. Fetch the base branch before packaging.`);
  process.exit(1);
}

if (JSON.stringify(currentMatches) !== JSON.stringify(baseMatches)
  && currentPackage.version === basePackage.version) {
  console.error(`ATS manifest matches changed without a version bump from ${basePackage.version}.`);
  process.exit(1);
}

console.log(`ATS manifest release contract verified against ${baseRef} at ${currentPackage.version}.`);
