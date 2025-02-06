// IBaseConfigurationManager.ts

import { InstanceConfig, TocElement } from '../utils/types';

export interface IDocumentManager {
  
  configPath: string;
  instances: InstanceConfig[];

  saveDocumentationConfig(doc: InstanceConfig, filePath?: string): Promise<void>;
  getTopicsDirectory(): string;
  getImagesDirectory(): string;


  // Document-specific methods
  createDocumentation(newDocument: InstanceConfig): Promise<void>;
  removeDocumentation(docId: string): Promise<boolean>;

  // Refresh configuration
  reloadConfiguration(): Promise<void>;

  fetchAllDocumentations(): InstanceConfig[];

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
