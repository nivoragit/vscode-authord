// eslint-disable-next-line import/no-unresolved
import * as vscode from 'vscode';
import * as path from 'path';
import { ConfigObject } from '../config/ConfigObjects';
import { ConfigProvider } from '../config/ConfigProvider';
import { InstanceConfig, TocElement } from '../utils/types';

export default abstract class AbstractConfigManager<T extends ConfigObject> {
  protected provider: ConfigProvider<T>;

  protected config: T | null = null;

  protected instances: InstanceConfig[] = [];

  constructor(provider: ConfigProvider<T>) {
    // Explicitly assign in constructor body to avoid "no-useless-constructor" and "no-empty-function" warnings.
    this.provider = provider;
  }

  /**
   * Re-reads the config from the provider, then loads `this.instances`.
   */
  public async refresh(): Promise<void> {
    this.config = await this.provider.read();
    this.loadInstancesFromConfig();
  }

  /**
   * Subclass must implement how to transform `this.config` into `this.instances`.
   * (e.g., reading `ihp.instance` or `config.instances`), then call `buildParentReferences(...)`.
   */
  protected abstract loadInstancesFromConfig(): void;

  /**
   * Persists any changes back to the provider.
   */
  protected async saveConfig(): Promise<void> {
    if (this.config) {
      await this.provider.write(this.config);
    }
  }

  public getDocuments(): InstanceConfig[] {
    return this.instances;
  }

  protected findDocById(docId: string): InstanceConfig | undefined {
    return this.instances.find((d) => d.id === docId);
  }

  // ------------------------------------------------------------------
  // Domain Methods (Examples)
  // ------------------------------------------------------------------

  public async renameDocument(docId: string, newName: string): Promise<boolean> {
    try {
      const doc = this.findDocById(docId);
      if (!doc) {
        vscode.window.showErrorMessage(`Document "${docId}" not found for rename.`);
        return false;
      }
      doc.name = newName;
      await this.saveConfig();
      return true;
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to rename document "${docId}": ${err.message}`);
      return false;
    }
  }

  /**
   * Moves a topic from its current location under a new target topic.
   */
  public async moveTopics(docId: string, sourceTopicId: string, targetTopicId: string): Promise<TocElement[]> {
    try {
      if (sourceTopicId === targetTopicId) return [];

      const doc = this.findDocById(docId);
      if (!doc) {
        throw new Error(`Document "${docId}" not found for moveTopics.`);
      }

      // Locate target and source
      const targetTopic = this.findTopicByFilename(doc['toc-elements'], targetTopicId);
      if (!targetTopic) {
        return [];
      }
      const sourceTopic = this.removeTopicFromDoc(doc['toc-elements'], sourceTopicId);
      if (!sourceTopic) {
        return [];
      }

      // Reassign parent / children
      targetTopic.children.push(sourceTopic);
      // eslint-disable-next-line no-param-reassign
      sourceTopic.parent = targetTopic;

      await this.saveConfig();
      return doc['toc-elements'];
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to move topics: ${err.message}`);
      throw err;
    }
  }

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
      // You might also delete the .md files on disk here if needed...
      await this.saveConfig();
      return true;
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to delete topic "${topicFileName}": ${err.message}`);
      return false;
    }
  }

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

      // locate topic
      const topic = this.findTopicByFilename(doc['toc-elements'], oldTopicFile);
      if (!topic) {
        vscode.window.showErrorMessage(`Topic "${oldTopicFile}" not found in doc "${docId}".`);
        return false;
      }

      // rename logic (in-memory)
      const newTopicFile = enteredFileName || AbstractConfigManager.formatTitleAsFilename(newName);
      topic.title = newName;
      topic.topic = newTopicFile;

      // if doc has only one topic, automatically update 'start-page'
      if (doc['toc-elements'].length === 1) {
        doc['start-page'] = newTopicFile;
      }

      // possibly rename the actual markdown file on disk if needed
      const topicsDir = this.getTopicsDir();
      const oldFilePath = path.join(topicsDir, oldTopicFile);
      const newFilePath = path.join(topicsDir, newTopicFile);
      await AbstractConfigManager.renameFileIfExists(oldFilePath, newFilePath);

      await this.saveConfig();
      return true;
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to rename topic "${oldTopicFile}" to "${newName}": ${err.message}`);
      return false;
    }
  }

  /**
   * Adds a new child topic under `parentTopicId`. 
   * If `parentTopicId` is null or not found, adds to root of doc.
   */
  public async addChildTopic(
    docId: string,
    parentTopicId: string | null,
    newTopic: TocElement
  ): Promise<boolean> {
    try {
      const doc = this.findDocById(docId);
      if (!doc) {
        vscode.window.showWarningMessage(`Document "${docId}" not found.`);
        return false;
      }

      let parentNode: TocElement | undefined;
      if (parentTopicId) {
        parentNode = this.findTopicByFilename(doc['toc-elements'], parentTopicId);
        if (!parentNode) {
          vscode.window.showWarningMessage(`Parent topic "${parentTopicId}" not found.`);
          return false;
        }
      }

      if (parentNode) {
        parentNode.children.push(newTopic);
        // eslint-disable-next-line no-param-reassign
        newTopic.parent = parentNode;
      } else {
        doc['toc-elements'].push(newTopic);
        // eslint-disable-next-line no-param-reassign
        newTopic.parent = undefined;
      }

      await this.saveConfig();
      return true;
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to add child topic: ${err.message}`);
      return false;
    }
  }

  /**
   * Adds `newTopic` as a sibling to `siblingTopicId`. 
   * Internally calls `addChildTopic` on the sibling’s parent.
   */
  public async addSiblingTopic(
    docId: string,
    siblingTopicId: string,
    newTopic: TocElement
  ): Promise<boolean> {
    try {
      const doc = this.findDocById(docId);
      if (!doc) {
        vscode.window.showWarningMessage(`Document "${docId}" not found.`);
        return false;
      }
      const siblingElem = this.findTopicByFilename(doc['toc-elements'], siblingTopicId);
      if (!siblingElem) {
        vscode.window.showWarningMessage(`Sibling topic "${siblingTopicId}" not found in doc "${docId}".`);
        return false;
      }
      const {parent} = siblingElem;
      const parentId = parent ? parent.topic : null;

      return this.addChildTopic(docId, parentId, newTopic);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to add sibling topic: ${err.message}`);
      return false;
    }
  }

  public async setAsStartPage(docId: string, topicFileName: string): Promise<boolean> {
    try {
      const doc = this.findDocById(docId);
      if (!doc) {
        vscode.window.showWarningMessage(`Document "${docId}" not found.`);
        return false;
      }
      // Verify the topic actually exists
      const topic = this.findTopicByFilename(doc['toc-elements'], topicFileName);
      if (!topic) {
        vscode.window.showWarningMessage(`Topic "${topicFileName}" not found in doc "${docId}".`);
        return false;
      }

      // Set the doc’s start-page
      doc['start-page'] = topicFileName;

      await this.saveConfig();
      return true;
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to set start page: ${err.message}`);
      return false;
    }
  }

  // ------------------------------------------------------------------
  // Utility Methods
  // ------------------------------------------------------------------

  /**
   * Recursively sets `elem.parent = parent` using array iteration.
   */
  protected buildParentReferences(elements: TocElement[], parent?: TocElement): void {
    elements.forEach((elem) => {
      // eslint-disable-next-line no-param-reassign
      elem.parent = parent;
      this.buildParentReferences(elem.children, elem);
    });
  }

  /**
   * Removes a topic from the given array (and sub-children) by `topicId`. 
   * Returns the removed TocElement, or undefined if not found.
   */
  protected removeTopicFromDoc(topics: TocElement[], topicId: string): TocElement | undefined {
    const index = topics.findIndex((t) => t.topic === topicId);
    if (index !== -1) {
      // eslint-disable-next-line prefer-destructuring
      const [removed] = topics.splice(index, 1);
      // eslint-disable-next-line no-param-reassign
      removed.parent = undefined;
      return removed;
    }

    let childRemoved: TocElement | undefined;
    topics.some((topic) => {
      childRemoved = this.removeTopicFromDoc(topic.children, topicId);
      return !!childRemoved;
    });
    return childRemoved;
  }

  /**
   * Recursively finds a topic by `topic === fileName`, or returns undefined if not found.
   */
  protected findTopicByFilename(topics: TocElement[], fileName: string): TocElement | undefined {
    let foundTopic: TocElement | undefined;
    topics.some((t) => {
      if (t.topic === fileName) {
        foundTopic = t;
        return true;
      }
      const found = this.findTopicByFilename(t.children, fileName);
      if (found) {
        foundTopic = found;
        return true;
      }
      return false;
    });
    return foundTopic;
  }

  /**
   * Removes the topic from the array (and sub-children) by filename, returning the extracted topic or null.
   */
  protected extractTopicByFilename(topics: TocElement[], fileName: string): TocElement | null {
    const idx = topics.findIndex((t) => t.topic === fileName);
    if (idx > -1) {
      // eslint-disable-next-line prefer-destructuring
      const [removed] = topics.splice(idx, 1);
      // eslint-disable-next-line no-param-reassign
      removed.parent = undefined;
      return removed;
    }

    let extractedTopic: TocElement | null = null;
    topics.some((t) => {
      const extracted = this.extractTopicByFilename(t.children, fileName);
      if (extracted) {
        extractedTopic = extracted;
        return true;
      }
      return false;
    });
    return extractedTopic;
  }

  /**
   * Example utility for renaming a file on disk if it exists (marked static to avoid "class-methods-use-this" lint error).
   */
  protected static async renameFileIfExists(oldPath: string, newPath: string) {
    const oldUri = vscode.Uri.file(oldPath);
    const newUri = vscode.Uri.file(newPath);

    try {
      // If file doesn't exist, no big deal. Otherwise rename it.
      await vscode.workspace.fs.stat(oldUri); // checks existence
      await vscode.workspace.fs.rename(oldUri, newUri);
    } catch {
      // ignore if file doesn't exist
    }
  }

  /**
   * Formats the given title string as a valid .md filename (static to avoid "class-methods-use-this").
   */
  protected static formatTitleAsFilename(title: string): string {
    return `${title.trim().toLowerCase().replace(/\s+/g, '-')}.md`;
  }

  public abstract getTopicsDir(): string;

  public abstract getImageDir(): string;

  public abstract addDocument(newDocument: InstanceConfig): Promise<boolean>;

  public abstract deleteDocument(docId: string): Promise<boolean>;

  public abstract validateAgainstSchema(schemaPath: string): Promise<void>;
}
