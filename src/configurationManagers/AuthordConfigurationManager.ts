/* eslint-disable no-param-reassign, no-useless-constructor, @typescript-eslint/no-unused-vars,
*/
// eslint-disable-next-line import/no-unresolved
import * as vscode from 'vscode';
import * as path from 'path';
import Ajv from 'ajv';
import AbstractConfigManager from './abstractConfigurationManager'; // Adjusted import for default export
import { InstanceConfig, TocElement } from '../utils/types';

export interface AuthordConfig {
  topics?: { dir: string };
  [key: string]: any;
}

export default class AuthordConfigurationManager extends AbstractConfigManager {
  configData: AuthordConfig | undefined;

  constructor(configPath: string) {
    super(configPath);
  }

  // ------------------------------------------------------------------------------------
  // FILE/JSON HELPERS
  // ------------------------------------------------------------------------------------

  /**
   * Reads a JSON file from disk.
   */
  private static async readJsonFile(filePath: string): Promise<any> {
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
  private async updateJsonFile(
    filePath: string,
    mutateFn: (jsonData: any) => any
  ): Promise<void> {
    try {
      const fileUri = vscode.Uri.file(filePath);
      // Ensure file exists; create it with default config if it doesn't.
      if (!(await this.fileExists(filePath)) && this.configData) {
        await this.writeNewFile(filePath, JSON.stringify(this.configData, null, 2));
        return;
      }

      const doc = await vscode.workspace.openTextDocument(fileUri);
      const originalText = doc.getText();

      let jsonData = JSON.parse(originalText);
      jsonData = mutateFn(jsonData);

      // Use indentation from the user/editor settings
      const indentation = await this.getIndentationSetting();

      // Example transformation: remove 'title' property before write
      // (For demonstration; adjust logic as needed)
      const instances = jsonData.instances.map((instance: InstanceConfig) => ({
        ...instance,
        'toc-elements': instance['toc-elements'].map(({ title, ...rest }: any) => rest),
      }));

      const newJsonString = JSON.stringify(
        { ...jsonData, instances },
        null,
        indentation
      );

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

  private static defaultConfigJson(): AuthordConfig {
    return {
      schema: 'https://json-schema.org/draft/2020-12/schema',
      title: 'Authord Settings',
      type: 'object',
      topics: { dir: 'topics' },
      images: { dir: 'images', version: '1.0', 'web-path': 'images' },
      instances: [],
    };
  }

  private async readConfig(): Promise<AuthordConfig | undefined> {
    try {
      if (!(await this.fileExists(this.configPath))) {
        return undefined;
      }
      return await AuthordConfigurationManager.readJsonFile(this.configPath);
    } catch (error: any) {
      vscode.window.showErrorMessage(`Error reading config: ${error.message}`);
      throw error;
    }
  }
  
  protected async writeConfig(): Promise<void> {
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
      if (!this.configData) {
        return;
      }
      await Promise.all(
        this.configData.instances.map(async (inst: InstanceConfig) => {
          await Promise.all(
            inst['toc-elements'].map(async (element: TocElement) => {
              if (element.topic) {
                // from parent class
                element.title = await this.getMdTitle(element.topic);
              }
            })
          );
        })
      );
      this.instances = this.configData.instances;
    } catch (error: any) {
      vscode.window.showErrorMessage(`Error refreshing configuration: ${error.message}`);
    }
  }

  async createConfigFile(): Promise<AuthordConfigurationManager> {
    try {
      this.configData = AuthordConfigurationManager.defaultConfigJson();
      await this.writeConfig();
      return this;
    } catch (error: any) {
      vscode.window.showErrorMessage(`Error creating config file: ${error.message}`);
      throw error;
    }
  }

  getTopicsDir(): string {
    return path.join(path.dirname(this.configPath), this.configData?.topics?.dir || '');
  }

  getImageDir(): string {
    return path.join(path.dirname(this.configPath), this.configData?.images?.dir || '');
  }

  async addDocument(newDocument: InstanceConfig): Promise<boolean> {
    try {
      if (!this.configData) {
        vscode.window.showErrorMessage('Configuration data not initialized.');
        return false;
      }
      // from parent class
      this.instances.push(newDocument);

      const [firstTopic] = newDocument['toc-elements'];
      if (firstTopic) {
        await this.writeTopicFile(firstTopic);
      }

      // Ensure the file was created before writing config
      if (await this.fileExists(path.join(this.getTopicsDir(), firstTopic.topic))) {
        await this.writeConfig();
        return true;
      }
      vscode.window.showErrorMessage('Error adding document');
      return false;
    } catch (error: any) {
      vscode.window.showErrorMessage(`Error adding document: ${error.message}`);
      return false;
    }
  }

  async deleteDocument(docId: string): Promise<boolean> {
    try {
      const foundDoc = this.findDocById(docId);
      if (!foundDoc || !this.configData) {
        return false;
      }
      const topicsDir = this.getTopicsDir();
      const allTopics = this.getAllTopicsFromDoc(foundDoc['toc-elements']);
      await Promise.all(
        allTopics.map(async (topicFileName: string) => {
          const filePath = path.join(topicsDir, topicFileName);
          await this.deleteFileIfExists(filePath);
        })
      );
      this.instances = this.instances.filter((doc: InstanceConfig) => doc.id !== docId);
      await this.writeConfig();
      return true;
    } catch (error: any) {
      vscode.window.showErrorMessage(`Error deleting document with id "${docId}": ${error.message}`);
      return false;
    }
  }

  // ------------------------------------------------------------------------------------
  // SCHEMA VALIDATION
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
