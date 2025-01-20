/************************************************************************************************
 * FILE: src/config/JsonConfigProvider.ts
 * Concrete provider for JSON-based config
 ***********************************************************************************************/
import * as vscode from 'vscode';
import { ConfigProvider } from './ConfigProvider';
import { JsonConfigObject } from './ConfigObjects';
import * as path from 'path';

export class JsonConfigProvider implements ConfigProvider<JsonConfigObject> {
  constructor(private filePath: string) {}

  public async read(): Promise<JsonConfigObject> {
    try {
      if (!(await this.fileExists(this.filePath))) {
        // If missing, write a default JSON config
        const defaultJson: JsonConfigObject = {
          schema: 'https://json-schema.org/draft/2020-12/schema',
          title: 'Authord Settings',
          type: 'object',
          topics: { dir: 'topics' },
          images: { dir: 'images', version: '1.0', 'web-path': 'images' },
          instances: []
        };
        await vscode.workspace.fs.writeFile(
          vscode.Uri.file(this.filePath),
          Buffer.from(JSON.stringify(defaultJson, null, 2), 'utf-8')
        );
      }
      const data = await vscode.workspace.fs.readFile(vscode.Uri.file(this.filePath));
      return JSON.parse(Buffer.from(data).toString('utf-8'));
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to read JSON config at "${this.filePath}": ${err.message}`);
      throw err;
    }
  }

  public async write(data: JsonConfigObject): Promise<void> {
    try {
      const indentation = await this.getIndentationSetting();
      const text = JSON.stringify(data, null, indentation);
      await vscode.workspace.fs.writeFile(
        vscode.Uri.file(this.filePath),
        Buffer.from(text, 'utf-8')
      );
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to write JSON config at "${this.filePath}": ${err.message}`);
      throw err;
    }
  }

  private async fileExists(fp: string): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(fp));
      return true;
    } catch {
      return false;
    }
  }

  private async getIndentationSetting(): Promise<string> {
    const config = vscode.workspace.getConfiguration('editor');
    const tabSize = config.get<number>('tabSize', 4);
    const insertSpaces = config.get<boolean>('insertSpaces', true);
    return insertSpaces ? ' '.repeat(tabSize) : '\t';
  }
