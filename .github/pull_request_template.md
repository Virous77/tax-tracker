## Changes

## Verification

## Checklist

- [ ] I used pnpm and preserved the 10-day cooldown, exact pins, and install-script allow-list.
- [ ] Money and coin amounts use decimal helpers and are stored and transported as strings.
- [ ] Tax parameters and section numbers live in the tax-year rule files.
- [ ] Engine changes stay deterministic and free of I/O.
- [ ] Import changes retain the original rows, deduplicate by source and source reference, and flag uncertainty for review.
- [ ] The change preserves local data, keeps network features opt-in, and keeps secrets out of logs.
- [ ] Tests use synthetic data. Any golden-case changes have a written reason in the commit.
- [ ] Lint, typecheck, tests, and recipe validation pass.
