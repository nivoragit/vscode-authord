import * as fs from 'fs';
import { parseStringPromise } from 'xml2js';

export async function parseIhpFile(ihpFilePath: string) {
  const ihpContent = fs.readFileSync(ihpFilePath, 'utf-8');
  const ihpXml = await parseStringPromise(ihpContent);

  const ihp = ihpXml.ihp;

  // Extract topics and images
  const topics = ihp.topics?.[0]?.$ || {};
  const images = ihp.images?.[0]?.$ || {};

  // **Add "version" to images**
  images.version = ihp.$.version || '1.0';

  // Extract instances (list of .tree files)
  const instanceElements = ihp.instance || [];
  const instanceFiles = instanceElements.map((instance: any) => instance.$.src);

  return { topics, images, instanceFiles };
}
