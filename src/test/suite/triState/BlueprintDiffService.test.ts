import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import BlueprintDiffService, { Blueprint } from '../../../services/triState/BlueprintDiffService';

function writeJson(filePath: string, data: unknown) {
  return fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

describe('BlueprintDiffService', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'authord-blueprint-'));
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('computes dependency order', async () => {
    const blueprint: Blueprint = {
      schema_version: 1,
      name: 'tri-state',
      capabilities: [
        {
          id: 'cap-a',
          description: 'A',
          depends_on: ['cap-b'],
          signals: { files_exist: [] },
          phase_hint: 1,
          priority: 2,
        },
        {
          id: 'cap-b',
          description: 'B',
          depends_on: [],
          signals: { files_exist: [] },
          phase_hint: 1,
          priority: 1,
        },
      ],
    };

    const service = new BlueprintDiffService(tempDir);
    const ordered = service.computeDependencyOrder(blueprint);
    expect(ordered.map((cap) => cap.id)).toEqual(['cap-b', 'cap-a']);
  });

  it('diff classification works', async () => {
    await fs.promises.mkdir(path.join(tempDir, 'src', 'services', 'triState'), { recursive: true });
    await fs.promises.writeFile(
      path.join(tempDir, 'src', 'services', 'triState', 'RegistryService.ts'),
      'export class RegistryService {}\nexport const loadRegistry = () => {};',
      'utf8'
    );

    await writeJson(path.join(tempDir, 'package.json'), {
      contributes: {
        commands: [{ command: 'authord.generateTriStateIntegrationPlan' }],
        configuration: {
          properties: {
            'authord.sentinel.enabled': { type: 'boolean', default: true },
          },
        },
      },
    });

    const blueprint: Blueprint = {
      schema_version: 1,
      name: 'tri-state',
      capabilities: [
        {
          id: 'cap-implemented',
          description: 'Implemented capability',
          depends_on: [],
          signals: {
            files_exist: ['src/services/triState/RegistryService.ts'],
            exports_exist: ['RegistryService'],
            commands_exist: ['authord.generateTriStateIntegrationPlan'],
            settings_exist: ['authord.sentinel.enabled'],
          },
          phase_hint: 1,
          priority: 1,
        },
        {
          id: 'cap-missing',
          description: 'Missing capability',
          depends_on: [],
          signals: {
            files_exist: ['src/services/triState/DoesNotExist.ts'],
          },
          phase_hint: 2,
          priority: 2,
        },
      ],
    };

    const service = new BlueprintDiffService(tempDir);
    const signals = await service.scanRepo();
    const diffResult = service.diff(blueprint, signals);

    const implemented = diffResult.capabilities.find((cap) => cap.capability.id === 'cap-implemented');
    const missing = diffResult.capabilities.find((cap) => cap.capability.id === 'cap-missing');

    expect(implemented?.status).toBe('IMPLEMENTED');
    expect(missing?.status).toBe('MISSING');
  });
});
