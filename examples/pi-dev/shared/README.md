This is one way to use Pristine primitives. You can write your own.

# Pi Dev Shared Helpers

Type: shared helper code. Install target: `.pi/extensions/shared/`. Loaded directly by Pi: no.

This directory contains helper modules imported by the Pi reference extensions:

- `db-path` — resolves the local Pristine SQLite DB path.
- `pi-jsonl-index-schema` — shared table/column names for the Pi JSONL index.
- `local-embedding-batch` — shared sequential local embedding helper for `@huggingface/transformers` feature extraction.

Copy this directory alongside the extensions so relative imports resolve:

```bash
rsync -a --delete examples/pi-dev/shared/. .pi/extensions/shared/
```

Do not list `.pi/extensions/shared` as a Pi extension in settings. It has no `index.ts` entry point and registers no tools or lifecycle hooks.
