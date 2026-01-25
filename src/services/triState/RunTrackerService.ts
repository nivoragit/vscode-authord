import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

export type RunStatus = 'RUNNING' | 'SUCCESS' | 'FAILED';
export type StepStatus = 'RUNNING' | 'SUCCESS' | 'FAILED';

export interface RunStep {
  step_id: string;
  started_at: string;
  finished_at?: string;
  status: StepStatus;
  inputs: {
    paths: string[];
    hashes: Record<string, string>;
    topicIds?: string[];
  };
  outputs: {
    paths: string[];
    hashes: Record<string, string>;
  };
  notes?: string;
  errors?: {
    message: string;
    stack?: string;
  };
}

export interface RunLog {
  schema_version: 1;
  run_id: string;
  workflow_id: string;
  started_at: string;
  finished_at?: string;
  status: RunStatus;
  steps: RunStep[];
}

export interface RunHandle {
  run: RunLog;
  filePath: string;
}

export interface StepHandle {
  runHandle: RunHandle;
  step: RunStep;
}

export default class RunTrackerService {
  constructor(private readonly workspaceRoot: string) {}

  async startRun(
    workflowId: string,
    _context?: { topicIds?: string[] }
  ): Promise<RunHandle> {
    const started_at = new Date().toISOString();
    const timestamp = sanitizeTimestamp(started_at);
    const run_id = `${timestamp}_${workflowId}_${randomSuffix()}`;
    const filePath = await this.resolveRunPath(timestamp, workflowId);

    const run: RunLog = {
      schema_version: 1,
      run_id,
      workflow_id: workflowId,
      started_at,
      status: 'RUNNING',
      steps: [],
    };

    const handle: RunHandle = { run, filePath };
    await this.writeRun(handle);
    return handle;
  }

  async startStep(
    runHandle: RunHandle,
    stepId: string,
    inputs: RunStep['inputs']
  ): Promise<StepHandle> {
    const step: RunStep = {
      step_id: stepId,
      started_at: new Date().toISOString(),
      status: 'RUNNING',
      inputs,
      outputs: { paths: [], hashes: {} },
    };
    runHandle.run.steps.push(step);
    await this.writeRun(runHandle);
    return { runHandle, step };
  }

  async finishStep(
    stepHandle: StepHandle,
    outputs: RunStep['outputs'],
    status: StepStatus,
    notes?: string,
    error?: Error
  ): Promise<void> {
    stepHandle.step.finished_at = new Date().toISOString();
    stepHandle.step.status = status;
    stepHandle.step.outputs = outputs;
    if (notes) {
      stepHandle.step.notes = notes;
    }
    if (error) {
      stepHandle.step.errors = {
        message: error.message,
        stack: error.stack,
      };
    }
    await this.writeRun(stepHandle.runHandle);
  }

  async finishRun(runHandle: RunHandle, status: RunStatus): Promise<void> {
    runHandle.run.status = status;
    runHandle.run.finished_at = new Date().toISOString();
    await this.writeRun(runHandle);
  }

  async buildInputs(
    paths: string[],
    topicIds?: string[]
  ): Promise<RunStep['inputs']> {
    return {
      paths,
      hashes: await this.computeHashes(paths),
      topicIds,
    };
  }

  async buildOutputs(paths: string[]): Promise<RunStep['outputs']> {
    return {
      paths,
      hashes: await this.computeHashes(paths),
    };
  }

  async getLastRunPath(): Promise<string | undefined> {
    const runsDir = this.getRunsDir();
    if (!fs.existsSync(runsDir)) return undefined;
    const entries = await fs.promises.readdir(runsDir);
    if (entries.length === 0) return undefined;
    const withStats = await Promise.all(
      entries.map(async (entry) => {
        const full = path.join(runsDir, entry);
        const stat = await fs.promises.stat(full);
        return { path: full, mtime: stat.mtimeMs };
      })
    );
    withStats.sort((a, b) => b.mtime - a.mtime);
    return withStats[0]?.path;
  }

  async readRun(filePath: string): Promise<RunLog> {
    const raw = await fs.promises.readFile(filePath, 'utf8');
    return JSON.parse(raw) as RunLog;
  }

  private async computeHashes(paths: string[]): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    for (const target of paths) {
      try {
        const stat = await fs.promises.stat(target);
        if (stat.isDirectory()) {
          result[target] = 'DIRECTORY';
          continue;
        }
        const content = await fs.promises.readFile(target, 'utf8');
        result[target] = sha256(content);
      } catch {
        result[target] = 'MISSING';
      }
    }
    return result;
  }

  private getRunsDir(): string {
    return path.join(this.workspaceRoot, '_authord', '_runs');
  }

  private async resolveRunPath(timestamp: string, workflowId: string): Promise<string> {
    const runsDir = this.getRunsDir();
    await fs.promises.mkdir(runsDir, { recursive: true });
    const baseName = `${timestamp}_${workflowId}.json`;
    let candidate = path.join(runsDir, baseName);
    let counter = 1;
    while (fs.existsSync(candidate)) {
      candidate = path.join(runsDir, `${timestamp}_${workflowId}_${counter}.json`);
      counter += 1;
    }
    return candidate;
  }

  private async writeRun(runHandle: RunHandle): Promise<void> {
    const dir = path.dirname(runHandle.filePath);
    await fs.promises.mkdir(dir, { recursive: true });
    const payload = JSON.stringify(runHandle.run, null, 2);
    const tempPath = `${runHandle.filePath}.tmp-${process.pid}-${Date.now()}`;
    await fs.promises.writeFile(tempPath, payload, 'utf8');
    await fs.promises.rename(tempPath, runHandle.filePath);
  }
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function sanitizeTimestamp(value: string): string {
  return value.replace(/[:.]/g, '-');
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}
