import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getDefaultRegistryPath, loadRegistry, saveRegistry } from './RegistryService';
import type { TriStateRegistry } from './types';

function buildTopic(id: string, name: string, filePath: string, hash: string) {
  return {
    id,
    name,
    code_contract: {
      symbols: [`file:${filePath}`],
      last_known_hash: `hash:${hash}`,
      hash_algo: 'text_nocomments_v1' as const,
    },
    local_state: {
      path: filePath,
      content_hash: `content:${hash}`,
      updated_at: new Date(0).toISOString(),
    },
  };
}

describe('RegistryService', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'authord-registry-'));
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('loads an empty registry and creates directories when missing', async () => {
    const registry = await loadRegistry(tempDir);
    const expectedDir = path.join(tempDir, '_authord', 'topics');

    expect(fs.existsSync(expectedDir)).toBe(true);
    expect(registry.schema_version).toBe(1);
    expect(registry.topics).toEqual({});
  });

  it('saves deterministically and round-trips registry data', async () => {
    const now = new Date(0).toISOString();
    const registry: TriStateRegistry = {
      schema_version: 1,
      updated_at: now,
      topics: {
        'b-topic': buildTopic('topic-b', 'B Topic', 'topics/b.md', 'b'),
        'a-topic': buildTopic('topic-a', 'A Topic', 'topics/a.md', 'a'),
      },
    };

    await saveRegistry(tempDir, registry);

    const registryPath = getDefaultRegistryPath(tempDir);
    const raw = await fs.promises.readFile(registryPath, 'utf8');

    expect(raw.includes('schema_version: 1')).toBe(true);
    const indexA = raw.indexOf('a-topic');
    const indexB = raw.indexOf('b-topic');
    expect(indexA).toBeGreaterThan(-1);
    expect(indexB).toBeGreaterThan(-1);
    expect(indexA).toBeLessThan(indexB);

    const reloaded = await loadRegistry(tempDir);
    expect(reloaded.topics['a-topic']).toBeDefined();
    expect(reloaded.topics['b-topic']).toBeDefined();
  });
});
