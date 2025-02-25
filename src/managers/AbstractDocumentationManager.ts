// eslint-disable-next-line import/no-unresolved
import * as vscode from 'vscode';
import * as path from 'path';
import { InstanceProfile, TocElement } from '../utils/types';
import FileService from '../services/FileService';
import { DocumentationManager } from './DocumentationManager';

export default abstract class AbstractDocumentationManager implements DocumentationManager {
    configPath: string;

    protected instances: InstanceProfile[] = [];

    constructor(configPath: string) {
        this.configPath = configPath;
    }

    public abstract saveInstance(
        _doc: InstanceProfile,
        _filePath?: string
    ): Promise<void>;

    abstract getTopicsDirectory(): string;

    abstract getImagesDirectory(): string;

    // Document-specific methods
    abstract createInstance(newDocument: InstanceProfile): Promise<void>;

    abstract removeInstance(docId: string): Promise<boolean>;

    // Refresh configuration
    abstract reload(): Promise<void>;

    getInstances(): InstanceProfile[] {
        return this.instances;
    }

    /**
     * Renames a topic’s file on disk and updates config accordingly.
     */
    async moveTopic(
        oldTopicFile: string,
        newTopicFile: string,
        doc: InstanceProfile
    ): Promise<void> {
        const topicsDir = this.getTopicsDirectory();
        const oldFileUri = vscode.Uri.file(path.join(topicsDir, oldTopicFile));
        const newFileUri = vscode.Uri.file(path.join(topicsDir, newTopicFile));
        await vscode.workspace.fs.rename(oldFileUri, newFileUri);
        await this.saveInstance(doc);
    }

    /**
     * Deletes one or more topic files -> removes from disk -> updates .tree/config.
     */
    async removeTopics(topicsFilestoBeRemoved: string[], doc: InstanceProfile): Promise<boolean> {
        const topicsDir = this.getTopicsDirectory();
        await Promise.all(
            topicsFilestoBeRemoved.map(async (tFile) =>
                FileService.deleteFileIfExists(path.join(topicsDir, tFile))
            )
        );
        await this.saveInstance(doc);
        return true;
    }

    /**
     * Adds a new child topic (and file) -> updates config if file is created.
     */
    async createChildTopic(
        newTopic: TocElement,
        doc: InstanceProfile
    ): Promise<void> {
        await this.createMarkdownFile(newTopic);
        const fileExists = await FileService.fileExists(path.join(this.getTopicsDirectory(), newTopic.topic));
        if (fileExists) {
            await this.saveInstance(doc);
        }
    }

    /**
     * Retrieves the title from a Markdown file’s first heading or uses fallback.
     */
    protected async extractMarkdownTitle(topicFile: string): Promise<string> {
        try {
            const mdFilePath = path.join(this.getTopicsDirectory(), topicFile);
            const content = await FileService.readFileAsString(mdFilePath);
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i += 1) {
                const line = lines[i].trim();
                if (line.startsWith('# ')) {
                    return line.substring(1).trim();
                }
                if (line.length > 0) {
                    break;
                }
            }
        } catch {
            // ignore
        }
        return `<${path.basename(topicFile)}>`;
    }

    public async setTopicTitle(topicFile: string, newTitle: string): Promise<void> {
        const mdFilePath = path.join(this.getTopicsDirectory(), topicFile);
      
        await FileService.updateFile(mdFilePath, (content) => {
          const lines = content.split('\n');
          
          for (let i = 0; i < lines.length; i += 1) {
            if (lines[i].trim().startsWith('# ')) {
              lines[i] = `# ${newTitle}`;
              return lines.join('\n');
            }
            if (lines[i].trim().length > 0) break;
          }
      
          // No title found, prepend it
          return `# ${newTitle}\n${content}`;
        });
      }
      


    /**
     * Writes a new .md file for the topic, if it doesn’t exist.
     */
    protected async createMarkdownFile(newTopic: TocElement): Promise<boolean> {
        try {
            const topicsDir = this.getTopicsDirectory();
            await vscode.workspace.fs.createDirectory(vscode.Uri.file(topicsDir));

            const filePath = path.join(topicsDir, newTopic.topic);
            if (await FileService.fileExists(filePath)) {
                vscode.window.showWarningMessage(`Topic file "${newTopic.topic}" already exists.`);
                return false;
            }

            await FileService.writeNewFile(
                filePath,
                `# ${newTopic.title}\n\nContent goes here...`
            );
            // Optionally open the new file in the editor:
            await vscode.commands.executeCommand('authordExtension.openMarkdownFile', filePath);
            return true;
        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to write topic file "${newTopic.topic}": ${err.message}`);
            throw err;
        }
    }
}
