// /**
//  * Example Jest test suite demonstrating how to unit test each method of AbstractConfigManager.
//  *
//  * Since AbstractConfigManager is abstract, we create a MockConfigManager that extends it
//  * and overrides the abstract methods. We then test all public and protected methods where possible.
//  */

// import * as vscode from 'vscode';
// import { InstanceConfig, TocElement } from '../utils/types';
// import { ConfigObject } from '../config/ConfigObjects';
// import { ConfigProvider } from '../config/ConfigProvider';
// import AbstractConfigManager from '../managers/AbstractConfigManager';

// // --------------------------------------------------
// // Mock Classes / Data
// // --------------------------------------------------
// interface MockConfig extends ConfigObject {
//   // Extend with any custom properties needed for tests
//   someValue?: string;
// }

// class MockConfigProvider implements ConfigProvider<MockConfig> {
//   private data: MockConfig;

//   constructor(initialData: MockConfig) {
//     this.data = initialData;
//   }

//   async read(): Promise<MockConfig> {
//     return this.data;
//   }

//   async write(newData: MockConfig): Promise<void> {
//     this.data = newData;
//   }
// }

// /**
//  * A concrete implementation of AbstractConfigManager for testing.
//  */
// class MockConfigManager extends AbstractConfigManager<MockConfig> {
//   private topicsDir = '/fake/topicsDir';
//   private imagesDir = '/fake/imagesDir';

//   protected loadInstancesFromConfig(): void {
//     // Example: just load from config property
//     this.instances = this.config?.instances || [];
//     // If there's a 'toc-elements' in each instance, build references, etc.
//     this.instances.forEach((inst) => {
//       if (inst['toc-elements']) {
//         this.buildParentReferences(inst['toc-elements'], undefined);
//       }
//     });
//   }

//   public getTopicsDir(): string {
//     return this.topicsDir;
//   }

//   public getImageDir(): string {
//     return this.imagesDir;
//   }

//   public async addDocument(newDocument: InstanceConfig): Promise<boolean> {
//     if (!this.config) return false;
//     this.config.instances = this.config.instances || [];
//     this.config.instances.push(newDocument);
//     await this.saveConfig();
//     return true;
//   }

//   public async deleteDocument(docId: string): Promise<boolean> {
//     if (!this.config || !this.config.instances) return false;
//     const index = this.config.instances.findIndex((i) => i.id === docId);
//     if (index === -1) return false;
//     this.config.instances.splice(index, 1);
//     await this.saveConfig();
//     return true;
//   }

//   public async validateAgainstSchema(schemaPath: string): Promise<void> {
//     // For test purposes, do nothing or throw if needed
//   }
// }

// // --------------------------------------------------
// // Test Suite
// // --------------------------------------------------
// describe('AbstractConfigManager', () => {
//   let mockProvider: MockConfigProvider;
//   let manager: MockConfigManager;

//   const sampleDocId = 'doc1';
//   const sampleInstance: InstanceConfig = {
//     id: sampleDocId,
//     name: 'Sample Document',
//     'start-page': 'index.md',
//     'toc-elements': [
//       {
//         topic: 'index.md',
//         title: 'Index',
//         children: [],
//       },
//       {
//         topic: 'intro.md',
//         title: 'Introduction',
//         children: [],
//       },
//     ],
//   };

//   beforeAll(() => {
//     // Mocks for VSCode APIs that might be called
//     jest.spyOn(vscode.window, 'showErrorMessage').mockImplementation(() => undefined);
//     jest.spyOn(vscode.window, 'showWarningMessage').mockImplementation(() => undefined);
//   });

//   beforeEach(() => {
//     // Reset our mock config and manager before each test
//     mockProvider = new MockConfigProvider({
//       instances: [sampleInstance], // initial data
//     });
//     manager = new MockConfigManager(mockProvider);
//   });

//   afterAll(() => {
//     jest.restoreAllMocks();
//   });

//   // --------------------------------------------------
//   // refresh()
//   // --------------------------------------------------
//   it('should refresh config and load instances', async () => {
//     await manager.refresh();
//     expect(manager.getDocuments()).toHaveLength(1);
//     expect(manager.getDocuments()[0].id).toBe(sampleDocId);
//   });

//   // --------------------------------------------------
//   // renameDocument()
//   // --------------------------------------------------
//   it('should rename a document successfully', async () => {
//     await manager.refresh();
//     const result = await manager.renameDocument(sampleDocId, 'Renamed Document');
//     expect(result).toBe(true);
//     expect(manager.getDocuments()[0].name).toBe('Renamed Document');
//   });

//   it('should fail to rename non-existing document', async () => {
//     await manager.refresh();
//     const result = await manager.renameDocument('wrong-id', 'New Name');
//     expect(result).toBe(false);
//     expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
//       expect.stringContaining('Document "wrong-id" not found for rename.')
//     );
//   });

//   // --------------------------------------------------
//   // moveTopics()
//   // --------------------------------------------------
//   it('should move a topic under a new target topic', async () => {
//     await manager.refresh();
//     const tocBefore = [...manager.getDocuments()[0]['toc-elements']];
//     expect(tocBefore).toHaveLength(2);

//     // Move "intro.md" under "index.md"
//     const updatedToc = await manager.moveTopics(sampleDocId, 'intro.md', 'index.md');
//     expect(updatedToc).toHaveLength(2); // root might still have 2, but "intro" is now a child of "index"
//     const indexTopic = updatedToc.find((t) => t.topic === 'index.md');
//     expect(indexTopic?.children).toHaveLength(1);
//     expect(indexTopic?.children[0].topic).toBe('intro.md');
//   });

//   // --------------------------------------------------
//   // deleteTopic()
//   // --------------------------------------------------
//   it('should delete a topic from the doc', async () => {
//     await manager.refresh();
//     const result = await manager.deleteTopic(sampleDocId, 'intro.md');
//     expect(result).toBe(true);

//     const doc = manager.getDocuments()[0];
//     expect(doc['toc-elements'].length).toBe(1);
//     expect(doc['toc-elements'][0].topic).toBe('index.md');
//   });

//   // --------------------------------------------------
//   // renameTopic()
//   // --------------------------------------------------
//   it('should rename an existing topic and update start-page if only one topic', async () => {
//     await manager.refresh();
//     // First, delete "intro.md" so there's only 1 topic
//     await manager.deleteTopic(sampleDocId, 'intro.md');

//     const result = await manager.renameTopic(sampleDocId, 'index.md', 'New Index');
//     expect(result).toBe(true);

//     const doc = manager.getDocuments()[0];
//     expect(doc['toc-elements'][0].title).toBe('New Index');
//     expect(doc['start-page']).toBe('new-index.md');
//   });

//   it('should fail to rename a non-existing topic', async () => {
//     await manager.refresh();
//     const result = await manager.renameTopic(sampleDocId, 'does-not-exist.md', 'Oops');
//     expect(result).toBe(false);
//     expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
//       expect.stringContaining('Topic "does-not-exist.md" not found in doc')
//     );
//   });

//   // --------------------------------------------------
//   // addChildTopic()
//   // --------------------------------------------------
//   it('should add a new child topic to an existing parent', async () => {
//     await manager.refresh();
//     const newTopic: TocElement = {
//       topic: 'child.md',
//       title: 'Child Topic',
//       children: [],
//     };
//     const result = await manager.addChildTopic(sampleDocId, 'index.md', newTopic);
//     expect(result).toBe(true);

//     const doc = manager.getDocuments()[0];
//     const indexTopic = doc['toc-elements'].find((t) => t.topic === 'index.md');
//     expect(indexTopic?.children).toHaveLength(1);
//     expect(indexTopic?.children[0].topic).toBe('child.md');
//   });

//   it('should add a new topic at root when parent is null', async () => {
//     await manager.refresh();
//     const newTopic: TocElement = {
//       topic: 'root-topic.md',
//       title: 'Root Topic',
//       children: [],
//     };
//     const result = await manager.addChildTopic(sampleDocId, null, newTopic);
//     expect(result).toBe(true);

//     const doc = manager.getDocuments()[0];
//     expect(doc['toc-elements'].some((t) => t.topic === 'root-topic.md')).toBe(true);
//   });

//   // --------------------------------------------------
//   // addSiblingTopic()
//   // --------------------------------------------------
//   it('should add a sibling topic to an existing topic', async () => {
//     await manager.refresh();
//     const newTopic: TocElement = {
//       topic: 'sibling.md',
//       title: 'Sibling Topic',
//       children: [],
//     };
//     const result = await manager.addSiblingTopic(sampleDocId, 'intro.md', newTopic);
//     expect(result).toBe(true);

//     const doc = manager.getDocuments()[0];
//     // 'intro.md' is at root, so new sibling is also at root
//     expect(doc['toc-elements'].find((t) => t.topic === 'sibling.md')).toBeDefined();
//   });

//   // --------------------------------------------------
//   // setAsStartPage()
//   // --------------------------------------------------
//   it('should set a valid topic as the start page', async () => {
//     await manager.refresh();
//     const result = await manager.setAsStartPage(sampleDocId, 'intro.md');
//     expect(result).toBe(true);

//     const doc = manager.getDocuments()[0];
//     expect(doc['start-page']).toBe('intro.md');
//   });

//   it('should fail to set start page if topic is not found', async () => {
//     await manager.refresh();
//     const result = await manager.setAsStartPage(sampleDocId, 'unknown.md');
//     expect(result).toBe(false);
//     expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
//       expect.stringContaining('Topic "unknown.md" not found in doc')
//     );
//   });

//   // --------------------------------------------------
//   // removeTopicFromDoc() - indirectly tested in deleteTopic/moveTopics
//   // --------------------------------------------------
//   it('should remove a topic from doc using removeTopicFromDoc (direct test)', async () => {
//     await manager.refresh();
//     const doc = manager.getDocuments()[0];
//     const removed = (manager as any).removeTopicFromDoc(doc['toc-elements'], 'intro.md');
//     expect(removed?.topic).toBe('intro.md');
//   });

//   // --------------------------------------------------
//   // extractTopicByFilename() - indirectly tested in deleteTopic
//   // --------------------------------------------------
//   it('should extract a topic using extractTopicByFilename (direct test)', async () => {
//     await manager.refresh();
//     const doc = manager.getDocuments()[0];
//     const extracted = (manager as any).extractTopicByFilename(doc['toc-elements'], 'intro.md');
//     expect(extracted?.topic).toBe('intro.md');
//   });

//   // --------------------------------------------------
//   // buildParentReferences() - indirectly tested in loadInstancesFromConfig
//   // --------------------------------------------------
//   it('should build parent references', async () => {
//     await manager.refresh();
//     const doc = manager.getDocuments()[0];
//     // The parent of "intro.md" should be undefined at root
//     const introTopic = doc['toc-elements'].find((t) => t.topic === 'intro.md');
//     expect(introTopic?.parent).toBeUndefined();
//   });

//   // --------------------------------------------------
//   // renameFileIfExists() - tested indirectly, we can do a direct test as well
//   // --------------------------------------------------
//   it('should rename file if exists', async () => {
//     // Mock FS
//     const statSpy = jest.spyOn(vscode.workspace.fs, 'stat').mockResolvedValueOnce({} as any);
//     const renameSpy = jest.spyOn(vscode.workspace.fs, 'rename').mockResolvedValueOnce();

//     // Attempt rename
//     await (MockConfigManager as any).renameFileIfExists('/fake/old.md', '/fake/new.md');
//     expect(statSpy).toHaveBeenCalledWith(vscode.Uri.file('/fake/old.md'));
//     expect(renameSpy).toHaveBeenCalledWith(
//       vscode.Uri.file('/fake/old.md'),
//       vscode.Uri.file('/fake/new.md')
//     );
//   });

//   it('should ignore rename if file does not exist', async () => {
//     // Mock FS to throw
//     const statSpy = jest.spyOn(vscode.workspace.fs, 'stat').mockRejectedValueOnce(new Error('Not found'));
//     const renameSpy = jest.spyOn(vscode.workspace.fs, 'rename').mockResolvedValueOnce();

//     // Attempt rename
//     await (MockConfigManager as any).renameFileIfExists('/fake/old.md', '/fake/new.md');
//     // rename should not be called if file is not found
//     expect(renameSpy).not.toHaveBeenCalled();
//   });

//   // --------------------------------------------------
//   // formatTitleAsFilename() - static
//   // --------------------------------------------------
//   it('should format title as filename', () => {
//     const filename = (MockConfigManager as any).formatTitleAsFilename('Some Title Here');
//     expect(filename).toBe('some-title-here.md');
//   });

//   // --------------------------------------------------
//   // addDocument() / deleteDocument() / validateAgainstSchema()
//   // --------------------------------------------------
//   it('should add a new document', async () => {
//     await manager.refresh();
//     const newDoc: InstanceConfig = {
//       id: 'doc2',
//       name: 'New Doc',
//       'start-page': 'index2.md',
//       'toc-elements': [],
//     };
//     const result = await manager.addDocument(newDoc);
//     expect(result).toBe(true);
//     expect(manager.getDocuments().find((d) => d.id === 'doc2')).toBeDefined();
//   });

//   it('should delete an existing document', async () => {
//     await manager.refresh();
//     const result = await manager.deleteDocument(sampleDocId);
//     expect(result).toBe(true);
//     expect(manager.getDocuments().find((d) => d.id === sampleDocId)).toBeUndefined();
//   });

//   it('should do nothing in validateAgainstSchema (for now)', async () => {
//     await manager.refresh();
//     await expect(manager.validateAgainstSchema('/some/path')).resolves.not.toThrow();
//   });
// });
