import { AbstractConfigManager, InstanceConfig, TocElement, Topic } from './abstractConfigManager';
import { InitializeExtension } from '../utils/initializeExtension';
import * as vscode from 'vscode';
import * as fs from 'fs';
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
  configData: AuthordConfig = { instances: [], topics: { dir: "topics" } };
  private watchedFile: string = "";

  constructor(configPath: string) {
    super(configPath);
    this.refresh();
  }

  setupWatchers(InitializeExtension: InitializeExtension): void {
    if (this.watchedFile) {
      InitializeExtension.setupWatchers(this.watchedFile);
      this.watchedFile = "";
    }
  }

  refresh(): void {
    this.configData = this.readConfig();
  }

  private readConfig(): AuthordConfig {
    if (!fs.existsSync(this.configPath)) {
      const defaultConfig: AuthordConfig = { instances: [], topics: { dir: "topics" } };
      fs.writeFileSync(this.configPath, JSON.stringify(defaultConfig, null, 2), 'utf-8');
      return defaultConfig;
    }
    const raw = fs.readFileSync(this.configPath, 'utf-8');
    const data = JSON.parse(raw);
    if (!data.instances) { data.instances = []; }
    if (!data.topics) { data.topics = { dir: "topics" }; }
    return data;
  }

  private writeConfig(): void {
    if (!this.configData) { return; }
    fs.writeFileSync(this.configPath, JSON.stringify(this.configData, null, 2), 'utf-8');
  }

  getTopicsDir(): string {
    return path.join(path.dirname(this.configPath), this.configData.topics?.dir || "topics");
  }

  loadInstances(): InstanceConfig[] {
    return this.configData.instances;
  }

  // Documents
  addDocument(newDocument: InstanceConfig): void {
    // Similar to XML version, we "create" a new document by adding it to JSON
    // If needed, we could track a "tree" file, but here we store all in one JSON.
    this.configData.instances.push(newDocument);
    // Set watchedFile if needed (here we set to the main config file)
    this.watchedFile = this.configPath;
    this.writeConfig();
  }

  deleteDocument(docId: string): void {
    const doc = this.configData.instances.find(d => d.id === docId);
    if (!doc) { return; }

    // Delete all associated topics from disk
    const topicsDir = this.getTopicsDir();
    const allTopics = this.getAllTopicsFromDoc(doc["toc-elements"]);
    for (const topicFileName of allTopics) {
      const topicFilePath = path.join(topicsDir, topicFileName);
      if (fs.existsSync(topicFilePath)) {
        fs.unlinkSync(topicFilePath);
      }
    }

    // Remove the document
    this.configData.instances = this.configData.instances.filter(d => d.id !== docId);
    this.writeConfig();
  }

  renameDocument(docId: string, newName: string): void {
    const doc = this.configData.instances.find(d => d.id === docId);
    if (!doc) { return; }
    doc.name = newName;
    this.writeConfig();
  }

  getDocuments(): InstanceConfig[] {
    return this.configData.instances;
  }

  // Topics
  addTopic(docItem: string, parentTopic: string | null, newTopic: TocElement): void {
    const doc = this.configData.instances.find(d => d.id === docItem); // || d.name === docItem); //todo d.name === docItem for doc topic creation
    if (!doc) {
      console.error(`Document "${docItem}" not found.`);
      vscode.window.showWarningMessage(`Document "${docItem}" not found.`);
      return;
    }

    const topicsDir = this.getTopicsDir();
    try {
      this.createDirectory(topicsDir);
    } catch (err) {
      console.error(`Failed to create topics directory: ${err}`);
      vscode.window.showErrorMessage(`Failed to create topics directory.`);
      return;
    }

    const mainFilePath = path.join(topicsDir, newTopic.topic);
    if (this.fileExists(mainFilePath)) {
      console.error(`Topic file "${newTopic.topic}" already exists.`);
      vscode.window.showWarningMessage(`Topic file "${newTopic.topic}" already exists.`);
      return;
    }

    try {
      this.writeFile(mainFilePath, `# ${newTopic.title}\n\nContent goes here...`);
    } catch (err) {
      console.error(`Failed to write topic file "${newTopic.topic}": ${err}`);
      vscode.window.showErrorMessage(`Failed to write topic file "${newTopic.topic}".`);
      return;
    }

    if (!doc["start-page"]) {
      doc["start-page"] = newTopic.topic;
    }

    let parentArray = doc["toc-elements"];
    if (parentTopic) {
      const parent = this.findTopicByFilename(doc["toc-elements"], parentTopic);
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

    this.writeConfig();
    vscode.window.showInformationMessage(`Topic "${newTopic.title}" added successfully.`);
  }

  deleteTopic(docId: string, topicFileName: string): void {
    const doc = this.configData.instances.find(d => d.id === docId);
    if (!doc) {
      console.error(`Document with id "${docId}" not found.`);
      vscode.window.showWarningMessage(`Document with id "${docId}" not found.`);
      return;
    }

    const extractedTopic = this.extractTopicByFilename(doc["toc-elements"], topicFileName);
    if (!extractedTopic) {
      console.error(`Topic "${topicFileName}" not found in document "${docId}".`);
      vscode.window.showWarningMessage(`Topic "${topicFileName}" not found in document "${docId}".`);
      return;
    }

    const allTopics = this.getAllTopicsFromDoc([extractedTopic]);
    const topicsDir = this.getTopicsDir();
    for (const tFile of allTopics) {
      const topicFilePath = path.join(topicsDir, tFile);
      if (fs.existsSync(topicFilePath)) {
        try {
          fs.unlinkSync(topicFilePath);
        } catch (err) {
          console.error(`Failed to delete file "${topicFilePath}": ${err}`);
          vscode.window.showErrorMessage(`Failed to delete topic file "${topicFilePath}".`);
        }
      }
    }

    this.writeConfig();
  }

  renameTopic(docId: string, oldTopicFile: string, newName: string): void {
    const doc = this.configData.instances.find(d => d.id === docId);
    if (!doc) { return; }
    const topic = this.findTopicByFilename(doc["toc-elements"], oldTopicFile);
    if (topic) {
      const topicsDir = this.getTopicsDir();
      const newTopicFile = this.formatTitleAsFilename(newName);
      const oldFilePath = path.join(topicsDir, oldTopicFile);
      const newFilePath = path.join(topicsDir, newTopicFile);

      if (!this.fileExists(oldFilePath)) {
        console.log(`Original file ${oldTopicFile} not found.`);
        return;
      }

      if (this.fileExists(newFilePath)) {
        console.log("File with the new name already exists.");
        return;
      }

      this.renamePath(oldFilePath, newFilePath);
      topic.topic = newTopicFile;
      topic.title = newName;
      this.writeConfig();
    }
  }

  // moveTopic(docId: string, topicId: string, newParentId: string | null): void {
  //   const doc = this.configData.instances.find(d => d.id === docId);
  //   if (!doc) { return; }

  //   // Extract the topic by its 'id' field (assuming id is unique)
  //   const topic = this.extractTopicById(doc["toc-elements"], topicId);
  //   if (!topic) { return; }

  //   if (newParentId === null) {
  //     doc["toc-elements"].push(topic);
  //   } else {
  //     const parent = this.findTopicById(doc["toc-elements"], newParentId);
  //     if (parent) {
  //       parent.children.push(topic);
  //     }
  //   }
  //   this.writeConfig();
  // }

  getTopics(): Topic[] {
    const topics: Topic[] = [];
    const topicsDir = this.getTopicsDir();

    const traverseElements = (elements: TocElement[]) => {
      for (const e of elements) {
        const filePath = path.join(topicsDir, e.topic);
        if (fs.existsSync(filePath)) {
          topics.push({
            name: path.basename(filePath),
            path: filePath
          });
        }
        if (e.children && e.children.length > 0) {
          traverseElements(e.children);
        }
      }
    };

    this.configData.instances.forEach((doc) => {
      traverseElements(doc["toc-elements"]);
    });
    return topics;
  }
  // File handling
  createDirectory(dirPath: string): void {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  writeFile(filePath: string, content: string): void {
    fs.writeFileSync(filePath, content, 'utf-8');
  }

  renamePath(oldPath: string, newPath: string): void {
    fs.renameSync(oldPath, newPath);
  }

  fileExists(filePath: string): boolean {
    return fs.existsSync(filePath);
  }

  moveFolderToTrash(folderPath: string): void {
    const trashPath = path.join(path.dirname(this.configPath), 'trash');
    if (!fs.existsSync(trashPath)) {
      fs.mkdirSync(trashPath, { recursive: true });
    }
    const destinationPath = path.join(trashPath, path.basename(folderPath));

    if (fs.existsSync(destinationPath)) {
      this.mergeFolders(folderPath, destinationPath);
      fs.rmdirSync(folderPath, { recursive: true });
    } else {
      fs.renameSync(folderPath, destinationPath);
    }
  }

  mergeFolders(source: string, destination: string): void {
    const sourceFiles = fs.readdirSync(source);
    for (const file of sourceFiles) {
      const sourceFilePath = path.join(source, file);
      const destinationFilePath = path.join(destination, file);

      if (fs.statSync(sourceFilePath).isDirectory()) {
        if (!fs.existsSync(destinationFilePath)) {
          fs.mkdirSync(destinationFilePath);
        }
        this.mergeFolders(sourceFilePath, destinationFilePath);
      } else {
        if (fs.existsSync(destinationFilePath)) {
          const newFileName = `${path.basename(file, path.extname(file))}-${Date.now()}${path.extname(file)}`;
          const newDestinationFilePath = path.join(destination, newFileName);
          fs.renameSync(sourceFilePath, newDestinationFilePath);
        } else {
          fs.renameSync(sourceFilePath, destinationFilePath);
        }
      }
    }
  }

  validateAgainstSchema(schemaPath: string): void {
    const ajv = new Ajv({ allErrors: true });
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
    const validate = ajv.compile(schema);
    const valid = validate(this.configData);

    if (!valid) {
      const errors = validate.errors || [];
      throw new Error(`Schema validation failed: ${JSON.stringify(errors, null, 2)}`);
    }
  }

  // Helpers
  private formatTitleAsFilename(title: string): string {
    return title.toLowerCase().replace(/\s+/g, '-') + '.md';
  }

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
}
