import { parseStringPromise } from 'xml2js';
import { readFile } from '../utils/fileUtils';
import { IhpData } from '../utils/types';

export async function parseIhpFile(filePath: string): Promise<IhpData> {
  const xmlContent = await readFile(filePath);
  const parsedXml = await parseStringPromise(xmlContent);

  const ihp = parsedXml.ihp;

  return {
    topics: ihp.topics?.[0]?.$ || {},
    images: ihp.images?.[0]?.$ || {},
    instanceFiles: ihp.instance?.map((i: any) => i.$.src) || []
  };
}
