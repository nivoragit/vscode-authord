/* eslint-disable no-useless-constructor, no-continue, prefer-destructuring */
import * as path from 'path';
import { XMLBuilder } from 'fast-xml-parser';
import {InstanceProfile, TocElement, WriterSideInstanceProfile} from '../utils/types';
import FileService from '../services/FileService';
import AbstractDocumentationManager from './AbstractDocumentationManager';
import TopicsService from '../services/TopicsService';
import {DocumentationManager} from "./DocumentationManager";

export default class WriterSideDocumentManager extends AbstractDocumentationManager implements DocumentationManager {
    
    public ihpData: any;

    constructor(configPath: string) {
        super(configPath);
    }

    async reload(): Promise<void> {
        this.ihpData = await this.readIhpFile();
        await this.loadAllInstances();
    }

    private getIhpDir(): string {
        return path.dirname(this.configPath);
    }

    getTopicsDirectory(): string {
        const ihp = this.ihpData?.ihp;
        return path.join(
            this.getIhpDir(),
            ihp?.topics && ihp.topics['@_dir'] ? ihp.topics['@_dir'] : 'topics'
        );
    }

    getImagesDirectory(): string {
        const ihp = this.ihpData?.ihp;
        return path.join(
            this.getIhpDir(),
            ihp?.images && ihp.images['@_dir'] ? ihp.images['@_dir'] : 'images'
        );
    }

    private async readIhpFile(): Promise<any> {
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
    }

    private async writeIhpFile(): Promise<void> {
        await FileService.updateXmlFile(this.configPath, () => this.ihpData);
    }

    public async loadAllInstances(): Promise<InstanceProfile[]> {
        const ihp = this.ihpData?.ihp;
        let instances: any[] = [];
        if (Array.isArray(ihp?.instance)) {
            instances = ihp.instance;
        } else if (ihp?.instance) {
            instances = [ihp.instance];
        }

        if (instances.length === 0) {
            this.instances = [];
            return this.instances;
        }

        const instanceProfiles = await Promise.all(
            instances.map(async (inst: any) => {
                if (!inst['@_src']) {
                    return null;
                }
                const treeFile = path.join(this.getIhpDir(), inst['@_src']);
                if (!(await FileService.fileExists(treeFile))) {
                    return null;
                }
                return this.parseInstanceProfile(treeFile);
            })
        );

        const validProfiles = instanceProfiles.filter(
            (profile) => profile !== null
        ) as InstanceProfile[];

        this.instances = validProfiles;
        return this.instances;
    }

    private async parseInstanceProfile(treeFile: string): Promise<WriterSideInstanceProfile | null> {
        const raw = await FileService.readFileAsString(treeFile);
        const data = FileService.parseXmlString(raw);
        const profile = data['instance-profile'];
        if (!profile) {
            return null;
        }

        const docId = profile['@_id'];
        const name = profile['@_name'] || profile['@_id'] || 'Untitled';
        const startPage = profile['@_start-page'] || '';
        const tocElements: TocElement[] = await this.buildTocElements(
            profile['toc-element'] || []
        );

        return {
            filePath: treeFile,
            id: docId,
            name,
            'start-page': startPage,
            'toc-elements': tocElements
        };
    }

    /**
     * This is the most efficient approach to gather titles (parallel reading).
     */
    private async buildTocElements(originalXmlElements: any): Promise<TocElement[]> {
        let xmlElements = originalXmlElements;
        if (!Array.isArray(xmlElements)) {
            xmlElements = xmlElements ? [xmlElements] : [];
        }

        const tasks = xmlElements.map(async (elem: any) => {
            const topicFile = elem['@_topic'];
            const children = await this.buildTocElements(elem['toc-element'] || []);
            const mdTitle = await this.extractMarkdownTitle(topicFile);

            return {
                topic: topicFile,
                title: mdTitle,
                sortChildren: 'none',
                children
            } as TocElement;
        });

        return Promise.all(tasks);
    }

    public async saveInstance(doc: WriterSideInstanceProfile): Promise<void> {
        const filePath = doc.filePath;
        const startPage =
            doc['toc-elements'].length === 1 ? doc['toc-elements'][0].topic : doc['start-page'];

        const profileObj = {
            'instance-profile': {
                '@_id': doc.id,
                '@_name': doc.name,
                '@_start-page': startPage,
                'toc-element': this.createXmlTocNodes(doc['toc-elements'])
            }
        };

        const xmlContent = await WriterSideDocumentManager.convertToXmlString(profileObj);
        const doctype = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE instance-profile SYSTEM "https://resources.jetbrains.com/writerside/1.0/product-profile.dtd">\n\n`;
        const fullContent = doctype + xmlContent;

        await FileService.writeNewFile(filePath, fullContent);
    }

    private static async convertToXmlString(profileObj: any): Promise<string> {
        const builder = new XMLBuilder({
            ignoreAttributes: false,
            format: true,
            indentBy: await FileService.getIndentationSetting(),
            suppressEmptyNode: true
        });
        return builder.build(profileObj);
    }

    private createXmlTocNodes(elements: TocElement[]): any[] {
        return elements.map((e) => {
            const node: any = { '@_topic': e.topic };
            if (e.children && e.children.length > 0) {
                node['toc-element'] = this.createXmlTocNodes(e.children);
            }
            return node;
        });
    }

    async createInstance(newDocument: WriterSideInstanceProfile): Promise<void> {
        const treeFileName = `${newDocument.id}.tree`;
        newDocument.filePath = path.join(path.dirname(this.configPath), treeFileName); 
        await this.saveInstance(newDocument);

        if (!this.ihpData.ihp.instance) {
            this.ihpData.ihp.instance = [];
        } else if (!Array.isArray(this.ihpData.ihp.instance)) {
            this.ihpData.ihp.instance = [this.ihpData.ihp.instance];
        }
        this.ihpData.ihp.instance.push({ '@_src': treeFileName });
        await this.writeIhpFile();

        this.instances.push(newDocument);

        const title = newDocument['toc-elements'][0].title;
        let markdownFileExists = await this.createMarkdownFile(newDocument['toc-elements'][0]);
        // if file name already exists
        let i = 2
        while(!markdownFileExists){
            newDocument['toc-elements'][0].title = `${title} ${i}`;
            markdownFileExists = await this.createMarkdownFile(newDocument['toc-elements'][0]);
            i += 1;
        }
        
    }

    async removeInstance(docId: string): Promise<boolean> {
        const ihp = this.ihpData?.ihp;
        if (!ihp.instance) {
            return false;
        }
        const arr = Array.isArray(ihp.instance) ? ihp.instance : [ihp.instance];
        const idx = await this.locateDocumentIndex(arr, docId);
        if (idx > -1) {
            const treeSrc = arr[idx]['@_src'];
            const doc = this.instances.find((d) => d.id === docId);
            if (doc) {
                const allTopics = TopicsService.getAllTopicsFromTocElement(doc['toc-elements']);
                const topicsDir = this.getTopicsDirectory();
                await Promise.all(
                    allTopics.map(async (tFile: string) => {
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
        return false;
    }

    private async locateDocumentIndex(instances: any[], docId: string): Promise<number> {
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
}
