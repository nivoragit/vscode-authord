import { AbstractConfigManager, InstanceConfig, TocElement, Topic } from './abstractConfigManager';
import { Authord } from '../authordExtension';
import * as vscode from 'vscode';
import { promises as fs } from 'fs'; // Use fs.promises for async operations
import * as path from 'path';
import Ajv from 'ajv';

export interface AuthordConfig {
  instances: InstanceConfig[];
  topics?: { dir: string };
  [key: string]: any;
}

export class AuthordConfigurationManager extends AbstractConfigManager {
  moveTopic(_docId: string, _topicId: string, _newParentId: string | null): void {
    throw new Error('Method not implemented.');
  }

  configData: AuthordConfig = { instances: [], topics: { dir: 'topics' } };
  private watchedFile: string = '';

  constructor(configPath: string) {
    super(configPath);
    // Immediately run an async function to load the config in the constructor
    (async () => {
      await this.refresh();
    })().catch(err => {
      vscode.window.showErrorMessage(`Failed to load AuthordConfig: ${err}`);
    });
  }

  setupWatchers(InitializeExtension: Authord): void {
    if (this.watchedFile) {
      InitializeExtension.setupWatchers(this.watchedFile);
      this.watchedFile = '';
    }
  }

  /**
   * Asynchronously refresh configuration data from disk.
   */
  public async refresh(): Promise<void> {
    this.configData = await this.readConfig();
  }

  /**
   * Reads the main config file asynchronously; creates a default if none exists.
   * Returns AuthordConfig object.
   */
  private async readConfig(): Promise<AuthordConfig> {
    try {
      await fs.access(this.configPath);
    } catch {
      // File does not exist -> create a default config
      const defaultConfig: AuthordConfig = { instances: [], topics: { dir: 'topics' } };
      await fs.writeFile(this.configPath, JSON.stringify(defaultConfig, null, 2), 'utf-8');
      return defaultConfig;
    }

    const rawData = await fs.readFile(this.configPath, 'utf-8');
    const data = JSON.parse(rawData);
    if (!data.instances) {data.instances = [];}
    if (!data.topics) {data.topics = { dir: 'topics' };}
    return data;
  }

  /**
   * Writes current configData to disk asynchronously.
   */
  private async writeConfig(): Promise<void> {
    if (!this.configData) {return;}
    await fs.writeFile(this.configPath, JSON.stringify(this.configData, null, 2), 'utf-8');
  }

  /**
   * Returns the directory path for storing topics.
   */
  public getTopicsDir(): string {
    return path.join(
      path.dirname(this.configPath),
      this.configData.topics?.dir || 'topics'
    );
  }

  /**
   * Asynchronously returns the array of instance configs from the loaded config.
   */
  public async loadInstances(): Promise<InstanceConfig[]> {
    // Here, configData is already in memory after refresh(), but we maintain the async signature.
    return this.configData.instances;
  }

  // --------------------------- Documents --------------------------- //

  /**
   * Creates a new document by appending to configData.instances. Then writes changes to disk.
   */
  public async addDocument(newDocument: InstanceConfig): Promise<void> {
    this.configData.instances.push(newDocument);
    // Setup watchers (if necessary) for the main config file
    this.watchedFile = this.configPath;
    await this.writeConfig();
  }

  /**
   * Deletes the specified document and all its topics from disk.
   */
  public async deleteDocument(docId: string): Promise<void> {
    const doc = this.configData.instances.find(d => d.id === docId);
    if (!doc) {return;}

    // Delete all associated topics from disk
    const topicsDir = this.getTopicsDir();
    const allTopics = this.getAllTopicsFromDoc(doc['toc-elements']);
    for (const topicFileName of allTopics) {
      const topicFilePath = path.join(topicsDir, topicFileName);
      try {
        await fs.unlink(topicFilePath);
      } catch {
        // If file doesn't exist or can't be removed, ignore
      }
    }

    // Remove the document
    this.configData.instances = this.configData.instances.filter(d => d.id !== docId);
    await this.writeConfig();
  }

  /**
   * Renames a document by updating its name and writing to disk.
   */
  public async renameDocument(docId: string, newName: string): Promise<void> {
    const doc = this.configData.instances.find(d => d.id === docId);
    if (!doc) {return;}
    doc.name = newName;
    await this.writeConfig();
  }

  /**
   * Returns all documents from configData synchronously (already loaded in memory).
   */
  public getDocuments(): InstanceConfig[] {
    return this.configData.instances;
  }

  // --------------------------- Topics --------------------------- //

  /**
   * Adds a new topic to the given document. Creates the topic file asynchronously.
   */
  public async addTopic(docItem: string, parentTopic: string | null, newTopic: TocElement): Promise<void> {
    const doc = this.configData.instances.find(d => d.id === docItem);
    if (!doc) {
      console.error(`Document "${docItem}" not found.`);
      vscode.window.showWarningMessage(`Document "${docItem}" not found.`);
      return;
    }

    const topicsDir = this.getTopicsDir();
    try {
      await this.createDirectory(topicsDir);
    } catch (err) {
      console.error(`Failed to create topics directory: ${err}`);
      vscode.window.showErrorMessage('Failed to create topics directory.');
      return;
    }

    const mainFilePath = path.join(topicsDir, newTopic.topic);
    if (await this.fileExists(mainFilePath)) {
      console.error(`Topic file "${newTopic.topic}" already exists.`);
      vscode.window.showWarningMessage(`Topic file "${newTopic.topic}" already exists.`);
      return;
    }

    try {
      await this.writeFile(mainFilePath, `# ${newTopic.title}\n\nContent goes here...`);
    } catch (err) {
      console.error(`Failed to write topic file "${newTopic.topic}": ${err}`);
      vscode.window.showErrorMessage(`Failed to write topic file "${newTopic.topic}".`);
      return;
    }

    if (!doc['start-page']) {
      doc['start-page'] = newTopic.topic;
    }

    let parentArray = doc['toc-elements'];
    if (parentTopic) {
      const parent = this.findTopicByFilename(doc['toc-elements'], parentTopic);
      if (parent) {
        parentArray = parent.children;
      } else {
        console.error(`Parent topic "${parentTopic}" not found.`);
        vscode.window.showWarningMessage(`Parent topic "${parentTopic}" not found.`);
        return;
      }
    }

    // Check for duplicate topic title under the same parent
    if (parentArray.some(t => t.title === newTopic.title)) {
      console.error(`Duplicate topic title "${newTopic.title}" in parent.`);
      vscode.window.showWarningMessage(`Duplicate topic title "${newTopic.title}" in parent.`);
      return;
    } else {
      parentArray.push(newTopic);
    }

    await this.writeConfig();
    vscode.window.showInformationMessage(`Topic "${newTopic.title}" added successfully.`);
  }

  /**
   * Deletes the specified topic (and its children) from a document, removing files from disk.
   */
  public async deleteTopic(docId: string, topicFileName: string): Promise<void> {
    const doc = this.configData.instances.find(d => d.id === docId);
    if (!doc) {
      console.error(`Document with id "${docId}" not found.`);
      vscode.window.showWarningMessage(`Document with id "${docId}" not found.`);
      return;
    }

    const extractedTopic = this.extractTopicByFilename(doc['toc-elements'], topicFileName);
    if (!extractedTopic) {
      console.error(`Topic "${topicFileName}" not found in document "${docId}".`);
      vscode.window.showWarningMessage(`Topic "${topicFileName}" not found in document "${docId}".`);
      return;
    }

    const allTopics = this.getAllTopicsFromDoc([extractedTopic]);
    const topicsDir = this.getTopicsDir();

    for (const tFile of allTopics) {
      const topicFilePath = path.join(topicsDir, tFile);
      try {
        await fs.unlink(topicFilePath);
      } catch (err) {
        console.error(`Failed to delete file "${topicFilePath}": ${err}`);
        vscode.window.showErrorMessage(`Failed to delete topic file "${topicFilePath}".`);
      }
    }

    await this.writeConfig();
  }

  /**
   * Renames a topic by renaming the file and updating topic data in config.
   */
  public async renameTopic(docId: string, oldTopicFile: string, newName: string): Promise<void> {
    const doc = this.configData.instances.find(d => d.id === docId);
    if (!doc) {return;}

    const topic = this.findTopicByFilename(doc['toc-elements'], oldTopicFile);
    if (topic) {
      const topicsDir = this.getTopicsDir();
      const newTopicFile = this.formatTitleAsFilename(newName);
      const oldFilePath = path.join(topicsDir, oldTopicFile);
      const newFilePath = path.join(topicsDir, newTopicFile);

      if (!(await this.fileExists(oldFilePath))) {
        console.log(`Original file "${oldTopicFile}" not found.`);
        return;
      }
      if (await this.fileExists(newFilePath)) {
        console.log('File with the new name already exists.');
        return;
      }

      await this.renamePath(oldFilePath, newFilePath);
      topic.topic = newTopicFile;
      topic.title = newName;
      await this.writeConfig();
    }
  }

  // --------------------------- Topic Utility Methods --------------------------- //

  /**
   * Returns all Topics (with file path) across all documents. Uses async file checks (fs.access).
   */
  public async getTopics(): Promise<Topic[]> {
    const topics: Topic[] = [];
    const topicsDir = this.getTopicsDir();

    const traverseElements = async (elements: TocElement[]) => {
      for (const e of elements) {
        const filePath = path.join(topicsDir, e.topic);
        try {
          await fs.access(filePath);
          topics.push({ name: path.basename(filePath), path: filePath });
        } catch {
          // File does not exist, ignore
        }
        if (e.children && e.children.length > 0) {
          await traverseElements(e.children);
        }
      }
    };

    // Traverse each doc's toc-elements
    for (const doc of this.configData.instances) {
      await traverseElements(doc['toc-elements']);
    }

    return topics;
  }

  /**
   * Recursively collects all .md file names (topics) from a set of TocElements.
   */
  private getAllTopicsFromDoc(tocElements: TocElement[]): string[] {
    const result: string[] = [];
    const traverse = (elements: TocElement[]) => {
      for (const e of elements) {
        result.push(e.topic);
        if (e.children && e.children.length > 0) {
          traverse(e.children);
        }
      }
    };
    traverse(tocElements);
    return result;
  }

  private findTopicByFilename(topics: TocElement[], fileName: string): TocElement | undefined {
    for (const t of topics) {
      if (t.title === fileName) {
        return t;
      }
      const found = this.findTopicByFilename(t.children, fileName);
      if (found) {return found;}
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
      if (extracted) {return extracted;}
    }
    return null;
  }

  private formatTitleAsFilename(title: string): string {
    return title.toLowerCase().replace(/\s+/g, '-') + '.md';
  }

  // --------------------------- Async File/Directory Operations --------------------------- //

  public async createDirectory(dirPath: string): Promise<void> {
    await fs.mkdir(dirPath, { recursive: true });
  }

  public async writeFile(filePath: string, content: string): Promise<void> {
    await fs.writeFile(filePath, content, 'utf-8');
  }

  public async renamePath(oldPath: string, newPath: string): Promise<void> {
    await fs.rename(oldPath, newPath);
  }

  public async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Moves a folder to a 'trash' directory for safe-keeping. Merges if conflicts exist.
   */
  public async moveFolderToTrash(folderPath: string): Promise<void> {
    const trashPath = path.join(path.dirname(this.configPath), 'trash');
    try {
      await fs.access(trashPath);
    } catch {
      await fs.mkdir(trashPath, { recursive: true });
    }
    const destinationPath = path.join(trashPath, path.basename(folderPath));

    try {
      await fs.access(destinationPath);
      await this.mergeFolders(folderPath, destinationPath);
      // Remove source folder after merging
      await fs.rm(folderPath, { recursive: true, force: true });
    } catch {
      // If destination doesn't exist, rename directly
      await fs.rename(folderPath, destinationPath);
    }
  }

  /**
   * Recursively merges two folders; if a collision occurs, the source file is renamed with a timestamp.
   */
  public async mergeFolders(source: string, destination: string): Promise<void> {
    let sourceFiles: string[] = [];
    try {
      sourceFiles = await fs.readdir(source);
    } catch {
      // If source doesn't exist or can't be read, just return
      return;
    }

    for (const file of sourceFiles) {
      const sourceFilePath = path.join(source, file);
      const destinationFilePath = path.join(destination, file);

      const stat = await fs.lstat(sourceFilePath);
      if (stat.isDirectory()) {
        try {
          await fs.access(destinationFilePath);
        } catch {
          await fs.mkdir(destinationFilePath);
        }
        await this.mergeFolders(sourceFilePath, destinationFilePath);
      } else {
        try {
          await fs.access(destinationFilePath);
          // If it exists, rename with timestamp
          const newFileName = `${path.basename(file, path.extname(file))}-${Date.now()}${path.extname(file)}`;
          const newDestinationFilePath = path.join(destination, newFileName);
          await fs.rename(sourceFilePath, newDestinationFilePath);
        } catch {
          // If the destination file doesn't exist
          await fs.rename(sourceFilePath, destinationFilePath);
        }
      }
    }
  }

  /**
   * Validates the loaded config against a JSON schema using Ajv. Uses an async file read for speed.
   */
  public async validateAgainstSchema(schemaPath: string): Promise<void> {
    const ajv = new Ajv({ allErrors: true });
    const schemaRaw = await fs.readFile(schemaPath, 'utf-8');
    const schema = JSON.parse(schemaRaw);
    const validate = ajv.compile(schema);
    const valid = validate(this.configData);

    if (!valid) {
      const errors = validate.errors || [];
      throw new Error(`Schema validation failed: ${JSON.stringify(errors, null, 2)}`);
    }
  }
}
