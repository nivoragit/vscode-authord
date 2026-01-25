import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import * as vscode from 'vscode';
import RegistryService, { computeLocalContentHash } from './RegistryService';
import type { TriStateRegistry, TriStateTopic } from './types';
import { requestJsonResponse, type JsonResponse } from '../agentic/httpClient';
import { getLogger } from '../LoggerService';
import RunTrackerService, { type StepHandle } from './RunTrackerService';

export interface PageSnapshot {
  pageId: string;
  title: string;
  spaceKey?: string;
  version: number;
  body: string;
  fetched_at: string;
}

export default class ConfluenceSyncService {
  private readonly logger = getLogger();

  constructor(
    private readonly workspaceRoot: string,
    private readonly registryService: RegistryService = new RegistryService(workspaceRoot)
  ) {}

  async fetchPageSnapshot(pageId: string): Promise<PageSnapshot> {
    const { baseUrl, basicAuth } = this.getConfig();
    const url = buildPageUrl(baseUrl, pageId);
    const headers = { Authorization: buildBasicAuthHeader(basicAuth) };

    const response = await this.requestWithRetry({ url, method: 'GET', headers });
    if (response.status < 200 || response.status >= 300) {
      const statusMessage = response.statusMessage ? ` ${response.statusMessage}` : '';
      throw new Error(`Confluence request failed (${response.status}${statusMessage}).`);
    }

    return parseSnapshot(response.body, pageId);
  }

  async syncTopic(topicId: string): Promise<{ pageId: string; version: number }> {
    const runTracker = new RunTrackerService(this.workspaceRoot);
    const runHandle = await runTracker.startRun('sync_confluence_snapshots', { topicIds: [topicId] });
    let activeStep: StepHandle | undefined;
    const registryPath = this.registryService.getDefaultRegistryPath();

    try {
      const registry = await this.registryService.loadRegistry();
      const topic = resolveTopic(registry, topicId);
      if (!topic) {
        await runTracker.finishRun(runHandle, 'FAILED');
        throw new Error(`Topic "${topicId}" not found in registry.`);
      }
      const pageId = topic.remote_state?.confluence_page_id;
      if (!pageId) {
        await runTracker.finishRun(runHandle, 'FAILED');
        throw new Error(`Topic "${topicId}" does not have confluence_page_id.`);
      }

      activeStep = await runTracker.startStep(
        runHandle,
        'fetch',
        await runTracker.buildInputs([], [topicId])
      );
      const snapshot = await this.fetchPageSnapshot(pageId);
      await runTracker.finishStep(
        activeStep,
        { paths: [], hashes: {} },
        'SUCCESS',
        `Fetched snapshot v${snapshot.version}.`
      );

      activeStep = await runTracker.startStep(
        runHandle,
        'write_snapshot',
        await runTracker.buildInputs([], [topicId])
      );
      await this.saveSnapshot(snapshot);
      const snapshotDir = path.join(this.workspaceRoot, '_authord_output', 'confluence_snapshots');
      const latestPath = path.join(snapshotDir, `${snapshot.pageId}.latest.json`);
      await runTracker.finishStep(
        activeStep,
        await runTracker.buildOutputs([latestPath]),
        'SUCCESS',
        'Wrote snapshot files.'
      );

      activeStep = await runTracker.startStep(
        runHandle,
        'update_registry',
        await runTracker.buildInputs([registryPath], [topicId])
      );
      await this.updateRegistryWithSnapshot(registry, topic, snapshot);
      await runTracker.finishStep(
        activeStep,
        await runTracker.buildOutputs([registryPath]),
        'SUCCESS',
        'Updated registry remote_state.'
      );

      await runTracker.finishRun(runHandle, 'SUCCESS');
      return { pageId: snapshot.pageId, version: snapshot.version };
    } catch (error: any) {
      if (activeStep) {
        await runTracker.finishStep(
          activeStep,
          { paths: [], hashes: {} },
          'FAILED',
          'Step failed.',
          error instanceof Error ? error : new Error(String(error))
        );
      }
      await runTracker.finishRun(runHandle, 'FAILED');
      throw error;
    }
  }

  async syncAllTopics(): Promise<{ synced: number; skipped: number }> {
    const registry = await this.registryService.loadRegistry();
    const topics = Object.values(registry.topics || {});
    let synced = 0;
    let skipped = 0;

    for (const topic of topics) {
      if (!topic.remote_state?.confluence_page_id) {
        skipped += 1;
        continue;
      }
      try {
        await this.syncTopic(topic.id);
        synced += 1;
      } catch (error: any) {
        skipped += 1;
        this.logger.warn('Confluence snapshot sync failed for topic.', {
          topicId: topic.id,
          error: error?.message || String(error),
        });
      }
    }

    return { synced, skipped };
  }

  private async requestWithRetry(options: {
    url: string;
    method: string;
    headers: Record<string, string>;
  }): Promise<JsonResponse> {
    const maxAttempts = 3;
    const baseDelayMs = 500;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const response = await requestJsonResponse(options);
      const status = response.status ?? 0;
      if (status >= 200 && status < 300) {
        return response;
      }

      const retryable = status === 429 || status >= 500;
      if (!retryable || attempt === maxAttempts) {
        return response;
      }

      const retryAfter = parseRetryAfter(response.headers?.['retry-after']);
      const delay = retryAfter ?? baseDelayMs * Math.pow(2, attempt - 1);
      await sleep(delay);
    }

    return requestJsonResponse(options);
  }

  private async saveSnapshot(snapshot: PageSnapshot): Promise<void> {
    const dir = path.join(this.workspaceRoot, '_authord_output', 'confluence_snapshots');
    await fs.promises.mkdir(dir, { recursive: true });

    const versioned = path.join(dir, `${snapshot.pageId}.v${snapshot.version}.json`);
    const latest = path.join(dir, `${snapshot.pageId}.latest.json`);
    const payload = JSON.stringify(snapshot, null, 2);

    await fs.promises.writeFile(versioned, payload, 'utf8');
    await fs.promises.writeFile(latest, payload, 'utf8');
  }

  private async updateRegistryWithSnapshot(
    registry: TriStateRegistry,
    topic: TriStateTopic,
    snapshot: PageSnapshot
  ): Promise<void> {
    const now = new Date().toISOString();
    const existing = topic.remote_state ?? null;
    const normalizedHash = computeStorageHash(snapshot.body);

    topic.remote_state = {
      confluence_page_id: snapshot.pageId,
      confluence_version: snapshot.version,
      confluence_anchor: existing?.confluence_anchor ?? undefined,
      last_synced_hash: normalizedHash,
      synced_at: snapshot.fetched_at,
    };

    registry.updated_at = now;
    await this.registryService.saveRegistry(registry);
  }

  private getConfig(): { baseUrl: string; basicAuth: string } {
    const config = vscode.workspace.getConfiguration('authord');
    const enabled = config.get<boolean>('confluence.enabled', true);
    if (!enabled) {
      throw new Error('Confluence sync is disabled in settings.');
    }
    const baseUrl = config.get<string>('confluence.baseUrl', '').trim() || process.env.CONF_BASE_URL || '';
    const basicAuth = config.get<string>('confluence.basicAuth', '').trim() || process.env.CONF_BASIC_AUTH || '';
    if (!baseUrl) {
      throw new Error('Missing Confluence base URL. Set authord.confluence.baseUrl or CONF_BASE_URL.');
    }
    if (!basicAuth) {
      throw new Error('Missing Confluence credentials. Set authord.confluence.basicAuth or CONF_BASIC_AUTH.');
    }
    return { baseUrl, basicAuth };
  }
}

function parseSnapshot(payload: any, fallbackPageId: string): PageSnapshot {
  const pageId = String(payload?.id ?? fallbackPageId);
  const title = String(payload?.title ?? '');
  const spaceKey =
    payload?.space?.key ?? payload?.spaceKey ?? payload?.space?.spaceKey ?? payload?.space?.space_key;
  const version = Number(payload?.version?.number ?? payload?.version ?? 0);
  const body = String(payload?.body?.storage?.value ?? payload?.body?.storage?.body ?? '');
  const fetched_at = new Date().toISOString();

  if (!body) {
    throw new Error(`Confluence page ${pageId} returned an empty storage body.`);
  }

  return { pageId, title, spaceKey, version, body, fetched_at };
}

function buildPageUrl(baseUrl: string, pageId: string): string {
  const target = new URL(baseUrl);
  const basePath = target.pathname.replace(/\/+$/, '');
  const wikiBase = basePath.endsWith('/wiki') ? basePath : `${basePath}/wiki`;
  target.pathname = `${wikiBase}/api/v2/pages/${pageId}`;
  target.search = 'body-format=storage';
  return target.toString();
}

function buildBasicAuthHeader(value: string): string {
  if (value.toLowerCase().startsWith('basic ')) {
    return value;
  }
  const encoded = Buffer.from(value, 'utf8').toString('base64');
  return `Basic ${encoded}`;
}

function parseRetryAfter(header: string | string[] | undefined): number | undefined {
  if (!header) return undefined;
  const raw = Array.isArray(header) ? header[0] : header;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return seconds * 1000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveTopic(registry: TriStateRegistry, topicId: string): TriStateTopic | undefined {
  if (!registry?.topics) return undefined;
  const direct = registry.topics[topicId];
  if (direct) return direct;
  const normalizedTarget = normalizePathValue(topicId);
  return Object.values(registry.topics).find((topic) => {
    const localPath = topic.local_state?.path;
    if (!localPath) return false;
    return normalizePathValue(localPath) === normalizedTarget;
  });
}

function normalizePathValue(value: string): string {
  return path.normalize(value).replace(/\\/g, '/').toLowerCase();
}

function computeStorageHash(body: string): string {
  const normalized = body.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const normalizedHash = computeLocalContentHash(normalized);
  if (normalizedHash) return normalizedHash;
  return createHash('sha256').update(normalized).digest('hex');
}
