import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  getDefaultRegistryPath,
  loadRegistry,
  saveRegistry,
  RegistryParseError,
} from '../../../services/triState/RegistryService';
import type { TriStateRegistry } from '../../../services/triState/types';

function buildRegistry(updatedAt: string): TriStateRegistry {
  return {
    schema_version: 1,
    updated_at: updatedAt,
    topics: {
      'topic-alpha': {
        id: 'topic-alpha',
        name: 'Alpha',
        tri_state: 'DRAFT',
        code_contract: null,
        local_state: {
          path: 'topics/alpha.md',
          content_hash: 'hash-alpha',
          updated_at: updatedAt,
        },
        remote_state: null,
      },
    },
  };
}

describe('Tri-State RegistryService (suite)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'authord-registry-suite-'));
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('load missing registry creates file + returns empty structure', async () => {
    const registry = await loadRegistry(tempDir);
    const registryPath = getDefaultRegistryPath(tempDir);

    expect(fs.existsSync(registryPath)).toBe(true);
    expect(registry.schema_version).toBe(1);
    expect(registry.topics).toEqual({});
    expect(typeof registry.updated_at).toBe('string');
  });

  it('save/load roundtrip preserves data', async () => {
    const updatedAt = new Date(0).toISOString();
    const registry = buildRegistry(updatedAt);

    await saveRegistry(tempDir, registry);
    const reloaded = await loadRegistry(tempDir);

    expect(reloaded).toEqual(registry);
  });

  it('save output deterministic', async () => {
    const updatedAt = new Date(0).toISOString();
    const registry = buildRegistry(updatedAt);

    await saveRegistry(tempDir, registry);
    const registryPath = getDefaultRegistryPath(tempDir);
    const first = await fs.promises.readFile(registryPath, 'utf8');

    await saveRegistry(tempDir, registry);
    const second = await fs.promises.readFile(registryPath, 'utf8');

    expect(second).toBe(first);
  });

  it('invalid YAML throws RegistryParseError', async () => {
    const registryPath = getDefaultRegistryPath(tempDir);
    await fs.promises.mkdir(path.dirname(registryPath), { recursive: true });
    await fs.promises.writeFile(registryPath, '::invalid: yaml::', 'utf8');

    await expect(loadRegistry(tempDir)).rejects.toBeInstanceOf(RegistryParseError);
  });
});
