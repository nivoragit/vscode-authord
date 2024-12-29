import { AbstractConfigManager, InstanceConfig, TocElement, Topic } from './abstractConfigManager';
import * as vscode from 'vscode';
import * as path from 'path';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import Ajv from 'ajv';
import { Authord } from '../authordExtension';

export class XMLConfigurationManager extends AbstractConfigManager {
  moveTopic(_docId: string, _topicId: string, _newParentId: string | null): void {
    throw new Error('Method not implemented.');
  }

  private treeFileName: string = '';
  instances: InstanceConfig[] = [];
  private ihpData: any;

  constructor(configPath: string) {
    super(configPath);
  }

  /**
   * If a .tree file name is set (via addDocument), set up watchers for it.
   */
  setupWatchers(InitializeExtension: Authord): void {
    if (this.treeFileName) {
      InitializeExtension.setupWatchers(this.treeFileName);
      this.treeFileName = '';
    }
  }

  /**
   * Reload ihpData from XML file and refresh local state, including this.instances.
   */
  async refresh(): Promise<void> {
    this.ihpData = await this.readIhpFile();
    await this.loadInstances();
  }

  /**
   * Returns all topics by scanning each doc’s toc-elements and checking actual file existence on disk.
   */
  async getTopics(): Promise<Topic[]> {
    const topics: Topic[] = [];
    const topicsDir = this.getTopicsDir();

    // Recursively traverse elements
    const traverseElements = async (elements: TocElement[]) => {
      for (const e of elements) {
        const filePath = path.join(topicsDir, e.topic);
        try {
          await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
          topics.push({ name: path.basename(filePath), path: filePath });
        } catch {
          // If missing, ignore
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
   * Returns the directory path of the .ihp file.
   */
  private getIhpDir(): string {
    return path.dirname(this.configPath);
  }

  /**
   * Returns absolute path to the topics directory, or 'topics' if not set.
   */
  getTopicsDir(): string {
    const ihp = this.ihpData?.ihp;
    return path.join(
      this.getIhpDir(),
      ihp?.topics && ihp.topics['@_dir'] ? ihp.topics['@_dir'] : 'topics'
    );
  }

  getImageDir(): string {
    const ihp = this.ihpData?.ihp;
    return path.join(
      this.getIhpDir(),
      ihp?.images && ihp.images['@_dir'] ? ihp.images['@_dir'] : 'images'
    );
  }

  /**
   * Reads the .ihp file as XML. If missing, create a minimal default.
   */
  private async readIhpFile(): Promise<any> {
    const fileExists = await this.fileExists(this.configPath);
    if (!fileExists) {
      const defaultIhp = `<?xml version="1.0" encoding="UTF-8"?>
<ihp version="2.0">
  <topics dir="topics"/>
</ihp>`;
      await this.writeNewFile(this.configPath, defaultIhp);
    }
    const raw = await this.readFileAsString(this.configPath);
    const parser = new XMLParser({ ignoreAttributes: false });
    return parser.parse(raw);
  }

  /**
   * Writes updated ihpData back to the main .ihp file, preserving indentation.
   */
  private async writeIhpFile(): Promise<void> {
    await this.updateXmlFile(this.configPath, () => {
      // Return the mutated this.ihpData to be re-serialized
      return this.ihpData;
    });
  }

  // ------------------------------------------------------------------------------------
  // LOADING INSTANCES + .tree FILES
  // ------------------------------------------------------------------------------------

  /**
   * Reads each instance’s .tree file (if any) to build this.instances.
   */
  async loadInstances(): Promise<void> {
    const ihp = this.ihpData?.ihp;
    const array = Array.isArray(ihp?.instance) ? ihp.instance : ihp?.instance ? [ihp.instance] : [];
    const result: InstanceConfig[] = [];

    for (const inst of array) {
      if (inst['@_src']) {
        const treeFile = path.join(this.getIhpDir(), inst['@_src']);
        // If .tree is missing or unreadable, skip
        if (await this.fileExists(treeFile)) {
          const instanceProfile = await this.readInstanceProfile(treeFile);
          if (instanceProfile) {
            result.push(instanceProfile);
          }
        }
      }
    }
    this.instances = result;
  }

  /**
   * Reads a single .tree file -> returns an InstanceConfig if valid, else null.
   */
  private async readInstanceProfile(treeFile: string): Promise<InstanceConfig | null> {
    const raw = await this.readFileAsString(treeFile);
    const parser = new XMLParser({ ignoreAttributes: false });
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
   * Converts <toc-element> structures into our TocElement interface recursively.
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
   * Writes updated instance-profile data to the .tree file for a doc, preserving indentation.
   */
  private async writeInstanceProfile(doc: InstanceConfig, filePath: string | null): Promise<void> {
    if(!filePath){ filePath = await this.getFilePathForDoc(doc.id);}
    // Determine startPage based on TOC elements
    const startPage = doc['toc-elements'].length > 0 ? doc['start-page'] : '';

    // Build the profile object
    const profileObj = {
      'instance-profile': {
        '@_id': doc.id,
        '@_name': doc.name,
        '@_start-page': startPage,
        'toc-element': this.buildTocElements(doc['toc-elements'])
      }
    };

    // Configure the XMLBuilder with VS Code settings
    const builder = new XMLBuilder({
      ignoreAttributes: false,
      format: true, // Enable pretty formatting
      indentBy: await this.getIndentationSetting(),
      suppressEmptyNode: true

    });

    // Build XML content
    const xmlContent = builder.build(profileObj);

    // Insert the Writerside doctype
    const doctype = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE instance-profile SYSTEM \"https://resources.jetbrains.com/writerside/1.0/product-profile.dtd\">\n\n`;
    const fullContent = doctype + xmlContent;
    this.writeNewFile(filePath,fullContent);
  }

  /**
   * Helper method to fetch the indentation settings from VS Code configuration.
   */
  private async getIndentationSetting(): Promise<string> {
    const config = vscode.workspace.getConfiguration('editor');
    const tabSize = config.get<number>('tabSize', 4);
    const insertSpaces = config.get<boolean>('insertSpaces', true);
    return insertSpaces ? ' '.repeat(tabSize) : '\t';

  }
  /**
   * Recursively builds XML toc-element from our TocElement[].
   */
  private buildTocElements(elements: TocElement[]): any[] {
    return elements.map(e => {
      const node: any = { '@_topic': e.topic };
      if (e.children && e.children.length > 0) {
        node['toc-element'] = this.buildTocElements(e.children);
      }
      return node;
    });
  }

  /**
   * Finds the .tree file for a given docId by reading each instance’s .tree to confirm @id matches.
   * Replaces old synchronous logic with a new async approach.
   */
  private async getFilePathForDoc(docId: string): Promise<string> {
    const ihp = this.ihpData?.ihp;
    const array = Array.isArray(ihp?.instance) ? ihp.instance : ihp?.instance ? [ihp.instance] : [];
    const parser = new XMLParser({ ignoreAttributes: false });

    for (const inst of array) {
      const treeSrc = inst['@_src'];
      if (!treeSrc) { continue; }

      const treeFile = path.join(this.getIhpDir(), treeSrc);
      if (!(await this.fileExists(treeFile))) { continue; }

      const raw = await this.readFileAsString(treeFile);
      const data = parser.parse(raw);
      const profile = data['instance-profile'];
      if (profile && profile['@_id'] === docId) {
        return treeFile;
      }
    }
    throw new Error(`No .tree file found for docId ${docId}`);
  }

  // ------------------------------------------------------------------------------------
  // DOCUMENT METHODS
  // ------------------------------------------------------------------------------------

  /**
   * Creates a new document -> writes a new .tree file -> updates .ihp -> ensures watchers.
   */
  async addDocument(newDocument: InstanceConfig): Promise<void> {
    this.treeFileName = `${newDocument.id}.tree`;
    const treeFilePath = path.join(this.getIhpDir(), this.treeFileName);

    // Build instance-profile
    // const profileObj = {
    //   'instance-profile': {
    //     '@_id': newDocument.id,
    //     '@_name': newDocument.name,
    //     '@_start-page': newDocument['start-page'],
    //     'toc-element': []
    //   }
    // };

    // // Writerside doctype
    // const builder = new XMLBuilder({
    //   ignoreAttributes: false,
    //   format: true, // Enable pretty formatting
    //   indentBy: await this.getIndentationSetting()
    // });

    // // Build XML content
    // const xmlContent = builder.build(profileObj);
    // const doctype = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE instance-profile SYSTEM \"https://resources.jetbrains.com/writerside/1.0/product-profile.dtd\">\n\n`;
    // const fullContent =  doctype + xmlContent;
    // // Write to disk
    // await this.writeNewFile(treeFilePath, fullContent);
    await this.writeInstanceProfile(newDocument, treeFilePath);
    // Update .ihp
    if (!this.ihpData.ihp.instance) {
      this.ihpData.ihp.instance = [];
    } else if (!Array.isArray(this.ihpData.ihp.instance)) {
      this.ihpData.ihp.instance = [this.ihpData.ihp.instance];
    }
    this.ihpData.ihp.instance.push({ '@_src': this.treeFileName });
    await this.writeIhpFile();

    // Update in memory
    this.instances.push(newDocument);

    // Create an initial .md file if the doc has a first TOC element
    if (newDocument['toc-elements'] && newDocument['toc-elements'][0]) {
      await this.writeTopicFile(newDocument['toc-elements'][0]);
    }
  }
  async createDirectory(dirPath: string): Promise<void> {
    const dirUri = vscode.Uri.file(dirPath);
  
    try {
      // Check if the directory exists
      await vscode.workspace.fs.stat(dirUri);
      // If it doesn't throw, the directory is already there
    } catch {
      // If stat failed, create the directory
      await vscode.workspace.fs.createDirectory(dirUri);
    }
  }

  /**
   * Deletes a document -> removes associated topics -> updates .ihp -> removes .tree file.
   */
  async deleteDocument(docId: string): Promise<void> {
    const ihp = this.ihpData?.ihp;
    if (!ihp.instance) { return; }

    let arr = Array.isArray(ihp.instance) ? ihp.instance : [ihp.instance];
    const idx = await this.findDocumentIndex(arr, docId);
    if (idx > -1) {
      const treeSrc = arr[idx]['@_src'];

      // Find doc in memory
      const doc = this.instances.find(d => d.id === docId);
      if (doc) {
        // Remove all topics from disk
        const allTopics = this.getAllTopicsFromDoc(doc['toc-elements']);
        const topicsDir = this.getTopicsDir();
        for (const tFile of allTopics) {
          const p = path.join(topicsDir, tFile);
          await this.deleteFileIfExists(p);
        }
      }

      // Remove from .ihp
      arr.splice(idx, 1);
      if (arr.length === 1) { ihp.instance = arr[0]; }
      else { ihp.instance = arr; }
      await this.writeIhpFile();

      // Remove .tree
      const treeFilePath = path.join(this.getIhpDir(), treeSrc);
      await this.deleteFileIfExists(treeFilePath);

      // Remove from instances
      this.instances = this.instances.filter(d => d.id !== docId);
    }
  }

  /**
   * Gathers all .md filenames from a TocElement[] recursively.
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

  /**
   * Finds the doc index by docId in the .ihp instance array by reading each .tree file to confirm match.
   */
  private async findDocumentIndex(instances: any[], docId: string): Promise<number> {
    const parser = new XMLParser({ ignoreAttributes: false });
    for (let i = 0; i < instances.length; i++) {
      const src = instances[i]['@_src'];
      if (!src) { continue; }
      const treeFile = path.join(this.getIhpDir(), src);
      if (!(await this.fileExists(treeFile))) { continue; }

      const raw = await this.readFileAsString(treeFile);
      const data = parser.parse(raw);
      const profile = data['instance-profile'];
      if (profile && profile['@_id'] === docId) {
        return i;
      }
    }
    return -1;
  }

  /**
   * Renames a document by updating `@_name` in its .tree file.
   */
  async renameDocument(docName: string, newName: string): Promise<void> {
    const doc = this.instances.find(d => d.name === docName);
    if (!doc) { return; }
    doc.name = newName;
    await this.writeInstanceProfile(doc,null);
  }

  /**
   * Returns the loaded documents in memory.
   */
  getDocuments(): InstanceConfig[] {
    // this.refresh();
    return this.instances;
  }

  // ------------------------------------------------------------------------------------
  // TOPIC METHODS
  // ------------------------------------------------------------------------------------

  /**
   * Adds a new topic -> writes .md -> updates .tree.
   */
  async addTopic(docItem: string, parentTopic: string | null, newTopic: TocElement): Promise<void> {
    const doc = this.instances.find(d => d.id === docItem);
    if (!doc) {
      vscode.window.showWarningMessage(`Document "${docItem}" not found.`);
      return;
    }

    // Write the .md file
    await this.writeTopicFile(newTopic);

    // If doc lacks start-page, set it
    if (!doc['start-page']) {
      doc['start-page'] = newTopic.topic;
    }

    // Identify parent or root
    let parentArray = doc['toc-elements'];
    if (parentTopic) {
      const parent = this.findTopicByFilename(doc['toc-elements'], parentTopic);
      if (!parent) {
        vscode.window.showWarningMessage(`Parent topic "${parentTopic}" not found.`);
        return;
      }
      parentArray = parent.children;
    }

    // Check for duplicates
    if (parentArray.some(t => t.title === newTopic.title)) {
      vscode.window.showWarningMessage(`Duplicate topic title "${newTopic.title}" in parent.`);
      return;
    } else {
      parentArray.push(newTopic);
    }

    // Update .tree
    try {
      await this.writeInstanceProfile(doc, null);
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to update document tree.`);
      return;
    }

    vscode.window.showInformationMessage(`Topic "${newTopic.title}" added successfully.`);
  }

  /**
   * Writes a new .md file for the topic, if it doesn’t exist.
   */
  private async writeTopicFile(newTopic: TocElement): Promise<void> {
    const topicsDir = this.getTopicsDir();
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(topicsDir));

    const filePath = path.join(topicsDir, newTopic.topic);
    if (await this.fileExists(filePath)) {
      vscode.window.showWarningMessage(`Topic file "${newTopic.topic}" already exists.`);
      return;
    }

    await this.writeNewFile(filePath, `# ${newTopic.title}\n\nContent goes here...`);
  }

  /**
   * Deletes a topic (and children) -> removes from disk -> updates .tree.
   */
  async deleteTopic(docId: string, topicFileName: string): Promise<void> {
    const doc = this.instances.find(d => d.id === docId);
    if (!doc) {
      vscode.window.showWarningMessage(`Document "${docId}" not found.`);
      return;
    }

    // Extract the topic
    const extractedTopic = this.extractTopicByFilename(doc['toc-elements'], topicFileName);
    if (!extractedTopic) {
      vscode.window.showWarningMessage(`Topic "${topicFileName}" not found in document "${docId}".`);
      return;
    }

    // Gather all .md files for this topic + children
    const allTopics = this.getAllTopicsFromDoc([extractedTopic]);
    const topicsDir = this.getTopicsDir();
    for (const tFile of allTopics) {
      await this.deleteFileIfExists(path.join(topicsDir, tFile));
    }

    try {
      await this.writeInstanceProfile(doc, null);
    } catch {
      vscode.window.showErrorMessage(`Failed to update document tree.`);
    }
  }

  /**
   * Renames a topic’s file on disk and updates .tree data accordingly.
   */
  async renameTopic(docId: string, oldTopicFile: string, newName: string): Promise<void> {
    const doc = this.instances.find(d => d.id === docId);
    if (!doc) { return; }

    const topic = this.findTopicByFilename(doc['toc-elements'], oldTopicFile);
    if (topic) {
      const topicsDir = this.getTopicsDir();
      const newTopicFile = this.formatTitleAsFilename(newName);
      const oldFilePath = path.join(topicsDir, oldTopicFile);
      const newFilePath = path.join(topicsDir, newTopicFile);

      if (!(await this.fileExists(oldFilePath))) { return; }
      if (await this.fileExists(newFilePath)) { return; }

      // Rename
      await vscode.workspace.fs.rename(
        vscode.Uri.file(oldFilePath),
        vscode.Uri.file(newFilePath)
      );

      // Update .tree
      topic.topic = newTopicFile;
      topic.title = newName;
      await this.writeInstanceProfile(doc, null);
    }
  }

  /**
   * Recursively searches `toc-elements` for a match by `t.title === fileName`.
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
   * Extracts a topic by `t.topic === fileName` and returns it, or null if not found.
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

  private formatTitleAsFilename(title: string): string {
    return title.toLowerCase().replace(/\s+/g, '-') + '.md';
  }

  // ------------------------------------------------------------------------------------
  // FILE + FOLDER UTILITIES
  // ------------------------------------------------------------------------------------

  /**
   * Creates a directory if it doesn't exist, writing a fresh file.
   */
  private async writeNewFile(filePath: string, fullContent: string): Promise<void> {

    // Open the tree file as a text document
    const fileUri = vscode.Uri.file(filePath);
    try {
      await vscode.workspace.fs.stat(fileUri);
    } catch {
      // File doesn't exist — either create it
      const dirUri = fileUri.with({ path: path.dirname(fileUri.fsPath) });
      await vscode.workspace.fs.createDirectory(dirUri);
      await vscode.workspace.fs.writeFile(fileUri, Buffer.from(fullContent, 'utf-8'));
      return;
    }
    


    
    const document = await vscode.workspace.openTextDocument(fileUri);

    // Apply changes using WorkspaceEdit
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      document.uri,
      new vscode.Range(
        document.positionAt(0),
        document.positionAt(document.getText().length)
      ),
      fullContent
    );

    await vscode.workspace.applyEdit(edit);
    try{
      await vscode.commands.executeCommand('editor.action.formatDocument', document.uri);
    }
    catch{

    }

    // Save the changes
    await document.save();
  }

  /**
   * Checks if a file exists using workspace.fs.stat.
   */
  private async fileExists(filePath: string): Promise<boolean> {
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
  private async readFileAsString(filePath: string): Promise<string> {
    try {
      // Check if the file exists
      await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
  
      // Read the file and return its contents as a UTF-8 string
      const data = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
      return Buffer.from(data).toString('utf-8');
    } catch (error: any) {
      console.error(`Error reading file "${filePath}": ${error.message}`);
      throw new Error(`File "${filePath}" does not exist or cannot be read.`);
    }
  }
  

  /**
   * Deletes a file if it exists.
   */
  private async deleteFileIfExists(filePath: string): Promise<void> {
    try {
      await vscode.workspace.fs.delete(vscode.Uri.file(filePath));
    } catch {
      // ignore
    }
  }

  /**
   * Utility to open an XML file, parse, mutate, replace content, and run `editor.action.formatDocument`.
   */
  private async updateXmlFile(
    filePath: string, 
    mutateFn: (parsedXml: any) => any
  ): Promise<void> {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
    const originalText = doc.getText();

    const parser = new XMLParser({ ignoreAttributes: false, preserveOrder: true });
    let xmlObj = parser.parse(originalText);

    // Apply your changes
    xmlObj = mutateFn(xmlObj);

    // Rebuild
    const builder = new XMLBuilder({
      ignoreAttributes: false,
      format: true, // Enable pretty formatting
      indentBy: await this.getIndentationSetting(),
      suppressEmptyNode: true
    });
    
    const newXml = builder.build(xmlObj);

    // Replace content
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      doc.uri,
      new vscode.Range(doc.positionAt(0), doc.positionAt(originalText.length)),
      newXml
    );
    await vscode.workspace.applyEdit(edit);

    // Format + Save
    try{
      await vscode.commands.executeCommand('editor.action.formatDocument', doc.uri);
    }
    catch{

    }
    
    await doc.save();
  }

  // ------------------------------------------------------------------------------------
  // moveFolderToTrash + mergeFolders
  // ------------------------------------------------------------------------------------

  /**
   * Moves a folder to "trash", merging if conflicts occur.
   */
  async moveFolderToTrash(folderPath: string): Promise<void> {
    const trashPath = path.join(path.dirname(this.configPath), 'trash');
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(trashPath));
    const destPath = path.join(trashPath, path.basename(folderPath));

    try {
      // If folder already in trash => merge
      await vscode.workspace.fs.stat(vscode.Uri.file(destPath));
      await this.mergeFolders(folderPath, destPath);
      await vscode.workspace.fs.delete(vscode.Uri.file(folderPath), { recursive: true });
    } catch {
      // If not found => rename
      await vscode.workspace.fs.rename(
        vscode.Uri.file(folderPath),
        vscode.Uri.file(destPath)
      );
    }
  }

  async mergeFolders(source: string, destination: string): Promise<void> {
    let entries: [string, vscode.FileType][] = [];
    try {
      entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(source));
    } catch {
      return;
    }
    for (const [fileName, fileType] of entries) {
      const srcPath = path.join(source, fileName);
      const dstPath = path.join(destination, fileName);

      if (fileType === vscode.FileType.Directory) {
        try {
          await vscode.workspace.fs.stat(vscode.Uri.file(dstPath));
        } catch {
          await vscode.workspace.fs.createDirectory(vscode.Uri.file(dstPath));
        }
        await this.mergeFolders(srcPath, dstPath);
      } else {
        try {
          await vscode.workspace.fs.stat(vscode.Uri.file(dstPath));
          // If collision => rename with timestamp
          const ext = path.extname(fileName);
          const base = path.basename(fileName, ext);
          const newName = `${base}-${Date.now()}${ext}`;
          const newPath = path.join(destination, newName);
          await vscode.workspace.fs.rename(
            vscode.Uri.file(srcPath),
            vscode.Uri.file(newPath)
          );
        } catch {
          // If no collision => rename
          await vscode.workspace.fs.rename(
            vscode.Uri.file(srcPath),
            vscode.Uri.file(dstPath)
          );
        }
      }
    }
  }

  // ------------------------------------------------------------------------------------
  // VALIDATION WITH AJV
  // ------------------------------------------------------------------------------------
  async validateAgainstSchema(schemaPath: string): Promise<void> {
    const ajv = new Ajv({ allErrors: true });
    const rawSchema = await vscode.workspace.fs.readFile(vscode.Uri.file(schemaPath));
    const schema = JSON.parse(Buffer.from(rawSchema).toString('utf-8'));

    const ihp = this.ihpData?.ihp;
    const topicsDir = ihp?.topics?.['@_dir'] || 'topics';
    let imagesObj: any;
    if (ihp?.images) {
      imagesObj = {
        dir: ihp.images['@_dir'],
        version: ihp.images['@_version'],
        'web-path': ihp.images['@_web-path']
      };
    }

    const configJson = {
      schema: this.ihpData?.schema,
      title: this.ihpData?.title,
      type: this.ihpData?.type,
      topics: { dir: topicsDir },
      images: imagesObj,
      instances: this.instances.map(inst => ({
        id: inst.id,
        name: inst.name,
        'start-page': inst['start-page'],
        'toc-elements': inst['toc-elements'].map(te => ({
          topic: te.topic,
          title: te.title,
          'sort-children': te.sortChildren,
          children: te.children
        }))
      }))
    };

    const validate = ajv.compile(schema);
    if (!validate(configJson)) {
      throw new Error(`Schema validation failed: ${JSON.stringify(validate.errors, null, 2)}`);
    }
  }

  /**
   * Recursively converts our TocElement[] into JSON for writing back to .tree/.ihp.
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
