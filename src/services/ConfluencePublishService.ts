import * as path from 'path';
import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

type PublishMode = 'single' | 'tree';

export interface ConfluencePublishResult {
  stdout: string;
  stderr: string;
  command: string;
  args: string[];
}

export default class ConfluencePublishService {
  constructor(private readonly workspaceRoot: string) {}

  public async publish(): Promise<ConfluencePublishResult> {
    const config = vscode.workspace.getConfiguration('authord');
    const enabled = config.get<boolean>('confluence.enabled', true);
    if (!enabled) {
      throw new Error('Confluence publishing is disabled. Enable authord.confluence.enabled to continue.');
    }

    const mode = normalizeMode(config.get<string>('confluence.mode', 'single'));
    const baseUrl = config.get<string>('confluence.baseUrl', '').trim() || process.env.CONF_BASE_URL || '';
    const basicAuth = config.get<string>('confluence.basicAuth', '').trim() || process.env.CONF_BASIC_AUTH || '';
    const pageId = config.get<string>('confluence.pageId', '').trim();
    const rootDir = resolveRootDir(this.workspaceRoot, config.get<string>('confluence.rootDir', '').trim());
    const cliPath = resolveCliPath(this.workspaceRoot, config.get<string>('confluence.cliPath', 'authord').trim());
    const useDeno = config.get<boolean>('confluence.useDeno', false);
    const denoPath = resolveCliPath(this.workspaceRoot, config.get<string>('confluence.denoPath', 'deno').trim());
    const denoScriptPath = resolveCliPath(this.workspaceRoot, config.get<string>('confluence.denoScriptPath', '').trim());
    const cfgPath = config.get<string>('confluence.cfgPath', '').trim();
    const imagesDir = config.get<string>('confluence.imagesDir', '').trim();
    const allowRemoteXsd = config.get<boolean>('confluence.allowRemoteXsd', false);
    const noToc = config.get<boolean>('confluence.noToc', false);
    const separators = config.get<boolean>('confluence.separators', false);
    const headingLevel = config.get<number>('confluence.headingLevel', 2);
    const title = config.get<string>('confluence.title', '').trim();

    if (!baseUrl) {
      throw new Error('Missing Confluence base URL. Set authord.confluence.baseUrl or CONF_BASE_URL.');
    }
    if (!basicAuth) {
      throw new Error('Missing Confluence credentials. Set authord.confluence.basicAuth or CONF_BASIC_AUTH.');
    }
    if (!pageId) {
      throw new Error('Missing Confluence page ID. Set authord.confluence.pageId.');
    }

    if (useDeno && !denoScriptPath) {
      throw new Error('Confluence Deno script path is required when authord.confluence.useDeno is true.');
    }

    const command = useDeno ? denoPath : cliPath;
    const args = buildArgs({
      mode,
      baseUrl,
      basicAuth,
      pageId,
      rootDir,
      cfgPath,
      imagesDir,
      allowRemoteXsd,
      noToc,
      separators,
      headingLevel,
      title,
    });

    const execArgs = useDeno
      ? ['run', '-A', denoScriptPath, ...args]
      : args;

    try {
      const { stdout, stderr } = await execFileAsync(command, execArgs, {
        cwd: rootDir,
        env: process.env,
      });
      return { stdout: stdout ?? '', stderr: stderr ?? '', command, args: execArgs };
    } catch (err: any) {
      const message = redactSecrets(String(err?.message || err), basicAuth);
      throw new Error(`Confluence publish failed: ${message}`);
    }
  }
}

function buildArgs(options: {
  mode: PublishMode;
  baseUrl: string;
  basicAuth: string;
  pageId: string;
  rootDir: string;
  cfgPath?: string;
  imagesDir?: string;
  allowRemoteXsd?: boolean;
  noToc?: boolean;
  separators?: boolean;
  headingLevel?: number;
  title?: string;
}): string[] {
  const cmd = options.mode === 'tree' ? 'confluence-tree' : 'confluence-single';
  const args: string[] = [
    cmd,
    '--base-url',
    options.baseUrl,
    '--basic-auth',
    options.basicAuth,
    '--page-id',
    options.pageId,
  ];

  if (options.title && options.mode === 'single') {
    args.push('--title', options.title);
  }
  if (options.cfgPath) {
    args.push('--cfg', options.cfgPath);
  }
  if (options.imagesDir) {
    args.push('--images', options.imagesDir);
  }
  if (options.allowRemoteXsd) {
    args.push('--allow-remote-xsd');
  }
  if (options.mode === 'single') {
    if (options.noToc) {
      args.push('--no-toc');
    }
    if (options.separators) {
      args.push('--separators');
    }
    if (Number.isFinite(options.headingLevel)) {
      args.push('--heading-level', String(options.headingLevel));
    }
  }

  args.push(options.rootDir);
  return args;
}

function normalizeMode(input: string): PublishMode {
  return input === 'tree' ? 'tree' : 'single';
}

function resolveRootDir(workspaceRoot: string, configured: string): string {
  if (!configured) return workspaceRoot;
  return path.isAbsolute(configured) ? configured : path.resolve(workspaceRoot, configured);
}

function resolveCliPath(workspaceRoot: string, configured: string): string {
  if (!configured) return configured;
  if (path.isAbsolute(configured)) return configured;
  if (!configured.includes('/') && !configured.includes('\\')) return configured;
  return path.resolve(workspaceRoot, configured);
}

function redactSecrets(message: string, secret: string): string {
  if (!secret) return message;
  return message.replace(new RegExp(escapeRegExp(secret), 'g'), '[REDACTED]');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
