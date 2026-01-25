import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import RegistryBootstrapService from '../../../services/triState/RegistryBootstrapService';
import { getDefaultRegistryPath, loadRegistry, saveRegistry } from '../../../services/triState/RegistryService';
import type { TriStateRegistry } from '../../../services/triState/types';

function buildToc(topic: string, title: string) {
  return { topic, title, children: [] };
}

describe('RegistryBootstrapService', () => {
  let tempDir: string;
  let topicsDir: string;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'authord-bootstrap-'));
    topicsDir = path.join(tempDir, 'topics');
    await fs.promises.mkdir(topicsDir, { recursive: true });
    await fs.promises.writeFile(path.join(topicsDir, 'intro.md'), '# Intro\n', 'utf8');
    await fs.promises.writeFile(path.join(topicsDir, 'setup.md'), '# Setup\n', 'utf8');
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  });

  function makeManager() {
    return {
      getInstances: () => [
        {
          id: 'doc-1',
          name: 'Docs',
          'toc-elements': [buildToc('intro.md', 'Intro'), buildToc('setup.md', 'Setup')],
        },
      ],
      getTopicsDirectory: () => topicsDir,
    } as any;
  }

  it('creates registry when missing', async () => {
    const service = new RegistryBootstrapService(makeManager());
    const result = await service.bootstrapFromTopics(tempDir);

    expect(result.created).toBe(true);
    expect(result.topicsAdded).toBe(2);

    const registryPath = getDefaultRegistryPath(tempDir);
    expect(fs.existsSync(registryPath)).toBe(true);

    const registry = await loadRegistry(tempDir);
    expect(Object.keys(registry.topics)).toHaveLength(2);
  });

  it('merges without overwriting', async () => {
    const existing: TriStateRegistry = {
      schema_version: 1,
      updated_at: new Date(0).toISOString(),
      topics: {
        'intro.md': {
          id: 'intro.md',
          name: 'Intro',
          tri_state: 'DRIFTED',
          code_contract: null,
          local_state: {
            path: 'intro.md',
            content_hash: 'existing-hash',
            updated_at: new Date(0).toISOString(),
          },
          remote_state: null,
        },
      },
    };

    await saveRegistry(tempDir, existing);

    const service = new RegistryBootstrapService(makeManager());
    const result = await service.bootstrapFromTopics(tempDir);

    expect(result.created).toBe(false);
    expect(result.topicsAdded).toBe(1);

    const registry = await loadRegistry(tempDir);
    expect(registry.topics['intro.md'].tri_state).toBe('DRIFTED');
    expect(registry.topics['intro.md'].local_state.content_hash).toBe('existing-hash');
    expect(registry.topics['setup.md']).toBeDefined();
  });

  it('does nothing if all topics already present', async () => {
    const registry: TriStateRegistry = {
      schema_version: 1,
      updated_at: new Date(0).toISOString(),
      topics: {
        'intro.md': {
          id: 'intro.md',
          name: 'Intro',
          tri_state: 'SYNCED',
          code_contract: null,
          local_state: {
            path: 'intro.md',
            content_hash: 'hash-intro',
            updated_at: new Date(0).toISOString(),
          },
          remote_state: null,
        },
        'setup.md': {
          id: 'setup.md',
          name: 'Setup',
          tri_state: 'SYNCED',
          code_contract: null,
          local_state: {
            path: 'setup.md',
            content_hash: 'hash-setup',
            updated_at: new Date(0).toISOString(),
          },
          remote_state: null,
        },
      },
    };

    await saveRegistry(tempDir, registry);

    const service = new RegistryBootstrapService(makeManager());
    const result = await service.bootstrapFromTopics(tempDir);

    expect(result.created).toBe(false);
    expect(result.topicsAdded).toBe(0);

    const reloaded = await loadRegistry(tempDir);
    expect(reloaded.updated_at).toBe(registry.updated_at);
  });
});
