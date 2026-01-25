import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { load } from 'js-yaml';

type DriftStatus = 'SYNCED' | 'DRIFTED' | 'UNKNOWN';

type CodeContract = {
  symbols?: string[];
  last_known_hash?: string;
  hash_algo?: 'ts_signature_v1' | 'text_nocomments_v1';
};

type LocalState = {
  path?: string;
};

type TriStateTopic = {
  id: string;
  name?: string;
  code_contract?: CodeContract | null;
  local_state?: LocalState;
};

type TriStateRegistry = {
  topics?: Record<string, TriStateTopic>;
};

export type CiConfig = {
  workspaceRoot: string;
  failOnDrift: boolean;
  minCoverage: number;
};

export type CiResult = {
  totalTopics: number;
  driftedTopics: string[];
  unknownTopics: string[];
  missingDocs: string[];
  documentedCount: number;
  coverage: number;
};

export function loadRegistry(registryPath: string): TriStateRegistry {
  if (!fs.existsSync(registryPath)) {
    throw new Error(`Registry not found at ${registryPath}`);
  }
  const raw = fs.readFileSync(registryPath, 'utf8');
  const parsed = load(raw) as TriStateRegistry;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Registry content is invalid.');
  }
  return parsed;
}

export function computeTextNoCommentsHash(text: string): string {
  const stripped = stripCommentsSafely(text ?? '');
  const normalized = normalizeWhitespace(stripped);
  return sha256(normalized);
}

export function computeTsSignatureHash(fileText: string, symbol: string): string {
  const symbolName = extractSymbolName(symbol);
  if (!symbolName) return '';
  const signature = extractSignatureBlock(fileText, symbolName);
  if (!signature) return '';
  const normalized = normalizeWhitespace(signature);
  return sha256(normalized);
}

export function evaluateRegistry(registry: TriStateRegistry, config: CiConfig): CiResult {
  const topics = registry.topics ? Object.values(registry.topics) : [];
  const driftedTopics: string[] = [];
  const unknownTopics: string[] = [];
  const missingDocs: string[] = [];
  let documentedCount = 0;

  for (const topic of topics) {
    const driftStatus = computeDriftStatus(topic, config.workspaceRoot);
    if (driftStatus === 'DRIFTED') driftedTopics.push(topic.id);
    if (driftStatus === 'UNKNOWN') unknownTopics.push(topic.id);

    const docExists = hasLocalDoc(topic, config.workspaceRoot);
    if (!docExists) {
      missingDocs.push(topic.id);
      continue;
    }

    if (!topic.code_contract || driftStatus !== 'DRIFTED') {
      documentedCount += 1;
    }
  }

  const totalTopics = topics.length;
  const coverage = totalTopics === 0 ? 100 : Math.round((documentedCount / totalTopics) * 10000) / 100;

  return {
    totalTopics,
    driftedTopics,
    unknownTopics,
    missingDocs,
    documentedCount,
    coverage,
  };
}

export function decideExitCode(result: CiResult, config: CiConfig): number {
  if (config.failOnDrift && result.driftedTopics.length > 0) {
    return 2;
  }
  if (result.coverage < config.minCoverage) {
    return 3;
  }
  return 0;
}

export function printReport(result: CiResult, config: CiConfig): void {
  const lines: string[] = [];
  lines.push('Authord CI Report');
  lines.push(`Total topics: ${result.totalTopics}`);
  lines.push(`Documented & not drifted: ${result.documentedCount}`);
  lines.push(`Coverage: ${result.coverage}% (min ${config.minCoverage}%)`);
  lines.push(`Drifted topics: ${result.driftedTopics.length}`);
  if (result.driftedTopics.length > 0) {
    lines.push(`  - ${result.driftedTopics.join(', ')}`);
  }
  lines.push(`Missing docs: ${result.missingDocs.length}`);
  if (result.missingDocs.length > 0) {
    lines.push(`  - ${result.missingDocs.join(', ')}`);
  }
  lines.push(`Unknown drift: ${result.unknownTopics.length}`);
  if (result.unknownTopics.length > 0) {
    lines.push(`  - ${result.unknownTopics.join(', ')}`);
  }
  console.log(lines.join('\n'));
}

function hasLocalDoc(topic: TriStateTopic, workspaceRoot: string): boolean {
  const localPath = topic.local_state?.path;
  if (!localPath) return false;
  const candidatePaths = resolveLocalPaths(localPath, workspaceRoot);
  for (const candidate of candidatePaths) {
    if (!fs.existsSync(candidate)) continue;
    const content = fs.readFileSync(candidate, 'utf8');
    if (content.trim().length > 0) {
      return true;
    }
  }
  return false;
}

function computeDriftStatus(topic: TriStateTopic, workspaceRoot: string): DriftStatus {
  const contract = topic.code_contract ?? null;
  if (!contract) return 'UNKNOWN';
  const lastHash = contract.last_known_hash || '';
  if (!lastHash) return 'UNKNOWN';
  const symbols = contract.symbols ?? [];

  let computed = false;
  for (const symbol of symbols.length ? symbols : ['']) {
    const filePath = resolveSymbolFile(symbol, workspaceRoot);
    if (!filePath) continue;
    if (!fs.existsSync(filePath)) continue;
    const fileText = fs.readFileSync(filePath, 'utf8');

    let currentHash = '';
    if (contract.hash_algo === 'text_nocomments_v1') {
      currentHash = computeTextNoCommentsHash(fileText);
    } else if (contract.hash_algo === 'ts_signature_v1') {
      currentHash = computeTsSignatureHash(fileText, symbol);
    } else {
      continue;
    }

    if (!currentHash) continue;
    computed = true;
    if (currentHash !== lastHash) return 'DRIFTED';
  }

  return computed ? 'SYNCED' : 'UNKNOWN';
}

function resolveSymbolFile(symbol: string, workspaceRoot: string): string | undefined {
  const trimmed = (symbol || '').trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('file:') || trimmed.startsWith('path:')) {
    const [, rest] = trimmed.split(/:(.+)/);
    if (!rest) return undefined;
    const [filePath] = rest.split('#');
    return path.isAbsolute(filePath) ? filePath : path.join(workspaceRoot, filePath);
  }
  if (trimmed.includes('#')) {
    const [filePath] = trimmed.split('#');
    if (looksLikePath(filePath)) {
      return path.isAbsolute(filePath) ? filePath : path.join(workspaceRoot, filePath);
    }
  }
  if (looksLikePath(trimmed)) {
    return path.isAbsolute(trimmed) ? trimmed : path.join(workspaceRoot, trimmed);
  }
  return undefined;
}

function looksLikePath(value: string): boolean {
  return value.includes('/') || value.includes('\\') || /\.[a-z0-9]+$/i.test(value);
}

function resolveLocalPaths(localPath: string, workspaceRoot: string): string[] {
  if (path.isAbsolute(localPath)) return [localPath];
  return [
    path.join(workspaceRoot, localPath),
    path.join(workspaceRoot, 'topics', localPath),
    path.join(workspaceRoot, 'docs', localPath),
  ];
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function stripCommentsSafely(text: string): string {
  let result = '';
  let i = 0;
  const length = text.length;
  let state: 'code' | 'string' | 'template' = 'code';
  let quote = '';

  while (i < length) {
    const char = text[i];
    const next = i + 1 < length ? text[i + 1] : '';

    if (state === 'code') {
      if (char === '/' && next === '/') {
        i += 2;
        while (i < length && text[i] !== '\n') i += 1;
        continue;
      }
      if (char === '/' && next === '*') {
        i += 2;
        while (i < length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
        i += 2;
        continue;
      }
      if (char === '"' || char === '\'' || char === '`') {
        state = char === '`' ? 'template' : 'string';
        quote = char;
        result += char;
        i += 1;
        continue;
      }
      result += char;
      i += 1;
      continue;
    }

    if (char === '\\' && i + 1 < length) {
      result += char + next;
      i += 2;
      continue;
    }

    result += char;
    i += 1;
    if (char === quote) {
      state = 'code';
      quote = '';
    }
  }

  return result;
}

function extractSymbolName(symbol: string): string | undefined {
  const trimmed = symbol.trim();
  if (!trimmed) return undefined;

  if (trimmed.startsWith('file:') || trimmed.startsWith('path:')) {
    const [, rest] = trimmed.split(/:(.+)/);
    if (!rest) return undefined;
    const parts = rest.split('#');
    return parts[1]?.trim();
  }

  if (trimmed.includes('#')) {
    return trimmed.split('#')[1]?.trim();
  }

  if (trimmed.includes(':')) {
    return trimmed.split(':').pop()?.trim();
  }

  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
    return trimmed;
  }

  return undefined;
}

function extractSignatureBlock(fileText: string, symbolName: string): string | undefined {
  const patterns: Array<{ kind: 'block' | 'line'; regex: RegExp }> = [
    { kind: 'block', regex: new RegExp(`export\\s+(?:declare\\s+)?function\\s+${symbolName}\\b`, 'g') },
    { kind: 'block', regex: new RegExp(`export\\s+default\\s+(?:async\\s+)?function\\s+${symbolName}\\b`, 'g') },
    { kind: 'block', regex: new RegExp(`export\\s+(?:abstract\\s+)?class\\s+${symbolName}\\b`, 'g') },
    { kind: 'block', regex: new RegExp(`export\\s+interface\\s+${symbolName}\\b`, 'g') },
    { kind: 'block', regex: new RegExp(`export\\s+enum\\s+${symbolName}\\b`, 'g') },
    { kind: 'line', regex: new RegExp(`export\\s+type\\s+${symbolName}\\b`, 'g') },
    { kind: 'line', regex: new RegExp(`export\\s+(?:const|let|var)\\s+${symbolName}\\b`, 'g') },
  ];

  for (const pattern of patterns) {
    pattern.regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.regex.exec(fileText)) !== null) {
      const matchIndex = match.index;
      const signatureStart = findJSDocStart(fileText, matchIndex) ?? matchIndex;
      const signatureEnd =
        pattern.kind === 'block'
          ? findSignatureEnd(fileText, matchIndex, '{')
          : findSignatureEnd(fileText, matchIndex, ';');

      if (signatureEnd === undefined) {
        return fileText.slice(signatureStart).trim();
      }
      return fileText.slice(signatureStart, signatureEnd).trim();
    }
  }

  return undefined;
}

function findSignatureEnd(text: string, startIndex: number, terminator: '{' | ';'): number | undefined {
  const index = text.indexOf(terminator, startIndex);
  if (index === -1) {
    const lineEnd = text.indexOf('\n', startIndex);
    return lineEnd === -1 ? undefined : lineEnd;
  }
  return terminator === '{' ? index : index + 1;
}

function findJSDocStart(text: string, signatureIndex: number): number | undefined {
  const before = text.slice(0, signatureIndex);
  const match = before.match(/\/\*\*[\s\S]*?\*\/\s*$/);
  if (!match) return undefined;
  return before.length - match[0].length;
}

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  return value.toLowerCase() !== 'false';
}

function parseNumber(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

async function main() {
  const workspaceRoot = process.env.AUTHORD_ROOT ? path.resolve(process.env.AUTHORD_ROOT) : process.cwd();
  const registryPath = path.join(workspaceRoot, '_authord', 'topics', 'index.yaml');
  const registry = loadRegistry(registryPath);
  const config: CiConfig = {
    workspaceRoot,
    failOnDrift: parseBoolean(process.env.AUTHORD_FAIL_ON_DRIFT, true),
    minCoverage: parseNumber(process.env.AUTHORD_MIN_COVERAGE, 80),
  };

  const result = evaluateRegistry(registry, config);
  printReport(result, config);
  const exitCode = decideExitCode(result, config);
  process.exit(exitCode);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
