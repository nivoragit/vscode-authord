// --------------------------------------------------------------------
// A new utility class to handle all file I/O and editing operations.
// --------------------------------------------------------------------
// eslint-disable-next-line import/no-unresolved
import * as vscode from 'vscode';
import * as path from 'path';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';

export default class FileService {
  /**
   * Checks if a file exists using workspace.fs.stat.
   */
  public static async fileExists(filePath: string): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Reads a file as string using workspace.fs.
   */
  public static async readFileAsString(filePath: string): Promise<string> {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
      const data = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
      return Buffer.from(data).toString('utf-8');
    } catch (error: any) {
      vscode.window.showErrorMessage(`Error reading file "${filePath}": ${error.message}`);
      throw new Error(`File "${filePath}" does not exist or cannot be read.`);
    }
  }

  /**
   * Writes a new file; overwrites if it exists.
   */
  public static async writeNewFile(filePath: string, content: string): Promise<void> {
    try {
      const fileUri = vscode.Uri.file(filePath);
      const directoryUri = fileUri.with({ path: path.dirname(fileUri.fsPath) });
      await vscode.workspace.fs.createDirectory(directoryUri);
      await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf-8'));
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to write file at "${filePath}": ${error.message}`);
      throw error;
    }
  }
  
  /**
 * Updates a file in place by applying a transformation function to its content.
 */
public static async updateFile(filePath: string, transformFn: (content: string) => string): Promise<void> {
  try {
    const fileUri = vscode.Uri.file(filePath);
    const content = await FileService.readFileAsString(filePath);
    const newContent = transformFn(content);

    await vscode.workspace.fs.writeFile(fileUri, Buffer.from(newContent, 'utf-8'));
  } catch (error: any) {
    vscode.window.showErrorMessage(`Failed to update file at "${filePath}": ${error.message}`);
    throw error;
  }
}

  /**
   * Deletes a file if it exists.
   */
  public static async deleteFileIfExists(filePath: string): Promise<void> {
    try {
      await vscode.workspace.fs.delete(vscode.Uri.file(filePath));
    } catch {
      // ignore
    }
  }

  /**
   * Reads a JSON file from disk and parses it.
   */
  public static async readJsonFile(filePath: string): Promise<any> {
    try {
      const fileData = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
      return JSON.parse(Buffer.from(fileData).toString('utf-8'));
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to read JSON file at "${filePath}": ${error.message}`);
      throw error;
    }
  }

  /**
   * Opens a JSON file, applies a mutation function, and preserves indentation.
   */
  public static async updateJsonFile(filePath: string, mutateFn: (jsonData: any) => any): Promise<void> {
    try {
      const fileUri = vscode.Uri.file(filePath);
      // If file doesn't exist, do nothing (or create a default?). Adjust as needed.
      if (!(await FileService.fileExists(filePath))) {
        return;
      }

      const doc = await vscode.workspace.openTextDocument(fileUri);
      const originalText = doc.getText();

      let jsonData = JSON.parse(originalText);
      jsonData = mutateFn(jsonData);

      // Use indentation from the user/editor settings
      const indentation = await FileService.getIndentationSetting();

      const newJsonString = JSON.stringify(jsonData, null, indentation);

      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        doc.uri,
        new vscode.Range(doc.positionAt(0), doc.positionAt(originalText.length)),
        newJsonString
      );

      await vscode.workspace.applyEdit(edit);
      await doc.save();
    } catch (error: any) {
      vscode.window.showErrorMessage(`Error updating JSON file at "${filePath}": ${error.message}`);
      throw error;
    }
  }

  /**
   * Utility to parse XML text into JSON-like structures.
   */
  public static parseXmlString(xmlText: string): any {
    const parser = new XMLParser({ ignoreAttributes: false });
    return parser.parse(xmlText);
  }

  /**
   * Utility to build XML text from JSON-like structures.
   */
  public static async buildXmlString(xmlData: any): Promise<string> {
    const builder = new XMLBuilder({
      ignoreAttributes: false,
      format: true,
      indentBy: await FileService.getIndentationSetting(),
      suppressEmptyNode: true
    });
    return builder.build(xmlData);
  }

  /**
   * Opens an XML file, parses, mutates, and writes the result.
   */
  public static async updateXmlFile(filePath: string, mutateFn: (parsedXml: any) => any): Promise<void> {
    let doc: vscode.TextDocument;
    try {
      doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to open XML file "${filePath}": ${err.message}`);
      throw err;
    }

    const originalText = doc.getText();

    let xmlObj;
    try {
      xmlObj = FileService.parseXmlString(originalText);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to parse XML file "${filePath}": ${err.message}`);
      throw err;
    }

    let mutatedXml;
    try {
      mutatedXml = mutateFn(xmlObj);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to mutate XML data: ${err.message}`);
      throw err;
    }

    let newXml: string;
    try {
      newXml = await FileService.buildXmlString(mutatedXml);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to build updated XML: ${err.message}`);
      throw err;
    }

    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      doc.uri,
      new vscode.Range(doc.positionAt(0), doc.positionAt(originalText.length)),
      newXml
    );
    try {
      await vscode.workspace.applyEdit(edit);
      // Optionally format. But if you rely on the builder's indentation, this might be redundant:
      await vscode.commands.executeCommand('editor.action.formatDocument', doc.uri);
      await doc.save();
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to apply edit/format/save XML file "${filePath}": ${err.message}`);
      throw err;
    }
  }

  /**
   * Fetches indentation settings from VS Code to keep JSON/XML output in sync with user preferences.
   */
  public static async getIndentationSetting(): Promise<string> {
    const config = vscode.workspace.getConfiguration('editor');
    const tabSize = config.get<number>('tabSize', 4);
    const insertSpaces = config.get<boolean>('insertSpaces', true);
    return insertSpaces ? ' '.repeat(tabSize) : '\t';
  }
}
