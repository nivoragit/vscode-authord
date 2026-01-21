import * as vscode from 'vscode';
import { execFile } from 'child_process';
import ConfluencePublishService from './ConfluencePublishService';

jest.mock('vscode');
jest.mock('child_process', () => ({
  execFile: jest.fn(),
}));

const execFileMock = execFile as jest.MockedFunction<typeof execFile>;

describe('ConfluencePublishService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    execFileMock.mockImplementation((_file, _args, options, callback) => {
      const cb = typeof options === 'function' ? options : callback;
      if (cb) cb(null, 'ok', '');
      return {} as any;
    });
  });

  it('publishes using the Authord CLI in single mode', async () => {
    const settings = new Map<string, any>([
      ['confluence.mode', 'single'],
      ['confluence.baseUrl', 'https://conf.example'],
      ['confluence.basicAuth', 'user:token'],
      ['confluence.pageId', '123'],
      ['confluence.rootDir', 'docs'],
      ['confluence.cliPath', '/usr/local/bin/authord'],
      ['confluence.noToc', true],
      ['confluence.separators', true],
      ['confluence.headingLevel', 3],
      ['confluence.allowRemoteXsd', true],
      ['confluence.title', 'Doc Title'],
      ['confluence.cfgPath', 'writerside.cfg'],
      ['confluence.imagesDir', 'images'],
      ['confluence.useDeno', false],
    ]);

    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: (key: string, defaultValue: unknown) => (
        settings.has(key) ? settings.get(key) : defaultValue
      ),
    });

    const service = new ConfluencePublishService('/repo');
    await service.publish();

    expect(execFileMock).toHaveBeenCalledTimes(1);
    const [command, args] = execFileMock.mock.calls[0];
    expect(command).toBe('/usr/local/bin/authord');
    expect(args).toEqual([
      'confluence-single',
      '--base-url',
      'https://conf.example',
      '--basic-auth',
      'user:token',
      '--page-id',
      '123',
      '--title',
      'Doc Title',
      '--cfg',
      'writerside.cfg',
      '--images',
      'images',
      '--allow-remote-xsd',
      '--no-toc',
      '--separators',
      '--heading-level',
      '3',
      '/repo/docs',
    ]);
  });

  it('publishes using Deno when configured', async () => {
    const settings = new Map<string, any>([
      ['confluence.mode', 'tree'],
      ['confluence.baseUrl', 'https://conf.example'],
      ['confluence.basicAuth', 'user:token'],
      ['confluence.pageId', '999'],
      ['confluence.rootDir', 'docs'],
      ['confluence.useDeno', true],
      ['confluence.denoPath', '/usr/bin/deno'],
      ['confluence.denoScriptPath', '/opt/authord/lib/cli.ts'],
    ]);

    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: (key: string, defaultValue: unknown) => (
        settings.has(key) ? settings.get(key) : defaultValue
      ),
    });

    const service = new ConfluencePublishService('/repo');
    await service.publish();

    const [command, args] = execFileMock.mock.calls[0];
    expect(command).toBe('/usr/bin/deno');
    expect(args).toEqual([
      'run',
      '-A',
      '/opt/authord/lib/cli.ts',
      'confluence-tree',
      '--base-url',
      'https://conf.example',
      '--basic-auth',
      'user:token',
      '--page-id',
      '999',
      '/repo/docs',
    ]);
  });

  it('throws when base URL is missing', async () => {
    const settings = new Map<string, any>([
      ['confluence.basicAuth', 'user:token'],
      ['confluence.pageId', '123'],
    ]);

    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: (key: string, defaultValue: unknown) => (
        settings.has(key) ? settings.get(key) : defaultValue
      ),
    });

    const service = new ConfluencePublishService('/repo');
    await expect(service.publish()).rejects.toThrow('Missing Confluence base URL');
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('throws when Confluence is disabled', async () => {
    const settings = new Map<string, any>([
      ['confluence.enabled', false],
      ['confluence.baseUrl', 'https://conf.example'],
      ['confluence.basicAuth', 'user:token'],
      ['confluence.pageId', '123'],
    ]);

    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: (key: string, defaultValue: unknown) => (
        settings.has(key) ? settings.get(key) : defaultValue
      ),
    });

    const service = new ConfluencePublishService('/repo');
    await expect(service.publish()).rejects.toThrow('Confluence publishing is disabled');
    expect(execFileMock).not.toHaveBeenCalled();
  });
});
