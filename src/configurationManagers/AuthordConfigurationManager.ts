/* eslint-disable @typescript-eslint/no-explicit-any */
import * as vscode from 'vscode';
import * as path from 'path';
import Ajv from 'ajv';
import { AbstractConfigManager, InstanceConfig, TocElement, Topic } from './abstractConfigurationManager';

export interface AuthordConfig {
  instances: InstanceConfig[];
  topics?: { dir: string };
  [key: string]: any;
}

export class AuthordConfigurationManager extends AbstractConfigManager {

  configData: AuthordConfig | undefined;
  constructor(configPath: string) {
    super(configPath);
  }

  
  // ------------------------------------------------------------------------------------
  // FILE/JSON HELPERS
  // ------------------------------------------------------------------------------------

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
      return true;
    } catch {
      return false;
    }
  }

  private async readJsonFile(filePath: string): Promise<any> {
    const fileData = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
    return JSON.parse(Buffer.from(fileData).toString('utf-8'));
  }

  private async writeNewFile(filePath: string, content: string): Promise<void> {
    const fileUri = vscode.Uri.file(filePath);
    const directoryUri = fileUri.with({ path: path.dirname(fileUri.fsPath) });
    await vscode.workspace.fs.createDirectory(directoryUri);
    await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf-8'));
  }

  /**
   * Opens a JSON file, applies a mutation function, and preserves indentation.
   */
  private async updateJsonFile(filePath: string, mutateFn: (jsonData: any) => any): Promise<void> {
    const fileUri = vscode.Uri.file(filePath);

    // Ensure the file exists; create it with default config if it doesn't
    if (!(await this.fileExists(filePath))) {
      await this.writeNewFile(filePath, JSON.stringify(this.configData, null, 2));
      return;
    }

    const doc = await vscode.workspace.openTextDocument(fileUri);
    const originalText = doc.getText();

    let jsonData = JSON.parse(originalText);
    jsonData = mutateFn(jsonData);

    const config = vscode.workspace.getConfiguration('editor');
    const tabSize = config.get<number>('tabSize', 4);
    const insertSpaces = config.get<boolean>('insertSpaces', true);
    const indentation = insertSpaces ? ' '.repeat(tabSize) : '\t';

    const newJsonString = JSON.stringify(jsonData, null, indentation);

    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      doc.uri,
      new vscode.Range(doc.positionAt(0), doc.positionAt(originalText.length)),
      newJsonString
    );

    await vscode.workspace.applyEdit(edit);
    await doc.save();
  }


  // ------------------------------------------------------------------------------------
  // CONFIG READ/WRITE
  // ------------------------------------------------------------------------------------

  private defaultConfigJson(): AuthordConfig {
    return {
      schema: 'https://json-schema.org/draft/2020-12/schema',
      title: 'Authord Settings',
      type: 'object',
      topics: { dir: 'topics' },
      images: { dir: 'images', version: '1.0', 'web-path': 'images' },
      instances: []
    };
  }

  private async readConfig(): Promise<AuthordConfig> {
    if (!(await this.fileExists(this.configPath))) {
      const defaultConfig = this.defaultConfigJson();
      await this.writeNewFile(this.configPath, JSON.stringify(defaultConfig, null, 2));
    }
    return this.readJsonFile(this.configPath);
  }

  private async writeConfig(): Promise<void> {
    if (!this.configData) { return; }
    await this.updateJsonFile(this.configPath, () => this.configData!);
  }

  // ------------------------------------------------------------------------------------
  // TOP-LEVEL METHODS
  // ------------------------------------------------------------------------------------

  async refresh(): Promise<void> {
    this.configData = await this.readConfig();
    this.instances = this.configData.instances;
  }

  async createConfigFile(): Promise<AuthordConfigurationManager> {
    this.configData = this.defaultConfigJson();
    await this.writeConfig();
    this.instances = [];
    return this;
  }

  getTopicsDir(): string {
    return path.join(
      path.dirname(this.configPath),
      this.configData?.topics?.dir || ''
    );
  }

  getImageDir(): string {
    return path.join(
      path.dirname(this.configPath),
      this.configData?.images?.dir || ''
    );
  }

  private findDocById(docId: string, showWarning = true): InstanceConfig | undefined {
    if (!this.configData) { return undefined; }
    const doc = this.configData.instances.find(d => d.id === docId);
    if (!doc && showWarning) {
      vscode.window.showWarningMessage(`Document with id "${docId}" not found.`);
    }
    return doc;
  }

  async addDocument(newDocument: InstanceConfig): Promise<void> {
    if (!this.configData) {
      vscode.window.showErrorMessage('Configuration data not initialized.');
      return;
    }

    this.configData.instances.push(newDocument);
    await this.writeConfig();

    if (newDocument['toc-elements'] && newDocument['toc-elements'][0]) {
      await this.writeTopicFile(newDocument['toc-elements'][0]);
    }
  }

  async createDirectory(dirPath: string): Promise<void> {
    const dirUri = vscode.Uri.file(dirPath);
    try {
      await vscode.workspace.fs.stat(dirUri);
    } catch {
      await vscode.workspace.fs.createDirectory(dirUri);
    }
  }

  async deleteDocument(docId: string): Promise<void> {
    const doc = this.findDocById(docId, false);
    if (!doc || !this.configData) { return; }

    const topicsDir = this.getTopicsDir();
    const allTopics = this.getAllTopicsFromDoc(doc['toc-elements']);

    for (const topicFileName of allTopics) {
      const filePath = path.join(topicsDir, topicFileName);
      try {
        await vscode.workspace.fs.delete(vscode.Uri.file(filePath));
      } catch {
        // ignore if not found
      }
    }

    this.configData.instances = this.configData.instances.filter(d => d.id !== docId);
    await this.writeConfig();
  }

  async renameDocument(docId: string, newName: string): Promise<void> {
    const doc = this.findDocById(docId);
    if (!doc) { return; }
    doc.name = newName;
    await this.writeConfig();
  }

  getDocuments(): InstanceConfig[] {
    return this.configData?.instances || [];
  }

  // ------------------------------------------------------------------------------------
  // TOPIC METHODS
  // ------------------------------------------------------------------------------------

  private async writeTopicFile(newTopic: TocElement): Promise<void> {
    const topicsDir = this.getTopicsDir();
    await this.createDirectory(topicsDir);

    const mainFilePath = path.join(topicsDir, newTopic.topic);
    if (await this.fileExists(mainFilePath)) {
      vscode.window.showWarningMessage(`Topic file "${newTopic.topic}" already exists.`);
      return;
    }

    const content = `# ${newTopic.title}\n\nContent goes here...`;
    await vscode.workspace.fs.writeFile(vscode.Uri.file(mainFilePath), Buffer.from(content, 'utf-8'));
  }

  async addTopic(docItem: string, parentTopic: string | null, newTopic: TocElement): Promise<void> {
    const doc = this.findDocById(docItem);
    if (!doc) { return; }

    await this.writeTopicFile(newTopic);

    if (!doc['start-page']) {
      doc['start-page'] = newTopic.topic;
    }

    let parentArray = doc['toc-elements'];
    if (parentTopic) {
      const parent = this.findTopicByFilename(doc['toc-elements'], parentTopic);
      if (!parent) {
        vscode.window.showWarningMessage(`Parent topic "${parentTopic}" not found.`);
        return;
      }
      parentArray = parent.children;
    }

    if (!parentArray.some(t => t.title === newTopic.title)) {
      parentArray.push(newTopic);
    }
    try {
      await this.writeConfig();
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to update document tree: ${err}`);
      return;
    }

    vscode.window.showInformationMessage(`Topic "${newTopic.title}" added successfully.`);
  }

  async deleteTopic(docId: string, topicFileName: string): Promise<void> {
    const doc = this.findDocById(docId);
    if (!doc) { return; }

    const extractedTopic = this.extractTopicByFilename(doc['toc-elements'], topicFileName);
    if (!extractedTopic) {
      vscode.window.showWarningMessage(`Topic "${topicFileName}" not found in document "${docId}".`);
      return;
    }

    const allTopics = this.getAllTopicsFromDoc([extractedTopic]);
    const topicsDir = this.getTopicsDir();
    for (const tFile of allTopics) {
      try {
        await vscode.workspace.fs.delete(vscode.Uri.file(path.join(topicsDir, tFile)));
      } catch {
        vscode.window.showWarningMessage(`Could not delete topic file "${tFile}". It may not exist.`);
      }
    }

    await this.writeConfig();
  }

  async renameTopic(docId: string, oldTopicFile: string, newName: string): Promise<void> {
    const doc = this.findDocById(docId);
    if (!doc) { return; }

    const topic = this.findTopicByFilename(doc['toc-elements'], oldTopicFile);
    if (!topic) { return; }

    const topicsDir = this.getTopicsDir();
    const newTopicFile = this.formatTitleAsFilename(newName);
    const oldFilePath = path.join(topicsDir, oldTopicFile);
    const newFilePath = path.join(topicsDir, newTopicFile);

    if (!(await this.fileExists(oldFilePath))) {
      vscode.window.showWarningMessage(`Cannot rename topic. File "${oldTopicFile}" does not exist.`);
      return;
    }
    if (await this.fileExists(newFilePath)) {
      vscode.window.showWarningMessage(`Cannot rename topic. File "${newTopicFile}" already exists.`);
      return;
    }

    await vscode.workspace.fs.rename(vscode.Uri.file(oldFilePath), vscode.Uri.file(newFilePath));
    topic.topic = newTopicFile;
    topic.title = newName;
    await this.writeConfig();
  }

  // ------------------------------------------------------------------------------------
  // getTopics - physically present
  // ------------------------------------------------------------------------------------
  async getTopics(): Promise<Topic[]> {
    if (!this.configData) { return []; }
    const topics: Topic[] = [];
    const topicsDir = this.getTopicsDir();

    const traverseElements = async (elements: TocElement[]) => {
      for (const e of elements) {
        const filePath = path.join(topicsDir, e.topic);
        if (await this.fileExists(filePath)) {
          topics.push({ name: path.basename(filePath), path: filePath });
        }
        if (e.children && e.children.length) {
          await traverseElements(e.children);
        }
      }
    };

    for (const doc of this.configData.instances) {
      await traverseElements(doc['toc-elements']);
    }

    return topics;
  }

  // ------------------------------------------------------------------------------------
  // Utility Methods
  // ------------------------------------------------------------------------------------

  private findTopicByFilename(topics: TocElement[], fileName: string): TocElement | undefined {
    for (const t of topics) {
      if (t.title === fileName) {
        return t;
      }
      const found = this.findTopicByFilename(t.children, fileName);
      if (found) { return found; }
    }
    return undefined;
  }

  private extractTopicByFilename(topics: TocElement[], fileName: string): TocElement | null {
    const idx = topics.findIndex(t => t.topic === fileName);
    if (idx > -1) {
      const [removed] = topics.splice(idx, 1);
      return removed;
    }
    for (const t of topics) {
      const extracted = this.extractTopicByFilename(t.children, fileName);
      if (extracted) { return extracted; }
    }
    return null;
  }

  private getAllTopicsFromDoc(tocElements: TocElement[]): string[] {
    const result: string[] = [];
    const traverse = (elements: TocElement[]) => {
      for (const e of elements) {
        result.push(e.topic);
        if (e.children && e.children.length) {
          traverse(e.children);
        }
      }
    };
    traverse(tocElements);
    return result;
  }

  private formatTitleAsFilename(title: string): string {
    return title.toLowerCase().replace(/\s+/g, '-') + '.md';
  }

  async moveFolderToTrash(folderPath: string): Promise<void> {
    const trashPath = path.join(path.dirname(this.configPath), 'trash');
    await this.createDirectory(trashPath);
    const destinationPath = path.join(trashPath, path.basename(folderPath));

    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(destinationPath));
      await this.mergeFolders(folderPath, destinationPath);
      await vscode.workspace.fs.delete(vscode.Uri.file(folderPath), { recursive: true });
    } catch {
      await vscode.workspace.fs.rename(vscode.Uri.file(folderPath), vscode.Uri.file(destinationPath));
    }
  }

  async mergeFolders(source: string, destination: string): Promise<void> {
    let sourceEntries: [string, vscode.FileType][] = [];
    try {
      sourceEntries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(source));
    } catch {
      return;
    }

    for (const [entryName, entryType] of sourceEntries) {
      const sourcePath = path.join(source, entryName);
      const destinationPath = path.join(destination, entryName);

      if (entryType === vscode.FileType.Directory) {
        if (!(await this.fileExists(destinationPath))) {
          await vscode.workspace.fs.createDirectory(vscode.Uri.file(destinationPath));
        }
        await this.mergeFolders(sourcePath, destinationPath);
      } else {
        if (await this.fileExists(destinationPath)) {
          const ext = path.extname(entryName);
          const base = path.basename(entryName, ext);
          const newFileName = `${base}-${Date.now()}${ext}`;
          const newDestPath = path.join(destination, newFileName);
          await vscode.workspace.fs.rename(vscode.Uri.file(sourcePath), vscode.Uri.file(newDestPath));
        } else {
          await vscode.workspace.fs.rename(vscode.Uri.file(sourcePath), vscode.Uri.file(destinationPath));
        }
      }
    }
  }

  async validateAgainstSchema(schemaPath: string): Promise<void> {
    if (!this.configData) {
      throw new Error('No configuration data available for schema validation.');
    }

    const ajv = new Ajv({ allErrors: true });
    const schemaData = await vscode.workspace.fs.readFile(vscode.Uri.file(schemaPath));
    const schema = JSON.parse(Buffer.from(schemaData).toString('utf-8'));

    const validate = ajv.compile(schema);
    const valid = validate(this.configData);
    if (!valid) {
      const errors = validate.errors || [];
      throw new Error(`Schema validation failed: ${JSON.stringify(errors, null, 2)}`);
    }
  }
}
