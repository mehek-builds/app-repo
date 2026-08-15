import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { REQUIRED_RELEASE_MARKERS } from './manifest-contract.mjs';
import { verifyReleaseZip } from './verify-release-zip.mjs';

const temporaryDirectories = [];

function fixture(runtime = REQUIRED_RELEASE_MARKERS.join('\n')) {
  const root = mkdtempSync(join(tmpdir(), 'litos-release-zip-test-'));
  temporaryDirectories.push(root);
  const build = join(root, 'build');
  const archive = join(root, 'release.zip');
  mkdirSync(build);
  writeFileSync(join(build, 'manifest.json'), '{"version":"0.6.0"}');
  writeFileSync(join(build, 'background.js'), runtime);
  execFileSync('zip', ['-q', archive, 'manifest.json', 'background.js'], { cwd: build });
  return { archive, build };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('release ZIP verification', () => {
  it('accepts an archive only when every entry byte-matches the current build', () => {
    const { archive, build } = fixture();
    const result = verifyReleaseZip(archive, build);
    expect(result).toMatchObject({ entries: 2, markers: REQUIRED_RELEASE_MARKERS.length });
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);

    writeFileSync(join(build, 'background.js'), `${REQUIRED_RELEASE_MARKERS.join('\n')}\nchanged`);
    expect(() => verifyReleaseZip(archive, build)).toThrow(/is stale/);
  });

  it('rejects an otherwise current archive that omits a required release marker', () => {
    const { archive, build } = fixture('hover_generation');
    expect(() => verifyReleaseZip(archive, build)).toThrow(/missing required 0.6 marker/);
  });
});
