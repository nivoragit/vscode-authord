import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  computeTsSignatureHash,
  decideExitCode,
  evaluateRegistry,
  type CiConfig,
} from '../../../../tools/ci/authord-ci';

describe('Authord CI', () => {
  it('computes coverage with drifted topic excluded', async () => {
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'authord-ci-'));
    const topicsDir = path.join(tempDir, 'topics');
    const codeDir = path.join(tempDir, 'src');
    await fs.promises.mkdir(topicsDir, { recursive: true });
    await fs.promises.mkdir(codeDir, { recursive: true });

    const okFile = path.join(codeDir, 'ok.ts');
    const driftFile = path.join(codeDir, 'drift.ts');
    await fs.promises.writeFile(okFile, 'export function ok(x: string) { return x; }', 'utf8');
    await fs.promises.writeFile(driftFile, 'export function drift(x: number) { return x; }', 'utf8');

    const okHash = computeTsSignatureHash(
      await fs.promises.readFile(okFile, 'utf8'),
      'file:src/ok.ts#ok'
    );

    const registry = {
      topics: {
        'topic-ok': {
          id: 'topic-ok',
          name: 'OK',
          code_contract: {
            symbols: ['file:src/ok.ts#ok'],
            last_known_hash: okHash,
            hash_algo: 'ts_signature_v1',
          },
          local_state: { path: 'ok.md' },
        },
        'topic-drift': {
          id: 'topic-drift',
          name: 'Drift',
          code_contract: {
            symbols: ['file:src/drift.ts#drift'],
            last_known_hash: 'deadbeef',
            hash_algo: 'ts_signature_v1',
          },
          local_state: { path: 'drift.md' },
        },
        'topic-doc': {
          id: 'topic-doc',
          name: 'Doc',
          local_state: { path: 'doc.md' },
        },
      },
    };

    await fs.promises.writeFile(path.join(topicsDir, 'ok.md'), '# ok', 'utf8');
    await fs.promises.writeFile(path.join(topicsDir, 'drift.md'), '# drift', 'utf8');
    await fs.promises.writeFile(path.join(topicsDir, 'doc.md'), '# doc', 'utf8');

    const config: CiConfig = {
      workspaceRoot: tempDir,
      failOnDrift: true,
      minCoverage: 50,
    };

    const result = evaluateRegistry(registry as any, config);
    expect(result.driftedTopics).toContain('topic-drift');
    expect(result.coverage).toBeCloseTo(66.67, 1);
  });

  it('chooses exit code for drift and coverage thresholds', () => {
    const baseConfig: CiConfig = {
      workspaceRoot: '/repo',
      failOnDrift: true,
      minCoverage: 80,
    };

    const driftResult = {
      totalTopics: 2,
      driftedTopics: ['topic-a'],
      unknownTopics: [],
      missingDocs: [],
      documentedCount: 1,
      coverage: 100,
    };
    expect(decideExitCode(driftResult, baseConfig)).toBe(2);

    const coverageResult = {
      totalTopics: 4,
      driftedTopics: [],
      unknownTopics: [],
      missingDocs: ['topic-x'],
      documentedCount: 2,
      coverage: 50,
    };
    expect(decideExitCode(coverageResult, baseConfig)).toBe(3);
  });
});
