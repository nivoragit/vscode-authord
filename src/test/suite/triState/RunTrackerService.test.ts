import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import RunTrackerService from '../../../services/triState/RunTrackerService';

describe('RunTrackerService', () => {
  it('creates run file and preserves step ordering', async () => {
    const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'authord-run-'));
    const tracker = new RunTrackerService(workspaceRoot);

    const run = await tracker.startRun('harmonize_topic');
    const stepA = await tracker.startStep(run, 'load_inputs', { paths: [], hashes: {}, topicIds: ['t1'] });
    await tracker.finishStep(stepA, { paths: [], hashes: {} }, 'SUCCESS', 'Loaded inputs');
    const stepB = await tracker.startStep(run, 'strategy', { paths: [], hashes: {}, topicIds: ['t1'] });
    await tracker.finishStep(stepB, { paths: [], hashes: {} }, 'SUCCESS', 'Drafted strategy');
    await tracker.finishRun(run, 'SUCCESS');

    const raw = await fs.promises.readFile(run.filePath, 'utf8');
    const parsed = JSON.parse(raw);

    expect(parsed.steps.length).toBe(2);
    expect(parsed.steps[0].step_id).toBe('load_inputs');
    expect(parsed.steps[1].step_id).toBe('strategy');
  });

  it('writes valid JSON atomically without prompt content', async () => {
    const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'authord-run-'));
    const tracker = new RunTrackerService(workspaceRoot);

    const run = await tracker.startRun('sync_confluence_snapshots');
    const step = await tracker.startStep(run, 'fetch', { paths: [], hashes: {}, topicIds: ['t2'] });
    await tracker.finishStep(step, { paths: [], hashes: {} }, 'SUCCESS', 'Fetched snapshot');
    await tracker.finishRun(run, 'SUCCESS');

    const raw = await fs.promises.readFile(run.filePath, 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
    expect(raw.includes('prompt')).toBe(false);
  });
});
