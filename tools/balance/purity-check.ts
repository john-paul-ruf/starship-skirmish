// tools/balance/purity-check.ts — the structural half of FR-33.
//
// FR-33: "Simulation logic contains no dependency on the rendering layer, enforced
// structurally so this can't rot." The lint boundary in `eslint.config.js` blocks
// `sim/**` from importing `three`/`preact` (and any npm at all). This script closes
// the loop from the OTHER side: it bundles `tools/balance/cli.ts` — the harness
// entry point — and asserts the transitive bundle text contains no reference to
// `three`, `preact`, or `document`. If someone accidentally imports a render module
// into the harness, or a sim file grows a DOM reference, THIS check fires.
//
// esbuild is available as a transitive dep of Vite. That is a deliberate choice —
// Vite is our build tool of record and shares its bundler, so we don't pay for a
// second one. If a future package upgrade drops esbuild, this script fails loudly
// with a clear error, and the fix is to add `esbuild` to `devDependencies` in
// package.json (a decision that lives with M01 / S01, not with this session).
//
// Usage:
//   tsx tools/balance/purity-check.ts        # non-zero exit on any banned token

import * as esbuild from 'esbuild';

// The banned tokens are stored as an array of CHAR ARRAYS reassembled at runtime,
// so the source of THIS FILE itself does not contain the literal strings — the
// check would trivially find them in its own transitive bundle otherwise (if a
// future task also bundles this file). This keeps the check honest.
const BANNED_TOKENS = [
  ['t', 'h', 'r', 'e', 'e'].join(''),
  ['p', 'r', 'e', 'a', 'c', 't'].join(''),
  ['d', 'o', 'c', 'u', 'm', 'e', 'n', 't'].join(''),
];

const ENTRY = 'tools/balance/cli.ts';

const main = async (): Promise<void> => {
  let build: esbuild.BuildResult;
  try {
    build = await esbuild.build({
      entryPoints: [ENTRY],
      bundle: true,
      format: 'esm',
      platform: 'node',
      write: false,
      logLevel: 'silent',
      // Node built-ins are external — they are NOT sim/harness code and we don't
      // want to grep through Node's fs implementation for banned strings.
      external: ['node:*'],
    });
  } catch (err) {
    process.stderr.write(
      `purity-check: esbuild failed to bundle ${ENTRY}\n${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
    );
    process.exit(2);
  }

  const outputs = build.outputFiles ?? [];
  if (outputs.length === 0) {
    process.stderr.write(`purity-check: esbuild produced no output for ${ENTRY}\n`);
    process.exit(2);
  }
  const bundleText = outputs.map((o) => o.text).join('\n');

  const hits: string[] = [];
  for (const token of BANNED_TOKENS) {
    const idx = bundleText.indexOf(token);
    if (idx >= 0) {
      // Report a small context window so a reader can start diagnosing without
      // re-bundling manually. 40 chars either side is a couple lines of minified JS.
      const start = Math.max(0, idx - 40);
      const end = Math.min(bundleText.length, idx + token.length + 40);
      const excerpt = bundleText.slice(start, end).replace(/\s+/g, ' ');
      hits.push(`  banned token ${JSON.stringify(token)} at offset ${idx}: …${excerpt}…`);
    }
  }

  if (hits.length > 0) {
    process.stderr.write(
      `purity-check: FR-33 structural check failed for ${ENTRY} — the harness bundle contains banned tokens:\n${hits.join('\n')}\n\n` +
        `The harness must not depend on the render layer. Trace the import chain from ${ENTRY} and remove the offending reference.\n`,
    );
    process.exit(1);
  }

  process.stdout.write(
    `purity-check: ${ENTRY} bundle (${bundleText.length} bytes) is clean — no reference to any of: ${BANNED_TOKENS.map((t) => JSON.stringify(t)).join(', ')}\n`,
  );
};

main().catch((err) => {
  process.stderr.write(`purity-check: unexpected error\n${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(2);
});
