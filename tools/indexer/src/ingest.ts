import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { load } from 'js-yaml';
import { createPool, runMigrations } from './db';
import { chunkConfluenceStorage, chunkMarkdown } from './chunking';
import { StubEmbeddingProvider } from './embeddings';

type TriStateRegistry = {
  topics?: Record<string, any>;
};

type DocInput = {
  sourceType: 'local' | 'confluence';
  sourceUri: string;
  title: string;
  spaceKey?: string;
  confluencePageId?: string;
  confluenceVersion?: number;
  bodyText: string;
  rawContent: string;
  updatedAt: string;
};

const embeddingProvider = new StubEmbeddingProvider(768);

async function main() {
  const workspaceRoot = resolveWorkspaceRoot();
  const pool = createPool();
  await runMigrations(pool, path.join(__dirname, '..', 'migrations'));

  const registryPath = path.join(workspaceRoot, '_authord', 'topics', 'index.yaml');
  if (!fs.existsSync(registryPath)) {
    console.error('Registry not found:', registryPath);
    process.exit(1);
  }

  const registryRaw = await fs.promises.readFile(registryPath, 'utf8');
  const registry = (load(registryRaw) as TriStateRegistry) || { topics: {} };

  const docs: DocInput[] = [];
  const now = new Date().toISOString();

  const topicsDir = resolveTopicsDir(registry, workspaceRoot);
  const topics = registry.topics ? Object.values(registry.topics) : [];
  for (const topic of topics) {
    const localPath = topic?.local_state?.path;
    if (!localPath) continue;
    const filePath = path.join(topicsDir, localPath);
    if (!fs.existsSync(filePath)) continue;
    const raw = await fs.promises.readFile(filePath, 'utf8');
    const normalized = normalizeText(raw);
    docs.push({
      sourceType: 'local',
      sourceUri: localPath,
      title: String(topic?.name ?? localPath),
      bodyText: normalized,
      rawContent: raw,
      updatedAt: now,
    });
  }

  const snapshotDir = path.join(workspaceRoot, '_authord_output', 'confluence_snapshots');
  if (fs.existsSync(snapshotDir)) {
    const entries = await fs.promises.readdir(snapshotDir);
    for (const entry of entries) {
      if (!entry.endsWith('.latest.json')) continue;
      const filePath = path.join(snapshotDir, entry);
      const raw = await fs.promises.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      const pageId = String(parsed?.pageId ?? parsed?.id ?? entry.replace(/\.latest\.json$/, ''));
      const version = Number(parsed?.version ?? parsed?.confluence_version ?? parsed?.version?.number ?? 0);
      const title = String(parsed?.title ?? pageId);
      const spaceKey =
        parsed?.spaceKey ?? parsed?.space?.key ?? parsed?.space?.spaceKey ?? parsed?.space?.space_key;
      const body = String(parsed?.body ?? parsed?.body?.storage?.value ?? parsed?.storageBody ?? '');
      if (!body) continue;
      const normalized = normalizeText(body);
      docs.push({
        sourceType: 'confluence',
        sourceUri: `confluence:${pageId}`,
        title,
        spaceKey,
        confluencePageId: pageId,
        confluenceVersion: version || undefined,
        bodyText: normalized,
        rawContent: body,
        updatedAt: now,
      });
    }
  }

  console.log(`Found ${docs.length} docs to ingest.`);

  const client = await pool.connect();
  try {
    for (const doc of docs) {
      await client.query('BEGIN');
      const docId = await upsertDoc(client, doc);
      await upsertChunks(client, docId, doc);
      await client.query('COMMIT');
    }
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function upsertDoc(client: any, doc: DocInput): Promise<number> {
  const result = await client.query(
    `
    INSERT INTO docs (
      source_type,
      source_uri,
      title,
      space_key,
      confluence_page_id,
      confluence_version,
      updated_at,
      tri_state,
      body_text
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,'published',$8)
    ON CONFLICT (source_uri) DO UPDATE SET
      source_type = EXCLUDED.source_type,
      title = EXCLUDED.title,
      space_key = EXCLUDED.space_key,
      confluence_page_id = EXCLUDED.confluence_page_id,
      confluence_version = EXCLUDED.confluence_version,
      updated_at = EXCLUDED.updated_at,
      body_text = EXCLUDED.body_text
    RETURNING doc_id
    `,
    [
      doc.sourceType,
      doc.sourceUri,
      doc.title,
      doc.spaceKey ?? null,
      doc.confluencePageId ?? null,
      doc.confluenceVersion ?? null,
      doc.updatedAt,
      doc.bodyText,
    ]
  );

  return result.rows[0].doc_id as number;
}

async function upsertChunks(client: any, docId: number, doc: DocInput): Promise<void> {
  const existing = await client.query(
    'SELECT chunk_id, chunk_index, content_hash FROM chunks WHERE doc_id = $1',
    [docId]
  );
  const existingByIndex = new Map<number, { chunk_id: number; content_hash: string }>();
  for (const row of existing.rows) {
    existingByIndex.set(Number(row.chunk_index), {
      chunk_id: Number(row.chunk_id),
      content_hash: String(row.content_hash),
    });
  }

  const options = { maxChunkChars: 2000, overlapChars: 200 };
  const chunks =
    doc.sourceType === 'confluence'
      ? chunkConfluenceStorage(doc.rawContent, options)
      : chunkMarkdown(doc.rawContent, options);

  const seenIndices = new Set<number>();
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const chunkIndex = index + 1;
    seenIndices.add(chunkIndex);
    const contentHash = hashText(chunk.text);

    const existingChunk = existingByIndex.get(chunkIndex);
    if (existingChunk && existingChunk.content_hash === contentHash) {
      continue;
    }

    const anchor = buildAnchor(chunk.headingPath);
    const { rows } = await client.query(
      `
      INSERT INTO chunks (
        doc_id,
        chunk_index,
        heading_path,
        anchor,
        chunk_text,
        content_hash,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (doc_id, chunk_index) DO UPDATE SET
        heading_path = EXCLUDED.heading_path,
        anchor = EXCLUDED.anchor,
        chunk_text = EXCLUDED.chunk_text,
        content_hash = EXCLUDED.content_hash,
        updated_at = EXCLUDED.updated_at
      RETURNING chunk_id
      `,
      [
        docId,
        chunkIndex,
        chunk.headingPath,
        anchor ?? null,
        chunk.text,
        contentHash,
        doc.updatedAt,
      ]
    );
    const chunkId = rows[0].chunk_id as number;
    const [embedding] = await embeddingProvider.embed([chunk.text]);
    await client.query(
      `
      INSERT INTO embeddings (chunk_id, embedding)
      VALUES ($1, $2::vector)
      ON CONFLICT (chunk_id) DO UPDATE SET embedding = EXCLUDED.embedding
      `,
      [chunkId, vectorLiteral(embedding)]
    );
  }

  for (const [index, existingChunk] of existingByIndex.entries()) {
    if (!seenIndices.has(index)) {
      await client.query('DELETE FROM chunks WHERE chunk_id = $1', [existingChunk.chunk_id]);
    }
  }
}

function resolveWorkspaceRoot(): string {
  const candidates = [
    process.env.AUTHORD_ROOT,
    process.cwd(),
    path.resolve(process.cwd(), '..'),
    path.resolve(process.cwd(), '..', '..'),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, '_authord'))) {
      return candidate;
    }
  }
  return process.cwd();
}

function resolveTopicsDir(registry: TriStateRegistry, workspaceRoot: string): string {
  const firstTopic = registry.topics ? Object.values(registry.topics)[0] : undefined;
  const samplePath = firstTopic?.local_state?.path;
  if (samplePath && samplePath.includes('/')) {
    const topDir = samplePath.split('/')[0];
    return path.join(workspaceRoot, topDir);
  }
  return path.join(workspaceRoot, 'topics');
}

function normalizeText(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function vectorLiteral(values: number[]): string {
  return `[${values.map((value) => value.toFixed(6)).join(',')}]`;
}

function buildAnchor(headingPath: string): string | undefined {
  if (!headingPath || headingPath === 'root') return undefined;
  const last = headingPath.split(' > ').pop() ?? headingPath;
  const slug = last
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || undefined;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
