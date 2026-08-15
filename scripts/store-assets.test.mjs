import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const assetDirectory = join(root, 'store-assets');
const source = readFileSync(join(assetDirectory, 'source/assets.html'), 'utf8');
const releaseManifest = JSON.parse(
  readFileSync(join(assetDirectory, 'release-manifest.json'), 'utf8'),
);

const expectedImages = new Map([
  ['litos-screenshot-1.png', [1280, 800]],
  ['litos-screenshot-2.png', [1280, 800]],
  ['litos-screenshot-3.png', [1280, 800]],
  ['litos-screenshot-4.png', [1280, 800]],
  ['litos-screenshot-5.png', [1280, 800]],
  ['litos-promo-small-440x280.png', [440, 280]],
  ['litos-promo-marquee-1400x560.png', [1400, 560]],
]);

describe('Chrome Web Store creative release', () => {
  it('contains exactly five screenshots and the two promotional tiles', () => {
    const images = readdirSync(assetDirectory).filter((file) => file.endsWith('.png'));
    const screenshots = images.filter((file) => /^litos-screenshot-\d+\.png$/.test(file));
    expect(screenshots.sort()).toEqual(
      [...expectedImages.keys()].filter((file) => file.includes('screenshot')),
    );
    for (const file of expectedImages.keys()) {
      expect(images).toContain(file);
    }
  });

  it('uses the exact required dimensions and 8-bit RGB output', () => {
    for (const [file, [expectedWidth, expectedHeight]] of expectedImages) {
      const bytes = readFileSync(join(assetDirectory, file));
      expect(bytes.readUInt32BE(16), file).toBe(expectedWidth);
      expect(bytes.readUInt32BE(20), file).toBe(expectedHeight);
      expect(bytes[24], file).toBe(8);
      expect(bytes[25], file).toBe(2);
    }
  });

  it('byte-pins every reviewed source, notice, renderer, and output', () => {
    expect(releaseManifest.extension_version).toBe('0.6.0');
    for (const [file, expectedSha256] of Object.entries(releaseManifest.files)) {
      const actualSha256 = createHash('sha256')
        .update(readFileSync(join(assetDirectory, file)))
        .digest('hex');
      expect(actualSha256, file).toBe(expectedSha256);
    }
  });

  it('states the current Free, Trial, and Litos+ boundaries without retired offers', () => {
    expect(source).toContain('Free Chrome extension for job seekers');
    expect(source).toContain('Fill factual fields for free.');
    expect(source).toContain('seven-day Trial');
    expect(source).toContain('Optional auto-submit');
    expect(source).toContain('Nothing sent yet');

    for (const retired of [
      '$49.99',
      '$39.99 yearly',
      '20-job',
      '20 jobs',
      'Essays always stay blank',
      'Nothing is sent until you click Submit',
      'You still hit submit',
    ]) {
      expect(source).not.toContain(retired);
    }
  });

  it('contains no forbidden long dash character', () => {
    const css = readFileSync(join(assetDirectory, 'source/assets.css'), 'utf8');
    expect(source).not.toContain('\u2014');
    expect(css).not.toContain('\u2014');
  });
});
