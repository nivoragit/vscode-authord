/************************************************************************************************
 * FILE: src/managers/XMLConfigurationManager.ts
 * Concrete manager for XML-based config
 ***********************************************************************************************/
import * as vscode from 'vscode';
import * as path from 'path';
import Ajv from 'ajv';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import AbstractConfigManager from './AbstractConfigManager';
import { XmlConfigObject } from '../config/ConfigObjects';
import { XmlConfigProvider } from '../config/XmlConfigProvider';
import { InstanceConfig, TocElement } from '../types';

export default class XMLConfigurationManager extends AbstractConfigManager<XmlConfigObject> {
  /** The entire .ihp-based structure after reading from the provider. */
  private ihpData: any = null;

  constructor(configPath: string) {
    super(new XmlConfigProvider(configPath));
  }

  protected loadInstancesFromConfig(): void {
    if (!this.config) {
      this.instances = [];
      return;
    }
    // store local reference for convenience
    this.ihpData = this.config.ihp;
    if (!this.ihpData) {
      this.instances = [];
      return;
    }
    // If the .ihp has <instance> elements, parse them or skip for brevity.
    // In more advanced code, you'd also parse .tree files. For now, just assume we have zero.
    this.instances = [];
  }

  /**
   * Writes changes for a single doc. In XML-based approach,
   * you might update the doc’s .tree, then update the .ihp references.
   */
  protected async writeConfig(doc: InstanceConfig): Promise<void> {
    // Example: write the doc’s .tree file
    // If you have an advanced method (like "getFilePathForDoc"), call it here:
    await this.saveFullConfig(); // or write the doc’s tree individually, then re-save .ihp
  }

  /**
   * Persists the entire .ihp back to disk (the root XML).
   */
  protected async saveFullConfig(): Promise<void> {
    if (!this.config) return;
    try {
      await this.provider.write(this.config);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to write XML config: ${err.message}`);
      throw err;
    }
  }

  public async validateAgainstSchema(schemaPath: string): Promise<void> {
    if (!this.config) {
      throw new Error('No XML configuration loaded for validation.');
    }
    const ajv = new Ajv({ allErrors: true });
    const rawSchema = await vscode.workspace.fs.readFile(vscode.Uri.file(schemaPath));
    const schema = JSON.parse(Buffer.from(rawSchema).toString('utf-8'));

    // Build an object that roughly corresponds to JSON structure
    const configJson = {
      schema: this.config.schema,
      title: this.config.title,
      type: this.config.type,
      topics: { dir: this.ihpData?.topics?.['@_dir'] || 'topics' },
      images: {
        dir: this.ihpData?.images?.['@_dir'] || 'images',
        version: this.ihpData?.images?.['@_version'],
        'web-path': this.ihpData?.images?.['@_web-path']
      },
      instances: this.instances
    };
    const validate = ajv.compile(schema);
    if (!validate(configJson)) {
      throw new Error(`Schema validation failed: ${JSON.stringify(validate.errors, null, 2)}`);
    }
  }

  public getTopicsDir(): string {
    const baseDir = path.dirname((this.provider as XmlConfigProvider)['filePath']);
    if (this.ihpData?.topics?.['@_dir']) {
      return path.join(baseDir, this.ihpData.topics['@_dir']);
    }
    return path.join(baseDir, 'topics');
  }

  public getImageDir(): string {
    const baseDir = path.dirname((this.provider as XmlConfigProvider)['filePath']);
    if (this.ihpData?.images?.['@_dir']) {
      return path.join(baseDir, this.ihpData.images['@_dir']);
    }
    return path.join(baseDir, 'images');
  }

  public async addDocument(newDocument: InstanceConfig): Promise<boolean> {
    // In a real scenario, you'd create the .tree file, update ihpData.<instance>, etc.
    this.instances.push(newDocument);
    await this.saveFullConfig();
    return true;
  }

  public async deleteDocument(docId: string): Promise<boolean> {
    const doc = this.findDocById(docId);
    if (!doc) return false;

    // remove doc’s topics from disk if needed...
    const topicsDir = this.getTopicsDir();
    const allTopics = this.getAllTopicsFromDoc(doc['toc-elements']);
    await Promise.all(allTopics.map((filename) => this.deleteFileIfExists(path.join(topicsDir, filename))));

    // remove from in-memory
    this.instances = this.instances.filter((d) => d.id !== docId);
    await this.saveFullConfig();
    return true;
  }
}
