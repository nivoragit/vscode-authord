import type { Root, Element, Properties } from "hast";
import { visit } from "unist-util-visit";
import * as path from "node:path";
import {
  getRenderRuntime,
  hashString,
  isPngFileOK,
  renderMermaidDefinitionToFile,
} from "../utils/remarkRenderer";

export interface RehypeMermaidPreviewOptions {
  imagesDir?: string;
  renderMermaid?: boolean;
}

type MermaidMatch = { code: string; dataLine?: string };

export default function rehypeMermaidPreview(
  opts: RehypeMermaidPreviewOptions = {},
) {
  const { imagesDir, renderMermaid = true } = opts;

  return async (tree: Root) => {
    if (!renderMermaid || !imagesDir) return;
    const runtime = getRenderRuntime();
    if (!runtime?.fs || !runtime.exec) return;

    const tasks: Promise<void>[] = [];

    const ensureMermaidImage = async (code: string): Promise<string | null> => {
      const fileName = `${hashString(`mermaid::${code}`)}.png`;
      const outPath = path.join(imagesDir, fileName);

      const ok = await isPngFileOK(outPath);
      if (!ok) {
        try {
          await renderMermaidDefinitionToFile(code, outPath);
        } catch {
          return null;
        }
      }
      return (await isPngFileOK(outPath)) ? fileName : null;
    };

    visit(tree, "element", (node: Element, index, parent) => {
      if (!parent || typeof index !== "number") return;

      const match = findMermaid(node);
      if (!match || !match.code.trim()) return;

      tasks.push((async () => {
        const fileName = await ensureMermaidImage(match.code);
        if (!fileName) return;

        const imgProps: Properties = {
          src: fileName,
          alt: "Mermaid diagram",
          className: ["mermaid-diagram"],
        };
        if (match.dataLine) {
          (imgProps as Record<string, unknown>)["data-line"] = match.dataLine;
        }

        const imgEl: Element = {
          type: "element",
          tagName: "img",
          properties: imgProps,
          children: [],
        };

        (parent.children as any[])[index] = imgEl;
      })());
    });

    await Promise.all(tasks);
  };
}

function findMermaid(node: Element): MermaidMatch | null {
  if (node.tagName === "code-block") {
    const lang = String(node.properties?.lang ?? "").toLowerCase();
    if (lang !== "mermaid") return null;
    const code = extractText(node);
    const dataLine = readDataLine(node.properties);
    return { code, dataLine };
  }

  if (node.tagName === "pre") {
    const codeEl = (node.children ?? []).find((child): child is Element =>
      isElement(child, "code"),
    );
    if (!codeEl) return null;
    const classes = getClassList(codeEl.properties);
    const isMermaid = classes.some((klass) => klass.toLowerCase() === "language-mermaid");
    if (!isMermaid) return null;
    const code = extractText(codeEl);
    const dataLine = readDataLine(codeEl.properties) ?? readDataLine(node.properties);
    return { code, dataLine };
  }

  return null;
}

function extractText(node: Element): string {
  let out = "";
  for (const child of node.children ?? []) {
    if (child.type === "text") {
      out += String(child.value ?? "");
    } else if (child.type === "element") {
      out += extractText(child);
    }
  }
  return out;
}

function readDataLine(props?: Properties): string | undefined {
  if (!props) return undefined;
  const raw =
    (props as Record<string, unknown>)["data-line"] ??
    (props as Record<string, unknown>).dataLine;
  if (typeof raw === "string") return raw;
  if (typeof raw === "number") return String(raw);
  return undefined;
}

function getClassList(props?: Properties): string[] {
  if (!props) return [];
  const raw = props.className ?? (props as Record<string, unknown>).class;
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === "string") return raw.split(/\s+/).filter(Boolean);
  return [];
}

function isElement(node: any, name?: string): node is Element {
  return Boolean(node && node.type === "element" && (!name || node.tagName === name));
}
