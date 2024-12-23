import { AbstractConfigManager, InstanceConfig, TocElement, Topic } from './abstractConfigManager';
import { Authord } from '../authordExtension';
import * as vscode from 'vscode';
import { promises as fs } from 'fs'; // Use fs.promises for async operations
import * as path from 'path';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import Ajv from 'ajv';

export class XMLConfigurationManager extends AbstractConfigManager {
  moveTopic(_docId: string, _topicId: string, _newParentId: string | null): void {
    throw new Error('Method not implemented.');
  }

  private treeFileName: string = '';
  instances: InstanceConfig[] = [];
  private ihpData: any;

  constructor(configPath: string) {
    super(configPath);

    // Immediately invoke an async IIFE to handle asynchronous init within constructor
    (async () => {
      await this.refresh();
      this.instances = await this.loadInstances();
    })().catch(err => {
      vscode.window.showErrorMessage(`Failed to initialize XMLConfigurationManager: ${err}`);
    });
  }

  /**
   * If a .tree file name is set (via addDocument), we set up watchers for it.
   */
  public setupWatchers(InitializeExtension: Authord): void {
    if (this.treeFileName) {
      InitializeExtension.setupWatchers(this.treeFileName);
      this.treeFileName = '';
    }
  }

  /**
   * Re-loads ihpData from XML file and refreshes local state, including `this.instances`.
   */
  public async refresh(): Promise<void> {
    this.ihpData = await this.readIhpFile();
    this.instances = await this.loadInstances();
  }

  /**
   * Returns all topics across all instances by scanning their toc-elements and checking the file system.
   * Uses async fs calls for the most efficient approach.
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
          // File doesn't exist, ignore
        }
        if (e.children && e.children.length > 0) {
          await traverseElements(e.children);
        }
      }
    };

    for (const doc of this.instances) {
      await traverseElements(doc['toc-elements']);
    }

    return topics;
  }

  /**
   * Returns the directory of the .ihp file.
   */
  private getIhpDir(): string {
    return path.dirname(this.configPath);
  }

  /**
   * Returns the absolute path to the topics directory. If none found, defaults to `topics`.
   */
  public getTopicsDir(): string {
    const ihp = this.ihpData?.ihp;
    return path.join(
      this.getIhpDir(),
      ihp?.topics && ihp.topics['@_dir'] ? ihp.topics['@_dir'] : 'topics'
    );
  }

  /**
   * Reads and parses the main .ihp file asynchronously. If the file doesn't exist, writes a default template.
   */
  private async readIhpFile(): Promise<any> {
    const parser = new XMLParser({ ignoreAttributes: false });
    try {
      await fs.access(this.configPath);
    } catch {
      // File does not exist, create a default IHP file
      const defaultIhp = `<?xml version="1.0" encoding="UTF-8"?>
<ihp version="2.0">
  <topics dir="topics"/>
</ihp>`;
      await fs.writeFile(this.configPath, defaultIhp, 'utf-8');
    }
    const raw = await fs.readFile(this.configPath, 'utf-8');
    return parser.parse(raw);
  }

  /**
   * Writes the updated ihpData back to the .ihp file asynchronously.
   */
  private async writeIhpFile(): Promise<void> {
    const builder = new XMLBuilder({ ignoreAttributes: false });
    const xmlContent = builder.build(this.ihpData);
    await fs.writeFile(this.configPath, xmlContent, 'utf-8');
  }

  /**
   * Loads instances by reading each instance's .tree file (if present).
   * Uses async fs calls for the most efficient approach.
   */
  public async loadInstances(): Promise<InstanceConfig[]> {
    const instances: InstanceConfig[] = [];
    const ihp = this.ihpData?.ihp;
    const instancesNodes = Array.isArray(ihp?.instance)
      ? ihp.instance
      : ihp?.instance
        ? [ihp.instance]
        : [];

    for (const inst of instancesNodes) {
      if (inst['@_src']) {
        const treeFile = path.join(this.getIhpDir(), inst['@_src']);
        try {
          await fs.access(treeFile);
          const instanceProfile = await this.readInstanceProfile(treeFile);
          if (instanceProfile) {
            instances.push(instanceProfile);
          }
        } catch {
          // .tree file doesn't exist or is unreadable; skip
        }
      }
    }
    return instances;
  }

  /**
   * Reads a single .tree file, extracts instance-profile data, and returns an `InstanceConfig`.
   */
  private async readInstanceProfile(treeFile: string): Promise<InstanceConfig | null> {
    const parser = new XMLParser({ ignoreAttributes: false });
    const raw = await fs.readFile(treeFile, 'utf-8');
    const data = parser.parse(raw);
    const profile = data['instance-profile'];
    if (!profile) { return null; }

    const docId = profile['@_id'];
    const name = profile['@_name'] || profile['@_id'] || 'Untitled';
    const startPage = profile['@_start-page'] || '';
    const tocElements: TocElement[] = this.loadTocElements(profile['toc-element'] || []);

    return {
      id: docId,
      name,
      'start-page': startPage,
      'toc-elements': tocElements
    };
  }

  /**
   * Converts XML toc-elements into our TocElement interface recursively.
   * (Uses a sync approach to map child elements, but reading .tree file is async.)
   */
  private loadTocElements(xmlElements: any): TocElement[] {
    if (!Array.isArray(xmlElements)) {
      xmlElements = xmlElements ? [xmlElements] : [];
    }
    return xmlElements.map((elem: any) => {
      const topicFile = elem['@_topic'];
      const children = this.loadTocElements(elem['toc-element'] || []);
      return {
        topic: topicFile,
        title: path.basename(topicFile, '.md'),
        sortChildren: 'none',
        children
      } as TocElement;
    });
  }

  /**
   * Writes updated instance-profile data to the .tree file for a specific doc.
   */
  private async writeInstanceProfile(doc: InstanceConfig): Promise<void> {
    const builder = new XMLBuilder({ ignoreAttributes: false });
    const treeFile = this.getTreeFileForDoc(doc.id);

    let startPage = '';
    if (doc['toc-elements'].length !== 0) {
      startPage = doc['start-page'];
    }

    const profileObj = {
      'instance-profile': {
        '@_id': doc.id,
        '@_name': doc.name,
        '@_start-page': startPage,
        'toc-element': this.buildTocElements(doc['toc-elements'])
      }
    };

    let xmlContent = builder.build(profileObj);
    const doctype = `<?xml version="1.0" encoding="UTF-8"?>
  <!DOCTYPE instance-profile SYSTEM "https://resources.jetbrains.com/writerside/1.0/product-profile.dtd">\n\n`;
    xmlContent = doctype + xmlContent;

    await fs.writeFile(treeFile, xmlContent, 'utf-8');
  }

  /**
   * Recursively builds XML elements from our TocElement data.
   */
  private buildTocElements(elements: TocElement[]): any[] {
    return elements.map(e => {
      const result: any = { '@_topic': e.topic };
      if (e.children && e.children.length > 0) {
        result['toc-element'] = this.buildTocElements(e.children);
      }
      return result;
    });
  }

  /**
   * Finds the .tree file corresponding to a given docId by reading each instance in ihpData.
   * Here we still do a synchronous file check (`fs.existsSync`) to locate the correct .tree.
   */
  private getTreeFileForDoc(docId: string): string {
    const ihp = this.ihpData.ihp;
    const instancesNodes = Array.isArray(ihp.instance)
      ? ihp.instance
      : ihp.instance
        ? [ihp.instance]
        : [];

    for (const inst of instancesNodes) {
      const treeSrc = inst['@_src'];
      if (!treeSrc) { continue; }
      const treeFile = path.join(this.getIhpDir(), treeSrc);

      // If it doesn't exist, skip
      if (!require('fs').existsSync(treeFile)) { continue; }

      const parser = new XMLParser({ ignoreAttributes: false });
      const raw = require('fs').readFileSync(treeFile, 'utf-8');
      const data = parser.parse(raw);
      const profile = data['instance-profile'];
      if (profile && profile['@_id'] === docId) {
        return treeFile;
      }
    }
    throw new Error(`No .tree file found for docId ${docId}`);
  }

  // ----------------- Document Methods ----------------- //

  /**
   * Creates a new document by generating a new .tree file and adding it to the main .ihp data.
   */
  public async addDocument(newDocument: InstanceConfig): Promise<void> {
    this.treeFileName = `${newDocument.id}.tree`;
    const treeFilePath = path.join(this.getIhpDir(), this.treeFileName);

    const profileObj = {
      'instance-profile': {
        '@_id': newDocument.id,
        '@_name': newDocument.name,
        '@_start-page': newDocument['start-page'],
        'toc-element': []
      }
    };

    const builder = new XMLBuilder({ ignoreAttributes: false });
    let xmlContent = builder.build(profileObj);
    const doctype = `<?xml version="1.0" encoding="UTF-8"?>
  <!DOCTYPE instance-profile SYSTEM "https://resources.jetbrains.com/writerside/1.0/product-profile.dtd">\n\n`;
    xmlContent = doctype + xmlContent;

    await fs.writeFile(treeFilePath, xmlContent, 'utf-8');

    // Make sure the `instance` property is an array
    if (!this.ihpData.ihp.instance) {
      this.ihpData.ihp.instance = [];
    } else if (!Array.isArray(this.ihpData.ihp.instance)) {
      this.ihpData.ihp.instance = [this.ihpData.ihp.instance];
    }

    this.ihpData.ihp.instance.push({ '@_src': this.treeFileName });
    await this.writeIhpFile();
    this.instances.push(newDocument);
  }

  /**
   * Deletes a document by removing its .tree file and associated topics from disk, then updating the main .ihp.
   */
  public async deleteDocument(docId: string): Promise<void> {
    const ihp = this.ihpData.ihp;
    if (ihp.instance) {
      if (!Array.isArray(ihp.instance)) {
        ihp.instance = [ihp.instance];
      }

      const idx = await this.findDocumentIndex(ihp.instance, docId);
      if (idx > -1) {
        const treeSrc = ihp.instance[idx]['@_src'];

        // Find the doc in memory
        const doc = this.instances.find(d => d.id === docId);
        if (doc) {
          // Delete all topics associated with this doc
          const allTopics = this.getAllTopicsFromDoc(doc['toc-elements']);
          const topicsDir = this.getTopicsDir();
          for (const topicFileName of allTopics) {
            const topicFilePath = path.join(topicsDir, topicFileName);
            try {
              await fs.unlink(topicFilePath);
            } catch {
              // If topic file doesn't exist or can't be removed, ignore
            }
          }
        }

        ihp.instance.splice(idx, 1);
        await this.writeIhpFile();

        const treeFilePath = path.join(this.getIhpDir(), treeSrc);
        try {
          await fs.unlink(treeFilePath);
        } catch {
          // If it doesn't exist or can't be removed, ignore
        }

        this.instances = this.instances.filter(d => d.id !== docId);
      }
    }
  }

  private getAllTopicsFromDoc(tocElements: TocElement[]): string[] {
    const result: string[] = [];
    const traverse = (elements: TocElement[]) => {
      for (const e of elements) {
        result.push(e.topic); // Add the current topic file name
        if (e.children && e.children.length > 0) {
          traverse(e.children); // Recursively traverse child elements
        }
      }
    };
    traverse(tocElements);
    return result;
  }

  /**
   * Helper function to find document index by docId inside the .ihp instance array.
   * Uses async file reads to parse each .tree file and check if it matches the docId.
   */
  private async findDocumentIndex(instances: any[], docId: string): Promise<number> {
    const parser = new XMLParser({ ignoreAttributes: false });
    for (let i = 0; i < instances.length; i++) {
      const src = instances[i]['@_src'];
      if (!src) { continue; }

      const treeFile = path.join(this.getIhpDir(), src);
      try {
        await fs.access(treeFile);
        const raw = await fs.readFile(treeFile, 'utf-8');
        const data = parser.parse(raw);
        const profile = data['instance-profile'];
        if (profile && profile['@_id'] === docId) {
          return i;
        }
      } catch {
        // If file doesn't exist or can't be read, skip
      }
    }
    return -1;
  }

  /**
   * Renames a document by updating the `@_name` field in its .tree file.
   */
  public async renameDocument(docName: string, newName: string): Promise<void> {
    const doc = this.instances.find(d => d.name === docName);
    if (!doc) { return; }
    doc.name = newName;
    await this.writeInstanceProfile(doc);
  }

  /**
   * Returns the array of docs currently loaded in `this.instances`.
   */
  public getDocuments(): InstanceConfig[] {
    return this.instances;
  }

  // ----------------- Topics Methods ----------------- //

  /**
   * Adds a new topic to the specified doc. Also writes a .md file to `topicsDir`.
   */
  public async addTopic(docItem: string, parentTopic: string | null, newTopic: TocElement): Promise<void> {
    const doc = this.instances.find(d => d.id === docItem);
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
      vscode.window.showErrorMessage(`Failed to create topics directory.`);
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

    // Check for duplicate titles within the parent
    if (parentArray.some(t => t.title === newTopic.title)) {
      // Attempt to confirm if it's truly a duplicate inside the .tree file
      const treeFilePath = this.getTreeFileForDoc(docItem);
      try {
        await fs.access(treeFilePath);
        const parser = new XMLParser({ ignoreAttributes: false });
        const rawTreeData = await fs.readFile(treeFilePath, 'utf-8');
        const treeData = parser.parse(rawTreeData);
        const topicInTree = this.findTopicInTree(treeData['instance-profile']['toc-element'], newTopic.title);
        if (topicInTree) {
          console.error(`Duplicate topic title "${newTopic.title}" in parent.`);
          vscode.window.showWarningMessage(`Duplicate topic title "${newTopic.title}" in parent.`);
          return;
        }
      } catch {
        // If treeFile missing or no duplication found, proceed
      }
    } else {
      parentArray.push(newTopic);
    }

    try {
      await this.writeInstanceProfile(doc);
    } catch (err) {
      console.error(`Failed to update .tree file for "${doc.id}": ${err}`);
      vscode.window.showErrorMessage(`Failed to update document tree.`);
      return;
    }

    vscode.window.showInformationMessage(`Topic "${newTopic.title}" added successfully.`);
  }

  /**
   * Recursively checks if a topic with the given `title` exists in the parsed XML tree.
   */
  private findTopicInTree(treeElements: any[], title: string): boolean {
    for (const element of treeElements) {
      if (element['@_title'] === title) {
        return true;
      }
      if (element['toc-element'] && Array.isArray(element['toc-element'])) {
        if (this.findTopicInTree(element['toc-element'], title)) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Deletes a topic (and its children) by removing the corresponding .md files from disk and updating .tree data.
   */
  public async deleteTopic(docId: string, topicFileName: string): Promise<void> {
    const doc = this.instances.find(d => d.id === docId);
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

    // Gather all topic files (this topic + children)
    const allTopics = this.getAllTopicsFromDoc([extractedTopic]);
    const topicsDir = this.getTopicsDir();

    for (const tFile of allTopics) {
      const topicFilePath = path.join(topicsDir, tFile);
      try {
        await fs.unlink(topicFilePath);
      } catch {
        // It's okay if the file didn't exist
      }
    }

    try {
      await this.writeInstanceProfile(doc);
    } catch (err) {
      console.error(`Failed to update .tree file for "${doc.id}": ${err}`);
      vscode.window.showErrorMessage(`Failed to update document tree.`);
    }
  }

  /**
   * Renames a topic by renaming its .md file and updating the .tree data for that topic.
   */
  public async renameTopic(docId: string, oldTopicFile: string, newName: string): Promise<void> {
    const doc = this.instances.find(d => d.id === docId);
    if (!doc) { return; }

    const topic = this.findTopicByFilename(doc['toc-elements'], oldTopicFile);
    if (topic) {
      const topicsDir = this.getTopicsDir();
      const newTopicFile = this.formatTitleAsFilename(newName);
      const oldFilePath = path.join(topicsDir, oldTopicFile);
      const newFilePath = path.join(topicsDir, newTopicFile);

      if (!(await this.fileExists(oldFilePath))) {
        console.log(`Original file ${oldTopicFile} not found.`);
        return;
      }
      if (await this.fileExists(newFilePath)) {
        console.log('already exists');
        return;
      }

      await this.renamePath(oldFilePath, newFilePath);
      topic.topic = newTopicFile;
      topic.title = newName;
      await this.writeInstanceProfile(doc);
    }
  }

  /**
   * Recursively searches toc-elements by `t.title` for a match with `fileName`.
   */
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

  /**
   * Extracts a topic from the doc's `toc-elements` array and returns it. If not found, returns null.
   */
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

  /**
   * Formats a title into a safe filename by lowercasing and replacing spaces with hyphens.
   */
  private formatTitleAsFilename(title: string): string {
    return title.toLowerCase().replace(/\s+/g, '-') + '.md';
  }

  // -------------------- Async File Handling Helpers -------------------- //

  public async createDirectory(dirPath: string): Promise<void> {
    try {
      await fs.mkdir(dirPath, { recursive: true });
    } catch (err) {
      throw new Error(`Failed to create directory "${dirPath}": ${err}`);
    }
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
   * Moves a folder to a trash directory, merging folders if collisions occur.
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
      // Remove source folder once merged
      await fs.rm(folderPath, { recursive: true, force: true });
    } catch {
      // If the destination does not exist, rename
      await fs.rename(folderPath, destinationPath);
    }
  }

  /**
   * Recursively merges folders, renaming files with timestamps when collisions occur.
   */
  public async mergeFolders(source: string, destination: string): Promise<void> {
    let sourceFiles: string[] = [];
    try {
      sourceFiles = await fs.readdir(source);
    } catch {
      // If the source can't be read, skip
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
          // If file exists, rename with a unique timestamp
          const newFileName = `${path.basename(file, path.extname(file))}-${Date.now()}${path.extname(file)}`;
          const newDestinationFilePath = path.join(destination, newFileName);
          await fs.rename(sourceFilePath, newDestinationFilePath);
        } catch {
          // If destination doesn't exist, rename directly
          await fs.rename(sourceFilePath, destinationFilePath);
        }
      }
    }
  }

  /**
   * Validates the loaded config against a JSON schema using Ajv.
   * Reads the schema file asynchronously for the most efficient approach.
   */
  public async validateAgainstSchema(schemaPath: string): Promise<void> {
    const ihp = this.ihpData.ihp;
    const topicsDir = ihp.topics['@_dir'];

    let imagesObj: any;
    if (ihp.images) {
      imagesObj = {
        dir: ihp.images['@_dir'],
        version: ihp.images['@_version'],
        'web-path': ihp.images['@_web-path']
      };
    }

    const configJson = {
      schema: this.ihpData.schema,
      title: this.ihpData.title,
      type: this.ihpData.type,
      topics: { dir: topicsDir },
      images: imagesObj,
      instances: this.instances.map(inst => ({
        id: inst.id,
        name: inst.name,
        'start-page': inst['start-page'],
        'toc-elements': this.convertTocElements(inst['toc-elements'])
      }))
    };

    const ajv = new Ajv({ allErrors: true });
    const schemaRaw = await fs.readFile(schemaPath, 'utf-8');
    const schema = JSON.parse(schemaRaw);
    const validate = ajv.compile(schema);
    const valid = validate(configJson);

    if (!valid) {
      const errors = validate.errors || [];
      throw new Error(`Schema validation failed: ${JSON.stringify(errors, null, 2)}`);
    }
  }

  /**
   * Recursively converts our TocElement[] into a JSON structure for writing back to .tree/.ihp.
   */
  private convertTocElements(elements: TocElement[]): any[] {
    return elements.map(e => ({
      topic: e.topic,
      title: e.title,
      'sort-children': e.sortChildren,
      children: this.convertTocElements(e.children)
    }));
  }
}
