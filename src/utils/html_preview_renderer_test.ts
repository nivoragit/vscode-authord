import { wrapMarkdownAsMdPageXast } from '@authord/render-core';
import { renderDocsetPageHtml, renderTopicXmlHtml } from './html_preview_renderer';

jest.mock('unified', () => {
  const serialize = (node: any): string => {
    if (!node) return '';
    if (node.type === 'text') return String(node.value ?? '');
    const children = (node.children ?? []).map(serialize).join('');
    if (node.type === 'root') return children;
    if (node.type !== 'element') return '';
    const props = node.properties ?? {};
    const attrs = Object.entries(props)
      .map(([key, value]) => {
        if (value == null) return '';
        if (key === 'className' && Array.isArray(value)) {
          return ` class="${value.join(' ')}"`;
        }
        if (Array.isArray(value)) {
          return ` ${key}="${value.join(' ')}"`;
        }
        return ` ${key}="${String(value)}"`;
      })
      .join('');
    return `<${node.tagName}${attrs}>${children}</${node.tagName}>`;
  };

  return {
    unified: () => {
      const transforms: Array<(tree: any) => void> = [];
      const api = {
        use: (plugin: any, opts?: any) => {
          if (typeof plugin === 'function' && plugin.name !== 'rehypeStringify') {
            const transformer = plugin(opts);
            if (typeof transformer === 'function') {
              transforms.push(transformer);
            }
          }
          return api;
        },
        run: async (tree: any) => {
          transforms.forEach((transform) => transform(tree));
          return tree;
        },
        stringify: (tree: any) => serialize(tree),
      };
      return api;
    },
  };
});

jest.mock('rehype-stringify', () => () => () => {});

jest.mock('@authord/render-core', () => {
  class TopicXastToHast {
    toHast(root: any) {
      const children: any[] = [];
      if (root.title) {
        children.push({
          type: 'element',
          tagName: 'h1',
          properties: {},
          children: [{ type: 'text', value: root.title }],
        });
      }
      if (root.codeText) {
        children.push({
          type: 'element',
          tagName: 'code-block',
          properties: { lang: root.codeLang },
          children: [{ type: 'text', value: root.codeText }],
        });
      }
      return { type: 'root', children };
    }
  }

  const parseXmlToXast = (xml: string) => {
    const titleMatch = xml.match(/<title>([\s\S]*?)<\/title>/i);
    const codeMatch = xml.match(/<code-block[^>]*lang=["']([^"']+)["'][^>]*>([\s\S]*?)<\/code-block>/i);
    return {
      title: titleMatch?.[1]?.trim() ?? '',
      codeLang: codeMatch?.[1],
      codeText: codeMatch?.[2]?.trim() ?? '',
    };
  };

  return {
    TopicXastToHast,
    parseXmlToXast,
    getRootElement: (root: any) => root,
    wrapMarkdownAsMdPageXast: (markdown: string) => ({
      type: 'element',
      children: [{ type: 'text', value: markdown }],
    }),
  };
});

jest.mock('./mixed_markdown_renderer', () => ({
  renderMixedMarkdownToHtml: async (markdown: string) => {
    if (markdown.includes('world')) return '<strong>world</strong>';
    return '<p>mock</p>';
  },
}));

describe('html preview renderer', () => {
  it('renders topic XML into HTML with headings and code blocks', async () => {
    const xml = '<topic><title>Intro</title><code-block lang="ts">\nconst x = 1;\n</code-block></topic>';
    const html = await renderTopicXmlHtml(xml);

    expect(html).toContain('Intro');
    expect(html).toContain('title__content');
    expect(html).toContain('code-block__pre');
    expect(html).toContain('language-ts');
  });

  it('renders markdown docset pages from md-page AST', async () => {
    const ast = wrapMarkdownAsMdPageXast('Hello **world**', '/docs/intro.md');
    const html = await renderDocsetPageHtml({ kind: 'markdown', ast });

    expect(html).toContain('<strong>world</strong>');
  });
});
