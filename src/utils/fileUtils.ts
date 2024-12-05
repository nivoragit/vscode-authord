import { promises as fs } from 'fs';

export async function readFile(filePath: string): Promise<string> {
  return await fs.readFile(filePath, 'utf-8');
}

export async function writeFile(filePath: string, data: string): Promise<void> {
  await fs.writeFile(filePath, data, 'utf-8');
}
