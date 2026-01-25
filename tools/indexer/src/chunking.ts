export interface ChunkingOptions {
  maxChunkChars: number;
  overlapChars: number;
}

export interface TextChunk {
  headingPath: string;
  text: string;
}

export function chunkMarkdown(content: string, options: ChunkingOptions): TextChunk[] {
  const sections = splitByHeadings(content);
  const chunks: TextChunk[] = [];

  for (const section of sections) {
    const sectionChunks = splitWithOverlap(section.text, options.maxChunkChars, options.overlapChars);
    for (const text of sectionChunks) {
      if (!text.trim()) continue;
      chunks.push({ headingPath: section.headingPath, text });
    }
  }

  return chunks;
}

export function chunkConfluenceStorage(content: string, options: ChunkingOptions): TextChunk[] {
  const markdownish = storageToMarkdownish(content);
  return chunkMarkdown(markdownish, options);
}

interface HeadingSection {
  headingPath: string;
  text: string;
}

function splitByHeadings(content: string): HeadingSection[] {
  const lines = content.split('\n');
  const sections: HeadingSection[] = [];
  const headingStack: string[] = [];
  let currentLines: string[] = [];
  let currentHeadingPath = 'root';

  const flush = () => {
    if (currentLines.length === 0) return;
    sections.push({ headingPath: currentHeadingPath, text: currentLines.join('\n') });
    currentLines = [];
  };

  for (const line of lines) {
    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line.trim());
    if (headingMatch) {
      flush();
      const level = headingMatch[1].length;
      const title = headingMatch[2].trim() || 'untitled';

      while (headingStack.length >= level) {
        headingStack.pop();
      }
      headingStack.push(title);
      currentHeadingPath = headingStack.join(' > ');
    }

    currentLines.push(line);
  }

  flush();

  if (sections.length === 0 && content.trim()) {
    return [{ headingPath: 'root', text: content }];
  }

  return sections;
}

function splitWithOverlap(text: string, maxChars: number, overlap: number): string[] {
  if (text.length <= maxChars) return [text];
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + maxChars, text.length);
    chunks.push(text.slice(start, end));
    if (end === text.length) break;
    start = Math.max(0, end - overlap);
  }

  return chunks;
}

function storageToMarkdownish(content: string): string {
  if (!content) return '';
  let text = content;

  text = text.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_match, level, inner) => {
    const headingText = stripTags(inner).trim() || 'untitled';
    const prefix = '#'.repeat(Number(level));
    return `\n${prefix} ${headingText}\n`;
  });

  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/(p|div|li|tr|ul|ol|table|section|blockquote)>/gi, '\n');
  text = text.replace(/<[^>]+>/g, '');

  return decodeEntities(text);
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, '');
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}
