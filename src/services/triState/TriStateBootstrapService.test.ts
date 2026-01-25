import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import TriStateBootstrapService from './TriStateBootstrapService';
import { computeLocalContentHash, getDefaultRegistryPath, loadRegistry } from './RegistryService';

function buildToc(topic: string, title: string, children: any[] = []) {
  return { topic, title, children };
}

describe('TriStateBootstrapService', () => {
  let tempDir: string;
  let topicsDir: string;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'authord-bootstrap-'));
    topicsDir = path.join(tempDir, 'topics');
    await fs.promises.mkdir(path.join(topicsDir, 'guide'), { recursive: true });
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('creates registry entries for topics in the instance profile', async () => {
    const introPath = path.join(topicsDir, 'intro.md');
    const setupPath = path.join(topicsDir, 'guide', 'setup.md');
    await fs.promises.writeFile(introPath, '# Intro\nHello', 'utf8');
    await fs.promises.writeFile(setupPath, '# Setup\nSteps', 'utf8');

    const documentManager = {
      getInstances: () => [
        {
          id: 'doc-1',
          name: 'Docs',
          'toc-elements': [
            buildToc('intro.md', 'Intro'),
            buildToc('guide/setup.md', 'Setup'),
          ],
        },
      ],
      getTopicsDirectory: () => topicsDir,
    } as any;

    const bootstrap = new TriStateBootstrapService(tempDir, documentManager);
    const result = await bootstrap.bootstrapRegistry();

    expect(result.addedTopics).toBe(2);
    const registry = await loadRegistry(tempDir);

    const entries = Object.values(registry.topics);
    expect(entries).toHaveLength(2);

    const introEntry = entries.find((entry) => entry.local_state.path === 'intro.md');
    const setupEntry = entries.find((entry) => entry.local_state.path === 'guide/setup.md');

    expect(introEntry?.name).toBe('Intro');
    expect(setupEntry?.name).toBe('Setup');

    expect(introEntry?.local_state.content_hash).toBe(computeLocalContentHash('# Intro\nHello'));
    expect(setupEntry?.local_state.content_hash).toBe(computeLocalContentHash('# Setup\nSteps'));

    expect(result.registryPath).toBe(getDefaultRegistryPath(tempDir));
  });
});
