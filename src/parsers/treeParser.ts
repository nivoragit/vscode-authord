import { parseStringPromise } from 'xml2js';
import { parseTocElements } from './tocParser';
import { readFile } from '../utils/fileUtils';
import { TreeData } from '../utils/types';
import * as path from 'path';

export async function parseTreeFile(filePath: string): Promise<TreeData> {
  const xmlContent = await readFile(filePath);
  const parsedXml = await parseStringPromise(xmlContent);

  const profile = parsedXml['instance-profile'].$;

  return {
    id: path.basename(filePath, '.tree'),
    name: profile.name || 'Unnamed Instance',
    startPage: profile['start-page'],
    tocElements: parseTocElements(parsedXml['instance-profile']['toc-element'])
  };
}

