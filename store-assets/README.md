# Chrome Web Store assets

This folder is the checked-in source of truth for the Litos Chrome Web Store creative set.

Upload the five screenshots in numeric order, followed by the small and marquee promotional tiles. The source compositions, local fonts, approved copy, and font license notices live in `source/`.

`release-manifest.json` pins the exact renderer, source, notices, fonts, and rendered image hashes reviewed for the release. The automated Store asset contract rejects any drift.

Rebuild all seven images:

```sh
node scripts/render-store-assets.mjs
```

Rebuild selected images:

```sh
node scripts/render-store-assets.mjs screenshot-2 promo-marquee
```

The renderer uses an isolated temporary Chrome profile for every image and rejects incorrect dimensions or non-RGB output.
