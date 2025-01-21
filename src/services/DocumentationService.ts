import AbstractConfigManager from "../configurationManagers/abstractConfigurationManager";
import { InstanceConfig } from "../utils/types";

export default class DocumentationService {
    constructor(
      private readonly configManager: AbstractConfigManager
    ) {}
  
    public getAllDocuments(): InstanceConfig[] {
      // Leverages getDocuments() from the new AbstractConfigManager interface
      return this.configManager.getDocuments();
    }
  
    public async deleteDoc(docId: string): Promise<boolean> {
      // Leverages deleteDocument(docId: string)
      return this.configManager.deleteDocument(docId);
    }
  
    public async renameDoc(docId: string, newName: string): Promise<boolean> {
      // Leverages renameDocument(docId: string, newName: string)
      return this.configManager.renameDocument(docId, newName);
    }
  
    public async addDoc(newDocument: InstanceConfig): Promise<boolean> {
      // Leverages addDocument(newDocument: InstanceConfig)
      return this.configManager.addDocument(newDocument);
    }
  }