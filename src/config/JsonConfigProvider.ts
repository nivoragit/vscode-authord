import { JsonConfigObject } from "./ConfigObjects";
import { ConfigProvider } from "./ConfigProvider";
import * as vscode from 'vscode';

export default class JsonConfigProvider implements ConfigProvider<JsonConfigObject> {
    constructor(private filePath: string) { }

    public async read(): Promise<JsonConfigObject> {
        const fileUri = vscode.Uri.file(this.filePath);
        try {
            if (!(await this.fileExists(this.filePath))) {
                const defaultConfig: JsonConfigObject = {
                    schema: 'https://json-schema.org/draft/2020-12/schema',
                    title: 'Authord Settings',
                    type: 'object',
                    topics: { dir: 'topics' },
                    images: { dir: 'images', version: '1.0', 'web-path': 'images' },
                    instances: []
                };
                await vscode.workspace.fs.writeFile(
                    fileUri,
                    Buffer.from(JSON.stringify(defaultConfig, null, 2), 'utf-8')
                );
            }
            const fileData = await vscode.workspace.fs.readFile(fileUri);
            return JSON.parse(Buffer.from(fileData).toString('utf-8'));
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to read JSON file at "${this.filePath}": ${error.message}`);
            throw error;
        }
    }

    public async write(data: JsonConfigObject): Promise<void> {
        try {
            const indentation = await this.getIndentationSetting();
            const jsonString = JSON.stringify(data, null, indentation);
            const fileUri = vscode.Uri.file(this.filePath);
            await vscode.workspace.fs.writeFile(fileUri, Buffer.from(jsonString, 'utf-8'));
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to write JSON file at "${this.filePath}": ${error.message}`);
            throw error;
        }
    }

    // -----------------------------
    // Private Helpers
    // -----------------------------
    private async fileExists(filePath: string): Promise<boolean> {
        try {
            await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
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
}