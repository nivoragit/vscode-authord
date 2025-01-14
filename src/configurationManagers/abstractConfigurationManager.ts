/* eslint-disable class-methods-use-this, no-restricted-syntax, import/no-unresolved */
/* 
  Note: 
  1) 'import/no-unresolved' is disabled here for 'vscode' imports typical in VS Code extensions.
  2) 'class-methods-use-this' is disabled because certain methods in an abstract manager may not need instance references; 
     or consider making them static if truly not using instance data.
  3) 'no-restricted-syntax' is disabled because some iterative patterns (like recursion with for loops) are practical here.
  Adjust or remove these overrides as appropriate for your project's rules and architecture.
*/

import * as vscode from 'vscode';
import * as path from 'path';
import { InstanceConfig, TocElement, Topic } from '../utils/types';

export default abstract class AbstractConfigManager {
  configPath: string;

  instances: InstanceConfig[] = [];

  constructor(configPath: string) {
    this.configPath = configPath;
  }

  protected abstract writeConfig(_doc: InstanceConfig, _filePath?: string): Promise<void>;

  abstract validateAgainstSchema(schemaPath: string): Promise<void>;

  abstract getTopicsDir(): string;

  abstract getImageDir(): string;

  // Document-specific methods
  abstract addDocument(newDocument: InstanceConfig): Promise<boolean>;

  abstract deleteDocument(docId: string): Promise<boolean>;

  // Refresh configuration
  abstract refresh(): Promise<void>;

  protected findDocById(docId: string): InstanceConfig | undefined {
    return this.instances.find((d) => d.id === docId);
  }

  /**
   * Renames a document by updating `@_name` in its .tree file.
   * Refactored to return Promise<boolean>.
   */
  async renameDocument(docId: string, newName: string): Promise<boolean> {
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

  /**
   * Moves topics within a document’s TOC. 
   * Removed explicit return and changed type to Promise<void> for consistent-return compliance.
   */
  async moveTopics(docId: string, sourceTopicId: string, targetTopicId: string): Promise<TocElement[]> {
    if (sourceTopicId === targetTopicId) {
      return [];
    }
    const doc = this.findDocById(docId);
    if (!doc) {
      throw new Error(`Document "${docId}" not found for moveTopicInDoc.`);
    }

    const targetTopic = await this.findTopicInDoc(doc['toc-elements'], targetTopicId, sourceTopicId);
    if (!targetTopic) {
      return [];
    }

    if (!(targetTopic as TocElement).children) {
      (targetTopic as TocElement).children = [];
    }

    const sourceTopic = await this.removeTopicFromDoc(doc['toc-elements'], sourceTopicId);
    if (!sourceTopic) {
      return [];
    }

    (targetTopic as TocElement).children.push(sourceTopic);
    await this.writeConfig(doc);
    return doc['toc-elements'];
  }

  /**
   * Opens the given Markdown file and replaces its first line with `# newTitle`.
   */
  async setMarkdownTitle(fileName: string, newTitle: string): Promise<void> {
    const filePath = path.join(this.getTopicsDir(), fileName);
    if (!await this.fileExists(filePath)) {
      vscode.window.showErrorMessage('File not found or cannot be opened.');
      return;
    }
    try {
      const document = await vscode.workspace.openTextDocument(filePath);
      const editor = await vscode.window.showTextDocument(document);
      await editor.edit((editBuilder) => {
        if (document.lineCount > 0) {
          const firstLineRange = document.lineAt(0).range;
          editBuilder.replace(firstLineRange, `# ${newTitle}`);
        } else {
          editBuilder.insert(new vscode.Position(0, 0), `# ${newTitle}\n\n`);
        }
      });
      await document.save();
    } catch (error: any) {
      vscode.window.showErrorMessage(`Error setting markdown title in ${filePath}: ${error.message}`);
    }
  }

  /**
   * Renames a topic’s file on disk and updates .tree data accordingly.
   */
  async renameTopic(
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

      const oldFileUri = vscode.Uri.file(path.join(topicsDir, oldTopicFile));
      const newFileUri = vscode.Uri.file(path.join(topicsDir, newTopicFile));
      await vscode.workspace.fs.rename(oldFileUri, newFileUri);

      if (doc['toc-elements'].length === 1) {
        doc['start-page'] = newTopicFile;
      }

      topic.topic = newTopicFile;
      topic.title = newName;
      await this.writeConfig(doc);

      return true;
    } catch (err: any) {
      vscode.window.showErrorMessage(
        `Failed to rename topic "${oldTopicFile}" to "${newName}": ${err.message}`
      );
      return false;
    }
  }

  /**
   * Deletes a topic (and children) -> removes from disk -> updates .tree.
   */
  async deleteTopic(docId: string, topicFileName: string): Promise<boolean> {
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
      const allTopics = this.getAllTopicsFromDoc([extractedTopic]);
      const topicsDir = this.getTopicsDir();
      await Promise.all(
        allTopics.map(async (tFile) => this.deleteFileIfExists(path.join(topicsDir, tFile)))
      );

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

  /**
   * Adds a new topic -> writes .md -> updates .tree.
   */
  async addSiblingTopic(docId: string, siblingTopic: string, newTopic: TocElement): Promise<boolean> {
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

      if (!tocElements.some((t) => t.title === newTopic.title)) {
        tocElements.push(newTopic);
      }

      await this.writeTopicFile(newTopic);
      if (await this.fileExists(path.join(this.getTopicsDir(), newTopic.topic))) {
        await this.writeConfig(doc);
        return true;
      }
      vscode.window.showErrorMessage(`Failed to delete topic "${newTopic.title}"`);
      return false;
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to add topic "${newTopic.title}": ${err.message}`);
      return false;
    }
  }

  async SetasStartPage(docId: string, siblingTopic: string): Promise<boolean> {
    try {
      const doc = this.findDocById(docId);
      if (!doc) {
        vscode.window.showWarningMessage(`Document "${docId}" not found.`);
        return false;
      }
      doc['start-page'] = siblingTopic;
      await this.writeConfig(doc);
      return true;
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to set start page:${err}`);
      return false;
    }
  }

  async addChildTopic(docId: string, parentTopic: string | null, newTopic: TocElement): Promise<boolean> {
    try {
      const doc = this.findDocById(docId);
      if (!doc) {
        vscode.window.showWarningMessage(`Document "${docId}" not found.`);
        return false;
      }
      let parentArray: TocElement[];
      if (parentTopic) {
        const parent = this.findTopicByFilename(doc['toc-elements'], parentTopic);
        if (!parent) {
          vscode.window.showWarningMessage(`Parent topic "${parentTopic}" not found.`);
          return false;
        }
        parentArray = parent.children;
      } else {
        parentArray = doc['toc-elements'];
        parentArray.push(newTopic);
      }
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

  /**
   * Returns the loaded documents in memory.
   */
  getDocuments(): InstanceConfig[] {
    return this.instances;
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

  /**
   * Deletes a file if it exists.
   */
  protected async deleteFileIfExists(filePath: string): Promise<void> {
    try {
      await vscode.workspace.fs.delete(vscode.Uri.file(filePath));
    } catch {
      // ignore
    }
  }

  protected async writeNewFile(filePath: string, content: string): Promise<boolean> {
    try {
      const fileUri = vscode.Uri.file(filePath);
      const directoryUri = fileUri.with({ path: path.dirname(fileUri.fsPath) });
      await vscode.workspace.fs.createDirectory(directoryUri);
      await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf-8'));
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to write new file at "${filePath}": ${error.message}`);
      throw error;
    }
    return true;
  }

  /**
   * Extracts a topic by `t.topic === fileName` and returns it, or null if not found.
   */
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

  /**
   * Recursively searches `toc-elements` for a match by `t.topic === fileName`.
   */
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

  /**
   * Reads a file as string using workspace.fs.
   */
  protected async readFileAsString(filePath: string): Promise<string> {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
      const data = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
      return Buffer.from(data).toString('utf-8');
    } catch (error: any) {
      vscode.window.showErrorMessage(`Error reading file "${filePath}": ${error.message}`);
      throw new Error(`File "${filePath}" does not exist or cannot be read.`);
    }
  }

  protected async getMdTitle(topicFile: string): Promise<string> {
    try {
      const mdFilePath = path.join(this.getTopicsDir(), topicFile);
      const content = await this.readFileAsString(mdFilePath);
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i].trim();
        if (line.startsWith('# ')) {
          return line.substring(1).trim();
        }
        if (line.length > 0) {
          break;
        }
      }
    } catch {
      // ignore
    }
    return `<${path.basename(topicFile)}>`;
  }

  /**
   * Gathers all .md filenames from a TocElement[] recursively.
   */
  protected getAllTopicsFromDoc(tocElements: TocElement[]): string[] {
    const result: string[] = [];
    const traverse = (elements: TocElement[]) => {
      elements.forEach((e) => {
        result.push(e.topic);
        if (e.children && e.children.length > 0) {
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

  /**
   * Returns all topics by scanning each doc’s toc-elements and checking actual file existence on disk.
   */
  async getTopics(): Promise<Topic[]> {
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
        .filter((filePath) => filePath !== null)
        .map((existingPath) => ({
          name: path.basename(existingPath as string),
          path: existingPath as string,
        }));
    } catch (err: any) {
      vscode.window.showErrorMessage(`Error retrieving topics: ${err.message}`);
      throw err;
    }
  }

  /**
   * Checks if a file exists using workspace.fs.stat.
   */
  protected async fileExists(filePath: string): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Helper method to fetch the indentation settings from VS Code configuration.
   */
  protected async getIndentationSetting(): Promise<string> {
    const config = vscode.workspace.getConfiguration('editor');
    const tabSize = config.get<number>('tabSize', 4);
    const insertSpaces = config.get<boolean>('insertSpaces', true);
    return insertSpaces ? ' '.repeat(tabSize) : '\t';
  }

  /**
   * Writes a new .md file for the topic, if it doesn’t exist.
   */
  protected async writeTopicFile(newTopic: TocElement): Promise<void> {
    try {
      const topicsDir = this.getTopicsDir();
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(topicsDir));

      const filePath = path.join(topicsDir, newTopic.topic);
      if (await this.fileExists(filePath)) {
        vscode.window.showWarningMessage(`Topic file "${newTopic.topic}" already exists.`);
        return;
      }

      const wrote = await this.writeNewFile(filePath, `# ${newTopic.title}\n\nContent goes here...`);
      if (wrote) {
        await vscode.commands.executeCommand('authordExtension.openMarkdownFile', filePath);
      }
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to write topic file "${newTopic.topic}": ${err.message}`);
      throw err;
    }
  }
}
