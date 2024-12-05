import * as fs from 'fs';
import * as path from 'path';
import { parseStringPromise } from 'xml2js';

export async function parseTreeFile(treeFilePath: string) {
  const treeContent = fs.readFileSync(treeFilePath, 'utf-8');
  const treeXml = await parseStringPromise(treeContent);

  const instanceProfile = treeXml['instance-profile'].$;

  const id = path.basename(treeFilePath, '.tree');
  const name = instanceProfile.name || id;
  const startPage = instanceProfile['start-page'];

  // Parse toc-elements
  const tocElements = parseTocElements(treeXml['instance-profile']['toc-element']);

  return {
    id,
    name,
    'start-page': startPage,            // Renamed from "startPage" to "start-page"
    'toc-elements': tocElements         // Renamed from "tocElements" to "toc-elements"
  };
}

function parseTocElements(tocElementsXml: any): any[] {
  if (!tocElementsXml) return [];

  // Ensure tocElementsXml is always an array
  if (!Array.isArray(tocElementsXml)) {
    tocElementsXml = [tocElementsXml];
  }

  return tocElementsXml.map((tocElementXml: any) => {
    const tocElement = tocElementXml.$;

    const children = parseTocElements(tocElementXml['toc-element']);

    // Extract the topic filename without extension
    const topicFilename = path.basename(tocElement.topic, path.extname(tocElement.topic));

    // Format the "toc-title"
    const tocTitle = formatTitle(topicFilename);

    return {
      id: topicFilename,
      topic: tocElement.topic,
      'toc-title': tocTitle,                 // Renamed from "tocTitle" to "toc-title"
      'sort-children': tocElement['sort-children'] || 'none',  // Renamed from "sortChildren"
      children
    };
  });
}

function formatTitle(filename: string): string {
  // Replace hyphens and underscores with spaces and capitalize each word
  return filename
    .replace(/[-_]/g, ' ')
    .replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1));
}
