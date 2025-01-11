import * as vscode from 'vscode';
import * as path from 'path';
import { InstanceConfig, TocElement, Topic } from '../utils/types';

export abstract class AbstractConfigManager {

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

  protected findDocById(docItem: string): InstanceConfig | undefined {
    return this.instances.find(d => d.id === docItem);
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
      this.writeConfig(doc);
      return true;
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to rename document "${docId}" -> "${newName}": ${err.message}`);
      return false;
    }
  }

  async moveTopics(docId: string, sourceTopicId: string, targetTopicId: string): Promise<TocElement[] | undefined> {
    if (sourceTopicId === targetTopicId) { return; }
    // 1) Find the document by ID
    const doc = this.findDocById(docId);
    if (!doc) {
      throw new Error(`Document "${docId}" not found for moveTopicInDoc.`);
    }
    // 2) Find the target node
    const targetTopic = await this.findTopicInDoc(doc['toc-elements'], targetTopicId, sourceTopicId);
    if (!targetTopic) {
      return; // Target not found
    }
    // Ensure targetTopic has children
    if (!(targetTopic as TocElement).children) {
      (targetTopic as TocElement).children = [];
    }

    // 3) Remove the source topic from doc’s toc-elements
    const sourceTopic = await this.removeTopicFromDoc(doc['toc-elements'], sourceTopicId);
    if (!sourceTopic) {
      return; // Source not found
    }



    (targetTopic as TocElement).children.push(sourceTopic);

    // 4) Write updates to the .tree file
    this.writeConfig(doc);
    return doc["toc-elements"];
  }
  /**
 * Opens the given Markdown file and replaces its first line with `# newTitle`.
 */
  async setMarkdownTitle(fileName: string, newTitle: string) {

    const filePath = path.join(this.getTopicsDir(), fileName);
    if (!this.fileExists(filePath)) {
      vscode.window.showErrorMessage('File not found or cannot be opened.');
      return;
    }
    try {

      const document = await vscode.workspace.openTextDocument(filePath);

      // Reveal the document in the active editor
      const editor = await vscode.window.showTextDocument(document);

      // Perform an edit operation
      await editor.edit(editBuilder => {
        if (document.lineCount > 0) {
          const firstLineRange = document.lineAt(0).range;
          editBuilder.replace(firstLineRange, `# ${newTitle}`);
        } else {
          // If the file is empty, just insert a new line
          editBuilder.insert(new vscode.Position(0, 0), `# ${newTitle}\n\n`);
        }
      });

      // Save the changes
      await document.save();

    } catch (error: any) {
      vscode.window.showErrorMessage(`Error setting markdown title in ${filePath}: ${error.message}`);
    }
  }

  /**
    * Renames a topic’s file on disk and updates .tree data accordingly.
    * Already returning Promise<boolean>, updated to unify error handling.
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
      // Generate the new filename if one wasn’t provided
      const newTopicFile = enteredFileName || this.formatTitleAsFilename(newName);
  
      // Convert to VS Code file URIs
      const oldFileUri = vscode.Uri.file(path.join(topicsDir, oldTopicFile));
      const newFileUri = vscode.Uri.file(path.join(topicsDir, newTopicFile));
      
      // Rename the file
    await vscode.workspace.fs.rename(oldFileUri, newFileUri);
      // If this doc only has one topic, update the start-page property
      if (doc['toc-elements'].length === 1) {
        doc['start-page'] = newTopicFile;
      }
  
      // After successful rename, update the in-memory TOC data
      topic.topic = newTopicFile;
      topic.title = newName;
  
      // Write back the updated doc config
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
     * Refactored to return Promise<boolean>.
     */
  async deleteTopic(docId: string, topicFileName: string): Promise<boolean> {
    try {
      const doc = this.findDocById(docId);
      if (!doc) {
        vscode.window.showWarningMessage(`Document "${docId}" not found.`);
        return false;
      }

      // Extract the topic (and its children)
      const extractedTopic = this.extractTopicByFilename(doc['toc-elements'], topicFileName);
      if (!extractedTopic) {
        vscode.window.showWarningMessage(`Topic "${topicFileName}" not found in document "${docId}".`);
        return false;
      }

      // Gather all .md files for this topic and its descendants
      const allTopics = this.getAllTopicsFromDoc([extractedTopic]);
      const topicsDir = this.getTopicsDir();

      // Perform all file deletions in parallel
      await Promise.all(
        allTopics.map((tFile) => this.deleteFileIfExists(path.join(topicsDir, tFile)))
      );

      // Update .tree
      if (await this.fileExists(path.join(topicsDir, topicFileName))) {
        vscode.window.showErrorMessage(`Failed to delete topic "${topicFileName}"`);
        return false;
      } else {
        this.writeConfig(doc);
        return true;
        
      }
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to delete topic "${topicFileName}": ${err.message}`);
      return false;
    }
  }


  /**
   * Adds a new topic -> writes .md -> updates .tree.
   * Refactored to return Promise<boolean>.
   */
  async addSiblingTopic(docItem: string, siblingTopic: string, newTopic: TocElement): Promise<boolean> {
    try {
      const doc = this.findDocById(docItem);
      if (!doc) {
        vscode.window.showWarningMessage(`Document "${docItem}" not found.`);
        return false;
      }



      // If doc lacks start-page, set it
      if (!doc['start-page']) {
        doc['start-page'] = newTopic.topic;
      }

      let tocElements: TocElement[] | undefined;

      tocElements = this.findSiblingsByFilename(doc['toc-elements'],siblingTopic);
      if (!tocElements) {
        vscode.window.showWarningMessage(`Parent topic "${siblingTopic}" not found.`);
        return false;
      }
      // Check for duplicates
      if (!tocElements!.some(t => t.title === newTopic.title)) {
        tocElements!.push(newTopic);
      }


      // Write the .md file
      await this.writeTopicFile(newTopic);

      // Update .tree
      if (await this.fileExists(path.join(this.getTopicsDir(), newTopic.topic))) {
        this.writeConfig(doc);
        return true;
      } else {
        vscode.window.showErrorMessage(`Failed to delete topic "${newTopic.title}"`);
        return false;
      }


    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to add topic "${newTopic.title}": ${err.message}`);
      return false;
    }
  }
  async SetasStartPage(docItem: string, siblingTopic: string): Promise<boolean> {
    try {
      const doc = this.findDocById(docItem);
      if (!doc) {
        vscode.window.showWarningMessage(`Document "${docItem}" not found.`);
        return false;
      }
      doc['start-page'] = siblingTopic;



      // Update config
      this.writeConfig(doc);
      return true;
    } catch (err: any) {
      vscode.window.showErrorMessage("Failed to set start page");
      return false;
    }
  }
  async addChildTopic(docItem: string, parentTopic: string | null, newTopic: TocElement): Promise<boolean> {
    try {
      const doc = this.findDocById(docItem);
      if (!doc) {
        vscode.window.showWarningMessage(`Document "${docItem}" not found.`);
        return false;
      }

      // Identify parent or root
      let parentArray;
      if (parentTopic) {
        const parent = this.findTopicByFilename(doc['toc-elements'], parentTopic);
        if (!parent) {
          vscode.window.showWarningMessage(`Parent topic "${parentTopic}" not found.`);
          return false;
        }
        parentArray = parent.children;
      } else {
        parentArray = doc['toc-elements'];
      }

      // push for root
      if (!parentTopic) {
        parentArray.push(newTopic);
      }

      // Write the .md file
      await this.writeTopicFile(newTopic);
      // Update .tree
      // Update .tree
      if (await this.fileExists(path.join(this.getTopicsDir(), newTopic.topic))) {
        this.writeConfig(doc);
        return true;
      } else {
        vscode.window.showErrorMessage(`Failed to add topic "${newTopic.title}"`);
        return false;
      }

    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to add topic "${newTopic.title}": ${err.message}`);
      return false;
    }
  }

  protected async removeTopicFromDoc(topics: TocElement[], topicId: string): Promise<TocElement | undefined> {
    for (let i = 0; i < topics.length; i++) {
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

  protected async findTopicInDoc(topics: TocElement[], targetTopicId: string, sourceTopicId: string): Promise<TocElement | boolean | undefined> {
    function hasTargetTopic(topic: TocElement, targetTopicId: string): boolean {
      // Check if this topic matches sourceTopicId and has the targetTopicId in its children
      if (topic.children.some(child => child.topic === targetTopicId)) {
        return true;
      }
      // Recursively check in children
      return topic.children.some(child => hasTargetTopic(child, targetTopicId));
    }
    for (const t of topics) {
      // check parent move to child
      if (t.topic === sourceTopicId && hasTargetTopic(t, targetTopicId)) { return false; }
      if (t.topic === targetTopicId) {
        // check child move to same parent
        if (t.children.some(child => child.topic === sourceTopicId)) { return false; }
        return t;
      }
      const childFound = await this.findTopicInDoc(t.children, targetTopicId, sourceTopicId);
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

  /**
   * Recursively searches `toc-elements` for a match by `t.topic === fileName`.
   */
  protected findTopicByFilename(topics: TocElement[], fileName: string): TocElement | undefined {
    for (const t of topics) {
      if (t.topic === fileName) {
        return t;
      }
      const found = this.findTopicByFilename(t.children, fileName);
      if (found) { return found; }
    }
    return undefined;
  }
  protected findSiblingsByFilename(topics: TocElement[], fileName: string): TocElement[] | undefined {
    for (const t of topics) {
      if (t.topic === fileName) {
        return topics;
      }
      const found = this.findSiblingsByFilename(t.children, fileName);
      if (found) { return found; }
    }
    return undefined;
  }
  /**
    * Reads a file as string using workspace.fs.
    */
  protected async readFileAsString(filePath: string): Promise<string> {
    try {
      // Check if the file exists
      await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
      // Read the file and return its contents as a UTF-8 string
      const data = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
      return Buffer.from(data).toString('utf-8');
    } catch (error: any) {
      vscode.window.showErrorMessage(`Error reading file "${filePath}": ${error.message}`);
      throw new Error(`File "${filePath}" does not exist or cannot be read.`);
    }
  }
  protected async getMdTitle(topicFile: string): Promise<string> {
    try {
      const topicsDir = this.getTopicsDir();
      const mdFilePath = path.join(topicsDir, topicFile);

      // Read the .md file contents
      const content = await this.readFileAsString(mdFilePath);

      // Look for the first heading in the file
      const lines = content.split('\n');
      for (let line of lines) {
        line = line.trim();
        if (line.startsWith('# ')) {
          // Strip out any leading '#' characters and extra spaces
          // return line.replace(/^#+\s*/, '').trim();
          return line.substring(1).trim();
        } else if (line.length > 0) {
          break; // if not empty line -> break
        }
      }
    } catch {
      // If file not found or no heading, we ignore and fall back
    }

    // Fallback to the base filename if no heading is available
    return `<${path.basename(topicFile)}>`;
  }

  /**
   * Gathers all .md filenames from a TocElement[] recursively.
   */
  protected getAllTopicsFromDoc(tocElements: TocElement[]): string[] {
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

  protected formatTitleAsFilename(title: string): string {
    return title.trim().toLowerCase().replace(/\s+/g, '-') + '.md';
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

    // First, gather all topics (sync in-memory traversal; no awaits here)
    const traverseElements = (elements: TocElement[]) => {
      for (const e of elements) {
        allFilePaths.push(path.join(topicsDir, e.topic));
        if (e.children && e.children.length > 0) {
          traverseElements(e.children);
        }
      }
    };

    try {
      for (const doc of this.instances) {
        traverseElements(doc['toc-elements']);
      }

      // Check file existence in parallel
      const checkResults = await Promise.all(
        allFilePaths.map(async (filePath) => {
          if (await this.fileExists(filePath)) {
            return filePath;
          }
          return null;
        })
      );

      // Filter out nulls and build Topic objects
      const topics = checkResults
        .filter((filePath) => filePath !== null)
        .map((existingPath) => ({
          name: path.basename(existingPath as string),
          path: existingPath as string,
        }));

      return topics;
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

      const write = await this.writeNewFile(filePath, `# ${newTopic.title}\n\nContent goes here...`);
      if (write) {
        await vscode.commands.executeCommand(
          'authordExtension.openMarkdownFile',
          filePath
        );
      }
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to write topic file "${newTopic.topic}": ${err.message}`);
      throw err;
    }
  }
}