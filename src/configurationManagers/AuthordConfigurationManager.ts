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
  async createDirectory(dirPath: string): Promise<void> {
    try {
      const dirUri = vscode.Uri.file(dirPath);
      await vscode.workspace.fs.stat(dirUri);
    } catch {
      // If the directory does not exist, create it.
      try {
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(dirPath));
      } catch (error: any) {
        vscode.window.showErrorMessage(`Error creating directory "${dirPath}": ${error.message}`);
        throw error;
      }
    }
  }
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
      return true;
    } catch {
      // We do not show an error here because a "missing file" is a valid condition
      // and not necessarily an error for existence checks.
      return false;
    }
  }

  private async readJsonFile(filePath: string): Promise<any> {
    try {
      const fileData = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
      return JSON.parse(Buffer.from(fileData).toString('utf-8'));
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to read JSON file at "${filePath}": ${error.message}`);
      throw error;
    }
  }

  private async writeNewFile(filePath: string, content: string): Promise<void> {
    try {
      const fileUri = vscode.Uri.file(filePath);
      const directoryUri = fileUri.with({ path: path.dirname(fileUri.fsPath) });
      await vscode.workspace.fs.createDirectory(directoryUri);
      await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf-8'));
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to write new file at "${filePath}": ${error.message}`);
      throw error;
    }
  }

  /**
   * Opens a JSON file, applies a mutation function, and preserves indentation.
   */
  private async updateJsonFile(filePath: string, mutateFn: (jsonData: any) => any): Promise<void> {
    try {
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
    } catch (error: any) {
      vscode.window.showErrorMessage(`Error updating JSON file at "${filePath}": ${error.message}`);
      throw error;
    }
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
    try {
      if (!(await this.fileExists(this.configPath))) {
        const defaultConfig = this.defaultConfigJson();
        await this.writeNewFile(this.configPath, JSON.stringify(defaultConfig, null, 2));
      }
      return await this.readJsonFile(this.configPath);
    } catch (error: any) {
      vscode.window.showErrorMessage(`Error reading config: ${error.message}`);
      throw error;
    }
  }

  private async writeConfig(): Promise<void> {
    try {
      if (!this.configData) {
        return;
      }
      await this.updateJsonFile(this.configPath, () => this.configData!);
    } catch (error: any) {
      vscode.window.showErrorMessage(`Error writing config: ${error.message}`);
      throw error;
    }
  }

  // ------------------------------------------------------------------------------------
  // TOP-LEVEL METHODS
  // ------------------------------------------------------------------------------------
  async refresh(): Promise<void> {
    try {
      this.configData = await this.readConfig();
      this.instances = this.configData.instances;
    } catch (error: any) {
      vscode.window.showErrorMessage(`Error refreshing configuration: ${error.message}`);
    }
  }

  async createConfigFile(): Promise<AuthordConfigurationManager> {
    try {
      this.configData = this.defaultConfigJson();
      await this.writeConfig();
      this.instances = [];
      return this;
    } catch (error: any) {
      vscode.window.showErrorMessage(`Error creating config file: ${error.message}`);
      throw error;
    }
  }

  getTopicsDir(): string {
    // Not wrapping in try-catch because this simply returns a path.
    return path.join(
      path.dirname(this.configPath),
      this.configData?.topics?.dir || ''
    );
  }

  getImageDir(): string {
    // Not wrapping in try-catch because this simply returns a path.
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

  async addDocument(newDocument: InstanceConfig): Promise<boolean> {
    try {
      if (!this.configData) {
        vscode.window.showErrorMessage('Configuration data not initialized.');
        return false;
      }
      this.configData.instances.push(newDocument);
      await this.writeConfig();

      if (newDocument['toc-elements'] && newDocument['toc-elements'][0]) {
        await this.writeTopicFile(newDocument['toc-elements'][0]);
      }
      return true;
    } catch (error: any) {
      vscode.window.showErrorMessage(`Error adding document: ${error.message}`);
      return false;
    }
  }

  async deleteDocument(docId: string): Promise<boolean> {
    try {
      const doc = this.findDocById(docId, false);
      if (!doc || !this.configData) {
        return false;
      }

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
      return true;
    } catch (error: any) {
      vscode.window.showErrorMessage(`Error deleting document with id "${docId}": ${error.message}`);
      return false;
    }
  }

  async renameDocument(docId: string, newName: string): Promise<boolean> {
    try {
      const doc = this.findDocById(docId);
      if (!doc) {
        return false;
      }
      doc.name = newName;
      await this.writeConfig();
      return true;
    } catch (error: any) {
      vscode.window.showErrorMessage(`Error renaming document with id "${docId}": ${error.message}`);
      return false;
    }
  }

  getDocuments(): InstanceConfig[] {
    // Not wrapping in try-catch; simply returns what is in-memory (or empty array).
    return this.configData?.instances || [];
  }

  // ------------------------------------------------------------------------------------
  // TOPIC METHODS
  // ------------------------------------------------------------------------------------

  private async writeTopicFile(newTopic: TocElement): Promise<void> {
    try {
      const topicsDir = this.getTopicsDir();
      await this.createDirectory(topicsDir);

      const mainFilePath = path.join(topicsDir, newTopic.topic);
      if (await this.fileExists(mainFilePath)) {
        vscode.window.showWarningMessage(`Topic file "${newTopic.topic}" already exists.`);
        return;
      }

      const content = `# ${newTopic.title}\n\nContent goes here...`;
      await vscode.workspace.fs.writeFile(vscode.Uri.file(mainFilePath), Buffer.from(content, 'utf-8'));
    } catch (error: any) {
      vscode.window.showErrorMessage(`Error writing topic file "${newTopic.topic}": ${error.message}`);
      throw error;
    }
  }
  async moveTopics(docId: string, sourceTopicId: string, targetTopicId: string): Promise<TocElement[] | undefined> {
    // Find the document by ID
    const doc = this.findDocById(docId);
    if (!doc) {
        vscode.window.showErrorMessage(`Document "${docId}" not found.`);
        return;
    }

    // Find the target topic
    const targetTopic = this.findTopicByFilename(doc['toc-elements'], targetTopicId);
    if (!targetTopic) {
        vscode.window.showWarningMessage(`Target topic "${targetTopicId}" not found in document "${docId}".`);
        return;
    }

    // Ensure the target topic has a children array
    if (!targetTopic.children) {
        targetTopic.children = [];
    }

    // Remove the source topic from the document's toc-elements
    const sourceTopic = this.extractTopicByFilename(doc['toc-elements'], sourceTopicId);
    if (!sourceTopic) {
        vscode.window.showWarningMessage(`Source topic "${sourceTopicId}" not found in document "${docId}".`);
        return;
    }

    // Add the source topic to the target topic's children
    targetTopic.children.push(sourceTopic);

    // Write updates to the configuration
    try {
        await this.writeConfig();
    } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to save changes while moving topics: ${error.message}`);
        throw error;
    }

    return doc['toc-elements'];
}

  
  async addTopic(docItem: string, parentTopic: string | null, newTopic: TocElement): Promise<boolean> {
    try {
      const doc = this.findDocById(docItem);
      if (!doc) {
        return false;
      }

      

      if (!doc['start-page']) {
        doc['start-page'] = newTopic.topic;
      }

      let parentArray = doc['toc-elements'];
      if (parentTopic) {
        const parent = this.findTopicByFilename(doc['toc-elements'], parentTopic);
        if (!parent) {
          vscode.window.showWarningMessage(`Parent topic "${parentTopic}" not found.`);
          return false;
        }
        parentArray = parent.children;
      }

      if (!parentArray.some(t => t.title === newTopic.title)) {
        parentArray.push(newTopic);
      }

      try {
        await this.writeTopicFile(newTopic);
        await this.writeConfig();
      } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to update document tree: ${error.message}`);
        return false;
      }

      vscode.window.showInformationMessage(`Topic "${newTopic.title}" added successfully.`);
      return true;
    } catch (error: any) {
      vscode.window.showErrorMessage(`Error adding topic "${newTopic.title}": ${error.message}`);
      return false;
    }
  }

  async deleteTopic(docId: string, topicFileName: string): Promise<boolean> {
    try {
      const doc = this.findDocById(docId);
      if (!doc) {
        return false;
      }

      const extractedTopic = this.extractTopicByFilename(doc['toc-elements'], topicFileName);
      if (!extractedTopic) {
        vscode.window.showWarningMessage(`Topic "${topicFileName}" not found in document "${docId}".`);
        return false;
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
      return true;
    } catch (error: any) {
      vscode.window.showErrorMessage(`Error deleting topic "${topicFileName}" from document "${docId}": ${error.message}`);
      return false;
    }
  }

  // Already returns Promise<boolean> - just ensure consistency in return statements.
  async renameTopic(docId: string, oldTopicFile: string, newName: string): Promise<boolean> {
    try {
      const doc = this.findDocById(docId);
      if (!doc) { 
        return false; 
      }
    
      const topic = this.findTopicByFilename(doc['toc-elements'], oldTopicFile);
      if (!topic) { 
        return false; 
      }

      const topicsDir = this.getTopicsDir();
      const newTopicFile = this.formatTitleAsFilename(newName);
      const oldFilePath = path.join(topicsDir, oldTopicFile);
      const newFilePath = path.join(topicsDir, newTopicFile);

      if(doc['toc-elements'].length === 1){
        doc['start-page'] = newTopicFile;
      }
      if (!(await this.fileExists(oldFilePath))) {
        vscode.window.showWarningMessage(`Cannot rename topic. File "${oldTopicFile}" does not exist.`);
        return false;
      }
      if (await this.fileExists(newFilePath)) {
        vscode.window.showWarningMessage(`Cannot rename topic. File "${newTopicFile}" already exists.`);
        return false;
      }

      topic.topic = newTopicFile;
      topic.title = newName;
      try {
        await this.writeConfig();
      } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to update config file: ${error.message}`);
        return false;
      }
      // Rename on disk
      await vscode.workspace.fs.rename(vscode.Uri.file(oldFilePath), vscode.Uri.file(newFilePath));
      return true;
    } catch (error: any) {
      vscode.window.showErrorMessage(`Error renaming topic "${oldTopicFile}": ${error.message}`);
      return false;
    }
  }

  // ------------------------------------------------------------------------------------
  // getTopics - physically present
  // ------------------------------------------------------------------------------------
  async getTopics(): Promise<Topic[]> {
    try {
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
    } catch (error: any) {
      vscode.window.showErrorMessage(`Error retrieving topics: ${error.message}`);
      return [];
    }
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

  async validateAgainstSchema(schemaPath: string): Promise<void> {
    try {
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
    } catch (error: any) {
      vscode.window.showErrorMessage(`Error validating against schema: ${error.message}`);
      throw error;
    }
  }
}