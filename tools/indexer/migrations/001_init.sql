CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS docs (
  doc_id BIGSERIAL PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_uri TEXT NOT NULL UNIQUE,
  title TEXT,
  space_key TEXT,
  confluence_page_id TEXT,
  confluence_version INT,
  updated_at TIMESTAMPTZ NOT NULL,
  tri_state TEXT NOT NULL DEFAULT 'published',
  body_text TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chunks (
  chunk_id BIGSERIAL PRIMARY KEY,
  doc_id BIGINT NOT NULL REFERENCES docs(doc_id) ON DELETE CASCADE,
  chunk_index INT NOT NULL,
  heading_path TEXT,
  anchor TEXT,
  chunk_text TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', chunk_text)) STORED,
  UNIQUE (doc_id, chunk_index)
);

CREATE TABLE IF NOT EXISTS embeddings (
  chunk_id BIGINT PRIMARY KEY REFERENCES chunks(chunk_id) ON DELETE CASCADE,
  embedding vector(768) NOT NULL
);

CREATE INDEX IF NOT EXISTS chunks_tsv_idx ON chunks USING GIN (tsv);
CREATE INDEX IF NOT EXISTS embeddings_hnsw_idx
ON embeddings
USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS docs_source_type_idx ON docs (source_type);
CREATE INDEX IF NOT EXISTS docs_confluence_page_idx ON docs (confluence_page_id);
