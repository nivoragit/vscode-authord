import { TocElement } from '../utils/types';
import * as path from 'path';

export function parseTocElements(elements: any): TocElement[] {
  if (!elements) {return [];}

  if (!Array.isArray(elements)) {
    elements = [elements];
  }

  return elements.map((element: any) => ({
    id: path.basename(element.$.topic, path.extname(element.$.topic)),
    topic: element.$.topic,
    tocTitle: element.$['toc-title'] || null,
    sortChildren: element.$['sort-children'] || 'none',
    children: parseTocElements(element['toc-element'])
  }));
}
