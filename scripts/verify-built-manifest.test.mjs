import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  contentScriptMatches,
  EXPECTED_EXTERNAL_MATCHES,
  EXPECTED_MANIFEST_DESCRIPTION,
  EXPECTED_MANIFEST_NAME,
  EXPECTED_PERMISSIONS,
} from './manifest-contract.mjs';
import { verifyBuiltManifest } from './verify-built-manifest.mjs';

const temporaryDirectories = [];

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'litos-built-manifest-test-'));
  temporaryDirectories.push(root);
  const packagePath = join(root, 'package.json');
  const manifestPath = join(root, 'manifest.json');
  const contentPath = join(root, 'content.ts');
  const contentSource = readFileSync('src/entrypoints/content.ts', 'utf8');
  const manifest = {
    manifest_version: 3,
    name: EXPECTED_MANIFEST_NAME,
    description: EXPECTED_MANIFEST_DESCRIPTION,
    version: '0.6.0',
    permissions: [...EXPECTED_PERMISSIONS],
    host_permissions: [],
    background: { service_worker: 'background.js' },
    action: { default_popup: 'popup.html' },
    content_scripts: [
      {
        matches: contentScriptMatches(contentSource),
        all_frames: true,
        run_at: 'document_idle',
        js: ['content-scripts/content.js'],
      },
    ],
    externally_connectable: { matches: [...EXPECTED_EXTERNAL_MATCHES] },
  };
  writeFileSync(packagePath, JSON.stringify({ version: manifest.version }));
  writeFileSync(manifestPath, JSON.stringify(manifest));
  writeFileSync(contentPath, contentSource);
  return { contentPath, manifest, manifestPath, packagePath };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('built manifest verification', () => {
  it('accepts the complete production manifest contract', () => {
    const paths = fixture();
    expect(verifyBuiltManifest(paths)).toEqual({ version: '0.6.0', matches: 44 });
  });

  it('rejects permission, site allowlist, and summary drift', () => {
    const paths = fixture();
    paths.manifest.permissions.push('tabs');
    writeFileSync(paths.manifestPath, JSON.stringify(paths.manifest));
    expect(() => verifyBuiltManifest(paths)).toThrow(/unexpected permissions/);

    paths.manifest.permissions.pop();
    paths.manifest.content_scripts[0].matches.pop();
    writeFileSync(paths.manifestPath, JSON.stringify(paths.manifest));
    expect(() => verifyBuiltManifest(paths)).toThrow(/exact source allowlist/);

    paths.manifest.content_scripts[0].matches = contentScriptMatches(
      readFileSync(paths.contentPath, 'utf8'),
    );
    paths.manifest.description = 'Stale description';
    writeFileSync(paths.manifestPath, JSON.stringify(paths.manifest));
    expect(() => verifyBuiltManifest(paths)).toThrow(/unexpected description/);
  });
});
