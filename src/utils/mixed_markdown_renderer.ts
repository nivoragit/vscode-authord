import { unified } from "unified";
import type { PluggableList } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkDirective from "remark-directive";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeStringify from "rehype-stringify";
import rehypeWritersidePreview, {
  type RehypeWritersidePreviewOptions,
} from "../plugins/rehype_writerside_preview";
import rehypeMermaidPreview from "../plugins/rehype_mermaid_preview";
import { stripMarkdownCommentDirectives } from "./markdown_comment_strip";
import { scrollSyncPlugin } from "../plugins/scrollSyncPlugin";

export interface MixedMarkdownRenderOptions extends RehypeWritersidePreviewOptions {
  /** Preserve raw HTML in the output. Default: true. */
  allowDangerousHtml?: boolean;
  /** Directory to store generated mermaid images. */
  imageFolder?: string;
  /** Extra remark plugins to extend Markdown syntax. */
  remarkPlugins?: PluggableList;
  /** Extra rehype plugins to extend HTML handling. */
  rehypePlugins?: PluggableList;
}

export async function renderMixedMarkdownToHtml(
  markdown: string,
  opts: MixedMarkdownRenderOptions = {},
): Promise<string> {
  const cleaned = stripMarkdownCommentDirectives(markdown);
  const {
    allowDangerousHtml = true,
    imageFolder,
    remarkPlugins,
    rehypePlugins,
    ...previewOpts
  } = opts;

  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkDirective)
    .use(scrollSyncPlugin);

  if (remarkPlugins && remarkPlugins.length > 0) {
    processor.use(remarkPlugins);
  }

  processor
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw);

  if (rehypePlugins && rehypePlugins.length > 0) {
    processor.use(rehypePlugins);
  }

  processor.use(rehypeMermaidPreview, { imagesDir: imageFolder });
  processor.use(rehypeWritersidePreview, previewOpts);

  const file = await processor
    .use(rehypeStringify, { allowDangerousHtml })
    .process(cleaned);

  return String(file);
}
