import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  contentScriptMatches,
  EXPECTED_EXTERNAL_MATCHES,
  EXPECTED_MANIFEST_DESCRIPTION,
  EXPECTED_MANIFEST_NAME,
  EXPECTED_MINIMUM_CHROME_VERSION,
  EXPECTED_PERMISSIONS,
  sameOrderedValues,
} from './manifest-contract.mjs';

export function verifyBuiltManifest({
  packagePath = 'package.json',
  manifestPath = '.output/chrome-mv3/manifest.json',
  contentPath = 'src/entrypoints/content.ts',
} = {}) {
  const packageMetadata = JSON.parse(readFileSync(packagePath, 'utf8'));
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const expectedMatches = contentScriptMatches(
    readFileSync(contentPath, 'utf8'),
    contentPath,
  );
  const contentScripts = manifest.content_scripts ?? [];
  const contentScript = contentScripts[0];
  const matches = (contentScript?.matches ?? []).slice().sort();
  const externalMatches = manifest.externally_connectable?.matches ?? [];

  if (manifest.manifest_version !== 3) {
    throw new Error(`Built manifest has unexpected manifest_version ${manifest.manifest_version ?? 'missing'}.`);
  }
  if (manifest.name !== EXPECTED_MANIFEST_NAME) {
    throw new Error(`Built manifest has unexpected name ${JSON.stringify(manifest.name)}.`);
  }
  if (manifest.description !== EXPECTED_MANIFEST_DESCRIPTION) {
    throw new Error(`Built manifest has unexpected description ${JSON.stringify(manifest.description)}.`);
  }
  if (manifest.version !== packageMetadata.version) {
    throw new Error(
      `Built manifest version ${manifest.version ?? 'missing'} does not match package ${packageMetadata.version}.`,
    );
  }
  if (manifest.minimum_chrome_version !== EXPECTED_MINIMUM_CHROME_VERSION) {
    throw new Error(
      `Built manifest has unexpected minimum_chrome_version ${JSON.stringify(manifest.minimum_chrome_version)}.`,
    );
  }
  if (contentScripts.length !== 1) {
    throw new Error(`Built manifest has ${contentScripts.length} content scripts instead of exactly one.`);
  }
  if (!sameOrderedValues(matches, expectedMatches)) {
    throw new Error('Built manifest content-script matches differ from the exact source allowlist.');
  }
  if (contentScript.all_frames !== true || contentScript.run_at !== 'document_start') {
    throw new Error('Built manifest has unexpected content-script execution settings.');
  }
  if (!sameOrderedValues(contentScript.js ?? [], ['content-scripts/content.js'])) {
    throw new Error(`Built manifest has unexpected content-script files: ${JSON.stringify(contentScript.js ?? [])}.`);
  }
  if (!sameOrderedValues(manifest.permissions ?? [], EXPECTED_PERMISSIONS)) {
    throw new Error(`Built manifest has unexpected permissions: ${JSON.stringify(manifest.permissions ?? [])}.`);
  }
  if (!sameOrderedValues(manifest.host_permissions ?? [], [])) {
    throw new Error(`Built manifest has unexpected host_permissions: ${JSON.stringify(manifest.host_permissions ?? [])}.`);
  }
  if (!sameOrderedValues(externalMatches, EXPECTED_EXTERNAL_MATCHES)) {
    throw new Error(
      `Built manifest has unexpected externally_connectable matches: ${JSON.stringify(externalMatches)}.`,
    );
  }
  if (manifest.background?.service_worker !== 'background.js') {
    throw new Error('Built manifest has unexpected background service worker settings.');
  }
  if (manifest.action?.default_popup !== 'popup.html') {
    throw new Error(`Built manifest has unexpected action popup ${JSON.stringify(manifest.action?.default_popup)}.`);
  }

  return { version: manifest.version, matches: matches.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = verifyBuiltManifest();
    console.log(
      `Built Chrome manifest ${result.version} matches the exact production contract across ${result.matches} sites.`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
