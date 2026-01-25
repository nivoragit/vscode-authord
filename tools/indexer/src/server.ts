import fastify from 'fastify';
import { createPool } from './db';
import { StubEmbeddingProvider } from './embeddings';

const app = fastify({ logger: true });
const pool = createPool();
const embedder = new StubEmbeddingProvider(768);

app.get('/search', async (request, reply) => {
  const query = String((request.query as any)?.q ?? '').trim();
  if (!query) {
    reply.code(400);
    return { error: 'Missing query parameter "q".' };
  }

  const limit = Number((request.query as any)?.k ?? 10);
  const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 50) : 10;

  const [vector] = await embedder.embed([query]);
  const vectorLiteral = `[${vector.map((value) => value.toFixed(6)).join(',')}]`;

  const fts = await pool.query(
    `
    SELECT c.chunk_id,
           c.chunk_text,
           c.heading_path,
           c.anchor,
           d.source_type,
           d.source_uri,
           d.title,
           d.space_key,
           d.confluence_page_id,
           d.confluence_version,
           ts_rank(c.tsv, plainto_tsquery('english', $1)) AS score
    FROM chunks c
    JOIN docs d ON d.doc_id = c.doc_id
    WHERE c.tsv @@ plainto_tsquery('english', $1)
    ORDER BY score DESC
    LIMIT $2
    `,
    [query, safeLimit]
  );

  const vectorResults = await pool.query(
    `
    SELECT c.chunk_id,
           c.chunk_text,
           c.heading_path,
           c.anchor,
           d.source_type,
           d.source_uri,
           d.title,
           d.space_key,
           d.confluence_page_id,
           d.confluence_version,
           (e.embedding <=> $1::vector) AS distance
    FROM embeddings e
    JOIN chunks c ON c.chunk_id = e.chunk_id
    JOIN docs d ON d.doc_id = c.doc_id
    ORDER BY distance ASC
    LIMIT $2
    `,
    [vectorLiteral, safeLimit]
  );

  const merged = mergeResults(fts.rows, vectorResults.rows);
  return { query, results: merged.slice(0, safeLimit) };
});

app.addHook('onClose', async () => {
  await pool.end();
});

const port = Number(process.env.PORT || 8787);
app.listen({ port, host: '0.0.0.0' }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});

function mergeResults(ftsRows: any[], vectorRows: any[]) {
  const combined = new Map<number, any>();
  const add = (row: any) => {
    const existing = combined.get(row.chunk_id);
    if (!existing) {
      combined.set(row.chunk_id, { ...row });
      return;
    }
    combined.set(row.chunk_id, { ...existing, ...row });
  };

  ftsRows.forEach(add);
  vectorRows.forEach(add);

  return Array.from(combined.values())
    .map((row) => ({
      chunkId: row.chunk_id,
      text: row.chunk_text,
      headingPath: row.heading_path,
      anchor: row.anchor,
      title: row.title,
      sourceType: row.source_type,
      sourceUri: row.source_uri,
      confluencePageId: row.confluence_page_id,
      confluenceVersion: row.confluence_version,
      spaceKey: row.space_key,
      score: row.score ?? (row.distance !== undefined ? 1 / (1 + row.distance) : null),
    }))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}
