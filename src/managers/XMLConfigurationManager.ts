/* eslint-disable no-useless-constructor, no-continue, prefer-destructuring */
// eslint-disable-next-line import/no-unresolved
import * as vscode from 'vscode';
import * as path from 'path';
import { XMLBuilder } from 'fast-xml-parser';
import Ajv from 'ajv';
import { InstanceConfig, TocElement } from '../utils/types';
import FileService from '../services/fileService';
import AbstractConfigManager from './AbstractConfigManager';

export default class XMLConfigurationManager extends AbstractConfigManager {
  private ihpData: any;

  constructor(configPath: string) {
    super(configPath);
  }

  async refresh(): Promise<void> {
    try {
      this.ihpData = await this.readIhpFile();
      await this.loadInstances();
    } catch (err: any) {
      vscode.window.showErrorMessage(`Error refreshing data: ${err.message}`);
      throw err;
    }
  }

  private getIhpDir(): string {
    return path.dirname(this.configPath);
  }

  getTopicsDir(): string {
    const ihp = this.ihpData?.ihp;
    return path.join(
      this.getIhpDir(),
      ihp?.topics && ihp.topics['@_dir'] ? ihp.topics['@_dir'] : 'topics'
    );
  }

  getImageDir(): string {
    const ihp = this.ihpData?.ihp;
    return path.join(
      this.getIhpDir(),
      ihp?.images && ihp.images['@_dir'] ? ihp.images['@_dir'] : 'images'
    );
  }

  private async readIhpFile(): Promise<any> {
    try {
      const fileExists = await FileService.fileExists(this.configPath);
      if (!fileExists) {
        const defaultIhp = `<?xml version="1.0" encoding="UTF-8"?>
<ihp version="2.0">
  <topics dir="topics"/>
</ihp>`;
        await FileService.writeNewFile(this.configPath, defaultIhp);
      }
      const raw = await FileService.readFileAsString(this.configPath);
      return FileService.parseXmlString(raw);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to read .ihp file: ${err.message}`);
      throw err;
    }
  }

  private async writeIhpFile(): Promise<void> {
    try {
      await FileService.updateXmlFile(this.configPath, () => this.ihpData);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to write .ihp file: ${err.message}`);
      throw err;
    }
  }

  public async loadInstances(): Promise<InstanceConfig[]> {
    try {
      const ihp = this.ihpData?.ihp;
      let arr: any[] = [];
      if (Array.isArray(ihp?.instance)) {
        arr = ihp.instance;
      } else if (ihp?.instance) {
        arr = [ihp.instance];
      }

      if (arr.length === 0) {
        this.instances = [];
        return this.instances;
      }

      const instanceProfiles = await Promise.all(
        arr.map(async (inst: any) => {
          if (!inst['@_src']) {
            return null;
          }
          const treeFile = path.join(this.getIhpDir(), inst['@_src']);
          if (!(await FileService.fileExists(treeFile))) {
            return null;
          }
          return this.readInstanceProfile(treeFile);
        })
      );

      const validProfiles = instanceProfiles.filter(
        (profile) => profile !== null
      ) as InstanceConfig[];

      this.instances = validProfiles;
      return this.instances;
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to load instances: ${err.message}`);
      throw err;
    }
  }

  private async readInstanceProfile(treeFile: string): Promise<InstanceConfig | null> {
    try {
      const raw = await FileService.readFileAsString(treeFile);
      const data = FileService.parseXmlString(raw);
      const profile = data['instance-profile'];
      if (!profile) {
        return null;
      }

      const docId = profile['@_id'];
      const name = profile['@_name'] || profile['@_id'] || 'Untitled';
      const startPage = profile['@_start-page'] || '';
      const tocElements: TocElement[] = await this.loadTocElements(
        profile['toc-element'] || []
      );

      return { id: docId, name, 'start-page': startPage, 'toc-elements': tocElements };
    } catch (err: any) {
      vscode.window.showErrorMessage(
        `Failed to read instance profile from "${treeFile}": ${err.message}`
      );
      return null;
    }
  }

  /**
   * This is the most efficient approach to gather titles,
   * using Promise.all to parallelize .md reads.
   */
  private async loadTocElements(originalXmlElements: any): Promise<TocElement[]> {
    let xmlElements = originalXmlElements;
    if (!Array.isArray(xmlElements)) {
      xmlElements = xmlElements ? [xmlElements] : [];
    }

    const tasks = xmlElements.map(async (elem: any) => {
      const topicFile = elem['@_topic'];
      const children = await this.loadTocElements(elem['toc-element'] || []);
      const mdTitle = await this.getMdTitle(topicFile);

      return {
        topic: topicFile,
        title: mdTitle,
        sortChildren: 'none',
        children
      } as TocElement;
    });

    return Promise.all(tasks);
  }

  protected async writeConfig(doc: InstanceConfig, customFilePath?: string): Promise<void> {
    try {
      let filePath = customFilePath;
      if (!filePath) {
        filePath = await this.getFilePathForDoc(doc.id);
      }
      const startPage =
        doc['toc-elements'].length === 1 ? doc['toc-elements'][0].topic : doc['start-page'];

      const profileObj = {
        'instance-profile': {
          '@_id': doc.id,
          '@_name': doc.name,
          '@_start-page': startPage,
          'toc-element': this.buildTocElements(doc['toc-elements'])
        }
      };

      const xmlContent = await XMLConfigurationManager.buildXmlString(profileObj);
      const doctype = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE instance-profile SYSTEM "https://resources.jetbrains.com/writerside/1.0/product-profile.dtd">\n\n`;
      const fullContent = doctype + xmlContent;

      await FileService.writeNewFile(filePath, fullContent);
    } catch (err: any) {
      vscode.window.showErrorMessage(
        `Failed to write instance profile for doc "${doc.id}": ${err.message}`
      );
      throw err;
    }
  }

  private static async buildXmlString(profileObj: any): Promise<string> {
    const builder = new XMLBuilder({
      ignoreAttributes: false,
      format: true,
      indentBy: await FileService.getIndentationSetting(),
      suppressEmptyNode: true
    });
    return builder.build(profileObj);
  }

  private buildTocElements(elements: TocElement[]): any[] {
    return elements.map((e) => {
      const node: any = { '@_topic': e.topic };
      if (e.children && e.children.length > 0) {
        node['toc-element'] = this.buildTocElements(e.children);
      }
      return node;
    });
  }

  private async getFilePathForDoc(docId: string): Promise<string> {
    try {
      const ihp = this.ihpData?.ihp;
      let arr: any[] = [];
      if (Array.isArray(ihp?.instance)) {
        arr = ihp.instance;
      } else if (ihp?.instance) {
        arr = [ihp.instance];
      }

      for (let i = 0; i < arr.length; i += 1) {
        const inst = arr[i];
        const treeSrc = inst['@_src'];
        if (!treeSrc) {
          continue;
        }
        const treeFile = path.join(this.getIhpDir(), treeSrc);
        if (!(await FileService.fileExists(treeFile))) {
          continue;
        }
        const raw = await FileService.readFileAsString(treeFile);
        const data = FileService.parseXmlString(raw);
        const profile = data['instance-profile'];
        if (profile && profile['@_id'] === docId) {
          return treeFile;
        }
      }
      throw new Error(`No .tree file found for docId ${docId}`);
    } catch (err: any) {
      vscode.window.showErrorMessage(
        `Failed to locate .tree file for doc "${docId}": ${err.message}`
      );
      throw err;
    }
  }

  async addDocument(newDocument: InstanceConfig): Promise<void> {
    try {
      const treeFileName = `${newDocument.id}.tree`;
      const treeFilePath = path.join(this.getIhpDir(), treeFileName);

      await this.writeConfig(newDocument, treeFilePath);

      if (!this.ihpData.ihp.instance) {
        this.ihpData.ihp.instance = [];
      } else if (!Array.isArray(this.ihpData.ihp.instance)) {
        this.ihpData.ihp.instance = [this.ihpData.ihp.instance];
      }
      this.ihpData.ihp.instance.push({ '@_src': treeFileName });
      await this.writeIhpFile();

      this.instances.push(newDocument);
      if (newDocument['toc-elements']?.[0]) {
        await this.writeTopicFile(newDocument['toc-elements'][0]);
      }

      if (await FileService.fileExists(treeFilePath)) {
        // Re-write in case the firstTopic was just created
        await this.writeConfig(newDocument, treeFilePath);
      }
      vscode.window.showErrorMessage(`Failed to add document "${newDocument.id}"`);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to add document "${newDocument.id}": ${err.message}`);
    }
  }

  async deleteDocument(docId: string): Promise<boolean> {
    try {
      const ihp = this.ihpData?.ihp;
      if (!ihp.instance) {
        return false;
      }
      const arr = Array.isArray(ihp.instance) ? ihp.instance : [ihp.instance];
      const idx = await this.findDocumentIndex(arr, docId);
      if (idx > -1) {
        const treeSrc = arr[idx]['@_src'];
        const doc = this.instances.find((d) => d.id === docId);
        if (doc) {
          const allTopics = this.getAllTopicsFromDoc(doc['toc-elements']);
          const topicsDir = this.getTopicsDir();
          await Promise.all(
            allTopics.map(async (tFile) => {
              const p = path.join(topicsDir, tFile);
              await FileService.deleteFileIfExists(p);
            })
          );
        }
        arr.splice(idx, 1);
        if (arr.length === 1) {
          ihp.instance = arr[0];
        } else {
          ihp.instance = arr;
        }
        await this.writeIhpFile();
        const treeFilePath = path.join(this.getIhpDir(), treeSrc);
        await FileService.deleteFileIfExists(treeFilePath);
        this.instances = this.instances.filter((d) => d.id !== docId);
        return true;
      }
      vscode.window.showWarningMessage(`Document "${docId}" not found.`);
      return false;
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to delete document "${docId}": ${err.message}`);
      return false;
    }
  }

  private async findDocumentIndex(instances: any[], docId: string): Promise<number> {
    for (let i = 0; i < instances.length; i += 1) {
      const src = instances[i]['@_src'];
      if (!src) {
        continue;
      }
      const treeFile = path.join(this.getIhpDir(), src);
      if (!(await FileService.fileExists(treeFile))) {
        continue;
      }
      const raw = await FileService.readFileAsString(treeFile);
      const data = FileService.parseXmlString(raw);
      const profile = data['instance-profile'];
      if (profile && profile['@_id'] === docId) {
        return i;
      }
    }
    return -1;
  }

  async validateAgainstSchema(schemaPath: string): Promise<void> {
    try {
      const ajv = new Ajv({ allErrors: true });
      const rawSchema = await FileService.readFileAsString(schemaPath);
      const schema = JSON.parse(rawSchema);

      const ihp = this.ihpData?.ihp;
      const topicsDir = ihp?.topics?.['@_dir'] || 'topics';
      let imagesObj: any;
      if (ihp?.images) {
        imagesObj = {
          dir: ihp.images['@_dir'],
          version: ihp.images['@_version'],
          'web-path': ihp.images['@_web-path'],
        };
      }

      const configJson = {
        schema: this.ihpData?.schema,
        title: this.ihpData?.title,
        type: this.ihpData?.type,
        topics: { dir: topicsDir },
        images: imagesObj,
        instances: this.instances.map((inst) => ({
          id: inst.id,
          name: inst.name,
          'start-page': inst['start-page'],
          'toc-elements': inst['toc-elements'].map((te) => ({
            topic: te.topic,
            title: te.title,
            children: te.children,
          })),
        })),
      };

      const validate = ajv.compile(schema);
      if (!validate(configJson)) {
        throw new Error(
          `Schema validation failed: ${JSON.stringify(validate.errors, null, 2)}`
        );
      }
    } catch (err: any) {
      vscode.window.showErrorMessage(
        `Failed to validate .ihp against schema: ${err.message}`
      );
      throw err;
    }
  }
}
