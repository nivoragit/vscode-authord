// eslint-disable-next-line import/no-unresolved
import * as vscode from 'vscode';
import * as path from 'path';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import { ConfigProvider } from './ConfigProvider';
import { XmlConfigObject } from './ConfigObjects';

export default class XmlConfigProvider implements ConfigProvider<XmlConfigObject> {
    private filePath: string;

    constructor(filePath: string) {
        this.filePath = filePath;
    }

    public async read(): Promise<XmlConfigObject> {
        try {
            if (!(await this.fileExists())) {
                const defaultIhp = `<?xml version="1.0" encoding="UTF-8"?>
  <ihp version="2.0">
    <topics dir="topics"/>
  </ihp>`;
                await this.writeNewFile(defaultIhp);
            }
            const fileUri = vscode.Uri.file(this.filePath);
            const rawData = await vscode.workspace.fs.readFile(fileUri);
            const parser = new XMLParser({ ignoreAttributes: false });
            const parsed = parser.parse(Buffer.from(rawData).toString('utf-8'));

            const obj: XmlConfigObject = { ihp: parsed.ihp || {} };
            return obj;
        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to read XML file at "${this.filePath}": ${err.message}`);
            throw err;
        }
    }

    public async write(data: XmlConfigObject): Promise<void> {
        try {
            const indentBy = await XmlConfigProvider.getIndentationSetting();
            const builder = new XMLBuilder({
                ignoreAttributes: false,
                format: true,
                indentBy,
                suppressEmptyNode: true
            });

            const rawXml = builder.build({ ihp: data.ihp });
            await vscode.workspace.fs.writeFile(
                vscode.Uri.file(this.filePath),
                Buffer.from(rawXml, 'utf-8')
            );
        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to write XML file at "${this.filePath}": ${err.message}`);
            throw err;
        }
    }

    private async fileExists(): Promise<boolean> {
        try {
            await vscode.workspace.fs.stat(vscode.Uri.file(this.filePath));
            return true;
        } catch {
            return false;
        }
    }

    private async writeNewFile(content: string): Promise<void> {
        const fileUri = vscode.Uri.file(this.filePath);
        const directoryUri = fileUri.with({ path: path.dirname(fileUri.fsPath) });
        await vscode.workspace.fs.createDirectory(directoryUri);
        await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf-8'));
    }

    private static async getIndentationSetting(): Promise<string> {
        const config = vscode.workspace.getConfiguration('editor');
        const tabSize = config.get<number>('tabSize', 4);
        const insertSpaces = config.get<boolean>('insertSpaces', true);
        return insertSpaces ? ' '.repeat(tabSize) : '\t';
    }
}
