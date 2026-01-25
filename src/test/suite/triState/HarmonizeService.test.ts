import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';
import HarmonizeService from '../../../services/triState/HarmonizeService';
import GovernanceService from '../../../services/triState/GovernanceService';
import RegistryService, { computeLocalContentHash, saveRegistry, loadRegistry } from '../../../services/triState/RegistryService';
import type { TriStateRegistry } from '../../../services/triState/types';

async function* streamFrom(text: string) {
  yield text;
}

describe('HarmonizeService', () => {
  beforeEach(() => {
    (vscode.commands.executeCommand as jest.Mock).mockReset();
    (vscode.window.showInformationMessage as jest.Mock).mockReset();
  });

  it('shows diff and does not apply when not confirmed', async () => {
    const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'authord-harmonize-'));
    const topicsDir = path.join(workspaceRoot, 'topics');
    await fs.promises.mkdir(topicsDir, { recursive: true });
    const topicFile = path.join(topicsDir, 'topic.md');
    await fs.promises.writeFile(topicFile, '# Title\nOld content\n', 'utf8');

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
            content_hash: computeLocalContentHash('# Title\nOld content\n'),
            updated_at: new Date().toISOString(),
          },
          remote_state: null,
        },
      },
    };
    await saveRegistry(workspaceRoot, registry);

    const aiChat = {
      send: jest
        .fn()
        .mockResolvedValueOnce(streamFrom(JSON.stringify({ summary: 'Update docs', proposed_changes: [] })))
        .mockResolvedValueOnce(streamFrom(JSON.stringify({ markdown: '# Title\nNew content\n' }))),
    };

    const documentManager = {
      getTopicsDirectory: () => topicsDir,
    } as any;

    (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue('No');

    const service = new HarmonizeService(
      workspaceRoot,
      documentManager,
      aiChat as any,
      new GovernanceService(workspaceRoot),
      new RegistryService(workspaceRoot)
    );
    await service.harmonizeTopic('topic-1');

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'vscode.diff',
      expect.anything(),
      expect.anything(),
      expect.stringContaining('Authord: Harmonize Topic')
    );

    const finalText = await fs.promises.readFile(topicFile, 'utf8');
    expect(finalText).toContain('Old content');
  });

  it('applies changes after confirmation', async () => {
    const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'authord-harmonize-'));
    const topicsDir = path.join(workspaceRoot, 'topics');
    await fs.promises.mkdir(topicsDir, { recursive: true });
    const topicFile = path.join(topicsDir, 'topic.md');
    const originalContent = '# Title\nOld content\n';
    await fs.promises.writeFile(topicFile, originalContent, 'utf8');

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
            content_hash: computeLocalContentHash(originalContent),
            updated_at: new Date().toISOString(),
          },
          remote_state: null,
        },
      },
    };
    await saveRegistry(workspaceRoot, registry);

    const aiChat = {
      send: jest
        .fn()
        .mockResolvedValueOnce(streamFrom(JSON.stringify({ summary: 'Update docs', proposed_changes: [] })))
        .mockResolvedValueOnce(streamFrom(JSON.stringify({ markdown: '# Title\nNew content\n' }))),
    };

    const documentManager = {
      getTopicsDirectory: () => topicsDir,
    } as any;

    (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue('Yes');

    const service = new HarmonizeService(
      workspaceRoot,
      documentManager,
      aiChat as any,
      new GovernanceService(workspaceRoot),
      new RegistryService(workspaceRoot)
    );
    await service.harmonizeTopic('topic-1');

    const finalText = await fs.promises.readFile(topicFile, 'utf8');
    expect(finalText).toContain('New content');

    const updatedRegistry = await loadRegistry(workspaceRoot);
    const updatedTopic = updatedRegistry.topics['topic-1'];
    expect(updatedTopic.local_state.content_hash).toBe(computeLocalContentHash(finalText));
  });
});
