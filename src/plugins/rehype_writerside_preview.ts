import type { Comment, Element, Parent, Properties, Root, Text, ElementContent } from "hast";
import { normalizeHastTree, type HastElementHandler } from "../utils/hast_normalizer";

export interface RehypeWritersidePreviewOptions {
  /** Base heading level for top-level <chapter>. Default: 2. */
  chapterBaseLevel?: number;
  /** Remove <show-structure> nodes. Default: true. */
  removeShowStructure?: boolean;
  /** Custom tag handlers keyed by tag name (lowercased). */
  customHandlers?: Record<string, CustomTagHandler>;
}

type Ctx = { chapterDepth: number; chapterBaseLevel: number };
export type CustomTagHandler = (el: Element, ctx: Ctx) => void;

export default function rehypeWritersidePreview(
  opts: RehypeWritersidePreviewOptions = {},
) {
  const chapterBaseLevel = clampHeadingLevel(opts.chapterBaseLevel ?? 2);
  const removeShowStructure = opts.removeShowStructure ?? true;
  const customHandlers = normalizeCustomHandlers(opts.customHandlers);

  const handlers: Record<string, HastElementHandler<Ctx>> = {
    h1: (el) => wrapHeading(el, 1),
    h2: (el) => wrapHeading(el, 2),
    h3: (el) => wrapHeading(el, 3),
    h4: (el) => wrapHeading(el, 4),
    h5: (el) => wrapHeading(el, 5),
    h6: (el) => wrapHeading(el, 6),
    p: (el) => {
      transformParagraph(el);
      return undefined;
    },
    "show-structure": (el) => {
      if (removeShowStructure) return null;
      transformShowStructure(el);
      return undefined;
    },
    chapter: (el, ctx) => {
      transformChapter(el, ctx);
      return undefined;
    },
    list: (el) => {
      transformList(el);
      return undefined;
    },
    item: (el) => {
      transformListItem(el);
      return undefined;
    },
    ul: (el) => {
      transformHtmlList(el, "ul");
      return undefined;
    },
    ol: (el) => {
      transformHtmlList(el, "ol");
      return undefined;
    },
    li: (el) => {
      transformListItem(el);
      return undefined;
    },
    "code-block": (el) => transformCodeBlock(el),
    pre: (el) => transformPre(el),
    code: (el) => {
      transformInlineCode(el);
      return undefined;
    },
    a: (el) => {
      transformLink(el);
      return undefined;
    },
    emphasis: (el) => {
      transformEmphasis(el);
      return undefined;
    },
    em: (el) => {
      transformEmphasis(el);
      return undefined;
    },
    i: (el) => {
      transformEmphasis(el);
      return undefined;
    },
    strong: (el) => {
      transformStrong(el);
      return undefined;
    },
    b: (el) => {
      transformStrong(el);
      return undefined;
    },
    del: (el) => {
      transformStrikethrough(el);
      return undefined;
    },
    s: (el) => {
      transformStrikethrough(el);
      return undefined;
    },
    strike: (el) => {
      transformStrikethrough(el);
      return undefined;
    },
    format: (el) => {
      transformFormat(el);
      return undefined;
    },
    note: (el) => transformAdmonition(el, "note"),
    tip: (el) => transformAdmonition(el, "tip"),
    warning: (el) => transformAdmonition(el, "warning"),
    important: (el) => transformAdmonition(el, "important"),
    blockquote: (el) => transformBlockquote(el),
    tldr: (el) => transformTldr(el),
    deflist: (el) => {
      transformDefinitionList(el);
      return undefined;
    },
    def: (el) => transformDefinition(el),
    procedure: (el) => transformProcedure(el),
    step: (el) => {
      transformStep(el);
      return undefined;
    },
    compare: (el) => transformCompare(el),
    tabs: (el) => transformTabs(el),
    table: (el) => transformTable(el),
    thead: (el) => {
      transformTableSection(el, "table__thead");
      return undefined;
    },
    tbody: (el) => {
      transformTableSection(el, "table__tbody");
      return undefined;
    },
    tr: (el) => {
      transformTableSection(el, "table__tr");
      return undefined;
    },
    th: (el) => {
      transformTableCell(el, "table__th", false);
      return undefined;
    },
    td: (el) => {
      transformTableCell(el, "table__td", true);
      return undefined;
    },
    "link-summary": () => null,
    "card-summary": () => null,
    include: () => null,
    cards: () => null,
    card: () => null,
    spotlight: (el) => {
      transformSpotlight(el);
      return undefined;
    },
    image: (el) => {
      transformImage(el);
      return undefined;
    },
    "confluence-image": (el) => {
      transformConfluenceImage(el);
      return undefined;
    },
  };

  const hasCustomHandlers = Object.keys(customHandlers).length > 0;

  const getNextCtx = (ctx: Ctx, originalTag: string) =>
    originalTag === "chapter"
      ? { ...ctx, chapterDepth: ctx.chapterDepth + 1 }
      : ctx;

  return (tree: Root) => {
    if (removeShowStructure) {
      unwrapVoidLikeElements(tree as Parent, new Set(["show-structure", "include", "card"]));
    } else {
      unwrapShowStructure(tree as Parent, "show-structure");
      unwrapVoidLikeElements(tree as Parent, new Set(["include", "card"]));
    }
    normalizeHastTree(tree as Parent, {
      ctx: { chapterDepth: 0, chapterBaseLevel },
      handlers,
      onElement: hasCustomHandlers
        ? (el, ctx, info) => {
            const nextCtx = getNextCtx(ctx, info.originalTag);
            applyCustomHandler(customHandlers, info.originalTag, info.currentTag, el, nextCtx);
          }
        : undefined,
      getChildContext: (ctx, info) => getNextCtx(ctx, info.originalTag),
    });
  };
}

function transformChapter(el: Element, ctx: Ctx) {
  const props = (el.properties ??= {});
  const titleAttr = stringProp(props, "title");
  const idAttr = stringProp(props, "id");

  const titleChildIdx = findChildIndex(el, "title");
  const titleChildText = titleChildIdx >= 0
    ? extractText(el.children?.[titleChildIdx] as ElementContent)
    : "";

  const title = (titleAttr || titleChildText || "").trim();

  if (titleChildIdx >= 0) {
    el.children?.splice(titleChildIdx, 1);
  }

  if (title) {
    const level = clampHeadingLevel(ctx.chapterBaseLevel + ctx.chapterDepth);
    const heading: Element = {
      type: "element",
      tagName: `h${level}`,
      properties: idAttr ? { id: idAttr } : {},
      children: [{ type: "text", value: title } as Text],
    };
    el.children = [heading, ...(el.children ?? [])];
    if ("title" in props) delete (props as Record<string, unknown>).title;
    if (idAttr && "id" in props) delete (props as Record<string, unknown>).id;
  }

  el.tagName = "section";
  addClass(props, "chapter");
  addClass(props, "ws-chapter");
}

function transformList(el: Element) {
  const props = (el.properties ??= {});
  const kind = (stringProp(props, "type") ?? stringProp(props, "kind") ?? "").toLowerCase();
  const isOrdered = kind === "numbered" || kind === "ordered" || kind === "decimal";
  el.tagName = isOrdered ? "ol" : "ul";
  addClass(props, "article__list");
  addClass(props, "list");
  addClass(props, isOrdered ? "_decimal" : "_bullet");
  if (isOrdered && !("type" in props)) {
    (props as Record<string, unknown>).type = "1";
  }
  if ("type" in props) delete (props as Record<string, unknown>).type;
  if ("kind" in props) delete (props as Record<string, unknown>).kind;
}

function transformCodeBlock(el: Element): Element {
  const props = (el.properties ??= {});
  const lang = stringProp(props, "lang") ?? stringProp(props, "language");
  const codeText = normalizeCodeText(extractCodeText(el));
  const preAttrs: Properties = {};
  if (props.id) preAttrs.id = props.id;
  if (props.className) preAttrs.className = props.className;
  if (props.style) preAttrs.style = props.style;
  return buildCodeBlockWrapper(codeText, lang, preAttrs);
}

function transformFormat(el: Element) {
  const props = (el.properties ??= {});
  const role = (stringProp(props, "role") ?? "").toLowerCase();
  const style = stringProp(props, "style") ?? "";

  if (role === "em" || role === "i") {
    el.tagName = "span";
    addClass(props, "emphasis");
  } else if (role === "strong" || role === "b") {
    el.tagName = "span";
    addClass(props, "control");
  } else if (role === "code") {
    el.tagName = "code";
    addClass(props, "code");
  } else if (role === "kbd") {
    el.tagName = "kbd";
  } else if (role === "del" || role === "strike") {
    el.tagName = "span";
    addClass(props, "text-line-through");
  } else {
    el.tagName = "span";
    if (style) props.style = style;
  }

  if ("role" in props) delete (props as Record<string, unknown>).role;
}

function transformAdmonition(el: Element, kind: string): Element {
  return buildPrompt(kind, el.children ?? []);
}

function transformSpotlight(el: Element) {
  el.tagName = "div";
  addClass((el.properties ??= {}), "spotlight");
}

function transformImage(el: Element) {
  const props = (el.properties ??= {});
  const src = stringProp(props, "src") ?? stringProp(props, "href") ?? stringProp(props, "file");
  if (src) props.src = src;
  el.tagName = "img";
}

function transformConfluenceImage(el: Element) {
  const props = (el.properties ??= {});
  const filename = stringProp(props, "filename");
  if (filename) (props as Record<string, unknown>).src = filename;
  if ("filename" in props) delete (props as Record<string, unknown>).filename;
  el.tagName = "img";
}

function transformShowStructure(el: Element) {
  const props = (el.properties ??= {});
  const depth = stringProp(props, "depth");
  const forAttr = stringProp(props, "for");
  el.tagName = "nav";
  addClass(props, "ws-toc");
  if (depth) (props as Record<string, unknown>)["data-depth"] = depth;
  if (forAttr) (props as Record<string, unknown>)["data-for"] = forAttr;
}

function unwrapVoidLikeElements(root: Parent, tags: Set<string>): void {
  const kids = root.children;
  if (!Array.isArray(kids)) return;

  for (let i = 0; i < kids.length; i++) {
    const node = kids[i];
    if (!node || node.type !== "element") continue;
    const el = node as Element;
    const tag = (el.tagName ?? "").toLowerCase();

    if (tags.has(tag)) {
      const replacement = Array.isArray(el.children) ? el.children : [];
      if (replacement.length > 0) {
        kids.splice(i, 1, ...replacement);
        i -= 1;
      } else {
        kids.splice(i, 1);
        i -= 1;
      }
      continue;
    }

    unwrapVoidLikeElements(el as Parent, tags);
  }
}

function unwrapShowStructure(root: Parent, tagName: string): void {
  const kids = root.children;
  if (!Array.isArray(kids)) return;

  for (let i = 0; i < kids.length; i++) {
    const node = kids[i];
    if (!node || node.type !== "element") continue;
    const el = node as Element;
    const tag = (el.tagName ?? "").toLowerCase();

    if (tag === tagName) {
      const replacement = Array.isArray(el.children) ? el.children : [];
      transformShowStructure(el);
      el.children = [];
      kids.splice(i, 1, el, ...replacement);
      i += 0;
      continue;
    }

    unwrapShowStructure(el as Parent, tagName);
  }
}

function wrapHeading(el: Element, level: number) {
  addClass((el.properties ??= {}), "title");
  addClass((el.properties ??= {}), `article__h${level}`);
  el.children = wrapTitleContent(el.children ?? []);
}

function wrapTitleContent(children: ElementContent[]): ElementContent[] {
  return [{
    type: "element",
    tagName: "span",
    properties: { className: ["title__content"] },
    children,
  }];
}

function transformParagraph(el: Element) {
  addClass((el.properties ??= {}), "article__p");
}

function transformInlineCode(el: Element) {
  const props = (el.properties ??= {});
  const classes = getClassList(props);
  if (classes.some((name) => name.startsWith("language-"))) return;
  addClass(props, "code");
}

function transformLink(el: Element) {
  const props = (el.properties ??= {});
  const href = stringProp(props, "href");
  if (href && /^https?:\/\//i.test(href)) {
    addClass(props, "link");
    addClass(props, "link--external");
    addClass(props, "link--dark");
    (props as Record<string, unknown>).target = "_blank";
    (props as Record<string, unknown>).rel = "noreferrer noopener";
  } else {
    addClass(props, "link");
  }
}

function transformEmphasis(el: Element) {
  el.tagName = "span";
  addClass((el.properties ??= {}), "emphasis");
}

function transformStrong(el: Element) {
  el.tagName = "span";
  addClass((el.properties ??= {}), "control");
}

function transformStrikethrough(el: Element) {
  el.tagName = "span";
  addClass((el.properties ??= {}), "text-line-through");
}

function transformHtmlList(el: Element, kind: "ul" | "ol") {
  const props = (el.properties ??= {});
  addClass(props, "article__list");
  addClass(props, "list");
  addClass(props, kind === "ol" ? "_decimal" : "_bullet");
  if (kind === "ol" && !("type" in props)) {
    (props as Record<string, unknown>).type = "1";
  }
}

function transformListItem(el: Element) {
  el.tagName = "li";
  addClass((el.properties ??= {}), "list__item");
  el.children = normalizeParagraphChildren(el.children ?? [], ["article__p", "child"]);
}

function transformPre(el: Element): Element | void {
  const props = (el.properties ??= {});
  const classes = getClassList(props);
  if (classes.includes("code-block__pre") || classes.includes("code-comparer__pre")) {
    return;
  }

  const codeChild = findFirstChild(el, "code");
  if (!codeChild) return;
  const lang = extractLanguageFromCode(codeChild);
  const codeText = normalizeCodeText(extractCodeText(codeChild));
  const preAttrs: Properties = {};
  if (props.id) preAttrs.id = props.id;
  if (props.className) preAttrs.className = props.className;
  if (props.style) preAttrs.style = props.style;
  return buildCodeBlockWrapper(codeText, lang, preAttrs);
}

function transformBlockquote(el: Element): Element {
  return buildPrompt("tip", el.children ?? []);
}

function transformTldr(el: Element): Element {
  const content = normalizeParagraphChildren(el.children ?? [], ["article__p", "child"]);
  return {
    type: "element",
    tagName: "div",
    properties: {},
    children: content,
  };
}

function transformDefinitionList(el: Element) {
  el.tagName = "dl";
  addClass((el.properties ??= {}), "definition-list");
  addClass((el.properties ??= {}), "definition-list--type-title-top");
}

function transformDefinition(el: Element): Element {
  const props = (el.properties ??= {});
  let title = stringProp(props, "title") ?? "";
  const titleChildIdx = findChildIndex(el, "title");
  if (titleChildIdx >= 0) {
    title = extractText(el.children?.[titleChildIdx] as ElementContent).trim();
    el.children?.splice(titleChildIdx, 1);
  }
  if ("title" in props) delete (props as Record<string, unknown>).title;

  const titleNode: Element = {
    type: "element",
    tagName: "dt",
    properties: { className: ["definition-list__title"] },
    children: [{ type: "text", value: title } as Text],
  };
  const descChildren = normalizeParagraphChildren(el.children ?? [], ["article__p", "child"]);
  const descNode: Element = {
    type: "element",
    tagName: "dd",
    properties: { className: ["definition-list__description"] },
    children: descChildren,
  };
  return {
    type: "element",
    tagName: "div",
    properties: {
      className: ["definition-list__group", "definition-list__group--type-title-top"],
    },
    children: [titleNode, descNode],
  };
}

function transformProcedure(el: Element): Element {
  const props = (el.properties ??= {});
  const title = stringProp(props, "title") ?? "";
  const idAttr = stringProp(props, "id");
  if ("title" in props) delete (props as Record<string, unknown>).title;
  if ("id" in props) delete (props as Record<string, unknown>).id;

  const steps: Element[] = [];
  const other: ElementContent[] = [];
  for (const child of el.children ?? []) {
    if (isElement(child, "step")) {
      steps.push(child as Element);
    } else {
      other.push(child);
    }
  }

  const listItems = steps.map((step) => buildStepItem(step));
  const sectionChildren: ElementContent[] = [];
  if (title) {
    const heading: Element = {
      type: "element",
      tagName: "h3",
      properties: idAttr ? { id: idAttr } : {},
      children: [{ type: "text", value: title } as Text],
    };
    wrapHeading(heading, 3);
    addClass((heading.properties ??= {}), "child");
    sectionChildren.push(heading);
  }
  if (listItems.length > 0) {
    const list: Element = {
      type: "element",
      tagName: "ul",
      properties: { className: ["article__list", "list", "_bullet", "child"] },
      children: listItems,
    };
    sectionChildren.push(list);
  }
  sectionChildren.push(...other);

  return {
    type: "element",
    tagName: "section",
    properties: { className: ["procedure-steps"] },
    children: sectionChildren,
  };
}

function transformStep(el: Element) {
  el.tagName = "li";
  addClass((el.properties ??= {}), "list__item");
  el.children = normalizeStepChildren(el.children ?? []);
}

function transformCompare(el: Element): Element {
  const props = (el.properties ??= {});
  const firstTitle = stringProp(props, "first-title") ?? "First";
  const secondTitle = stringProp(props, "second-title") ?? "Second";
  const blocks = (el.children ?? []).filter((child) => isElement(child, "code-block")) as Element[];
  const titles = [firstTitle, secondTitle];

  const columns: Element[] = blocks.map((block, idx) => {
    const lang = stringProp(block.properties ?? {}, "lang") ?? stringProp(block.properties ?? {}, "language");
    const codeText = normalizeCodeText(extractCodeText(block));
    const pre = buildComparerPre(codeText, lang);
    const column: Element = {
      type: "element",
      tagName: "div",
      properties: {
        className: ["code-comparer__copy-button-container", "code-comparer__copy-button-container--titled"],
      },
      children: [{
        type: "element",
        tagName: "div",
        properties: { className: ["code-comparer__code-block"] },
        children: [
          {
            type: "element",
            tagName: "h4",
            properties: { className: ["code-comparer__title"] },
            children: [{ type: "text", value: titles[idx] ?? `Column ${idx + 1}` } as Text],
          },
          pre,
        ],
      }],
    };
    return column;
  });

  const comparer: Element = {
    type: "element",
    tagName: "div",
    properties: {
      className: ["code-comparer", "code-comparer--type-vertically", "code-comparer--dark"],
    },
    children: columns,
  };

  return {
    type: "element",
    tagName: "div",
    properties: { className: ["code-comparer__wrapper"] },
    children: [comparer],
  };
}

function transformTabs(el: Element): Element {
  const tabs = (el.children ?? []).filter((child) => isElement(child, "tab")) as Element[];
  const titles: Element[] = [];
  const contents: Element[] = [];
  tabs.forEach((tab, idx) => {
    const tabProps = (tab.properties ??= {});
    const tabId = stringProp(tabProps, "id") ?? `tab-${idx + 1}`;
    const title = stringProp(tabProps, "title") ?? `Tab ${idx + 1}`;
    const titleEl: Element = {
      type: "element",
      tagName: "div",
      properties: { className: ["tabs__title"], "data-tab-id": tabId },
      children: [{ type: "text", value: title } as Text],
    };
    titles.push(titleEl);
    const contentEl: Element = {
      type: "element",
      tagName: "div",
      properties: {
        className: ["tabs__content"],
        "data-tab-id": tabId,
        "data-title": title,
      },
      children: normalizeParagraphChildren(tab.children ?? [], ["article__p", "child"]),
    };
    contents.push(contentEl);
  });

  const titlesWrapper: Element = {
    type: "element",
    tagName: "div",
    properties: { className: ["tabs__titles"], "data-test": "tab-list" },
    children: titles,
  };
  const contentsWrapper: Element = {
    type: "element",
    tagName: "div",
    properties: { className: ["tabs__content-wrapper"], "data-test": "tab-content" },
    children: contents,
  };
  return {
    type: "element",
    tagName: "div",
    properties: { className: ["tabs"] },
    children: [titlesWrapper, contentsWrapper],
  };
}

function transformTable(el: Element): Element | void {
  const table = el;
  const existing = getClassList(table.properties ?? {});
  if (existing.includes("table__content")) {
    return;
  }
  addClass((table.properties ??= {}), "table__content");
  addClass((table.properties ??= {}), "table__content--wide");
  const wrapper: Element = {
    type: "element",
    tagName: "div",
    properties: { className: ["table__wrapper", "table__wrapper--wide", "table__wrapper--without-scroll"] },
    children: [table],
  };
  return {
    type: "element",
    tagName: "div",
    properties: { className: ["table"] },
    children: [wrapper],
  };
}

function transformTableSection(el: Element, className: string) {
  addClass((el.properties ??= {}), className);
}

function transformTableCell(el: Element, className: string, isBody: boolean) {
  addClass((el.properties ??= {}), className);
  const childClasses = isBody ? ["article__p", "child"] : ["article__p"];
  el.children = normalizeParagraphChildren(el.children ?? [], childClasses);
}

function buildCodeBlockWrapper(
  codeText: string,
  lang: string | undefined,
  preAttrs: Properties = {},
): Element {
  const preProps: Properties = { ...preAttrs };
  addClass(preProps, "code-block__pre");
  addClass(preProps, normalizeLanguageClass(lang));

  const codeEl: Element = {
    type: "element",
    tagName: "code",
    properties: {},
    children: [{ type: "text", value: codeText } as Text],
  };
  const preEl: Element = {
    type: "element",
    tagName: "pre",
    properties: preProps,
    children: [codeEl],
  };
  const blockEl: Element = {
    type: "element",
    tagName: "div",
    properties: { className: ["code-block", "code-block--dark", "in-flow"] },
    children: [preEl],
  };
  return {
    type: "element",
    tagName: "div",
    properties: { className: ["code-block__wrapper"] },
    children: [blockEl],
  };
}

function buildComparerPre(codeText: string, lang: string | undefined): Element {
  const preProps: Properties = {};
  addClass(preProps, "code-comparer__pre");
  addClass(preProps, normalizeLanguageClass(lang));
  return {
    type: "element",
    tagName: "pre",
    properties: preProps,
    children: [{
      type: "element",
      tagName: "code",
      properties: { className: ["code-comparer__code"] },
      children: [{ type: "text", value: codeText } as Text],
    }],
  };
}

function buildPrompt(kind: string, children: ElementContent[]): Element {
  const normalized = normalizeParagraphChildren(children, ["article__p", "child"]);
  const content: Element = {
    type: "element",
    tagName: "div",
    properties: { className: ["prompt__content"] },
    children: normalized,
  };
  const wrapper: Element = {
    type: "element",
    tagName: "div",
    properties: { className: ["prompt__wrapper", `prompt__wrapper--type-${kind}`] },
    children: [content],
  };
  return {
    type: "element",
    tagName: "blockquote",
    properties: { className: ["prompt"] },
    children: [
      {
        type: "element",
        tagName: "h3",
        properties: { className: ["a11y-title"] },
        children: [{ type: "text", value: kind } as Text],
      },
      wrapper,
    ],
  };
}

function buildStepItem(step: Element): Element {
  return {
    type: "element",
    tagName: "li",
    properties: { className: ["list__item"] },
    children: normalizeStepChildren(step.children ?? []),
  };
}

function normalizeStepChildren(children: ElementContent[]): ElementContent[] {
  if (children.length === 0) return [];
  const out: ElementContent[] = [];
  const textParts: ElementContent[] = [];
  for (const child of children) {
    if (isElement(child, "p")) {
      const props = (child as Element).properties ?? ((child as Element).properties = {});
      addClass(props, "article__p");
      addClass(props, "child");
      out.push(child);
    } else if (child.type === "text") {
      textParts.push(child);
    } else {
      out.push(child);
    }
  }
  if (textParts.length > 0) {
    out.unshift({
      type: "element",
      tagName: "p",
      properties: { className: ["article__p", "child"] },
      children: textParts,
    });
  }
  return out;
}

function normalizeParagraphChildren(children: ElementContent[], classNames: string[]): ElementContent[] {
  if (children.length === 0) return [];
  const hasParagraph = children.some((child) => isElement(child, "p"));
  if (hasParagraph) {
    for (const child of children) {
      if (isElement(child, "p")) {
        const props = (child as Element).properties ?? ((child as Element).properties = {});
        for (const name of classNames) addClass(props, name);
      }
    }
    return children;
  }
  return [{
    type: "element",
    tagName: "p",
    properties: { className: [...classNames] },
    children,
  }];
}

function normalizeLanguageClass(lang: string | undefined): string {
  const raw = (lang ?? "").trim().toLowerCase();
  if (!raw || raw === "text" || raw === "plain" || raw === "plaintext" || raw === "none") {
    return "language-none";
  }
  return `language-${raw}`;
}

function extractLanguageFromCode(codeEl: Element): string | undefined {
  const classNames = getClassList(codeEl.properties ?? {});
  const match = classNames.map(String).find((name) => name.startsWith("language-"));
  if (match) return match.replace(/^language-/, "");
  return stringProp(codeEl.properties ?? {}, "lang");
}

function getClassList(props: Properties): string[] {
  const raw = (props as Record<string, unknown>).className ?? (props as Record<string, unknown>).class;
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === "string") return raw.split(/\s+/).filter(Boolean);
  return [];
}

function findFirstChild(parent: Parent, tagName: string): Element | undefined {
  const target = tagName.toLowerCase();
  return (parent.children ?? []).find((child) =>
    child && child.type === "element" && ((child as Element).tagName ?? "").toLowerCase() === target
  ) as Element | undefined;
}

function isElement(node: ElementContent, tagName?: string): node is Element {
  if (!node || node.type !== "element") return false;
  if (!tagName) return true;
  return (node.tagName ?? "").toLowerCase() === tagName.toLowerCase();
}

function findChildIndex(parent: Parent, tagName: string): number {
  const kids = parent.children ?? [];
  const target = tagName.toLowerCase();
  return kids.findIndex((c) =>
    c && c.type === "element" && ((c as Element).tagName ?? "").toLowerCase() === target
  );
}

function extractCodeText(node?: ElementContent | null): string {
  const result = extractCodeTextParts(node);
  let out = result.text;
  if (result.sawCdata) {
    out = out.replace(/\]\]>\s*$/g, ">");
    out = dedentCodeText(out);
  }
  return out;
}

function extractCodeTextParts(
  node?: ElementContent | null,
): { text: string; sawCdata: boolean } {
  if (!node) return { text: "", sawCdata: false };
  if (node.type === "text") return { text: String((node as Text).value ?? ""), sawCdata: false };
  if (node.type === "comment") {
    const value = String((node as Comment).value ?? "");
    const cdata = unwrapCdataComment(value);
    if (cdata == null) return { text: "", sawCdata: false };
    return { text: cdata, sawCdata: true };
  }
  if (node.type === "element") {
    const kids = (node as Parent).children ?? [];
    let out = "";
    let sawCdata = false;
    for (const child of kids) {
      const next = extractCodeTextParts(child as ElementContent);
      out += next.text;
      if (next.sawCdata) sawCdata = true;
    }
    return { text: out, sawCdata };
  }
  return { text: "", sawCdata: false };
}

function dedentCodeText(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  let minIndent = Number.POSITIVE_INFINITY;
  for (const line of lines) {
    if (!line.trim()) continue;
    const match = line.match(/^[ \t]+/);
    const indent = match ? match[0].length : 0;
    minIndent = Math.min(minIndent, indent);
    if (minIndent === 0) break;
  }
  if (!Number.isFinite(minIndent) || minIndent === 0) return normalized;
  return lines
    .map((line) => (line.trim() ? line.slice(minIndent) : line))
    .join("\n");
}

function unwrapCdataComment(value: string): string | undefined {
  const trimmed = value.trim();
  const start = trimmed.indexOf("[CDATA[");
  if (start === -1) return undefined;
  let inner = trimmed.slice(start + "[CDATA[".length);
  const end = inner.lastIndexOf("]]");
  if (end !== -1) inner = inner.slice(0, end);
  return inner;
}

function extractText(node?: ElementContent | null): string {
  if (!node) return "";
  if (node.type === "text") return String((node as Text).value ?? "");
  if (node.type === "element") {
    const kids = (node as Parent).children ?? [];
    let out = "";
    for (const c of kids) out += extractText(c as ElementContent);
    return out;
  }
  return "";
}

function normalizeCodeText(text: string): string {
  let out = text.replace(/\r\n/g, "\n");
  if (out.startsWith("\n")) out = out.slice(1);
  if (out.endsWith("\n")) out = out.slice(0, -1);
  return out;
}

function clampHeadingLevel(level: number): number {
  const n = Math.floor(level);
  if (n < 1) return 1;
  if (n > 6) return 6;
  return n;
}

function stringProp(props: Properties | undefined, key: string): string | undefined {
  if (!props) return undefined;
  const val = (props as Record<string, unknown>)[key];
  if (val == null) return undefined;
  if (Array.isArray(val)) return val.join(" ");
  return String(val);
}

function addClass(props: Properties, className: string) {
  const raw = (props as Record<string, unknown>).className ?? (props as Record<string, unknown>).class;
  const list = Array.isArray(raw)
    ? raw.map(String)
    : typeof raw === "string"
    ? raw.split(/\s+/).filter(Boolean)
    : [];
  if (!list.includes(className)) list.push(className);
  (props as Record<string, unknown>).className = list;
  if ("class" in props) delete (props as Record<string, unknown>).class;
}

function normalizeCustomHandlers(
  handlers?: Record<string, CustomTagHandler>,
): Record<string, CustomTagHandler> {
  const out: Record<string, CustomTagHandler> = {};
  if (!handlers) return out;
  for (const [key, handler] of Object.entries(handlers)) {
    if (!handler) continue;
    out[key.toLowerCase()] = handler;
  }
  return out;
}

function applyCustomHandler(
  handlers: Record<string, CustomTagHandler>,
  originalTag: string,
  currentTag: string,
  el: Element,
  ctx: Ctx,
) {
  const primary = handlers[originalTag];
  if (primary) primary(el, ctx);
  if (currentTag !== originalTag) {
    const secondary = handlers[currentTag];
    if (secondary) secondary(el, ctx);
  }
}
