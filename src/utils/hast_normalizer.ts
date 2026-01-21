import type { Element, Parent } from "hast";

export type HastElementHandler<TCtx> = (el: Element, ctx: TCtx) => Element | null | void;

export interface HastTagInfo {
  originalTag: string;
  currentTag: string;
  element: Element;
}

export interface HastNormalizerOptions<TCtx> {
  ctx: TCtx;
  handlers?: Record<string, HastElementHandler<TCtx>>;
  onElement?: (el: Element, ctx: TCtx, info: HastTagInfo) => void;
  getChildContext?: (ctx: TCtx, info: HastTagInfo) => TCtx;
}

export function normalizeHastTree<TCtx>(
  root: Parent,
  options: HastNormalizerOptions<TCtx>,
): void {
  const handlers = normalizeHandlers(options.handlers);

  const walk = (parent: Parent, ctx: TCtx) => {
    const kids = parent.children;
    if (!Array.isArray(kids)) return;

    for (let i = 0; i < kids.length; i++) {
      const node = kids[i];
      if (!node || node.type !== "element") continue;

      const el = node as Element;
      const originalTag = normalizeTagName(el.tagName);
      const handler = handlers[originalTag];
      let currentEl = el;

      if (handler) {
        const result = handler(el, ctx);
        if (result === null) {
          kids.splice(i, 1);
          i--;
          continue;
        }
        if (result && result !== el) {
          currentEl = result;
          kids[i] = currentEl;
        }
      }

      const currentTag = normalizeTagName(currentEl.tagName);
      const info: HastTagInfo = { originalTag, currentTag, element: currentEl };

      if (options.onElement) {
        options.onElement(currentEl, ctx, info);
      }

      const nextCtx = options.getChildContext ? options.getChildContext(ctx, info) : ctx;
      walk(currentEl as Parent, nextCtx);
    }
  };

  walk(root, options.ctx);
}

function normalizeTagName(tagName?: string): string {
  return (tagName ?? "").toLowerCase();
}

function normalizeHandlers<TCtx>(
  handlers?: Record<string, HastElementHandler<TCtx>>,
): Record<string, HastElementHandler<TCtx>> {
  const out: Record<string, HastElementHandler<TCtx>> = {};
  if (!handlers) return out;
  for (const [key, handler] of Object.entries(handlers)) {
    if (!handler) continue;
    out[key.toLowerCase()] = handler;
  }
  return out;
}
