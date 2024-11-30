import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token';

export async function processMarkdown(content: string): Promise<string> {
  // Initialize markdown-it with desired plugins
  const md = new MarkdownIt()
    
    .use(customPlugin);

  // Render the Markdown content
  return md.render(content);
}


// Custom plugin to replace @@text@@ with <span class="highlight">text</span>
function customPlugin(md: MarkdownIt): void {
  md.core.ruler.push('custom_highlight', (state) => {
    state.tokens.forEach((blockToken) => {
      if (blockToken.type === 'inline' && blockToken.children) {
        blockToken.children.forEach((token: Token) => {
          if (token.type === 'text') {
            token.content = token.content.replace(
              /@@(.*?)@@/g,
              (_, match) => `<h1> <b><i>madushika</i></b></h1>${match}</span>`
            );
          }
        });
      }
    });
  });
}


