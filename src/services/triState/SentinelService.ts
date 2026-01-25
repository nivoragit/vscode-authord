import * as path from 'path';
import { createHash } from 'crypto';
import type { TriStateRegistry, TriStateTopic } from './types';

export type DriftStatus = 'Synced' | 'Drifted' | 'Unknown';

export interface SymbolRef {
  topic: TriStateTopic;
  symbol: string;
  symbolName?: string;
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

export default class SentinelService {
  constructor(private readonly workspaceRoot: string) {}

  checkDrift(topic: TriStateTopic, currentFileText: string, symbolOverride?: string): DriftStatus {
    const contract = topic?.code_contract ?? null;
    if (!contract) return 'Unknown';
    const lastHash = contract.last_known_hash;
    if (!lastHash) return 'Unknown';

    let currentHash = '';
    if (contract.hash_algo === 'text_nocomments_v1') {
      currentHash = computeTextNoCommentsHash(currentFileText);
    } else if (contract.hash_algo === 'ts_signature_v1') {
      const symbol = symbolOverride || contract.symbols?.[0] || '';
      currentHash = computeTsSignatureHash(currentFileText, symbol);
    }

    if (!currentHash) return 'Unknown';
    return currentHash === lastHash ? 'Synced' : 'Drifted';
  }

  findSymbolRefsForDocument(registry: TriStateRegistry, documentPath: string): SymbolRef[] {
    if (!registry?.topics) return [];
    const normalizedDoc = normalizePath(documentPath);
    const refs: SymbolRef[] = [];

    Object.values(registry.topics).forEach((topic) => {
      const symbols = topic?.code_contract?.symbols || [];
      symbols.forEach((symbol) => {
        const parsed = parseSymbolRef(symbol);
        if (!parsed.filePath) return;
        const resolved = path.isAbsolute(parsed.filePath)
          ? parsed.filePath
          : path.resolve(this.workspaceRoot, parsed.filePath);
        if (normalizePath(resolved) !== normalizedDoc) return;
        refs.push({ topic, symbol, symbolName: parsed.symbolName });
      });
    });

    return refs;
  }
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

function parseSymbolRef(symbol: string): { filePath?: string; symbolName?: string } {
  const trimmed = symbol.trim();
  if (!trimmed) return {};

  if (trimmed.startsWith('file:') || trimmed.startsWith('path:')) {
    const [, rest] = trimmed.split(/:(.+)/);
    if (!rest) return {};
    const [filePath, symbolName] = rest.split('#');
    return { filePath, symbolName };
  }

  if (trimmed.includes('#')) {
    const [filePath, symbolName] = trimmed.split('#');
    return { filePath, symbolName };
  }

  if (looksLikePath(trimmed)) {
    return { filePath: trimmed };
  }

  return { symbolName: extractSymbolName(trimmed) };
}

function looksLikePath(value: string): boolean {
  if (value.includes('/') || value.includes('\\')) return true;
  return /\.[a-z0-9]+$/i.test(value);
}

function normalizePath(value: string): string {
  return path.normalize(value).toLowerCase();
}
