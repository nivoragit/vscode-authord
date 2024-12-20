import { AbstractConfigManager, InstanceConfig, TocElement, Topic } from './abstractConfigManager';
import { InitializeExtension } from '../utils/initializeExtension';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import Ajv from 'ajv';

export class XMLConfigurationManager extends AbstractConfigManager {
  moveTopic(_docId: string, _topicId: string, _newParentId: string | null): void {
    throw new Error('Method not implemented.');
  }
  private treeFileName: string = "";
  getFilePathById(_id: string): string | undefined {
    throw new Error('Method not implemented.');
  }
  setFilePathById(_id: string, _filePath: string): void {
    throw new Error('Method not implemented.');
  }
  removeFilePathById(_id: string): void {
    throw new Error('Method not implemented.');
  }

  instances: InstanceConfig[] = [];
  private ihpData: any;

  constructor(configPath: string) {
    super(configPath);
    this.refresh();
  }

  setupWatchers(InitializeExtension: InitializeExtension): void {
    if (this.treeFileName) {
      InitializeExtension.setupWatchers(this.treeFileName);
      this.treeFileName = "";
    }
  }
  refresh(): void {
    this.ihpData = this.readIhpFile();
    this.instances = this.loadInstances();
  }

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

    this.instances.forEach((doc) => {
      traverseElements(doc["toc-elements"]);
    });
    return topics;
  }

  private getIhpDir(): string {
    return path.dirname(this.configPath);
  }

  getTopicsDir(): string {
    const ihp = this.ihpData.ihp;
    return path.join(this.getIhpDir(), ihp.topics && ihp.topics["@_dir"] ? ihp.topics["@_dir"] : "topics");
  }

  private readIhpFile(): any {
    const parser = new XMLParser({ ignoreAttributes: false });
    if (!fs.existsSync(this.configPath)) {
      const defaultIhp = `<?xml version="1.0" encoding="UTF-8"?>
<ihp version="2.0">
  <topics dir="topics"/>
</ihp>`;
      fs.writeFileSync(this.configPath, defaultIhp, 'utf-8');
    }
    const raw = fs.readFileSync(this.configPath, 'utf-8');
    return parser.parse(raw);
  }

  private writeIhpFile(): void {
    const builder = new XMLBuilder({ ignoreAttributes: false });
    const xmlContent = builder.build(this.ihpData);
    fs.writeFileSync(this.configPath, xmlContent, 'utf-8');
  }

  loadInstances(): InstanceConfig[] {
    const instances: InstanceConfig[] = [];
    const ihp = this.ihpData.ihp;
    const instancesNodes = Array.isArray(ihp.instance) ? ihp.instance : (ihp.instance ? [ihp.instance] : []);
    for (const inst of instancesNodes) {
      if (inst["@_src"]) {
        const treeFile = path.join(this.getIhpDir(), inst["@_src"]);
        if (fs.existsSync(treeFile)) {
          const instanceProfile = this.readInstanceProfile(treeFile);
          if (instanceProfile) {
            instances.push(instanceProfile);
          }
        }
      }
    }
    return instances;
  }

  private readInstanceProfile(treeFile: string): InstanceConfig | null {
    const parser = new XMLParser({ ignoreAttributes: false });
    const raw = fs.readFileSync(treeFile, 'utf-8');
    const data = parser.parse(raw);
    const profile = data["instance-profile"];
    if (!profile) { return null; }

    const docId = profile["@_id"];
    const name = profile["@_name"] ||profile["@_id"]|| "Untitled";

    const startPage = profile["@_start-page"] || "";
    const tocElements: TocElement[] = this.loadTocElements(profile["toc-element"] || []);

    return {
      id: docId,
      name,
      "start-page": startPage,
      "toc-elements": tocElements
    };
  }

  private loadTocElements(xmlElements: any): TocElement[] {
    if (!Array.isArray(xmlElements)) {
      xmlElements = xmlElements ? [xmlElements] : [];
    }

    return xmlElements.map((elem: any) => {
      const topicFile = elem["@_topic"];
      const children = this.loadTocElements(elem["toc-element"] || []);
      return {
        topic: topicFile,
        title: path.basename(topicFile, '.md'),
        sortChildren: "none",
        children
      } as TocElement;
    });
  }

  private writeInstanceProfile(doc: InstanceConfig): void {
    const builder = new XMLBuilder({ ignoreAttributes: false });
    const treeFile = this.getTreeFileForDoc(doc.id);
    let startPage =""; 
    if (doc['toc-elements'].length !== 0){
      startPage = doc["start-page"]; // updating start-page when go back to 0 topics
    } 

    const profileObj = {
      "instance-profile": {
        "@_id": doc.id,
        "@_name": doc.name,
        "@_start-page": startPage,
        "toc-element": this.buildTocElements(doc["toc-elements"])
      }
    };

    let xmlContent = builder.build(profileObj);
    // Prepend XML declaration and DOCTYPE
    const doctype = `<?xml version="1.0" encoding="UTF-8"?>
  <!DOCTYPE instance-profile SYSTEM "https://resources.jetbrains.com/writerside/1.0/product-profile.dtd">\n\n`;
    xmlContent = doctype + xmlContent;

    fs.writeFileSync(treeFile, xmlContent, 'utf-8');
  }

  private buildTocElements(elements: TocElement[]): any[] {
    return elements.map(e => {
      const result: any = {
        "@_topic": e.topic
      };
      if (e.children && e.children.length > 0) {
        result["toc-element"] = this.buildTocElements(e.children);
      }
      return result;
    });
  }


  private getTreeFileForDoc(docId: string): string {
    const ihp = this.ihpData.ihp;
    const instancesNodes = Array.isArray(ihp.instance) ? ihp.instance : (ihp.instance ? [ihp.instance] : []);
    for (const inst of instancesNodes) {
      const treeSrc = inst["@_src"];
      if (!treeSrc) { continue; }
      const treeFile = path.join(this.getIhpDir(), treeSrc);
      if (!fs.existsSync(treeFile)) { continue; }

      const parser = new XMLParser({ ignoreAttributes: false });
      const raw = fs.readFileSync(treeFile, 'utf-8');
      const data = parser.parse(raw);
      const profile = data["instance-profile"];
      if (profile && profile["@_id"] === docId) {
        return treeFile;
      }
    }
    throw new Error(`No .tree file found for docId ${docId}`);
  }

  // Document methods
  addDocument(newDocument: InstanceConfig): void {
    this.treeFileName = `${newDocument.id}.tree`;
    const treeFilePath = path.join(this.getIhpDir(), this.treeFileName);

    const profileObj = {
      "instance-profile": {
        "@_id": newDocument.id,
        "@_name": newDocument.name,
        "@_start-page": newDocument["start-page"],
        "toc-element": []
      }
    };

    const builder = new XMLBuilder({ ignoreAttributes: false });
    let xmlContent = builder.build(profileObj);

    // Prepend XML declaration and DOCTYPE
    // todo remove jetbrains
    const doctype = `<?xml version="1.0" encoding="UTF-8"?>
  <!DOCTYPE instance-profile SYSTEM "https://resources.jetbrains.com/writerside/1.0/product-profile.dtd">\n\n`;
    xmlContent = doctype + xmlContent;
    fs.writeFileSync(treeFilePath, xmlContent, 'utf-8');

    if (!this.ihpData.ihp.instance) {
      this.ihpData.ihp.instance = [];
    } else if (!Array.isArray(this.ihpData.ihp.instance)) {
      this.ihpData.ihp.instance = [this.ihpData.ihp.instance];
    }
    this.ihpData.ihp.instance.push({ "@_src": this.treeFileName });

    this.writeIhpFile(); // updating .tree files
    this.instances.push(newDocument);
  }
  deleteDocument(docId: string): void {
    const ihp = this.ihpData.ihp;
    if (ihp.instance) {
      if (!Array.isArray(ihp.instance)) {
        ihp.instance = [ihp.instance];
      }
      const idx = ihp.instance.findIndex((i: any) => {
        if (!i["@_src"]) { return false; }
        const treeFile = path.join(this.getIhpDir(), i["@_src"]);
        if (!fs.existsSync(treeFile)) { return false; }
        const parser = new XMLParser({ ignoreAttributes: false });
        const raw = fs.readFileSync(treeFile, 'utf-8');
        const data = parser.parse(raw);
        const profile = data["instance-profile"];
        return profile && profile["@_id"] === docId;
      });
  
      if (idx > -1) {
        const treeSrc = ihp.instance[idx]["@_src"];
  
        // Find the doc in this.instances
        const doc = this.instances.find(d => d.id === docId);
        if (doc) {
          // Delete all topics associated with this doc
          const allTopics = this.getAllTopicsFromDoc(doc["toc-elements"]);
          const topicsDir = this.getTopicsDir();
          for (const topicFileName of allTopics) {
            const topicFilePath = path.join(topicsDir, topicFileName);
            if (fs.existsSync(topicFilePath)) {
              fs.unlinkSync(topicFilePath);
            }
          }
        }
  
        // Remove the doc entry from ihp and instances
        ihp.instance.splice(idx, 1);
        this.writeIhpFile();
        const treeFilePath = path.join(this.getIhpDir(), treeSrc);
        if (fs.existsSync(treeFilePath)) {
          fs.unlinkSync(treeFilePath);
        }
        this.instances = this.instances.filter(d => d.id !== docId);
      }
    }
  }
  
  // Helper method to get all topics (including children) for a doc
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
  
  
  renameDocument(docName: string, newName: string): void {
    const doc = this.instances.find(d => d.name === docName);
    if (!doc) { return; }
    doc.name = newName;
    // Update the instance-profile (.tree file) with the new name
    this.writeInstanceProfile(doc);
  }
  

  getDocuments(): InstanceConfig[] {
    return this.instances;
  }

  // Topics
  addTopic(docItem: string, parentTopic: string | null, newTopic: TocElement): void {
    const doc = this.instances.find(d => d.id === docItem); // || d.name === docItem); //todo d.name === docItem for doc topic creation
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
  
    // Check for duplicate titles within the parent
    if (parentArray.some(t => t.title === newTopic.title)) {
      // console.error(`Duplicate topic title "${newTopic.title}" in parent.`);
      // vscode.window.showWarningMessage(`Duplicate topic title "${newTopic.title}" in parent.`);
    
      // Ensure the duplicate topic is written in the .tree file
      const treeFilePath = this.getTreeFileForDoc(docItem);
      const parser = new XMLParser({ ignoreAttributes: false });
      if (fs.existsSync(treeFilePath)) {
        const rawTreeData = fs.readFileSync(treeFilePath, 'utf-8');
        const treeData = parser.parse(rawTreeData);
        const topicInTree = this.findTopicInTree(treeData["instance-profile"]["toc-element"], newTopic.title);
    
        if (topicInTree) {
          console.error(`Duplicate topic title "${newTopic.title}" in parent.`);
          vscode.window.showWarningMessage(`Duplicate topic title "${newTopic.title}" in parent.`);
          return;
        }
      } else {
        console.error(`Tree file "${treeFilePath}" not found.`);
        vscode.window.showWarningMessage(`Tree file "${treeFilePath}" not found.`);
        return;
      }
    
      
    }else{
      parentArray.push(newTopic);
    }


    try {
      
      this.writeInstanceProfile(doc); // Updates the .tree file
  
    } catch (err) {
      console.error(`Failed to update .tree file for "${doc.id}": ${err}`);
      vscode.window.showErrorMessage(`Failed to update document tree.`);
      return;
    }
  
    vscode.window.showInformationMessage(`Topic "${newTopic.title}" added successfully.`);
  }
  
  private findTopicInTree(treeElements: any[], title: string): boolean {
    for (const element of treeElements) {
      // Check if the current element's title matches the given title
      if (element["@_title"] === title) {
        return true;
      }
  
      // Recursively check in child elements, if they exist
      if (element["toc-element"] && Array.isArray(element["toc-element"])) {
        if (this.findTopicInTree(element["toc-element"], title)) {
          return true;
        }
      }
    }
  
    // If no match is found, return false
    return false;
  }
  

  deleteTopic(docId: string, topicFileName: string): void {
    const doc = this.instances.find(d => d.id === docId);
    if (!doc) {
      console.error(`Document with id "${docId}" not found.`);
      vscode.window.showWarningMessage(`Document with id "${docId}" not found.`);
      return;
    }
  
    // Extract the topic along with its children
    const extractedTopic = this.extractTopicByFilename(doc["toc-elements"], topicFileName);
    if (!extractedTopic) {
      console.error(`Topic "${topicFileName}" not found in document "${docId}".`);
      vscode.window.showWarningMessage(`Topic "${topicFileName}" not found in document "${docId}".`);
      return;
    }
  
    // Gather all topic files (this topic and its children)
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
  
    // Update the .tree file after removing the topic
    this.writeInstanceProfile(doc);
  }
  
  
  renameTopic(docId: string, oldTopicFile: string, newName: string): void {
    const doc = this.instances.find(d => d.id === docId);
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
        console.log("already exists");
        return;
      }
  
      this.renamePath(oldFilePath, newFilePath);
      topic.topic = newTopicFile;
      topic.title = newName;
      this.writeInstanceProfile(doc);
    }
  }
  
  // Helper methods updated to check t.topic instead of t.title
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
  
  private removeTopicByFilename(topics: TocElement[], fileName: string): boolean {
    const idx = topics.findIndex(t => t.topic === fileName);
    if (idx > -1) {
      topics.splice(idx, 1);
      return true;
    }
    for (const t of topics) {
      if (this.removeTopicByFilename(t.children, fileName)) { return true; }
    }
    return false;
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

  private formatTitleAsFilename(title: string): string {
    return title.toLowerCase().replace(/\s+/g, '-') + '.md';
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

  validateAgainstSchema(schemaPath: string) {
    return; // todo
    const ihp = this.ihpData.ihp;
    const topicsDir = ihp.topics ? ihp.topics["@_dir"] || "topics" : "topics";

    let imagesObj: any = undefined;
    if (ihp.images) {
      imagesObj = {
        dir: ihp.images["@_dir"] || "",
        version: ihp.images["@_version"] || "",
        "web-path": ihp.images["@_web-path"] || ""
      };
    }

    const configJson = {
      schema: this.ihpData.schema || "http://json-schema.org/draft-07/schema#",
      title: this.ihpData.title || "Authord Settings",
      type: this.ihpData.type || "object",
      topics: {
        dir: topicsDir
      },
      images: imagesObj,
      instances: this.instances.map(inst => ({
        id: inst.id,
        name: inst.name,
        "start-page": inst["start-page"],
        "toc-elements": this.convertTocElements(inst["toc-elements"])
      }))
    };

    const ajv = new Ajv({ allErrors: true });
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
    const validate = ajv.compile(schema);
    const valid = validate(configJson);

    if (!valid) {
      const errors = validate.errors || [];
      throw new Error(`Schema validation failed: ${JSON.stringify(errors, null, 2)}`);
    }
  }

  private convertTocElements(elements: TocElement[]): any[] {
    return elements.map(e => ({
      topic: e.topic,
      title: e.title,
      "sort-children": e.sortChildren,
      children: this.convertTocElements(e.children)
    }));
  }
}
