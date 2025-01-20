/************************************************************************************************
 * FILE: src/managers/AuthordConfigurationManager.ts
 * Concrete manager for JSON-based config
 ***********************************************************************************************/
import * as vscode from 'vscode';
import * as path from 'path';
import Ajv from 'ajv';
import AbstractConfigManager from './AbstractConfigManager';
import { JsonConfigObject } from '../config/ConfigObjects';
import { JsonConfigProvider } from '../config/JsonConfigProvider';
import { InstanceConfig } from '../types';

/** Example shape for the JSON config (mirroring original "AuthordConfig"). */
export interface AuthordConfig extends JsonConfigObject {
  images?: { dir: string; version?: string; 'web-path'?: string };
  // ... any other fields
}

export default class AuthordConfigurationManager extends AbstractConfigManager<JsonConfigObject> {
  /** Optionally store the entire JSON in memory after reading. */
  protected configData: AuthordConfig | null = null;

  constructor(configPath: string) {
    super(new JsonConfigProvider(configPath));
  }

  /** Load `this.instances` from `this.configData` once read. */
  protected loadInstancesFromConfig(): void {
    if (!this.config) {
      this.instances = [];
      return;
    }
    // treat `this.config` as AuthordConfig
    this.configData = this.config as AuthordConfig;
    this.instances = this.configData.instances || [];
  }

  /** Called by domain methods to persist changes for a single doc. */
  protected async writeConfig(doc: InstanceConfig): Promise<void> {
    // In JSON approach, writing a single doc typically means rewriting the entire config.
    // Just call `saveFullConfig()` to persist the entire data.
    await this.saveFullConfig();
  }

  /** Rewrites the entire JSON config object via the provider. */
  protected async saveFullConfig(): Promise<void> {
    if (!this.configData) return;
    try {
      // sync in-memory `this.instances` back to configData
      this.configData.instances = this.instances;
      await this.provider.write(this.configData);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Error saving JSON config: ${err.message}`);
      throw err;
    }
  }

  public async validateAgainstSchema(schemaPath: string): Promise<void> {
    try {
      if (!this.configData) {
        throw new Error('No configuration data available for schema validation.');
      }
      const ajv = new Ajv({ allErrors: true });
      const raw = await vscode.workspace.fs.readFile(vscode.Uri.file(schemaPath));
      const schema = JSON.parse(Buffer.from(raw).toString('utf-8'));

      const validate = ajv.compile(schema);
      const valid = validate(this.configData);
      if (!valid) {
        const errors = validate.errors || [];
        throw new Error(`Schema validation failed: ${JSON.stringify(errors, null, 2)}`);
      }
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to validate JSON config: ${err.message}`);
      throw err;
    }
  }

  /** Return topics folder from config or default. */
  public getTopicsDir(): string {
    const base = path.dirname((this.provider as JsonConfigProvider)['filePath']);
    if (this.configData && this.configData.topics?.dir) {
      return path.join(base, this.configData.topics.dir);
    }
    return path.join(base, 'topics');
  }

  public getImageDir(): string {
    const base = path.dirname((this.provider as JsonConfigProvider)['filePath']);
    if (this.configData && this.configData.images?.dir) {
      return path.join(base, this.configData.images.dir);
    }
    return path.join(base, 'images');
  }

  /** Domain method: add a new doc. */
  public async addDocument(newDocument: InstanceConfig): Promise<boolean> {
    if (!this.configData) {
      vscode.window.showErrorMessage('Configuration data not loaded.');
      return false;
    }
    this.instances.push(newDocument);
    // If doc has an initial topic, create the file.
    const [firstTopic] = newDocument['toc-elements'];
    if (firstTopic) {
      await this.writeTopicFile(firstTopic);
    }
    // confirm file exists
    if (firstTopic && (await this.fileExists(path.join(this.getTopicsDir(), firstTopic.topic)))) {
      await this.saveFullConfig(); // rewrite JSON
      return true;
    }
    vscode.window.showErrorMessage('Error adding document (could not create first topic).');
    return false;
  }

  /** Domain method: delete a doc. */
  public async deleteDocument(docId: string): Promise<boolean> {
    if (!this.configData) return false;
    const doc = this.findDocById(docId);
    if (!doc) return false;

    // remove doc’s topics from disk
    const topicsDir = this.getTopicsDir();
    const allTopics = this.getAllTopicsFromDoc(doc['toc-elements']);
    await Promise.all(allTopics.map((filename) => this.deleteFileIfExists(path.join(topicsDir, filename))));

    // remove from in-memory
    this.instances = this.instances.filter((d) => d.id !== docId);
    await this.saveFullConfig();
    return true;
  }
}
