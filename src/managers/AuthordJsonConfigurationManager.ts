/* eslint-disable no-param-reassign, no-useless-constructor, @typescript-eslint/no-unused-vars */
import * as path from 'path';
import Ajv from 'ajv';
import { AuthordConfig, InstanceConfig, TocElement } from '../utils/types';
import FileService from '../services/FileService';
import BaseConfigurationManager from './BaseConfigurationManager';
import TopicsService from '../services/TopicsService';

export default class AuthordJsonConfigurationManager extends BaseConfigurationManager {
    public configData: AuthordConfig | undefined;

    constructor(configPath: string) {
        super(configPath);
    }

    async reloadConfiguration(): Promise<void> {
        this.configData = await this.parseConfigFile();
        if (!this.configData) {
            return;
        }
        if (this.configData.instances) {
            // Load titles from each topic’s .md file
            await Promise.all(
                this.configData.instances.map(async (inst: InstanceConfig) => {
                    await Promise.all(
                        inst['toc-elements'].map(async (element: TocElement) => {
                            if (element.topic) {
                                element.title = await this.extractMarkdownTitle(element.topic);
                            }
                        })
                    );
                })
            );
        }
        this.instances = this.configData.instances || [];
    }

    async initializeConfigurationFile(): Promise<void> {
        this.configData = AuthordJsonConfigurationManager.defaultConfigJson();
        await this.saveConfigurationFile();
    }

    static defaultConfigJson(): AuthordConfig {
        return {
            schema: 'https://json-schema.org/draft/2020-12/schema',
            title: 'Authord Settings',
            type: 'object',
            topics: { dir: 'topics' },
            images: { dir: 'images', version: '1.0', 'web-path': 'images' },
            instances: [],
        };
    }

    private async parseConfigFile(): Promise<AuthordConfig | undefined> {
        if (!(await FileService.fileExists(this.configPath))) {
            return undefined;
        }
        return FileService.readJsonFile(this.configPath);
    }

    public async saveConfigurationFile(): Promise<void> {
        if (!this.configData) {
            return;
        }
        await FileService.updateJsonFile(this.configPath, () => this.configData!);
    }

    getTopicsDirectory(): string {
        return path.join(
            path.dirname(this.configPath),
            this.configData?.topics?.dir || 'topics'
        );
    }

    getImagesDirectory(): string {
        return path.join(
            path.dirname(this.configPath),
            this.configData?.images?.dir || 'images'
        );
    }

    async createDocument(newDocument: InstanceConfig): Promise<void> {
        if (!this.configData) {
            return;
        }
        this.instances.push(newDocument);

        const [firstTopic] = newDocument['toc-elements'];
        if (firstTopic) {
            await this.createTopicMarkdownFile(firstTopic);
        }

        if (
            firstTopic &&
            (await FileService.fileExists(path.join(this.getTopicsDirectory(), firstTopic.topic)))
        ) {
            // Persist changes to config
            this.configData.instances = this.instances;
            await this.saveConfigurationFile();
        }
    }

    async removeDocument(docId: string): Promise<boolean> {
        const foundDoc = this.instances.find((d: InstanceConfig) => d.id === docId);
        if (!foundDoc || !this.configData) {
            return false;
        }
        const topicsDir = this.getTopicsDirectory();
        const allTopics = TopicsService.getAllTopicsFromTocElement(foundDoc['toc-elements']);
        await Promise.all(
            allTopics.map(async (topicFileName: string) => {
                await FileService.deleteFileIfExists(path.join(topicsDir, topicFileName));
            })
        );
        this.instances = this.instances.filter((doc) => doc.id !== docId);
        this.configData.instances = this.instances;
        await this.saveConfigurationFile();
        return true;
    }

    public async saveDocumentConfig(doc: InstanceConfig, _filePath?: string): Promise<void> {
        if (!this.configData) {
            return;
        }

        // Check if the doc already exists; if so, update; otherwise, insert it.
        const existingIndex = this.instances.findIndex(d => d.id === doc.id);
        if (existingIndex >= 0) {
            this.instances[existingIndex] = doc;
        } else {
            this.instances.push(doc);
        }

        // Persist to config file
        this.configData.instances = this.instances;
        await this.saveConfigurationFile();
    }

}
