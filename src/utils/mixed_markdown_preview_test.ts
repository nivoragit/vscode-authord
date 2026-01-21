import rehypeWritersidePreview from "../plugins/rehype_writerside_preview";
import { stripMarkdownCommentDirectives } from "./markdown_comment_strip";

type HastNode = {
  type: string;
  tagName?: string;
  properties?: Record<string, any>;
  children?: HastNode[];
  value?: string;
};

function runPlugin(tree: HastNode) {
  const plugin = rehypeWritersidePreview();
  (plugin as any)(tree);
}

function getClassList(node?: HastNode): string[] {
  if (!node?.properties) return [];
  const raw = node.properties.className ?? node.properties.class;
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === "string") return raw.split(/\s+/).filter(Boolean);
  return [];
}

function findFirst(node: HastNode | undefined, predicate: (n: HastNode) => boolean): HastNode | undefined {
  if (!node) return undefined;
  if (predicate(node)) return node;
  for (const child of node.children ?? []) {
    const found = findFirst(child, predicate);
    if (found) return found;
  }
  return undefined;
}

describe("renderMixedMarkdownToHtml", () => {
  it("maps inline emphasis, strong, and strikethrough to Writerside classes", async () => {
    const tree: HastNode = {
      type: "root",
      children: [
        { type: "element", tagName: "strong", properties: {}, children: [{ type: "text", value: "world" }] },
        { type: "element", tagName: "em", properties: {}, children: [{ type: "text", value: "italics" }] },
        { type: "element", tagName: "del", properties: {}, children: [{ type: "text", value: "done" }] },
      ],
    };
    runPlugin(tree);

    const strong = tree.children?.[0];
    const emphasis = tree.children?.[1];
    const strike = tree.children?.[2];

    expect(strong?.tagName).toBe("span");
    expect(getClassList(strong)).toContain("control");
    expect(emphasis?.tagName).toBe("span");
    expect(getClassList(emphasis)).toContain("emphasis");
    expect(strike?.tagName).toBe("span");
    expect(getClassList(strike)).toContain("text-line-through");
  });

  it("applies custom handlers to normalize additional tags", async () => {
    const tree: HastNode = {
      type: "root",
      children: [
        { type: "element", tagName: "callout", properties: {}, children: [{ type: "text", value: "Heads up" }] },
      ],
    };
    const plugin = rehypeWritersidePreview({
      customHandlers: {
        callout: (el: any) => {
          el.tagName = "div";
          (el.properties ??= {}).className = ["callout"];
        },
      },
    });
    (plugin as any)(tree);

    const callout = tree.children?.[0];
    expect(callout?.tagName).toBe("div");
    expect(getClassList(callout)).toContain("callout");
  });

  it("strips markdown comment directives", async () => {
    const markdown = "[//]: # (Comment)\n# Title";
    const cleaned = stripMarkdownCommentDirectives(markdown);
    expect(cleaned).toContain("# Title");
    expect(cleaned).not.toContain("Comment");
  });

  it("styles inline code and external links", async () => {
    const tree: HastNode = {
      type: "root",
      children: [
        { type: "element", tagName: "code", properties: {}, children: [{ type: "text", value: "inline.code" }] },
        { type: "element", tagName: "a", properties: { href: "https://example.com" }, children: [{ type: "text", value: "link" }] },
      ],
    };
    runPlugin(tree);

    const code = tree.children?.[0];
    const link = tree.children?.[1];
    expect(code?.tagName).toBe("code");
    expect(getClassList(code)).toContain("code");
    expect(getClassList(link)).toEqual(expect.arrayContaining(["link", "link--external", "link--dark"]));
    expect(link?.properties?.target).toBe("_blank");
    expect(link?.properties?.rel).toBe("noreferrer noopener");
  });

  it("adds Writerside list classes to markdown lists", async () => {
    const tree: HastNode = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "ul",
          properties: {},
          children: [
            { type: "element", tagName: "li", properties: {}, children: [{ type: "text", value: "Bullet item" }] },
          ],
        },
        {
          type: "element",
          tagName: "ol",
          properties: {},
          children: [
            { type: "element", tagName: "li", properties: {}, children: [{ type: "text", value: "Numbered item" }] },
          ],
        },
      ],
    };
    runPlugin(tree);

    const ul = tree.children?.[0];
    const ol = tree.children?.[1];
    expect(getClassList(ul)).toEqual(expect.arrayContaining(["article__list", "list", "_bullet"]));
    expect(getClassList(ol)).toEqual(expect.arrayContaining(["article__list", "list", "_decimal"]));

    const li = findFirst(ul, (n) => n.tagName === "li");
    expect(getClassList(li)).toContain("list__item");
    const p = findFirst(li, (n) => n.tagName === "p");
    expect(getClassList(p)).toEqual(expect.arrayContaining(["article__p", "child"]));
  });

  it("renders definition lists with Writerside structure", async () => {
    const tree: HastNode = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "deflist",
          properties: {},
          children: [
            {
              type: "element",
              tagName: "def",
              properties: { title: "Term" },
              children: [{ type: "element", tagName: "p", properties: {}, children: [{ type: "text", value: "Definition text." }] }],
            },
          ],
        },
      ],
    };
    runPlugin(tree);

    const dl = findFirst(tree, (n) => n.tagName === "dl");
    expect(getClassList(dl)).toEqual(expect.arrayContaining(["definition-list", "definition-list--type-title-top"]));
    const dt = findFirst(dl, (n) => n.tagName === "dt");
    expect(getClassList(dt)).toContain("definition-list__title");
    const dd = findFirst(dl, (n) => n.tagName === "dd");
    expect(getClassList(dd)).toContain("definition-list__description");
    const p = findFirst(dd, (n) => n.tagName === "p");
    expect(getClassList(p)).toEqual(expect.arrayContaining(["article__p", "child"]));
  });

  it("renders procedures as titled step lists", async () => {
    const tree: HastNode = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "procedure",
          properties: { title: "Procedure Title", id: "procedure-id" },
          children: [
            {
              type: "element",
              tagName: "step",
              properties: {},
              children: [{ type: "element", tagName: "p", properties: {}, children: [{ type: "text", value: "Do the thing." }] }],
            },
          ],
        },
      ],
    };
    runPlugin(tree);

    const section = findFirst(tree, (n) => n.tagName === "section");
    expect(getClassList(section)).toContain("procedure-steps");
    const heading = findFirst(section, (n) => n.tagName === "h3");
    expect(getClassList(heading)).toEqual(expect.arrayContaining(["title", "article__h3", "child"]));
    const title = findFirst(heading, (n) => n.tagName === "span");
    expect(getClassList(title)).toContain("title__content");
    const li = findFirst(section, (n) => n.tagName === "li");
    expect(getClassList(li)).toContain("list__item");
    const p = findFirst(li, (n) => n.tagName === "p");
    expect(getClassList(p)).toEqual(expect.arrayContaining(["article__p", "child"]));
  });

  it("renders compare blocks as code comparers", async () => {
    const tree: HastNode = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "compare",
          properties: { "first-title": "First Column", "second-title": "Second Column" },
          children: [
            { type: "element", tagName: "code-block", properties: { lang: "bash" }, children: [{ type: "text", value: "echo \"first\"" }] },
            { type: "element", tagName: "code-block", properties: { lang: "bash" }, children: [{ type: "text", value: "echo \"second\"" }] },
          ],
        },
      ],
    };
    runPlugin(tree);

    const wrapper = findFirst(tree, (n) => getClassList(n).includes("code-comparer__wrapper"));
    expect(wrapper).toBeDefined();
    const title = findFirst(wrapper, (n) => n.tagName === "h4");
    expect(getClassList(title)).toContain("code-comparer__title");
    const pre = findFirst(wrapper, (n) => n.tagName === "pre");
    expect(getClassList(pre)).toEqual(expect.arrayContaining(["code-comparer__pre", "language-bash"]));
  });

  it("unwraps CDATA comments inside compare blocks", async () => {
    const tree: HastNode = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "compare",
          properties: { "first-title": "First Column", "second-title": "Second Column" },
          children: [
            {
              type: "element",
              tagName: "code-block",
              properties: { lang: "xml" },
              children: [
                {
                  type: "comment",
                  value: "[CDATA[<img src=\"new_topic_options.png\" alt=\"Alt text\" width=\"450px\"/>]]",
                },
              ],
            },
          ],
        },
      ],
    };
    runPlugin(tree);

    const code = findFirst(tree, (n) => n.tagName === "code");
    const text = code?.children?.[0]?.value;
    expect(text).toBe("<img src=\"new_topic_options.png\" alt=\"Alt text\" width=\"450px\"/>");
  });

  it("renders tabs with content wrappers", async () => {
    const tree: HastNode = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "tabs",
          properties: {},
          children: [
            { type: "element", tagName: "tab", properties: { title: "Tab Title" }, children: [{ type: "element", tagName: "p", properties: {}, children: [{ type: "text", value: "Tab content." }] }] },
          ],
        },
      ],
    };
    runPlugin(tree);

    const wrapper = findFirst(tree, (n) => getClassList(n).includes("tabs__content-wrapper"));
    expect(wrapper).toBeDefined();
    const content = findFirst(wrapper, (n) => getClassList(n).includes("tabs__content"));
    expect(content?.properties?.["data-title"]).toBe("Tab Title");
    const p = findFirst(wrapper, (n) => n.tagName === "p");
    expect(getClassList(p)).toEqual(expect.arrayContaining(["article__p", "child"]));
  });

  it("wraps tables with Writerside classes", async () => {
    const tree: HastNode = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "table",
          properties: {},
          children: [
            {
              type: "element",
              tagName: "thead",
              children: [
                {
                  type: "element",
                  tagName: "tr",
                  children: [
                    { type: "element", tagName: "th", properties: {}, children: [{ type: "text", value: "Header A" }] },
                    { type: "element", tagName: "th", properties: {}, children: [{ type: "text", value: "Header B" }] },
                  ],
                },
              ],
            },
            {
              type: "element",
              tagName: "tbody",
              children: [
                {
                  type: "element",
                  tagName: "tr",
                  children: [
                    { type: "element", tagName: "td", properties: {}, children: [{ type: "text", value: "Row A" }] },
                    { type: "element", tagName: "td", properties: {}, children: [{ type: "text", value: "Row B" }] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    runPlugin(tree);

    const tableWrapper = findFirst(tree, (n) => getClassList(n).includes("table"));
    expect(tableWrapper).toBeDefined();
    const th = findFirst(tableWrapper, (n) => n.tagName === "th");
    expect(getClassList(th)).toContain("table__th");
    const headerP = findFirst(th, (n) => n.tagName === "p");
    expect(getClassList(headerP)).toContain("article__p");
    const td = findFirst(tableWrapper, (n) => n.tagName === "td");
    const cellP = findFirst(td, (n) => n.tagName === "p");
    expect(getClassList(cellP)).toEqual(expect.arrayContaining(["article__p", "child"]));
  });

  it("renders admonitions as prompt blocks", async () => {
    const tree: HastNode = {
      type: "root",
      children: [
        { type: "element", tagName: "note", children: [{ type: "element", tagName: "p", properties: {}, children: [{ type: "text", value: "Note text." }] }] },
        { type: "element", tagName: "tip", children: [{ type: "element", tagName: "p", properties: {}, children: [{ type: "text", value: "Tip text." }] }] },
        { type: "element", tagName: "warning", children: [{ type: "element", tagName: "p", properties: {}, children: [{ type: "text", value: "Warning text." }] }] },
      ],
    };
    runPlugin(tree);

    const noteWrapper = findFirst(tree, (n) => getClassList(n).includes("prompt__wrapper--type-note"));
    const tipWrapper = findFirst(tree, (n) => getClassList(n).includes("prompt__wrapper--type-tip"));
    const warningWrapper = findFirst(tree, (n) => getClassList(n).includes("prompt__wrapper--type-warning"));
    expect(noteWrapper).toBeDefined();
    expect(tipWrapper).toBeDefined();
    expect(warningWrapper).toBeDefined();
    const noteP = findFirst(noteWrapper, (n) => n.tagName === "p");
    expect(getClassList(noteP)).toEqual(expect.arrayContaining(["article__p", "child"]));
  });

  it("converts code blocks into Writerside wrappers", async () => {
    const tree: HastNode = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "code-block",
          properties: { lang: "ts" },
          children: [{ type: "text", value: "const x = 1;" }],
        },
      ],
    };
    runPlugin(tree);

    const wrapper = findFirst(tree, (n) => getClassList(n).includes("code-block__wrapper"));
    expect(wrapper).toBeDefined();
    const pre = findFirst(wrapper, (n) => n.tagName === "pre");
    expect(getClassList(pre)).toEqual(expect.arrayContaining(["code-block__pre", "language-ts"]));
  });

  it("unwraps CDATA comments inside code blocks", async () => {
    const tree: HastNode = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "code-block",
          properties: { lang: "xml" },
          children: [
            {
              type: "comment",
              value: "[CDATA[\n            <img src=\"new_topic_options.png\" alt=\"Alt text\" width=\"450px\"/>]]",
            },
          ],
        },
      ],
    };
    runPlugin(tree);

    const code = findFirst(tree, (n) => n.tagName === "code");
    const text = code?.children?.[0]?.value;
    expect(text).toBe("<img src=\"new_topic_options.png\" alt=\"Alt text\" width=\"450px\"/>");
  });

  it("renders markdown fences with code-block styling", async () => {
    const tree: HastNode = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "pre",
          properties: {},
          children: [
            {
              type: "element",
              tagName: "code",
              properties: { className: ["language-javascript"] },
              children: [{ type: "text", value: "console.log('hi');" }],
            },
          ],
        },
      ],
    };
    runPlugin(tree);

    const pre = findFirst(tree, (n) => getClassList(n).includes("code-block__pre"));
    expect(getClassList(pre)).toContain("language-javascript");
  });

  it("renders tldr blocks as plain content", async () => {
    const tree: HastNode = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "tldr",
          children: [
            { type: "element", tagName: "p", properties: {}, children: [{ type: "text", value: "Scope: short highlight." }] },
            { type: "element", tagName: "p", properties: {}, children: [{ type: "text", value: "Audience: short highlight." }] },
          ],
        },
      ],
    };
    runPlugin(tree);

    const tldrWrapper = findFirst(tree, (n) => n.tagName === "div");
    expect(tldrWrapper).toBeDefined();
    const p = findFirst(tldrWrapper, (n) => n.tagName === "p");
    expect(getClassList(p)).toEqual(expect.arrayContaining(["article__p", "child"]));
  });
});
