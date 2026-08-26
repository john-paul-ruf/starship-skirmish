# catalog/lock/ — APPEND-ONLY. DO NOT EDIT EXISTING FILES.

Each `catalog-vN.json` is a frozen snapshot of `{ permanentId → permanentOrdinal }` at the moment
`catalogVersion` N was released. Share tokens (`specs/database.md` §6) encode ordinals, not strings.
**An edit to a historical lock file silently reinterprets every token ever generated against it.**

## Rules

1. **Never edit a released lock file.** Not to fix a typo, not to reorder, not to reformat.
2. **Never reuse an ordinal.** Even for content that was a mistake — retired content stays in the
   catalog forever (FR-1). There is no delete.
3. **Never renumber.** Ordinals are assigned monotonically on first authoring and are permanent.
4. **A new ordinal is `nextOrdinal` from the most recent lock**, then `nextOrdinal` increments.
5. Ordinal `0` is permanently reserved for `EMPTY_SLOT` and appears in no lock's `ordinals` map.
6. **Chassis and components share ONE ordinal space** so `byOrdinal(n)` is unambiguous. Decode still
   type-checks the resolved entry against its position in the slot layout.

## Releasing a new catalog version

```
1. Add/re-tune content in catalog/*.json. Assign new ids their ordinals from nextOrdinal.
2. Bump catalogVersion in classes.json and tuning.json.
3. Copy the previous lock to catalog-v<N>.json, ADD the new entries, change nothing else.
4. Run `npm run test:catalog-lock`. It fails if any prior id vanished or moved.
```

Re-tuning a stat does **not** need a new ordinal — only a `catalogVersion` bump, which is what
triggers `needs-refit` re-pricing on load (FR-2, Ruling A).
