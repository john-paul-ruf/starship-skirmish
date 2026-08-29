// tests/unit/toolchain/openGraph.test.ts — SESSION-02 M01/M19.
//
// Locks the crawler-visible share-metadata contract in the static entry
// document `index.html` against the real key-art asset `public/og-card.png`:
//   1. Each required Open Graph / Twitter / link key appears exactly once —
//      no duplicate canonical, description, og:*, or twitter:* entries that
//      would make a crawler preview ambiguous.
//   2. The exact title, promise, alt text, image type, and 1200×630 image
//      dimensions match the marketing contract.
//   3. Canonical URL and og:url are the same absolute https production URL;
//      both image tags are the same absolute https URL ending in /og-card.png.
//   4. The committed PNG really is a PNG and really is 1200×630, read straight
//      from its IHDR chunk — a renamed or resized asset fails the contract.
//   5. The security posture is intact: default-src 'self', img-src 'self'
//      data:, and connect-src 'self' still present in the CSP.
//
// Node built-ins + Vitest only — no DOM, HTML parser, or new dependency.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Paths resolved from THIS file's location — never from a shell cwd.
// ---------------------------------------------------------------------------

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const INDEX_HTML_PATH = path.join(REPO_ROOT, 'index.html');
const OG_IMAGE_PATH = path.join(REPO_ROOT, 'public', 'og-card.png');

const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');

// ---------------------------------------------------------------------------
// Canonical contract values — one production URL, one image URL.
// ---------------------------------------------------------------------------

const PROD_URL = 'https://john-paul-ruf.github.io/starship-skirmish/';
const IMAGE_URL = 'https://john-paul-ruf.github.io/starship-skirmish/og-card.png';
const TITLE = 'Starship Skirmish — Build. Plot. Survive.';
const DESCRIPTION =
  'Design warships, commit blind, and survive a 3D fleet battle where momentum, missiles, and wreckage never stop moving.';
const IMAGE_ALT = 'Neon wireframe starships collide inside a red lethal arena boundary.';

// ---------------------------------------------------------------------------
// Small local attribute extractor — no DOM, clear failure messages.
//
// Finds the single <meta> (or <link>) tag whose `keyAttr` equals `keyValue`
// and returns its `valueAttr`. Throws with a descriptive message when the tag
// is missing or duplicated, so the assertion pinpoints the contract breach.
// ---------------------------------------------------------------------------

const tagValue = (
  tag: string,
  keyAttr: string,
  keyValue: string,
  valueAttr: string,
): string => {
  const keyPattern = new RegExp(
    `<${tag}\\b[^>]*\\b${keyAttr}="${escapeRegExp(keyValue)}"[^>]*>`,
    'g',
  );
  const matches = [...html.matchAll(keyPattern)].map((m) => m[0]);
  if (matches.length === 0) {
    throw new Error(`missing <${tag} ${keyAttr}="${keyValue}">`);
  }
  if (matches.length > 1) {
    throw new Error(
      `<${tag} ${keyAttr}="${keyValue}"> appears ${matches.length} times; expected exactly once`,
    );
  }
  const valuePattern = new RegExp(`\\b${valueAttr}="([^"]*)"`);
  const found = valuePattern.exec(matches[0] ?? '');
  if (found === null) {
    throw new Error(`<${tag} ${keyAttr}="${keyValue}"> has no ${valueAttr} attribute`);
  }
  return found[1] ?? '';
};

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const metaProp = (property: string): string =>
  tagValue('meta', 'property', property, 'content');
const metaName = (name: string): string =>
  tagValue('meta', 'name', name, 'content');

// ---------------------------------------------------------------------------
// Contract 1 — every required key appears exactly once (extractor throws on
// absence or duplication). Reading the value IS the uniqueness assertion.
// ---------------------------------------------------------------------------

describe('index.html — required metadata keys are unique', () => {
  it('has exactly one canonical link', () => {
    expect(tagValue('link', 'rel', 'canonical', 'href')).toBe(PROD_URL);
  });

  it('has exactly one theme-color meta', () => {
    expect(metaName('theme-color')).toBe('#05070A');
  });

  it('has exactly one of each required Open Graph tag', () => {
    expect(metaProp('og:type')).toBe('website');
    expect(metaProp('og:site_name')).toBe('Starship Skirmish');
    expect(metaProp('og:url')).toBe(PROD_URL);
    expect(metaProp('og:title')).toBe(TITLE);
    expect(metaProp('og:description')).toBe(DESCRIPTION);
    expect(metaProp('og:image')).toBe(IMAGE_URL);
    expect(metaProp('og:image:type')).toBe('image/png');
    expect(metaProp('og:image:width')).toBe('1200');
    expect(metaProp('og:image:height')).toBe('630');
    expect(metaProp('og:image:alt')).toBe(IMAGE_ALT);
  });

  it('has exactly one of each required Twitter tag', () => {
    expect(metaName('twitter:card')).toBe('summary_large_image');
    expect(metaName('twitter:title')).toBe(TITLE);
    expect(metaName('twitter:description')).toBe(DESCRIPTION);
    expect(metaName('twitter:image')).toBe(IMAGE_URL);
    expect(metaName('twitter:image:alt')).toBe(IMAGE_ALT);
  });

  it('keeps a single description meta', () => {
    // The pre-existing meta[name="description"] must not be duplicated by the
    // new share metadata; extractor throws if a second one is introduced.
    expect(() => metaName('description')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Contract 2 — URL coherence: one production URL, one image URL, absolute
// https, crawler-safe (no hash route, relative path, or data: URL).
// ---------------------------------------------------------------------------

describe('index.html — URLs are absolute, https, and coherent', () => {
  it('canonical and og:url are the same absolute https production URL', () => {
    const canonical = tagValue('link', 'rel', 'canonical', 'href');
    const ogUrl = metaProp('og:url');
    expect(canonical).toBe(ogUrl);
    expect(canonical.startsWith('https://')).toBe(true);
    expect(canonical.endsWith('/')).toBe(true);
  });

  it('og:image and twitter:image are the same absolute https URL ending in /og-card.png', () => {
    const ogImage = metaProp('og:image');
    const twitterImage = metaName('twitter:image');
    expect(ogImage).toBe(twitterImage);
    expect(ogImage.startsWith('https://')).toBe(true);
    expect(ogImage.endsWith('/og-card.png')).toBe(true);
  });

  it('uses no hash route or data URL in share targets', () => {
    for (const url of [metaProp('og:url'), metaProp('og:image'), metaName('twitter:image')]) {
      expect(url).not.toContain('#');
      expect(url.startsWith('data:')).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Contract 3 — the real asset: PNG signature + IHDR width/height. A renamed
// or wrong-size file fails here, not silently at crawl time.
// ---------------------------------------------------------------------------

describe('public/og-card.png — real PNG at the contracted size', () => {
  const bytes = fs.readFileSync(OG_IMAGE_PATH);

  it('starts with the 8-byte PNG signature', () => {
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(bytes.subarray(0, 8).equals(signature)).toBe(true);
  });

  it('declares 1200×630 in its IHDR chunk', () => {
    // PNG layout: 8-byte signature, then the IHDR chunk whose data begins at
    // byte 16 — width at 16, height at 20 (big-endian uint32 each).
    expect(bytes.readUInt32BE(16)).toBe(1200);
    expect(bytes.readUInt32BE(20)).toBe(630);
  });
});

// ---------------------------------------------------------------------------
// Contract 4 — the security posture the metadata must not relax.
// ---------------------------------------------------------------------------

describe('index.html — CSP remains intact', () => {
  const cspMatch = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/.exec(html);
  const csp = cspMatch?.[1] ?? '';

  it('still declares the locked-down directives', () => {
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("img-src 'self' data:");
    expect(csp).toContain("connect-src 'self'");
  });
});
