import { remark } from 'remark';
import remarkHtml from 'remark-html';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkHtmlKatex from 'remark-html-katex';
import { Plugin } from 'unified';
import { visit } from 'unist-util-visit';
import { Node } from 'unist';


const customPlugin: Plugin = () => {
    return (tree) => {
      visit(tree, 'text', (node: Node & { value: string }) => {
        if (typeof node.value === 'string') {
          // Replace @@text@@ with <span class="highlight">text</span>
          node.value = node.value.replace(/@@(.*?)@@/g, '<span class="highlight">$1</span>');
        }
      });
    };
  };
  

export async function processMarkdown(content: string): Promise<string> {
  const processor = remark()
    .use(remarkGfm)
    .use(remarkMath)
    .use(customPlugin)
    .use(remarkHtmlKatex)
    .use(remarkHtml);

  const file = await processor.process(content);
  return String(file);
}
