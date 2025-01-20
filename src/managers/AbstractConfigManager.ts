/************************************************************************************************
 * FILE: src/managers/AbstractConfigManager.ts
 * An abstract base manager holding all domain logic from the original code
 ***********************************************************************************************/
import * as vscode from 'vscode';
import * as path from 'path';
import { ConfigProvider } from '../config/ConfigProvider';
import { ConfigObject } from '../config/ConfigObjects';
import { InstanceConfig, TocElement, Topic } from '../types';

/**
 * Abstract manager that uses a ConfigProvider to read/write the configuration object
 * (JSON or XML), plus domain-level operations on documents/topics.
 */
export default abstract class AbstractConfigManager<T extends ConfigObject> {
  protected config: T | null = null;
  protected instances: InstanceConfig[] = [];

  /** Subclasses or the constructor will provide the actual config file path or provider. */
  constructor(protected provider: ConfigProvider<T>) {}

  /**
   * Refresh configuration from the provider, then load `this.instances` from the config object.
   */
  public async refresh(): Promise<void> {
    this.config = await this.provider.read();
    this.loadInstancesFromConfig();
  }

  /**
   * Subclass implements how to map `this.config` → `this.instances`.
   */
  protected abstract loadInstancesFromConfig(): void;

  /**
   * Subclass implements partial doc writing if needed (like writing .tree).
   * Many domain methods call `this.writeConfig(doc)` to save changes for a single doc.
   */
  protected abstract writeConfig(doc: InstanceConfig): Promise<void>;

  /**
   * For overall config writes, if your child class wants to reserialize the entire config object,
   * it can do so. Some child classes (JSON-based) might do `this.provider.write(this.config!)`.
   */
  protected abstract saveFullConfig(): Promise<void>;

  /** Validate the entire config object against a schema. */
  public abstract validateAgainstSchema(schemaPath: string): Promise<void>;

  /** Return the folder path for topics. */
  public abstract getTopicsDir(): string;

  /** Return the folder path for images. */
  public abstract getImageDir(): string;

  /** Create a new doc/instance. */
  public abstract addDocument(newDocument: InstanceConfig): Promise<boolean>;

  /** Delete an existing doc/instance. */
  public abstract deleteDocument(docId: string): Promise<boolean>;

  // ------------------------------------------------------------------------------------------
  // Common domain logic and utilities
  // ------------------------------------------------------------------------------------------

  public getDocuments(): InstanceConfig[] {
    return this.instances;
  }

  protected findDocById(docId: string): InstanceConfig | undefined {
    return this.instances.find((d) => d.id === docId);
  }

  // 1) renameDocument
  public async renameDocument(docId: string, newName: string): Promise<boolean> {
    try {
      const doc = this.findDocById(docId);
      if (!doc) {
        vscode.window.showErrorMessage(`Document "${docId}" not found for rename.`);
        return false;
      }
      doc.name = newName;
      await this.writeConfig(doc);
      return true;
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to rename document "${docId}" -> "${newName}": ${err.message}`);
      return false;
    }
  }

  // 2) moveTopics
  public async moveTopics(docId: string, sourceTopicId: string, targetTopicId: string): Promise<TocElement[]> {
    if (sourceTopicId === targetTopicId) {
      return [];
    }
    const doc = this.findDocById(docId);
    if (!doc) {
      throw new Error(`Document "${docId}" not found for moveTopics.`);
    }

    const targetTopic = await this.findTopicInDoc(doc['toc-elements'], targetTopicId, sourceTopicId);
    if (!targetTopic) {
      return [];
    }
    if (!targetTopic.children) {
      targetTopic.children = [];
    }

    const sourceTopic = await this.removeTopicFromDoc(doc['toc-elements'], sourceTopicId);
    if (!sourceTopic) {
      return [];
    }
    targetTopic.children.push(sourceTopic);

    await this.writeConfig(doc);
    return doc['toc-elements'];
  }

  // 3) setMarkdownTitle
  public async setMarkdownTitle(fileName: string, newTitle: string): Promise<void> {
    const filePath = path.join(this.getTopicsDir(), fileName);
    if (!(await this.fileExists(filePath))) {
      vscode.window.showErrorMessage(`File "${fileName}" not found or cannot be opened.`);
      return;
    }
    try {
      const doc = await vscode.workspace.openTextDocument(filePath);
      const editor = await vscode.window.showTextDocument(doc);
      await editor.edit((editBuilder) => {
        if (doc.lineCount > 0) {
          const firstLineRange = doc.lineAt(0).range;
          editBuilder.replace(firstLineRange, `# ${newTitle}`);
        } else {
          editBuilder.insert(new vscode.Position(0, 0), `# ${newTitle}\n\n`);
        }
      });
      await doc.save();
    } catch (error: any) {
      vscode.window.showErrorMessage(`Error setting markdown title in ${filePath}: ${error.message}`);
    }
  }

  // 4) renameTopic
  public async renameTopic(
    docId: string,
    oldTopicFile: string,
    newName: string,
    enteredFileName?: string
  ): Promise<boolean> {
    try {
      const doc = this.findDocById(docId);
      if (!doc) {
        vscode.window.showErrorMessage(`Document "${docId}" not found for renameTopic.`);
        return false;
      }
      const topic = this.findTopicByFilename(doc['toc-elements'], oldTopicFile);
      if (!topic) {
        vscode.window.showErrorMessage(`Topic "${oldTopicFile}" not found in doc "${docId}".`);
        return false;
      }
      const topicsDir = this.getTopicsDir();
      const newTopicFile = enteredFileName || this.formatTitleAsFilename(newName);

      // rename file on disk if it exists
      const oldUri = vscode.Uri.file(path.join(topicsDir, oldTopicFile));
      const newUri = vscode.Uri.file(path.join(topicsDir, newTopicFile));
      await this.renameFileIfExists(oldUri, newUri);

      // adjust doc data
      if (doc['toc-elements'].length === 1) {
        doc['start-page'] = newTopicFile;
      }
      topic.topic = newTopicFile;
      topic.title = newName;

      await this.writeConfig(doc);
      return true;
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to rename topic "${oldTopicFile}" to "${newName}": ${err.message}`);
      return false;
    }
  }

  // 5) deleteTopic
  public async deleteTopic(docId: string, topicFileName: string): Promise<boolean> {
    try {
      const doc = this.findDocById(docId);
      if (!doc) {
        vscode.window.showWarningMessage(`Document "${docId}" not found.`);
        return false;
      }
      const extractedTopic = this.extractTopicByFilename(doc['toc-elements'], topicFileName);
      if (!extractedTopic) {
        vscode.window.showWarningMessage(`Topic "${topicFileName}" not found in document "${docId}".`);
        return false;
      }
      // remove from disk
      const allTopics = this.getAllTopicsFromDoc([extractedTopic]);
      const topicsDir = this.getTopicsDir();
      await Promise.all(
        allTopics.map((tFile) => this.deleteFileIfExists(path.join(topicsDir, tFile)))
      );

      // double check if main file is gone
      if (await this.fileExists(path.join(topicsDir, topicFileName))) {
        vscode.window.showErrorMessage(`Failed to delete topic "${topicFileName}"`);
        return false;
      }
      await this.writeConfig(doc);
      return true;
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to delete topic "${topicFileName}": ${err.message}`);
      return false;
    }
  }

  // 6) addSiblingTopic
  public async addSiblingTopic(docId: string, siblingTopic: string, newTopic: TocElement): Promise<boolean> {
    try {
      const doc = this.findDocById(docId);
      if (!doc) {
        vscode.window.showWarningMessage(`Document "${docId}" not found.`);
        return false;
      }
      if (!doc['start-page']) {
        doc['start-page'] = newTopic.topic;
      }
      const tocElements = this.findSiblingsByFilename(doc['toc-elements'], siblingTopic);
      if (!tocElements) {
        vscode.window.showWarningMessage(`Parent topic "${siblingTopic}" not found.`);
        return false;
      }

      // add if not a duplicate
      if (!tocElements.some((t) => t.title === newTopic.title)) {
        tocElements.push(newTopic);
      }
      // create the .md file if needed
      await this.writeTopicFile(newTopic);

      // confirm file creation
      if (await this.fileExists(path.join(this.getTopicsDir(), newTopic.topic))) {
        await this.writeConfig(doc);
        return true;
      }
      vscode.window.showErrorMessage(`Failed to add topic "${newTopic.title}"`);
      return false;
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to add sibling topic "${newTopic.title}": ${err.message}`);
      return false;
    }
  }

  // 7) setAsStartPage
  public async setAsStartPage(docId: string, topicFileName: string): Promise<boolean> {
    try {
      const doc = this.findDocById(docId);
      if (!doc) {
        vscode.window.showWarningMessage(`Document "${docId}" not found.`);
        return false;
      }
      doc['start-page'] = topicFileName;
      await this.writeConfig(doc);
      return true;
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to set start page: ${err}`);
      return false;
    }
  }

  // 8) addChildTopic
  public async addChildTopic(docId: string, parentTopic: string | null, newTopic: TocElement): Promise<boolean> {
    try {
      const doc = this.findDocById(docId);
      if (!doc) {
        vscode.window.showWarningMessage(`Document "${docId}" not found.`);
        return false;
      }
      if (parentTopic) {
        const parentElem = this.findTopicByFilename(doc['toc-elements'], parentTopic);
        if (!parentElem) {
          vscode.window.showWarningMessage(`Parent topic "${parentTopic}" not found.`);
          return false;
        }
        parentElem.children.push(newTopic);
      } else {
        doc['toc-elements'].push(newTopic);
      }
      // create .md file
      await this.writeTopicFile(newTopic);

      if (await this.fileExists(path.join(this.getTopicsDir(), newTopic.topic))) {
        await this.writeConfig(doc);
        return true;
      }
      vscode.window.showErrorMessage(`Failed to add topic "${newTopic.title}"`);
      return false;
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to add topic "${newTopic.title}": ${err.message}`);
      return false;
    }
  }

  // 9) getTopics (lists actual .md files that exist on disk for all docs)
  public async getTopics(): Promise<Topic[]> {
    if (!this.instances) {
      return [];
    }
    const topicsDir = this.getTopicsDir();
    const allFilePaths: string[] = [];

    const traverseElements = (elements: TocElement[]) => {
      elements.forEach((e) => {
        allFilePaths.push(path.join(topicsDir, e.topic));
        if (e.children && e.children.length > 0) {
          traverseElements(e.children);
        }
      });
    };
    try {
      this.instances.forEach((doc) => {
        traverseElements(doc['toc-elements']);
      });
      const checkResults = await Promise.all(
        allFilePaths.map(async (filePath) => {
          if (await this.fileExists(filePath)) {
            return filePath;
          }
          return null;
        })
      );
      return checkResults
        .filter((fp) => fp !== null)
        .map((fp) => ({
          name: path.basename(fp as string),
          path: fp as string
        }));
    } catch (err: any) {
      vscode.window.showErrorMessage(`Error retrieving topics: ${err.message}`);
      throw err;
    }
  }

  // ------------------------------------------------------------------------------------------
  // Protected / Utility Methods
  // ------------------------------------------------------------------------------------------

  protected async removeTopicFromDoc(topics: TocElement[], topicId: string): Promise<TocElement | undefined> {
    for (let i = 0; i < topics.length; i += 1) {
      if (topics[i].topic === topicId) {
        return topics.splice(i, 1)[0];
      }
      const childRemoved = await this.removeTopicFromDoc(topics[i].children, topicId);
      if (childRemoved) {
        return childRemoved;
      }
    }
    return undefined;
  }

  protected async findTopicInDoc(
    topics: TocElement[],
    findTargetId: string,
    sourceTopicId: string
  ): Promise<TocElement | boolean | undefined> {
    function hasTargetTopic(topic: TocElement, tId: string): boolean {
      if (topic.children.some((child) => child.topic === tId)) {
        return true;
      }
      return topic.children.some((child) => hasTargetTopic(child, tId));
    }

    for (let i = 0; i < topics.length; i += 1) {
      const t = topics[i];
      if (t.topic === sourceTopicId && hasTargetTopic(t, findTargetId)) {
        return false;
      }
      if (t.topic === findTargetId) {
        if (t.children.some((child) => child.topic === sourceTopicId)) {
          return false;
        }
        return t;
      }
      const childFound = await this.findTopicInDoc(t.children, findTargetId, sourceTopicId);
      if (childFound || childFound === false) {
        return childFound;
      }
    }
    return undefined;
  }

  protected extractTopicByFilename(topics: TocElement[], fileName: string): TocElement | null {
    const idx = topics.findIndex((t) => t.topic === fileName);
    if (idx > -1) {
      const [removed] = topics.splice(idx, 1);
      return removed;
    }
    for (let i = 0; i < topics.length; i += 1) {
      const extracted = this.extractTopicByFilename(topics[i].children, fileName);
      if (extracted) {
        return extracted;
      }
    }
    return null;
  }

  protected findTopicByFilename(topics: TocElement[], fileName: string): TocElement | undefined {
    for (let i = 0; i < topics.length; i += 1) {
      const t = topics[i];
      if (t.topic === fileName) {
        return t;
      }
      const found = this.findTopicByFilename(t.children, fileName);
      if (found) {
        return found;
      }
    }
    return undefined;
  }

  protected findSiblingsByFilename(topics: TocElement[], fileName: string): TocElement[] | undefined {
    for (let i = 0; i < topics.length; i += 1) {
      const t = topics[i];
      if (t.topic === fileName) {
        return topics;
      }
      const found = this.findSiblingsByFilename(t.children, fileName);
      if (found) {
        return found;
      }
    }
    return undefined;
  }

  protected getAllTopicsFromDoc(tocElements: TocElement[]): string[] {
    const result: string[] = [];
    const traverse = (elems: TocElement[]) => {
      elems.forEach((e) => {
        result.push(e.topic);
        if (e.children?.length) {
          traverse(e.children);
        }
      });
    };
    traverse(tocElements);
    return result;
  }

  protected formatTitleAsFilename(title: string): string {
    return `${title.trim().toLowerCase().replace(/\s+/g, '-')}.md`;
  }

  /** Checks if a file exists using workspace.fs.stat. */
  protected async fileExists(filePath: string): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
      return true;
    } catch {
      return false;
    }
  }

  /** Helper method to rename a file if it already exists. */
  protected async renameFileIfExists(oldUri: vscode.Uri, newUri: vscode.Uri): Promise<void> {
    try {
      // if old doesn't exist, do nothing
      await vscode.workspace.fs.stat(oldUri);
      // rename
      await vscode.workspace.fs.rename(oldUri, newUri);
    } catch {
      // ignore
    }
  }

  /** Helper that deletes a file if it exists. */
  protected async deleteFileIfExists(filePath: string): Promise<void> {
    try {
      await vscode.workspace.fs.delete(vscode.Uri.file(filePath));
    } catch {
      // ignore
    }
  }

  /** Reads a file from disk as string. */
  protected async readFileAsString(filePath: string): Promise<string> {
    try {
      const data = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
      return Buffer.from(data).toString('utf-8');
    } catch (err: any) {
      vscode.window.showErrorMessage(`Error reading file "${filePath}": ${err.message}`);
      throw new Error(`File "${filePath}" does not exist or cannot be read.`);
    }
  }

  /** Write a new file to disk, creating parent directories if necessary. */
  protected async writeNewFile(filePath: string, content: string): Promise<boolean> {
    try {
      const fileUri = vscode.Uri.file(filePath);
      const directoryUri = fileUri.with({ path: path.dirname(fileUri.fsPath) });
      await vscode.workspace.fs.createDirectory(directoryUri);
      await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf-8'));
      return true;
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to write new file at "${filePath}": ${err.message}`);
      throw err;
    }
  }

  /** Writes a new .md file for the topic, if it doesn’t exist. */
  protected async writeTopicFile(newTopic: TocElement): Promise<void> {
    const topicsDir = this.getTopicsDir();
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(topicsDir));

    const filePath = path.join(topicsDir, newTopic.topic);
    if (await this.fileExists(filePath)) {
      vscode.window.showWarningMessage(`Topic file "${newTopic.topic}" already exists.`);
      return;
    }
    const wrote = await this.writeNewFile(filePath, `# ${newTopic.title}\n\nContent goes here...`);
    if (wrote) {
      // optional: open it in an editor
      await vscode.commands.executeCommand('authordExtension.openMarkdownFile', filePath);
    }
  }

  /** Scans a markdown file’s first line to guess a title. */
  protected async getMdTitle(topicFile: string): Promise<string> {
    try {
      const mdFilePath = path.join(this.getTopicsDir(), topicFile);
      const content = await this.readFileAsString(mdFilePath);
      const lines = content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('# ')) {
          return trimmed.substring(1).trim();
        }
        if (trimmed.length > 0) {
          break;
        }
      }
    } catch {
      // ignore
    }
    return `<${path.basename(topicFile)}>`;
  }
}
