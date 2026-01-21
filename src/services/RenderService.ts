import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as http from 'node:http';
import * as https from 'node:https';
import { XMLParser } from 'fast-xml-parser';
import type { TextDocument } from 'vscode';
import {
  AuthordAstAssembler,
  type AuthordAst,
  type BuildDocsetOptions,
  type Fetcher,
  type Resource,
} from '@authord/render-core';
import type { DocumentationManager } from '../managers/DocumentationManager';
import {
  renderDocsetPageHtml,
  renderMarkdownHtml,
  renderTopicXmlHtml,
} from '../utils/html_preview_renderer';

export type PreviewRenderMode = 'simple' | 'docset';

type RenderContext = {
  documentManager?: DocumentationManager;
  renderMode?: PreviewRenderMode;
};

const WRITERSIDE_CFG_XSD = 'https://resources.jetbrains.com/writerside/1.0/writerside-cfg.xsd';
const XSI_NAMESPACE = 'http://www.w3.org/2001/XMLSchema-instance';

export default class RenderService {
  private readonly assembler = new AuthordAstAssembler();
  private readonly docsetCache = new Map<string, Promise<AuthordAst>>();
  private readonly fetcher: Fetcher;

  constructor() {
    this.fetcher = createCachedFetcher();
  }

  async renderDocument(doc: TextDocument, context: RenderContext = {}): Promise<string> {
    const renderMode = context.renderMode ?? 'simple';
    const imageFolder = context.documentManager?.getImagesDirectory();

    if (renderMode === 'docset') {
      const docsetHtml = await this.tryRenderFromDocset(doc, context.documentManager, imageFolder);
      if (docsetHtml) {
        return docsetHtml;
      }
    }

    return await this.renderStandaloneHtml(doc, imageFolder);
  }

  invalidateDocset(cfgPath?: string): void {
    if (cfgPath) {
      this.docsetCache.delete(cfgPath);
    } else {
      this.docsetCache.clear();
    }
  }

  private async renderStandaloneHtml(doc: TextDocument, imageFolder?: string): Promise<string> {
    const text = doc.getText();
    if (isTopicFile(doc.uri.fsPath)) {
      return await renderTopicXmlHtml(text, { imagesDir: imageFolder });
    }
    return await renderMarkdownHtml(text, { imageFolder });
  }

  private async tryRenderFromDocset(
    doc: TextDocument,
    documentManager: DocumentationManager | undefined,
    imageFolder?: string
  ): Promise<string | null> {
    if (!documentManager) return null;
    const cfgPath = documentManager.getConfigPath();
    if (!isWritersideCfg(cfgPath)) return null;

    // Keep editing fast: fall back to standalone rendering while the buffer is dirty.
    if (doc.isDirty) return null;

    try {
      const docset = await this.getDocset(cfgPath);
      const page = findDocsetPage(docset, doc.uri.fsPath);
      if (!page) return null;
      return await renderDocsetPageHtml(page, {
        markdown: { imageFolder },
        topic: { imagesDir: imageFolder },
      });
    } catch (error) {
      console.warn(`[authord] docset render failed, falling back: ${String(error)}`);
      return null;
    }
  }

  private async getDocset(cfgPath: string): Promise<AuthordAst> {
    let promise = this.docsetCache.get(cfgPath);
    if (!promise) {
      promise = this.buildDocset(cfgPath);
      this.docsetCache.set(cfgPath, promise);
    }
    try {
      return await promise;
    } catch (error) {
      this.docsetCache.delete(cfgPath);
      throw error;
    }
  }

  private async buildDocset(cfgPath: string): Promise<AuthordAst> {
    const resource = createNodeResource(cfgPath, this.fetcher);
    const macros = await loadVarsMacros(resource, cfgPath);

    const buildOpts: BuildDocsetOptions = {
      cfgPath,
      resource,
      macros,
      fetchExternalCode: true,
      maxIncludeDepth: 20,
      allowRemoteSchemaFetch: false,
      fetcher: this.fetcher,
    };

    return await this.assembler.build(buildOpts);
  }
}

function isTopicFile(filePath: string): boolean {
  return filePath.toLowerCase().endsWith('.topic');
}

function isWritersideCfg(cfgPath: string): boolean {
  return cfgPath.toLowerCase().endsWith('.cfg');
}

function findDocsetPage(docset: AuthordAst, docPath: string) {
  const target = normalizeFsPath(docPath);
  return docset.pages.find((page) => normalizeFsPath(page.path) === target);
}

function normalizeFsPath(filePath: string): string {
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function createNodeResource(cfgPath: string, fetcher: Fetcher): Resource {
  return {
    readText: async (pathOrUrl: string) => {
      if (isHttpUrl(pathOrUrl)) {
        return await fetcher(pathOrUrl);
      }
      const raw = await fs.readFile(pathOrUrl, 'utf8');
      if (normalizeFsPath(pathOrUrl) === normalizeFsPath(cfgPath)) {
        return normalizeWritersideCfg(raw);
      }
      return raw;
    },
    exists: async (pathOrUrl: string) => {
      if (isHttpUrl(pathOrUrl)) {
        return await urlExists(pathOrUrl);
      }
      try {
        await fs.stat(pathOrUrl);
        return true;
      } catch {
        return false;
      }
    },
    resolve: (base: string, target: string) => {
      if (isHttpUrl(target)) return target;
      if (path.isAbsolute(target)) return target;
      if (isHttpUrl(base)) return new URL(target, base).toString();
      const root = isDirLike(base) ? base : path.dirname(base);
      return path.resolve(root, target);
    },
  };
}

function isDirLike(p: string): boolean {
  return p.endsWith(path.sep) || !path.extname(p);
}

function normalizeWritersideCfg(xml: string): string {
  const match = xml.match(/<ihp\b[^>]*>/i);
  if (!match) return xml;

  const tag = match[0];
  const hasSchema = /\bxsi:noNamespaceSchemaLocation\s*=/.test(tag);
  const hasNamespace = /\bxmlns:xsi\s*=/.test(tag);

  if (hasSchema && hasNamespace) return xml;

  const attrs: string[] = [];
  if (!hasNamespace) {
    attrs.push(`xmlns:xsi="${XSI_NAMESPACE}"`);
  }
  if (!hasSchema) {
    attrs.push(`xsi:noNamespaceSchemaLocation="${WRITERSIDE_CFG_XSD}"`);
  }

  const updatedTag = tag.replace(/^<ihp\b/, `<ihp ${attrs.join(' ')}`);
  return xml.replace(tag, updatedTag);
}

async function loadVarsMacros(resource: Resource, cfgPath: string): Promise<Record<string, string>> {
  const varsPath = resource.resolve(cfgPath, 'v.list');
  if (!(await resource.exists(varsPath))) {
    return {};
  }

  const xml = await resource.readText(varsPath);
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  const data: any = parser.parse(xml);

  const vars = Array.isArray(data?.vars?.var)
    ? data.vars.var
    : (data?.vars?.var ? [data.vars.var] : []);

  const macros: Record<string, string> = {};
  for (const entry of vars) {
    const name = String(entry?.['@_name'] ?? '').trim();
    const value = String(entry?.['@_value'] ?? '');
    if (name) {
      macros[name] = escapeXml(value);
    }
  }
  return macros;
}

function escapeXml(value: string): string {
  return value.replace(/[&<>]/g, (ch) => {
    switch (ch) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      default:
        return ch;
    }
  });
}

function createCachedFetcher(): Fetcher {
  const cache = new Map<string, Promise<string>>();
  return async (url: string) => {
    const existing = cache.get(url);
    if (existing) return existing;

    const promise = fetchText(url);
    cache.set(url, promise);
    try {
      return await promise;
    } catch (error) {
      cache.delete(url);
      throw error;
    }
  };
}

async function fetchText(urlOrPath: string): Promise<string> {
  if (!isHttpUrl(urlOrPath)) {
    return await fs.readFile(urlOrPath, 'utf8');
  }
  const res = await requestUrl(urlOrPath, 'GET');
  if (res.statusCode >= 400) {
    throw new Error(`Failed to fetch ${urlOrPath}: HTTP ${res.statusCode}`);
  }
  return res.data?.toString('utf8') ?? '';
}

async function urlExists(url: string): Promise<boolean> {
  try {
    const res = await requestUrl(url, 'HEAD');
    if (res.statusCode < 400) return true;
    if (res.statusCode === 405 || res.statusCode === 403) {
      const fallback = await requestUrl(url, 'GET');
      return fallback.statusCode < 400;
    }
    return false;
  } catch {
    return false;
  }
}

async function requestUrl(
  url: string,
  method: 'GET' | 'HEAD',
  redirectLimit = 5
): Promise<{ statusCode: number; data?: Buffer }> {
  const parsed = new URL(url);
  const lib = parsed.protocol === 'https:' ? https : http;

  return await new Promise((resolve, reject) => {
    const req = lib.request(
      {
        method,
        hostname: parsed.hostname,
        port: parsed.port || undefined,
        path: parsed.pathname + parsed.search,
        headers: { 'User-Agent': 'authord-vscode' },
      },
      (res) => {
        const statusCode = res.statusCode ?? 0;

        if (
          statusCode >= 300 &&
          statusCode < 400 &&
          res.headers.location &&
          redirectLimit > 0
        ) {
          res.resume();
          const nextUrl = new URL(res.headers.location, url).toString();
          requestUrl(nextUrl, method, redirectLimit - 1)
            .then(resolve)
            .catch(reject);
          return;
        }

        if (method === 'HEAD') {
          res.resume();
          resolve({ statusCode });
          return;
        }

        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => {
          resolve({ statusCode, data: Buffer.concat(chunks) });
        });
      }
    );

    req.on('error', reject);
    req.end();
  });
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}
