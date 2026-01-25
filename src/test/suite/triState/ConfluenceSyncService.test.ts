import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createHash } from 'crypto';
import * as vscode from 'vscode';
import ConfluenceSyncService from '../../../services/triState/ConfluenceSyncService';
import { requestJsonResponse } from '../../../services/agentic/httpClient';
import { saveRegistry, loadRegistry } from '../../../services/triState/RegistryService';
import type { TriStateRegistry } from '../../../services/triState/types';

jest.mock('../../../services/agentic/httpClient', () => ({
  requestJsonResponse: jest.fn(),
}));

const requestMock = requestJsonResponse as jest.Mock;

describe('ConfluenceSyncService', () => {
  beforeEach(() => {
    requestMock.mockReset();
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: jest.fn((key: string, fallback?: any) => {
        const values: Record<string, any> = {
          'confluence.enabled': true,
          'confluence.baseUrl': 'https://example.atlassian.net/wiki',
          'confluence.basicAuth': 'user:token',
        };
        return key in values ? values[key] : fallback;
      }),
    });
  });

  it('requests storage body via body-format', async () => {
    requestMock.mockResolvedValue({
      status: 200,
      statusMessage: 'OK',
      headers: {},
      body: {
        id: '123',
        title: 'Test',
        version: { number: 5 },
        body: { storage: { value: '<p>Hi</p>' } },
        space: { key: 'SPACE' },
      },
    });

    const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'authord-conf-'));
    const service = new ConfluenceSyncService(workspaceRoot);
    const snapshot = await service.fetchPageSnapshot('123');

    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        url: expect.stringContaining('/wiki/api/v2/pages/123?body-format=storage'),
      })
    );
    expect(snapshot.pageId).toBe('123');
    expect(snapshot.version).toBe(5);
    expect(snapshot.body).toBe('<p>Hi</p>');
  });

  it('writes snapshot files and updates registry', async () => {
    requestMock.mockResolvedValue({
      status: 200,
      statusMessage: 'OK',
      headers: {},
      body: {
        id: '123',
        title: 'Test',
        version: { number: 7 },
        body: { storage: { value: '<p>Snapshot</p>' } },
        space: { key: 'SPACE' },
      },
    });

    const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'authord-conf-'));
    const registry: TriStateRegistry = {
      schema_version: 1,
      updated_at: new Date().toISOString(),
      topics: {
        'topic-1': {
          id: 'topic-1',
          name: 'Topic One',
          tri_state: 'DRAFT',
          code_contract: null,
          local_state: {
            path: 'topic.md',
            content_hash: '',
            updated_at: new Date().toISOString(),
          },
          remote_state: {
            confluence_page_id: '123',
            confluence_version: 1,
            last_synced_hash: '',
            synced_at: new Date().toISOString(),
          },
        },
      },
    };
    await saveRegistry(workspaceRoot, registry);

    const service = new ConfluenceSyncService(workspaceRoot);
    await service.syncTopic('topic-1');

    const snapshotDir = path.join(workspaceRoot, '_authord_output', 'confluence_snapshots');
    const versioned = path.join(snapshotDir, '123.v7.json');
    const latest = path.join(snapshotDir, '123.latest.json');
    expect(fs.existsSync(versioned)).toBe(true);
    expect(fs.existsSync(latest)).toBe(true);

    const updated = await loadRegistry(workspaceRoot);
    const remote = updated.topics['topic-1'].remote_state!;
    const normalized = '<p>Snapshot</p>'.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const expectedHash = createHash('sha256').update(normalized).digest('hex');
    expect(remote.confluence_version).toBe(7);
    expect(remote.last_synced_hash).toBe(expectedHash);
    expect(remote.synced_at).toBeTruthy();
  });
});
