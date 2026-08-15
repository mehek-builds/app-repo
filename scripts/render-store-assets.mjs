#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const htmlPath = join(root, 'store-assets/source/assets.html');
const outputPath = join(root, 'store-assets');
const chromePath =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const assets = [
  { id: 'screenshot-1', file: 'litos-screenshot-1.png', width: 1280, height: 800 },
  { id: 'screenshot-2', file: 'litos-screenshot-2.png', width: 1280, height: 800 },
  { id: 'screenshot-3', file: 'litos-screenshot-3.png', width: 1280, height: 800 },
  { id: 'screenshot-4', file: 'litos-screenshot-4.png', width: 1280, height: 800 },
  { id: 'screenshot-5', file: 'litos-screenshot-5.png', width: 1280, height: 800 },
  { id: 'promo-small', file: 'litos-promo-small-440x280.png', width: 440, height: 280 },
  { id: 'promo-marquee', file: 'litos-promo-marquee-1400x560.png', width: 1400, height: 560 },
];

const requestedIds = new Set(process.argv.slice(2));
const targets = requestedIds.size > 0
  ? assets.filter((asset) => requestedIds.has(asset.id))
  : assets;

if (targets.length !== (requestedIds.size || assets.length)) {
  throw new Error(`Unknown asset id. Known ids: ${assets.map((asset) => asset.id).join(', ')}`);
}

await access(htmlPath);
await access(chromePath);

for (const asset of targets) {
  const url = pathToFileURL(htmlPath);
  url.searchParams.set('asset', asset.id);
  const destination = join(outputPath, asset.file);
  let rendered = false;
  let finalError;

  await rm(destination, { force: true });

  for (let attempt = 1; attempt <= 3 && !rendered; attempt += 1) {
    const profile = await mkdtemp(join(tmpdir(), `litos-cws-${asset.id}-`));
    try {
      await run(
        chromePath,
        [
          '--headless',
          '--disable-gpu',
          '--disable-dev-shm-usage',
          '--hide-scrollbars',
          '--no-default-browser-check',
          '--no-first-run',
          '--force-device-scale-factor=1',
          '--virtual-time-budget=3000',
          `--user-data-dir=${profile}`,
          `--window-size=${asset.width},${asset.height}`,
          `--screenshot=${destination}`,
          url.href,
        ],
        { timeout: 60_000 },
      );
      rendered = true;
    } catch (error) {
      finalError = error;
      if (attempt < 3) {
        await new Promise((resolveRetry) => setTimeout(resolveRetry, 750));
      }
    } finally {
      await rm(profile, { recursive: true, force: true });
    }
  }

  if (!rendered) {
    throw finalError;
  }

  const bytes = await readFile(destination);
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const bitDepth = bytes[24];
  const colorType = bytes[25];
  const details = await stat(destination);
  const sha256 = createHash('sha256').update(bytes).digest('hex');

  if (width !== asset.width || height !== asset.height) {
    throw new Error(`${asset.file}: expected ${asset.width}x${asset.height}, got ${width}x${height}`);
  }
  if (bitDepth !== 8 || colorType !== 2) {
    throw new Error(
      `${asset.file}: expected 8-bit RGB PNG, got bit depth ${bitDepth}, color type ${colorType}`,
    );
  }

  console.log(
    `${asset.file}\t${width}x${height}\t${Math.round(details.size / 1024)} KB\t${sha256}`,
  );
}
