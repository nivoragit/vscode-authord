// import { InstanceConfig, AbstractConfigManager, TocElement, Topic } from './abstractConfigManager';
// import * as fs from 'fs';
// import * as path from 'path';
// import Ajv from 'ajv';

// export interface AuthordConfig {
//   instances: InstanceConfig[];
//   "file-paths"?: { [key: string]: string };
//   topics?: { dir: string };
//   [key: string]: any;
// }

// export class JSONConfigurationManager extends AbstractConfigManager {
//   configData: AuthordConfig;

//   constructor(configPath: string) {
//     super(configPath);
//     this.configData = this.readConfig();
//   }

//   refresh(): void {
//     this.configData = this.readConfig();
//   }

//   loadInstances(): InstanceConfig[] {
//     return this.readConfig().instances;
//   }

//   private readConfig(): AuthordConfig {
//     if (!fs.existsSync(this.configPath)) {
//       return { instances: [], "file-paths": {}, topics: { dir: "topics" } };
//     }
//     const raw = fs.readFileSync(this.configPath, 'utf-8');
//     const data = JSON.parse(raw);
//     if (!data.instances) {
//       data.instances = [];
//     }
//     if (!data["file-paths"]) {
//       data["file-paths"] = {};
//     }
//     if (!data.topics) {
//       data.topics = { dir: "topics" };
//     }
//     return data;
//   }

//   private writeConfig(): void {
//     if (!this.configData) { return; }
//     fs.writeFileSync(this.configPath, JSON.stringify(this.configData, null, 2), 'utf-8');
//   }

//   // Document-specific methods
//   addDocument(newDocument: InstanceConfig): void {
//     if (!this.configData) { return; }
//     this.configData.instances.push(newDocument);
//     this.writeConfig();
//   }

//   deleteDocument(docId: string): void {
//     if (!this.configData) { return; }
//     this.configData.instances = this.configData.instances.filter(d => d.id !== docId);
//     this.writeConfig();
//   }

//   renameDocument(docId: string, newName: string): void {
//     if (!this.configData) { return; }
//     const doc = this.configData.instances.find(d => d.id === docId);
//     if (doc) {
//       doc.name = newName;
//       this.writeConfig();
//     }
//   }

//   getDocuments(): InstanceConfig[] {
//     return this.configData?.instances || [];
//   }

//   // Topic-specific methods
//   addTopic(docId: string, parentTopicId: string | null, newTopic: TocElement): void {
//     if (!this.configData) { return; }
//     const doc = this.configData.instances.find(d => d.id === docId);
//     if (!doc) { return; }

//     if (parentTopicId === null) {
//       doc["toc-elements"].push(newTopic);
//     } else {
//       const parent = this.findTopicById(doc["toc-elements"], parentTopicId);
//       if (parent) {
//         parent.children.push(newTopic);
//       }
//     }

//     this.writeConfig();
//   }

//   deleteTopic(docId: string, topicId: string): void {
//     if (!this.configData) { return; }
//     const doc = this.configData.instances.find(d => d.id === docId);
//     if (!doc) { return; }
//     this.removeTopicById(doc["toc-elements"], topicId);
//     this.writeConfig();
//   }

//   renameTopic(docId: string, topicId: string, newName: string): void {
//     if (!this.configData) { return; }
//     const doc = this.configData.instances.find(d => d.id === docId);
//     if (!doc) { return; }

//     const topic = this.findTopicById(doc["toc-elements"], topicId);
//     if (topic) {
//       topic["toc-title"] = newName;
//       this.writeConfig();
//     }
//   }

//   moveTopic(docId: string, topicId: string, newParentId: string | null): void {
//     if (!this.configData) { return; }
//     const doc = this.configData.instances.find(d => d.id === docId);
//     if (!doc) { return; }

//     const topic = this.extractTopicById(doc["toc-elements"], topicId);
//     if (!topic) { return; }

//     if (newParentId === null) {
//       doc["toc-elements"].push(topic);
//     } else {
//       const parent = this.findTopicById(doc["toc-elements"], newParentId);
//       if (parent) {
//         parent.children.push(topic);
//       }
//     }
//     this.writeConfig();
//   }

//   getTopics(): Topic[] {
//     const topics: Topic[] = [];
//     const traverseElements = (elements: TocElement[]) => {
//       for (const e of elements) {
//         const filePath = this.getFilePathById(e.id);
//         if (filePath) {
//           topics.push({
//             name: path.basename(filePath),
//             path: filePath
//           });
//         }
//         if (e.children && e.children.length > 0) {
//           traverseElements(e.children);
//         }
//       }
//     };

//     this.configData!.instances.forEach((doc) => {
//       traverseElements(doc["toc-elements"]);
//     });

//     return topics;
//   }

//   getFilePathById(id: string): string | undefined {
//     return this.configData && this.configData["file-paths"] ? this.configData["file-paths"][id] : undefined;
//   }

//   setFilePathById(id: string, filePath: string): void {
//     if (!this.configData) { return; }
//     if (!this.configData["file-paths"]) {
//       this.configData["file-paths"] = {};
//     }
//     this.configData["file-paths"][id] = filePath;
//     this.writeConfig();
//   }

//   removeFilePathById(id: string): void {
//     if (!this.configData || !this.configData["file-paths"]) { return; }
//     delete this.configData["file-paths"][id];
//     this.writeConfig();
//   }

//   // File handling methods
//   createDirectory(dirPath: string): void {
//     fs.mkdirSync(dirPath, { recursive: true });
//   }

//   writeFile(filePath: string, content: string): void {
//     fs.writeFileSync(filePath, content, 'utf-8');
//   }

//   renamePath(oldPath: string, newPath: string): void {
//     fs.renameSync(oldPath, newPath);
//   }

//   fileExists(filePath: string): boolean {
//     return fs.existsSync(filePath);
//   }

//   moveFolderToTrash(folderPath: string): void {
//     const trashPath = path.join(path.dirname(this.configPath), 'trash');
//     if (!fs.existsSync(trashPath)) {
//       fs.mkdirSync(trashPath, { recursive: true });
//     }
//     const destinationPath = path.join(trashPath, path.basename(folderPath));

//     if (fs.existsSync(destinationPath)) {
//       this.mergeFolders(folderPath, destinationPath);
//       fs.rmdirSync(folderPath, { recursive: true });
//     } else {
//       fs.renameSync(folderPath, destinationPath);
//     }
//   }

//   mergeFolders(source: string, destination: string): void {
//     const sourceFiles = fs.readdirSync(source);
//     for (const file of sourceFiles) {
//       const sourceFilePath = path.join(source, file);
//       const destinationFilePath = path.join(destination, file);

//       if (fs.statSync(sourceFilePath).isDirectory()) {
//         if (!fs.existsSync(destinationFilePath)) {
//           fs.mkdirSync(destinationFilePath);
//         }
//         this.mergeFolders(sourceFilePath, destinationFilePath);
//       } else {
//         if (fs.existsSync(destinationFilePath)) {
//           const newFileName = `${path.basename(file, path.extname(file))}-${Date.now()}${path.extname(file)}`;
//           const newDestinationFilePath = path.join(destination, newFileName);
//           fs.renameSync(sourceFilePath, newDestinationFilePath);
//         } else {
//           fs.renameSync(sourceFilePath, destinationFilePath);
//         }
//       }
//     }
//   }

//   // Validation method
//   validateAgainstSchema(schemaPath:string): void {
//     // Using Ajv to validate configData against AUTHORD_SETTINGS_SCHEMA
   
//     const ajv = new Ajv({ allErrors: true });
//     const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
//     const validate = ajv.compile(schema);
//     const valid = validate(this.configData);

//     if (!valid) {
//       const errors = validate.errors || [];
//       throw new Error(`Schema validation failed: ${JSON.stringify(errors, null, 2)}`);
//     }
//   }

//   // Helper methods for topics
//   private findTopicById(topics: TocElement[], id: string): TocElement | undefined {
//     for (const t of topics) {
//       if (t.id === id) { return t; }
//       const found = this.findTopicById(t.children, id);
//       if (found) { return found; }
//     }
//     return undefined;
//   }

//   private removeTopicById(topics: TocElement[], id: string): boolean {
//     const idx = topics.findIndex(t => t.id === id);
//     if (idx > -1) {
//       topics.splice(idx, 1);
//       return true;
//     }
//     for (const t of topics) {
//       if (this.removeTopicById(t.children, id)) { return true; }
//     }
//     return false;
//   }

//   private extractTopicById(topics: TocElement[], id: string): TocElement | null {
//     const idx = topics.findIndex(t => t.id === id);
//     if (idx > -1) {
//       const [removed] = topics.splice(idx, 1);
//       return removed;
//     }
//     for (const t of topics) {
//       const extracted = this.extractTopicById(t.children, id);
//       if (extracted) { return extracted; }
//     }
//     return null;
//   }
// }
