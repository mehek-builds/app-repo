#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REQUIRED_RELEASE_MARKERS } from './manifest-contract.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const BUILD_DIR = join(ROOT, '.output/chrome-mv3');

function builtFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? builtFiles(path) : [path];
  });
}

export function verifyReleaseZip(zipPath, buildDirectory = BUILD_DIR) {
  const resolvedZip = resolve(zipPath);
  const archiveFiles = execFileSync('unzip', ['-Z1', resolvedZip], { encoding: 'utf8' })
    .split('\n')
    .filter((entry) => entry && !entry.endsWith('/'))
    .sort();
  const diskFiles = builtFiles(buildDirectory)
    .map((path) => relative(buildDirectory, path))
    .sort();

  if (JSON.stringify(archiveFiles) !== JSON.stringify(diskFiles)) {
    throw new Error('Release ZIP entries differ from the current production build output. Rebuild the ZIP.');
  }

  for (const entry of diskFiles) {
    const archived = execFileSync('unzip', ['-p', resolvedZip, entry]);
    const current = readFileSync(join(buildDirectory, entry));
    if (!archived.equals(current)) {
      throw new Error(`Release ZIP entry ${entry} is stale. Rebuild the ZIP from the current output.`);
    }
  }

  const runtimeText = archiveFiles
    .filter((entry) => entry.endsWith('.js'))
    .map((entry) => execFileSync('unzip', ['-p', resolvedZip, entry], { encoding: 'utf8' }))
    .join('\n');
  for (const marker of REQUIRED_RELEASE_MARKERS) {
    if (!runtimeText.includes(marker)) {
      throw new Error(`Release ZIP is missing required 0.6 marker ${marker}.`);
    }
  }
  if (/VITE_QA_TOKEN|qa_token|qaToken/.test(runtimeText)) {
    throw new Error('Release ZIP contains a QA token marker.');
  }

  const sha256 = createHash('sha256').update(readFileSync(resolvedZip)).digest('hex');
  return { entries: archiveFiles.length, markers: REQUIRED_RELEASE_MARKERS.length, sha256 };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const packageMetadata = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const zipPath = join(ROOT, `.output/litos-extension-${packageMetadata.version}-chrome.zip`);
  try {
    const result = verifyReleaseZip(zipPath);
    console.log(
      `Release ZIP matches the current build: ${result.entries} files, ${result.markers} required markers, SHA256 ${result.sha256}.`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
