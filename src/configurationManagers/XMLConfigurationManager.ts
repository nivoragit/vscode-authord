import { AbstractConfigManager } from './abstractConfigurationManager';
import * as vscode from 'vscode';
import * as path from 'path';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import Ajv from 'ajv';
import { InstanceConfig, TocElement } from '../utils/types';

export class XMLConfigurationManager extends AbstractConfigManager {
  private treeFileName: string = '';
  private ihpData: any;
  // titleToFileMap: Record<string, string> = {};

  constructor(configPath: string) {
    super(configPath);
  }

  /**
   * Reload ihpData from XML file and refresh local state, including this.instances.
   */
  async refresh(): Promise<void> {
    try {
      this.ihpData = await this.readIhpFile();
      await this.loadInstances();
    } catch (err: any) {
      vscode.window.showErrorMessage(`Error refreshing data: ${err.message}`);
      throw err;
    }
  }


  /**
   * Returns the directory path of the .ihp file.
   */
  private getIhpDir(): string {
    return path.dirname(this.configPath);
  }

  /**
   * Returns absolute path to the topics directory, or 'topics' if not set.
   */
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

  /**
   * Reads the .ihp file as XML. If missing, create a minimal default.
   */
  private async readIhpFile(): Promise<any> {
    try {
      const fileExists = await this.fileExists(this.configPath);
      if (!fileExists) {
        const defaultIhp = `<?xml version="1.0" encoding="UTF-8"?>
<ihp version="2.0">
  <topics dir="topics"/>
</ihp>`;
        await this.writeNewFile(this.configPath, defaultIhp);
      }
      const raw = await this.readFileAsString(this.configPath);
      const parser = new XMLParser({ ignoreAttributes: false });
      return parser.parse(raw);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to read .ihp file: ${err.message}`);
      throw err;
    }
  }

  /**
   * Writes updated ihpData back to the main .ihp file, preserving indentation.
   */
  private async writeIhpFile(): Promise<void> {
    try {
      await this.updateXmlFile(this.configPath, () => {
        // Return the mutated this.ihpData to be re-serialized
        return this.ihpData;
      });
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to write .ihp file: ${err.message}`);
      throw err;
    }
  }

  // ------------------------------------------------------------------------------------
  // LOADING INSTANCES .tree FILES
  // ------------------------------------------------------------------------------------

  /**
   * Reads each instance’s .tree file (if any) to build this.instances.
   */
  public async loadInstances(): Promise<InstanceConfig[]> {
    try {
      const ihp = this.ihpData?.ihp;
      // Normalize to an array of instance entries
      const arr = Array.isArray(ihp?.instance)
        ? ihp.instance
        : ihp?.instance
          ? [ihp.instance]
          : [];

      // If there are no instance entries, we can exit early
      if (arr.length === 0) {
        this.instances = [];
        return this.instances;
      }

      // Parallelize reading each .tree file using Promise.all
      const instanceProfiles = await Promise.all(
        arr.map(async (inst: any) => {
          // If there's no '@_src', skip
          if (!inst['@_src']) {
            return null;
          }

          const treeFile = path.join(this.getIhpDir(), inst['@_src']);

          // Check if .tree file exists
          if (!(await this.fileExists(treeFile))) {
            return null;
          }

          // Read and parse the instance profile
          const instanceProfile = await this.readInstanceProfile(treeFile);
          return instanceProfile || null; // Return null if invalid
        })
      );

      // Filter out null entries
      const validProfiles = instanceProfiles.filter(
        (profile) => profile !== null
      ) as InstanceConfig[];

      // Assign to this.instances
      this.instances = validProfiles;
      return this.instances;
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to load instances: ${err.message}`);
      throw err;
    }
  }

  private async readInstanceProfile(treeFile: string): Promise<InstanceConfig | null> {
    try {
      const raw = await this.readFileAsString(treeFile);
      const parser = new XMLParser({ ignoreAttributes: false });
      const data = parser.parse(raw);
      const profile = data['instance-profile'];
      if (!profile) { return null; }

      const docId = profile['@_id'];
      const name = profile['@_name'] || profile['@_id'] || 'Untitled';
      const startPage = profile['@_start-page'] || '';

      // Note the 'await' usage here to retrieve titles concurrently from .md files
      const tocElements: TocElement[] = await this.loadTocElements(profile['toc-element'] || []);

      return {
        id: docId,
        name,
        'start-page': startPage,
        'toc-elements': tocElements
      };
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to read instance profile from "${treeFile}": ${err.message}`);
      return null;
    }
  }

  /**
   * Reads each <toc-element> concurrently, extracting the title from its corresponding .md file,
   * and stores the "title -> filename" mapping asynchronously in titleToFileMap.
   * This is the most efficient approach, as Promise.all parallelizes the reads.
   */
  private async loadTocElements(xmlElements: any): Promise<TocElement[]> {
    if (!Array.isArray(xmlElements)) {
      xmlElements = xmlElements ? [xmlElements] : [];
    }

    const tasks = xmlElements.map(async (elem: any) => {
      const topicFile = elem['@_topic'];
      const children = await this.loadTocElements(elem['toc-element'] || []);

      // Attempt to read the .md file and retrieve a heading-based title
      const mdTitle = await this.getMdTitle(topicFile);

      // Asynchronously add to the dictionary (title -> filename)
      // this.titleToFileMap[mdTitle] = topicFile; todo remove

      return {
        topic: topicFile,
        title: mdTitle,
        sortChildren: 'none',
        children
      } as TocElement;
    });

    return Promise.all(tasks);
  }

  /**
   * Reads the corresponding .md file and returns the first heading line as the title.
   * Falls back to the filename if no heading is found or if the file is missing.
   */



  /**
   * Writes updated instance-profile data to the .tree file for a doc, preserving indentation.
   */
  protected async writeConfig(doc: InstanceConfig, filePath?: string): Promise<void> {
    try {
      if (!filePath) {
        filePath = await this.getFilePathForDoc(doc.id);
      }
      // Determine startPage based on TOC elements
      const startPage = doc['toc-elements'].length === 1 ? doc['toc-elements'][0].topic : doc['start-page'];

      // Build the profile object
      const profileObj = {
        'instance-profile': {
          '@_id': doc.id,
          '@_name': doc.name,
          '@_start-page': startPage,
          'toc-element': this.buildTocElements(doc['toc-elements'])
        }
      };

      // Configure the XMLBuilder with VS Code settings
      const builder = new XMLBuilder({
        ignoreAttributes: false,
        format: true, // Enable pretty formatting
        indentBy: await this.getIndentationSetting(),
        suppressEmptyNode: true
      });

      // Build XML content
      const xmlContent = builder.build(profileObj);

      // Insert the Writerside doctype
      const doctype = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE instance-profile SYSTEM \"https://resources.jetbrains.com/writerside/1.0/product-profile.dtd\">\n\n`;
      const fullContent = doctype + xmlContent;
      await this.writeNewFile(filePath, fullContent);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to write instance profile for doc "${doc.id}": ${err.message}`);
      throw err;
    }
  }

  /**
   * Recursively builds XML toc-element from our TocElement[].
   */
  private buildTocElements(elements: TocElement[]): any[] {
    return elements.map(e => {
      const node: any = { '@_topic': e.topic };
      if (e.children && e.children.length > 0) {
        node['toc-element'] = this.buildTocElements(e.children);
      }
      return node;
    });
  }

  /**
   * Finds the .tree file for a given docId by reading each instance’s .tree to confirm @id matches.
   */
  private async getFilePathForDoc(docId: string): Promise<string> {
    try {
      const ihp = this.ihpData?.ihp;
      const array = Array.isArray(ihp?.instance) ? ihp.instance : ihp?.instance ? [ihp.instance] : [];
      const parser = new XMLParser({ ignoreAttributes: false });

      for (const inst of array) {
        const treeSrc = inst['@_src'];
        if (!treeSrc) { continue; }

        const treeFile = path.join(this.getIhpDir(), treeSrc);
        if (!(await this.fileExists(treeFile))) { continue; }

        const raw = await this.readFileAsString(treeFile);
        const data = parser.parse(raw);
        const profile = data['instance-profile'];
        if (profile && profile['@_id'] === docId) {
          return treeFile;
        }
      }
      throw new Error(`No .tree file found for docId ${docId}`);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to locate .tree file for doc "${docId}": ${err.message}`);
      throw err;
    }
  }

  // ------------------------------------------------------------------------------------
  // DOCUMENT METHODS
  // ------------------------------------------------------------------------------------

  /**
   * Creates a new document -> writes a new .tree file -> updates .ihp -> ensures watchers.
   * Refactored to return Promise<boolean>.
   */
  async addDocument(newDocument: InstanceConfig): Promise<boolean> {
    try {
      this.treeFileName = `${newDocument.id}.tree`;
      const treeFilePath = path.join(this.getIhpDir(), this.treeFileName);

      // Update .ihp
      if (!this.ihpData.ihp.instance) {
        this.ihpData.ihp.instance = [];
      } else if (!Array.isArray(this.ihpData.ihp.instance)) {
        this.ihpData.ihp.instance = [this.ihpData.ihp.instance];
      }
      this.ihpData.ihp.instance.push({ '@_src': this.treeFileName });
      await this.writeIhpFile();

      // Update in memory
      this.instances.push(newDocument);

      // Create an initial .md file if the doc has a first TOC element
      if (newDocument['toc-elements'] && newDocument['toc-elements'][0]) {
        await this.writeTopicFile(newDocument['toc-elements'][0]);
      }
      if (await this.fileExists(treeFilePath)) {
        this.writeConfig(newDocument, treeFilePath);
        return true;
      } else {
        vscode.window.showErrorMessage(`Failed to add document "${newDocument.id}"`);
        return false;
      };

    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to add document "${newDocument.id}": ${err.message}`);
      return false;
    }
  }



  /**
   * Deletes a document -> removes associated topics -> updates .ihp -> removes .tree file.
   * Refactored to return Promise<boolean>.
   */
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

        // Find doc in memory
        const doc = this.instances.find(d => d.id === docId);
        if (doc) {
          // Remove all topics from disk
          const allTopics = this.getAllTopicsFromDoc(doc['toc-elements']);
          const topicsDir = this.getTopicsDir();
          await Promise.all(
            allTopics.map(async (tFile) => {
              const p = path.join(topicsDir, tFile);
              await this.deleteFileIfExists(p);
            })
          );

        }

        // Remove from .ihp
        arr.splice(idx, 1);
        if (arr.length === 1) {
          ihp.instance = arr[0];
        } else {
          ihp.instance = arr;
        }
        await this.writeIhpFile();

        // Remove .tree
        const treeFilePath = path.join(this.getIhpDir(), treeSrc);
        await this.deleteFileIfExists(treeFilePath);

        // Remove from instances
        this.instances = this.instances.filter(d => d.id !== docId);

        return true;
      }

      // docId not found
      vscode.window.showWarningMessage(`Document "${docId}" not found.`);
      return false;
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to delete document "${docId}": ${err.message}`);
      return false;
    }
  }




  /**
   * Finds the doc index by docId in the .ihp instance array by reading each .tree file to confirm match.
   */
  private async findDocumentIndex(instances: any[], docId: string): Promise<number> {
    try {
      const parser = new XMLParser({ ignoreAttributes: false });
      for (let i = 0; i < instances.length; i++) {
        const src = instances[i]['@_src'];
        if (!src) { continue; }
        const treeFile = path.join(this.getIhpDir(), src);
        if (!(await this.fileExists(treeFile))) { continue; }

        const raw = await this.readFileAsString(treeFile);
        const data = parser.parse(raw);
        const profile = data['instance-profile'];
        if (profile && profile['@_id'] === docId) {
          return i;
        }
      }
      return -1;
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to find document index for "${docId}": ${err.message}`);
      throw err;
    }
  }


  // ------------------------------------------------------------------------------------
  // FILE FOLDER UTILITIES
  // ------------------------------------------------------------------------------------
  /**
   * Utility to open an XML file, parse, mutate, replace content, and run `editor.action.formatDocument`.
   */
  private async updateXmlFile(
    filePath: string,
    mutateFn: (parsedXml: any) => any
  ): Promise<void> {
    let doc: vscode.TextDocument;
    try {
      doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to open XML file "${filePath}": ${err.message}`);
      throw err;
    }

    const originalText = doc.getText();
    const parser = new XMLParser({ ignoreAttributes: false, preserveOrder: true });

    let xmlObj;
    try {
      xmlObj = parser.parse(originalText);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to parse XML file "${filePath}": ${err.message}`);
      throw err;
    }

    // Apply your changes
    let mutatedXml;
    try {
      mutatedXml = mutateFn(xmlObj);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to mutate XML data: ${err.message}`);
      throw err;
    }

    // Rebuild
    const builder = new XMLBuilder({
      ignoreAttributes: false,
      format: true, // Enable pretty formatting
      indentBy: await this.getIndentationSetting(),
      suppressEmptyNode: true
    });

    let newXml: string;
    try {
      newXml = builder.build(mutatedXml);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to build updated XML: ${err.message}`);
      throw err;
    }

    // Replace content
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      doc.uri,
      new vscode.Range(doc.positionAt(0), doc.positionAt(originalText.length)),
      newXml
    );
    try {
      await vscode.workspace.applyEdit(edit);
      // Format Save
      await vscode.commands.executeCommand('editor.action.formatDocument', doc.uri);
      await doc.save();
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to apply edit/format/save XML file "${filePath}": ${err.message}`);
      throw err;
    }
  }

  // ------------------------------------------------------------------------------------
  // VALIDATION WITH AJV
  // ------------------------------------------------------------------------------------
  async validateAgainstSchema(schemaPath: string): Promise<void> {
    try {
      const ajv = new Ajv({ allErrors: true });
      const rawSchema = await vscode.workspace.fs.readFile(vscode.Uri.file(schemaPath));
      const schema = JSON.parse(Buffer.from(rawSchema).toString('utf-8'));

      const ihp = this.ihpData?.ihp;
      const topicsDir = ihp?.topics?.['@_dir'] || 'topics';
      let imagesObj: any;
      if (ihp?.images) {
        imagesObj = {
          dir: ihp.images['@_dir'],
          version: ihp.images['@_version'],
          'web-path': ihp.images['@_web-path']
        };
      }

      const configJson = {
        schema: this.ihpData?.schema,
        title: this.ihpData?.title,
        type: this.ihpData?.type,
        topics: { dir: topicsDir },
        images: imagesObj,
        instances: this.instances.map(inst => ({
          id: inst.id,
          name: inst.name,
          'start-page': inst['start-page'],
          'toc-elements': inst['toc-elements'].map(te => ({
            topic: te.topic,
            title: te.title,
            children: te.children
          }))
        }))
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

  /**
   * Recursively converts our TocElement[] into JSON for writing back to .tree/.ihp.
   */
  private convertTocElements(elements: TocElement[]): any[] {
    return elements.map(e => ({
      topic: e.topic,
      title: e.title,
      children: this.convertTocElements(e.children)
    }));
  }

}
