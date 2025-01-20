/************************************************************************************************
 * FILE: src/config/XmlConfigProvider.ts
 * Concrete provider for XML-based config
 ***********************************************************************************************/
import * as vscode from 'vscode';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import { ConfigProvider } from './ConfigProvider';
import { XmlConfigObject } from './ConfigObjects';
import * as path from 'path';

export class XmlConfigProvider implements ConfigProvider<XmlConfigObject> {
  constructor(private filePath: string) {}

  public async read(): Promise<XmlConfigObject> {
    try {
      if (!(await this.fileExists(this.filePath))) {
        // If missing, write a minimal .ihp structure
        const defaultIhp = `<?xml version="1.0" encoding="UTF-8"?>
<ihp version="2.0">
  <topics dir="topics"/>
</ihp>`;
        await this.writeNewFile(this.filePath, defaultIhp);
      }
      const data = await vscode.workspace.fs.readFile(vscode.Uri.file(this.filePath));
      const parser = new XMLParser({ ignoreAttributes: false });
      const parsed = parser.parse(Buffer.from(data).toString('utf-8'));

      const result: XmlConfigObject = { ihp: parsed.ihp || {} };
      return result;
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to read XML config at "${this.filePath}": ${err.message}`);
      throw err;
    }
  }

  public async write(data: XmlConfigObject): Promise<void> {
    try {
      const builder = new XMLBuilder({
        ignoreAttributes: false,
        format: true,
        indentBy: await this.getIndentationSetting(),
        suppressEmptyNode: true
      });
      const raw = builder.build({ ihp: data.ihp });
      await vscode.workspace.fs.writeFile(vscode.Uri.file(this.filePath), Buffer.from(raw, 'utf-8'));
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to write XML config at "${this.filePath}": ${err.message}`);
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

  private async writeNewFile(fp: string, content: string): Promise<void> {
    const fileUri = vscode.Uri.file(fp);
    const dirUri = fileUri.with({ path: path.dirname(fileUri.fsPath) });
    await vscode.workspace.fs.createDirectory(dirUri);
    await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf-8'));
  }

  private async getIndentationSetting(): Promise<string> {
    const config = vscode.workspace.getConfiguration('editor');
    const tabSize = config.get<number>('tabSize', 4);
    const insertSpaces = config.get<boolean>('insertSpaces', true);
    return insertSpaces ? ' '.repeat(tabSize) : '\t';
  }
}
