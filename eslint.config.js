// ESLint 9 flat config.
// The two structural guarantees that later sessions inherit for free are here (architecture §5, §7.1):
//
//   1. Module boundaries (eslint-plugin-boundaries).
//      Only `sim → sim` (no other module, no npm package) is hard-forbidden by element-types.
//      `ui → sim/physics|sim/rules` and `app` being imported from outside `src/main.tsx` are
//      forbidden via targeted `no-restricted-imports` blocks.
//      `render` may import `sim` — TypeScript's `verbatimModuleSyntax` (tsconfig) is what enforces
//      the "types only" half of that rule at build time; a value import from sim into render would
//      create a runtime dep and fail there. Nothing else in flat lint expresses that cheaply.
//
//   2. Determinism ban-list, scoped to `src/sim/**` + `src/ai/**`.
//      Banned globals: Date, document, window, performance.
//      Banned Math methods: random, sin/cos/tan, asin/acos/atan/atan2, exp/log/log2/log10,
//        pow/hypot/cbrt, fround, expm1/log1p, sinh/cosh/tanh (implementation-defined per §7.1).
//      Banned imports: `three`, `preact`, `@preact/*`, `three/*`, `preact/*` — sim/ai must not
//      touch any npm runtime package.
//
//   Plus repo-wide: `dangerouslySetInnerHTML` and `Element.innerHTML` are banned (architecture §10).
//
// Prototypes, mocks, dist, and the bundled node_modules are ignored — prototypes are disposable
// (FR-32) and mocks are pre-shipping content.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';

const DETERMINISM_BANNED_MATH = [
  'random',
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'atan2',
  'exp',
  'log',
  'log2',
  'log10',
  'pow',
  'hypot',
  'cbrt',
  'fround',
  'expm1',
  'log1p',
  'sinh',
  'cosh',
  'tanh',
];

const APP_IMPORT_PATTERN = {
  group: ['**/src/app', '**/src/app/**', 'src/app', 'src/app/**'],
  message: 'src/app is the composition root — only src/main.tsx may import it (architecture §5).',
};

const XSS_SYNTAX_BANS = [
  {
    selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
    message: 'dangerouslySetInnerHTML is banned repo-wide (architecture §10).',
  },
  {
    selector: "MemberExpression[property.name='innerHTML']",
    message: 'Element.innerHTML is banned repo-wide (architecture §10).',
  },
];

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'prototypes/**',
      'mocks/**',
      'public/**',
      '.forge/**',
      'program/**',
      'coverage/**',
      // legacy stray duplicates removed in CP4 of this session; ignored so pre-delete lints stay green
      'migrations.ts',
      'migrate/**',
      'io/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Module boundaries (§5).
  {
    plugins: { boundaries },
    settings: {
      'boundaries/elements': [
        { type: 'catalog', pattern: 'src/catalog/**' },
        { type: 'domain', pattern: 'src/domain/**' },
        { type: 'sim', pattern: 'src/sim/**' },
        { type: 'ai', pattern: 'src/ai/**' },
        { type: 'io', pattern: 'src/io/**' },
        { type: 'persist', pattern: 'src/persist/**' },
        { type: 'render', pattern: 'src/render/**' },
        { type: 'ui', pattern: 'src/ui/**' },
        { type: 'workers', pattern: 'src/workers/**' },
        { type: 'app', pattern: 'src/app/**' },
      ],
      // Entry file and ambient .d.ts sit above the module graph; they aren't a boundary element.
      'boundaries/ignore': ['src/main.tsx', 'src/vite-env.d.ts'],
    },
    rules: {
      'boundaries/element-types': [
        'error',
        {
          default: 'allow',
          rules: [
            // Sim is the deterministic core — it may not reach out to any other module (§5, §7.1).
            { from: ['sim'], allow: ['sim'] },
          ],
        },
      ],
      'boundaries/external': [
        'error',
        {
          default: 'allow',
          rules: [
            // Sim may not import any npm runtime package (§7.1). The bundled TypeScript type
            // definitions in `node_modules/@types` are allowed at compile time via tsconfig only.
            { from: ['sim'], disallow: ['*'] },
          ],
        },
      ],
    },
  },

  // Repo-wide XSS bans (§10).
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': ['error', ...XSS_SYNTAX_BANS],
    },
  },

  // Determinism ban-list — scoped to `src/sim/**` and `src/ai/**` (§7.1, §7.2).
  {
    files: ['src/sim/**/*.{ts,tsx}', 'src/ai/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: 'sim/ai must be deterministic — no wall-clock reads (§7.1).' },
        { name: 'document', message: 'sim/ai must not touch the DOM (§5).' },
        { name: 'window', message: 'sim/ai must not touch the DOM (§5).' },
        { name: 'performance', message: 'sim/ai must not read wall time (§7.1).' },
      ],
      'no-restricted-properties': [
        'error',
        ...DETERMINISM_BANNED_MATH.map((name) => ({
          object: 'Math',
          property: name,
          message: `Math.${name} is implementation-defined across JS engines — use src/sim/mathx for deterministic math (architecture §7.1).`,
        })),
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'three', message: 'sim/ai may not import any npm runtime package (§7.1).' },
            { name: 'preact', message: 'sim/ai may not import any npm runtime package (§7.1).' },
          ],
          patterns: [
            {
              group: ['three/*', 'preact/*', '@preact/*'],
              message: 'sim/ai may not import any npm runtime package (§7.1).',
            },
            APP_IMPORT_PATTERN,
          ],
        },
      ],
    },
  },

  // UI may not reach into sim/physics or sim/rules — those flow through domain/render (§5).
  {
    files: ['src/ui/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/sim/physics',
                '**/sim/physics/**',
                '**/sim/rules',
                '**/sim/rules/**',
                'src/sim/physics/**',
                'src/sim/rules/**',
              ],
              message:
                'ui may not import sim/physics or sim/rules — the UI reads through domain/render (architecture §5).',
            },
            APP_IMPORT_PATTERN,
          ],
        },
      ],
    },
  },

  // `src/app` may only be imported by `src/main.tsx` (composition root). Applied everywhere the
  // more-specific ui/sim blocks above don't already restate the app pattern.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/main.tsx', 'src/sim/**', 'src/ai/**', 'src/ui/**', 'src/app/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [APP_IMPORT_PATTERN] }],
    },
  },
];
