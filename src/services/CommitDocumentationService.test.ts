// eslint-disable-next-line import/no-unresolved
import * as vscode from 'vscode';
import { execFile } from 'child_process';
import * as https from 'https';
import { EventEmitter } from 'events';
import CommitDocumentationService from './CommitDocumentationService';
import FileService from './FileService';
import { DocumentationManager } from '../managers/DocumentationManager';
import { InstanceProfile } from '../utils/types';

jest.mock('vscode');
jest.mock('child_process');
jest.mock('https', () => ({
  request: jest.fn(),
}));
jest.mock('./FileService', () => ({
  __esModule: true,
  default: {
    fileExists: jest.fn(),
    writeNewFile: jest.fn(),
  },
}));

const execFileMock = execFile as unknown as jest.Mock;

function textStream(parts: string[]): AsyncIterable<string> {
  async function* generator() {
    for (const part of parts) {
      yield part;
    }
  }
  return generator();
}

function mockGit(outputs: Record<string, string>, errors: Record<string, string> = {}) {
  execFileMock.mockImplementation((_cmd, args, _options, cb) => {
    const key = Array.isArray(args) ? args.join(' ') : '';
    const callback = cb as (err: Error | null, stdout: string, stderr: string) => void;
    if (errors[key]) {
      const err = Object.assign(new Error(errors[key]), { stderr: errors[key] });
      callback(err, '', errors[key]);
      return {} as any;
    }
    if (!Object.prototype.hasOwnProperty.call(outputs, key)) {
      const err = Object.assign(new Error('git command failed'), { stderr: 'git command failed' });
      callback(err, '', 'git command failed');
      return {} as any;
    }
    callback(null, outputs[key], '');
    return {} as any;
  });
}

describe('CommitDocumentationService', () => {
  let context: vscode.ExtensionContext;
  let documentManager: DocumentationManager;
  let mockModel: { sendRequest: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();

    mockModel = {
      sendRequest: jest.fn().mockResolvedValue({
        text: textStream(['Generated body without title.']),
      }),
    };

    (vscode as any).lm.selectChatModels.mockResolvedValue([mockModel]);
    (vscode as any).LanguageModelChatMessage.User.mockImplementation((content: string) => ({
      role: 'user',
      content,
    }));

    context = {
      workspaceState: {
        get: jest.fn(() => '/repo'),
        update: jest.fn(),
      },
      languageModelAccessInformation: {
        canSendRequest: jest.fn(() => true),
      },
    } as unknown as vscode.ExtensionContext;

    documentManager = {
      getTopicsDirectory: jest.fn(() => '/repo/docs/topics'),
      saveInstance: jest.fn(),
    } as unknown as DocumentationManager;

    (FileService.fileExists as jest.Mock).mockResolvedValue(false);
    (FileService.writeNewFile as jest.Mock).mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('generates docs, writes the topic file, and updates the instance', async () => {
    const doc: InstanceProfile = {
      id: 'doc1',
      name: 'Doc',
      'toc-elements': [],
    };

    const service = new CommitDocumentationService(context, documentManager, '/repo');
    jest.spyOn(service as any, 'resolveProjectRoot').mockResolvedValue('/repo');
    jest.spyOn(service as any, 'collectCommitContext').mockResolvedValue({
      sha: 'abcdef1234567890',
      shortSha: 'abcdef12',
      subject: 'Add feature',
      body: '',
      stats: 'abcdef Add feature\n 1 file changed',
      changedFiles: ['src/foo.ts', '__tests__/foo.test.ts'],
      testFiles: ['__tests__/foo.test.ts'],
      otherFiles: ['src/foo.ts'],
      testContexts: [],
      diffContexts: [],
      omittedTestFiles: [],
      omittedOtherFiles: [],
    });
    jest.spyOn(service as any, 'generateMarkdown').mockResolvedValue('Generated body without title.');
    const result = await service.generateForHeadCommit(doc);

    expect(result).toEqual({
      filePath: '/repo/docs/topics/add-feature.md',
      title: 'Add feature',
      topicFile: 'add-feature.md',
    });
    expect(FileService.writeNewFile).toHaveBeenCalledTimes(1);
    const [writtenPath, writtenContent] = (FileService.writeNewFile as jest.Mock).mock.calls[0];
    expect(writtenPath).toBe('/repo/docs/topics/add-feature.md');
    expect(String(writtenContent)).toMatch(/^# Add feature/);
    expect(doc['toc-elements']).toHaveLength(1);
    expect(doc['toc-elements'][0]).toEqual({ topic: 'add-feature.md', title: 'Add feature', children: [] });
    expect(doc['start-page']).toBe('add-feature.md');
    expect(documentManager.saveInstance).toHaveBeenCalledWith(doc);
  });

  it('prompts for project root when stored root is not a git repo', async () => {
    mockGit(
      {},
      {
        'rev-parse --show-toplevel': 'fatal: not a git repository',
      }
    );

    (vscode.workspace.fs.stat as jest.Mock).mockResolvedValue({
      type: (vscode as any).FileType.Directory,
    });
    (context.workspaceState.get as jest.Mock).mockReturnValue('/stored');
    (vscode.window.showOpenDialog as jest.Mock).mockResolvedValue([vscode.Uri.file('/chosen')]);

    const service = new CommitDocumentationService(context, documentManager, '/docs');
    const result = await (service as any).resolveProjectRoot();

    expect(result).toBe('/chosen');
    expect(vscode.window.showOpenDialog).toHaveBeenCalled();
    expect(context.workspaceState.update).toHaveBeenCalledWith('authord.projectRoot', '/chosen');
  });

  it('uses /v1/chat/completions for DeepSeek base URLs without a path', async () => {
    (https.request as jest.Mock).mockImplementation((_options: any, callback: any) => {
      const res = new EventEmitter() as any;
      res.statusCode = 200;
      res.statusMessage = 'OK';
      res.setEncoding = jest.fn();
      callback(res);

      process.nextTick(() => {
        res.emit('data', JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
        res.emit('end');
      });

      const req = new EventEmitter() as any;
      req.setTimeout = jest.fn();
      req.write = jest.fn();
      req.end = jest.fn();
      req.destroy = jest.fn();
      return req;
    });

    const service = new CommitDocumentationService(context, documentManager, '/repo');
    const result = await (service as any).generateWithCustomProvider(
      'system',
      'user',
      {
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-reasoner',
        apiKey: 'token',
      }
    );

    expect(result.result).toBe('ok');
    expect(https.request).toHaveBeenCalledTimes(1);
    const options = (https.request as jest.Mock).mock.calls[0][0] as { hostname?: string; path?: string };
    expect(options.hostname).toBe('api.deepseek.com');
    expect(options.path).toBe('/v1/chat/completions');
  });

  it('honors custom chat endpoint overrides and timeout settings', async () => {
    const setTimeoutMock = jest.fn();

    (https.request as jest.Mock).mockImplementation((_options: any, callback: any) => {
      const res = new EventEmitter() as any;
      res.statusCode = 200;
      res.statusMessage = 'OK';
      res.setEncoding = jest.fn();
      callback(res);

      process.nextTick(() => {
        res.emit('data', JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
        res.emit('end');
      });

      const req = new EventEmitter() as any;
      req.setTimeout = setTimeoutMock;
      req.write = jest.fn();
      req.end = jest.fn();
      req.destroy = jest.fn();
      return req;
    });

    const service = new CommitDocumentationService(context, documentManager, '/repo');
    const result = await (service as any).generateWithCustomProvider(
      'system',
      'user',
      {
        baseUrl: 'https://api.example.com',
        chatEndpoint: 'https://api.deepseek.com/v1/chat/completions',
        model: 'deepseek-reasoner',
        apiKey: 'token',
        requestTimeoutMs: 45000,
      }
    );

    expect(result.result).toBe('ok');
    expect(https.request).toHaveBeenCalledTimes(1);
    const options = (https.request as jest.Mock).mock.calls[0][0] as { hostname?: string; path?: string };
    expect(options.hostname).toBe('api.deepseek.com');
    expect(options.path).toBe('/v1/chat/completions');
    expect(setTimeoutMock).toHaveBeenCalledWith(45000, expect.any(Function));
  });

  it('returns undefined and shows an error when no commit exists', async () => {
    mockGit(
      {
        'rev-parse --show-toplevel': '/repo',
      },
      {
        'rev-parse HEAD': 'fatal: not a git repository',
      }
    );

    const doc: InstanceProfile = {
      id: 'doc1',
      name: 'Doc',
      'toc-elements': [],
    };

    const service = new CommitDocumentationService(context, documentManager, '/repo');
    jest.spyOn(service as any, 'resolveProjectRoot').mockResolvedValue('/repo');
    const result = await service.generateForHeadCommit(doc);

    expect(result).toBeUndefined();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      'No Git commit found. Commit your changes first.'
    );
    expect(FileService.writeNewFile).not.toHaveBeenCalled();
    expect(documentManager.saveInstance).not.toHaveBeenCalled();
  });

  it('uses a unique file name when the base name already exists', async () => {
    (FileService.fileExists as jest.Mock)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const doc: InstanceProfile = {
      id: 'doc1',
      name: 'Doc',
      'toc-elements': [],
    };

    const service = new CommitDocumentationService(context, documentManager, '/repo');
    jest.spyOn(service as any, 'resolveProjectRoot').mockResolvedValue('/repo');
    jest.spyOn(service as any, 'collectCommitContext').mockResolvedValue({
      sha: 'abcdef1234567890',
      shortSha: 'abcdef12',
      subject: 'Add feature',
      body: '',
      stats: 'abcdef Add feature\n 1 file changed',
      changedFiles: ['src/foo.ts', '__tests__/foo.test.ts'],
      testFiles: ['__tests__/foo.test.ts'],
      otherFiles: ['src/foo.ts'],
      testContexts: [],
      diffContexts: [],
      omittedTestFiles: [],
      omittedOtherFiles: [],
    });
    jest.spyOn(service as any, 'generateMarkdown').mockResolvedValue('Generated body without title.');
    const result = await service.generateForHeadCommit(doc);

    expect(result?.topicFile).toBe('add-feature-2.md');
    expect(FileService.writeNewFile).toHaveBeenCalledWith(
      '/repo/docs/topics/add-feature-2.md',
      expect.any(String)
    );
  });
});
