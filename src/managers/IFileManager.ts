// IBaseConfigurationManager.ts

import { InstanceConfig, TocElement } from '../utils/types';

export interface IBaseFileManager {
  
  configPath: string;
  instances: InstanceConfig[];

  saveDocumentConfig(doc: InstanceConfig, filePath?: string): Promise<void>;
  getTopicsDirectory(): string;
  getImagesDirectory(): string;


  // Document-specific methods
  createDocument(newDocument: InstanceConfig): Promise<void>;
  removeDocument(docId: string): Promise<boolean>;

  // Refresh configuration
  reloadConfiguration(): Promise<void>;

  fetchAllDocuments(): InstanceConfig[];

  // Topic-related methods
  renameTopicFile(
    oldTopicFile: string,
    newTopicFile: string,
    doc: InstanceConfig
  ): Promise<void>;

  removeTopicFiles(topicsFilestoBeRemoved: string[], doc: InstanceConfig): Promise<boolean>;

  createChildTopicFile(
    newTopic: TocElement,
    doc: InstanceConfig
  ): Promise<void>;

  updateMarkdownTitle(topicFile: string, newTitle: string): Promise<void>;
}
