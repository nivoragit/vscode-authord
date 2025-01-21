/*
***********************************************************************************************
 * FILE: src/managers/XMLConfigurationManager.ts
 * Concrete manager for XML-based config
 **********************************************************************************************
 */
import * as vscode from 'vscode';
import * as path from 'path';
import Ajv from 'ajv';
import AbstractConfigManager from './AbstractConfigManager';
import { XmlConfigObject } from '../config/ConfigObjects';
import XmlConfigProvider from '../config/XmlConfigProvider';
import { InstanceConfig } from '../utils/types';

export default class XMLConfigurationManager extends AbstractConfigManager<XmlConfigObject> {
    constructor(configPath: string) {
        super(new XmlConfigProvider(configPath));
    }

    protected loadInstancesFromConfig(): void {
        if (!this.config) {
            this.instances = [];
            return;
        }
        const ihp = this.config.ihp;
        if (!ihp) {
            this.instances = [];
            return;
        }
        // Example usage: parse <ihp> to build your instance list, or read .tree files, etc.
        this.instances = [];

        // Build parent references for each doc’s TOC
        for (const doc of this.instances) {
            this.buildParentReferences(doc['toc-elements']);
        }
    }

    public async addDocument(newDocument: InstanceConfig): Promise<boolean> {
        try {
            this.instances.push(newDocument);
            // Update <ihp> structure if needed
            // ...
            this.buildParentReferences(newDocument['toc-elements']);

            await this.saveConfig();
            return true;
        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to add document "${newDocument.id}": ${err.message}`);
            return false;
        }
    }

    public async deleteDocument(docId: string): Promise<boolean> {
        try {
            this.instances = this.instances.filter((d) => d.id !== docId);
            // Also update <ihp> structure
            // ...
            await this.saveConfig();
            return true;
        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to delete document "${docId}": ${err.message}`);
            return false;
        }
    }

    public getTopicsDir(): string {
        if (!this.config) return '';
        const baseDir = path.dirname((this.provider as XmlConfigProvider)['filePath']);
        const ihp = this.config.ihp || {};
        return path.join(baseDir, ihp?.topics?.['@_dir'] || 'topics');
    }

    public getImageDir(): string {
        if (!this.config) return '';
        const baseDir = path.dirname((this.provider as XmlConfigProvider)['filePath']);
        const ihp = this.config.ihp || {};
        return path.join(baseDir, ihp?.images?.['@_dir'] || 'images');
    }

    public async validateAgainstSchema(schemaPath: string): Promise<void> {
        try {
            if (!this.config) {
                throw new Error('No configuration data available for schema validation.');
            }
            const ajv = new Ajv({ allErrors: true });
            const rawSchema = await vscode.workspace.fs.readFile(vscode.Uri.file(schemaPath));
            const schema = JSON.parse(Buffer.from(rawSchema).toString('utf-8'));

            const ihp = this.config.ihp;
            const configJson = {
                schema: this.config.schema,
                title: this.config.title,
                type: this.config.type,
                topics: { dir: ihp?.topics?.['@_dir'] || 'topics' },
                images: {
                    dir: ihp?.images?.['@_dir'] || 'images',
                    version: ihp?.images?.['@_version'],
                    'web-path': ihp?.images?.['@_web-path']
                },
                instances: this.instances
            };

            const validate = ajv.compile(schema);
            if (!validate(configJson)) {
                throw new Error(`Schema validation failed: ${JSON.stringify(validate.errors, null, 2)}`);
            }
        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to validate .ihp against schema: ${err.message}`);
            throw err;
        }
    }
}
