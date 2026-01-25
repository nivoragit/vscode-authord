# Authord Indexer (pgvector)

Standalone ingestion + retrieval service for Authord content. This is **not** wired into the extension runtime.

## Quick start

1) Start Postgres + pgvector:

```
docker-compose up
```

2) Install dependencies:

```
npm install
```

3) Ingest content:

```
npm run ingest
```

4) Start the API:

```
npm run dev
```

Query:

```
curl "http://localhost:8787/search?q=authord"
```

## Configuration

The indexer reads environment variables:

- `DATABASE_URL` (optional; if unset, uses PGHOST/PGUSER/PGPASSWORD/PGDATABASE/PGPORT with defaults)
- `AUTHORD_ROOT` (optional; repo root if running outside `tools/indexer`)

## Data sources

- Local topics from `_authord/topics/index.yaml`
- Confluence snapshots from `_authord_output/confluence_snapshots/*.latest.json`

## pgvector tuning

- Increase recall for HNSW searches:

```
SET hnsw.ef_search = 200;
```

- Some pgvector versions include an iterative scan option for HNSW when filtering; if supported by your installed pgvector version, consider enabling it for better recall. Check pgvector documentation for the exact parameter name and availability.

## Embeddings

The ingestion uses a deterministic stub embedding provider (no model weights shipped). Replace `StubEmbeddingProvider` in `src/embeddings.ts` with your preferred embedding provider.
