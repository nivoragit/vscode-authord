import * as vscode from 'vscode';
import * as path from 'path';
import Ajv from 'ajv';
import { AbstractConfigManager } from './abstractConfigurationManager';
import { InstanceConfig } from '../utils/types';

export interface AuthordConfig {
  topics?: { dir: string };
  [key: string]: any;
}

export class AuthordConfigurationManager extends AbstractConfigManager {
  configData: AuthordConfig | undefined;

  constructor(configPath: string) {
    super(configPath);
  }

  // ------------------------------------------------------------------------------------
  // FILE/JSON HELPERS
  // ------------------------------------------------------------------------------------


  private async readJsonFile(filePath: string): Promise<any> {
    try {
      const fileData = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
      return JSON.parse(Buffer.from(fileData).toString('utf-8'));
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to read JSON file at "${filePath}": ${error.message}`);
      throw error;
    }
  }

  /**
   * Opens a JSON file, applies a mutation function, and preserves indentation.
   */
  private async updateJsonFile(filePath: string, mutateFn: (jsonData: any) => any): Promise<void> {
    try {
      const fileUri = vscode.Uri.file(filePath);
      // Ensure the file exists; create it with default config if it doesn't
      if (!(await this.fileExists(filePath)) && this.configData) {
        // removing title before write
      //   const jsonData = this.configData.instances.map((doc: InstanceConfig) => ({
      //     ...doc,
      //     'toc-elements': doc['toc-elements'].map(({ title, ...rest }: any) => rest) // Exclude `title` directly
      // }));
      
      await this.writeNewFile(filePath, JSON.stringify(this.configData, null, 2));
      
        return;
      }

      const doc = await vscode.workspace.openTextDocument(fileUri);
      const originalText = doc.getText();

      let jsonData = JSON.parse(originalText);
      jsonData = mutateFn(jsonData);
      const indentation = await this.getIndentationSetting();
      const newJsonString = JSON.stringify(jsonData, null, indentation);

      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        doc.uri,
        new vscode.Range(doc.positionAt(0), doc.positionAt(originalText.length)),
        newJsonString
      );

      await vscode.workspace.applyEdit(edit);
      await doc.save();
    } catch (error: any) {
      vscode.window.showErrorMessage(`Error updating JSON file at "${filePath}": ${error.message}`);
      throw error;
    }
  }

  // ------------------------------------------------------------------------------------
  // CONFIG READ/WRITE
  // ------------------------------------------------------------------------------------

  private defaultConfigJson(): AuthordConfig {
    return {
      schema: 'https://json-schema.org/draft/2020-12/schema',
      title: 'Authord Settings',
      type: 'object',
      topics: { dir: 'topics' },
      images: { dir: 'images', version: '1.0', 'web-path': 'images' },
      instances: []
    };
  }

  private async readConfig(): Promise<AuthordConfig> {
    try {
      if (!(await this.fileExists(this.configPath))) {
        const defaultConfig = this.defaultConfigJson();
        await this.writeNewFile(this.configPath, JSON.stringify(defaultConfig, null, 2));
      }
      return await this.readJsonFile(this.configPath);
    } catch (error: any) {
      vscode.window.showErrorMessage(`Error reading config: ${error.message}`);
      throw error;
    }
  }
  protected async writeConfig(_?: any, __?: any): Promise<void> {
    try {
      if (!this.configData) {
        return;
      }
      await this.updateJsonFile(this.configPath, () => this.configData!);
    } catch (error: any) {
      vscode.window.showErrorMessage(`Error writing config: ${error.message}`);
      throw error;
    }
  }

  // ------------------------------------------------------------------------------------
  // TOP-LEVEL METHODS
  // ------------------------------------------------------------------------------------
  async refresh(): Promise<void> {
    try {
      this.configData = await this.readConfig();
      this.instances = this.configData.instances;
    } catch (error: any) {
      vscode.window.showErrorMessage(`Error refreshing configuration: ${error.message}`);
    }
  }

  async createConfigFile(): Promise<AuthordConfigurationManager> {
    try {
      this.configData = this.defaultConfigJson();
      await this.writeConfig();
      return this;
    } catch (error: any) {
      vscode.window.showErrorMessage(`Error creating config file: ${error.message}`);
      throw error;
    }
  }

  getTopicsDir(): string {
    // Not wrapping in try-catch because this simply returns a path.
    return path.join(
      path.dirname(this.configPath),
      this.configData?.topics?.dir || ''
    );
  }

  getImageDir(): string {
    // Not wrapping in try-catch because this simply returns a path.
    return path.join(
      path.dirname(this.configPath),
      this.configData?.images?.dir || ''
    );
  }


  async addDocument(newDocument: InstanceConfig): Promise<boolean> {
    try {
      if (!this.configData) {
        vscode.window.showErrorMessage('Configuration data not initialized.');
        return false;
      }
      this.instances.push(newDocument);

      await this.writeConfig();

      if (newDocument['toc-elements'] && newDocument['toc-elements'][0]) {
        await this.writeTopicFile(newDocument['toc-elements'][0]);
      }
      return true;
    } catch (error: any) {
      vscode.window.showErrorMessage(`Error adding document: ${error.message}`);
      return false;
    }
  }

  async deleteDocument(docId: string): Promise<boolean> {
    try {
      const doc = this.findDocById(docId);
      if (!doc || !this.configData) {
        return false;
      }

      const topicsDir = this.getTopicsDir();
      const allTopics = this.getAllTopicsFromDoc(doc['toc-elements']);
      // running deletions in parallel
      await Promise.all(
        allTopics.map(async (topicFileName) => {
          const filePath = path.join(topicsDir, topicFileName);
          await this.deleteFileIfExists(filePath);
        })
      );


      this.instances = this.instances.filter(d => d.id !== docId);
      await this.writeConfig();
      return true;
    } catch (error: any) {
      vscode.window.showErrorMessage(`Error deleting document with id "${docId}": ${error.message}`);
      return false;
    }
  }

  // ------------------------------------------------------------------------------------
  // Utility Methods
  // ------------------------------------------------------------------------------------

  async validateAgainstSchema(schemaPath: string): Promise<void> {
    try {
      if (!this.configData) {
        throw new Error('No configuration data available for schema validation.');
      }

      const ajv = new Ajv({ allErrors: true });
      const schemaData = await vscode.workspace.fs.readFile(vscode.Uri.file(schemaPath));
      const schema = JSON.parse(Buffer.from(schemaData).toString('utf-8'));

      const validate = ajv.compile(schema);
      const valid = validate(this.configData);
      if (!valid) {
        const errors = validate.errors || [];
        throw new Error(`Schema validation failed: ${JSON.stringify(errors, null, 2)}`);
      }
    } catch (error: any) {
      vscode.window.showErrorMessage(`Error validating against schema: ${error.message}`);
      throw error;
    }
  }
}