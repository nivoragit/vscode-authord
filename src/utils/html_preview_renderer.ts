import { unified } from 'unified';
import rehypeStringify from 'rehype-stringify';
import type { Element as XastElement } from 'xast';
import {
  TopicXastToHast,
  getRootElement,
  parseXmlToXast,
  type XmlSanitizeOptions,
} from '@authord/render-core';
import rehypeWritersidePreview, {
  type RehypeWritersidePreviewOptions,
} from '../plugins/rehype_writerside_preview';
import rehypeMermaidPreview from '../plugins/rehype_mermaid_preview';
import {
  renderMixedMarkdownToHtml,
  type MixedMarkdownRenderOptions,
} from './mixed_markdown_renderer';

export type HtmlPreviewOptions = {
  markdown?: MixedMarkdownRenderOptions;
  topic?: {
    preview?: RehypeWritersidePreviewOptions;
    sanitize?: XmlSanitizeOptions;
    imagesDir?: string;
  };
};

export async function renderMarkdownHtml(
  markdown: string,
  opts: MixedMarkdownRenderOptions = {}
): Promise<string> {
  return await renderMixedMarkdownToHtml(markdown, opts);
}

export async function renderTopicXmlHtml(
  xml: string,
  opts: HtmlPreviewOptions['topic'] = {}
): Promise<string> {
  const root = getRootElement(parseXmlToXast(xml, opts?.sanitize));
  return await renderTopicXastHtml(root, opts);
}

export async function renderTopicXastHtml(
  root: XastElement,
  opts: HtmlPreviewOptions['topic'] = {}
): Promise<string> {
  const toHast = new TopicXastToHast();
  const hast = toHast.toHast(root);
  const previewOptions = opts.preview ?? {};

  const processor = unified()
    .use(rehypeMermaidPreview, { imagesDir: opts.imagesDir })
    .use(rehypeWritersidePreview, previewOptions)
    .use(rehypeStringify, { allowDangerousHtml: true });

  const transformed = await processor.run(hast as any);
  return String(processor.stringify(transformed as any));
}

export async function renderDocsetPageHtml(
  page: { kind: 'topic' | 'markdown'; ast: XastElement },
  opts: HtmlPreviewOptions = {}
): Promise<string> {
  if (page.kind === 'markdown') {
    const markdown = extractMarkdownFromMdPage(page.ast);
    return await renderMarkdownHtml(markdown, opts.markdown);
  }
  return await renderTopicXastHtml(page.ast, opts.topic ?? {});
}

function extractMarkdownFromMdPage(mdPage: XastElement): string {
  const parts: string[] = [];
  for (const child of mdPage.children ?? []) {
    if (child.type === 'text') {
      const value = (child as { value?: unknown }).value;
      parts.push(String(value ?? ''));
    }
  }
  return parts.join('');
}
