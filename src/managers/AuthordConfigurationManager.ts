/*
***********************************************************************************************
 * FILE: src/managers/AuthordConfigurationManager.ts
 * Concrete manager for JSON-based config
 **********************************************************************************************
 */
import * as vscode from 'vscode';
import * as path from 'path';
import Ajv from 'ajv';
import AbstractConfigManager from './AbstractConfigManager';
import { JsonConfigObject } from '../config/ConfigObjects';
import JsonConfigProvider from '../config/JsonConfigProvider';
import { InstanceConfig } from '../utils/types';

export default class AuthordConfigurationManager extends AbstractConfigManager<JsonConfigObject> {
    constructor(configPath: string) {
      super(new JsonConfigProvider(configPath));
    }
  
    protected loadInstancesFromConfig(): void {
      if (!this.config) {
        this.instances = [];
        return;
      }
      this.instances = this.config.instances || [];
  
      // Build parent references for each doc’s TOC
      for (const doc of this.instances) {
        this.buildParentReferences(doc['toc-elements']);
      }
    }
  
    public async addDocument(newDocument: InstanceConfig): Promise<boolean> {
      try {
        if (!this.config) {
          vscode.window.showErrorMessage('Configuration data not initialized.');
          return false;
        }
        this.instances.push(newDocument);
        this.config.instances = this.instances;
  
        // Build parent references for the new doc
        this.buildParentReferences(newDocument['toc-elements']);
  
        await this.saveConfig();
        return true;
      } catch (error: any) {
        vscode.window.showErrorMessage(`Error adding document: ${error.message}`);
        return false;
      }
    }
  
    public async deleteDocument(docId: string): Promise<boolean> {
      try {
        this.instances = this.instances.filter((doc) => doc.id !== docId);
        if (this.config) {
          this.config.instances = this.instances;
        }
        await this.saveConfig();
        return true;
      } catch (error: any) {
        vscode.window.showErrorMessage(`Error deleting document with id "${docId}": ${error.message}`);
        return false;
      }
    }
  
    public getTopicsDir(): string {
      if (!this.config) return '';
      const baseDir = path.dirname((this.provider as JsonConfigProvider)['filePath']);
      return path.join(baseDir, this.config.topics?.dir || '');
    }
  
    public getImageDir(): string {
      if (!this.config) return '';
      const baseDir = path.dirname((this.provider as JsonConfigProvider)['filePath']);
      return path.join(baseDir, this.config.images?.dir || '');
    }
  
    public async validateAgainstSchema(schemaPath: string): Promise<void> {
      try {
        if (!this.config) {
          throw new Error('No configuration data available for schema validation.');
        }
        const ajv = new Ajv({ allErrors: true });
        const schemaData = await vscode.workspace.fs.readFile(vscode.Uri.file(schemaPath));
        const schema = JSON.parse(Buffer.from(schemaData).toString('utf-8'));
  
        const validate = ajv.compile(schema);
        const valid = validate(this.config);
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
  
