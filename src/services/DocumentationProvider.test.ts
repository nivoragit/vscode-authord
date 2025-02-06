
import * as mockVSCode from '../../__mocks__/vscode';
import DocumentationProvider from './DocumentationProvider';
import TopicsProvider from './TopicsProvider';
import DocumentationService from './DocumentationService';
import DocumentationItem from './DocumentationItem';
import { InstanceConfig } from '../utils/types';
import TopicsService from './TopicsService';
import { IDocumentManager } from '../managers/IDocumentManager';
import AuthordDocumentManager from '../managers/AuthordDocumentManager';

// Mock external services/classes
jest.mock('./DocumentationService');
jest.mock('./TopicsProvider');

// Utility function to build a DocumentationItem
function createDocItem(
    id: string | undefined,
    label: string
): DocumentationItem {
    // In your actual code, ensure DocumentationItem's constructor accepts (label: string, collapsibleState: number, id?: string)
    return new DocumentationItem(id!, label, mockVSCode.TreeItemCollapsibleState.Collapsed);
}

describe('DocumentationProvider', () => {
    let documentationProvider: DocumentationProvider;
    let mockDocService: jest.Mocked<DocumentationService>;
    let mockTopicsProvider: jest.Mocked<TopicsProvider>;
    let mockConfigManager: jest.Mocked<IDocumentManager>;
    let mockTopicsService: jest.Mocked<TopicsService>;


    beforeEach(() => {
        jest.clearAllMocks();
        // Mocked TopicsService
        mockTopicsService = {
            createTreeItem: jest.fn(),
            moveTopic: jest.fn(),
            addChildTopic: jest.fn(),
            getParentByTopic: jest.fn(),
            renameTopic: jest.fn(),
            topicExists: jest.fn(),
            deleteTopic: jest.fn(),
            removeTopicFromTree: jest.fn(),
            findTopicItemByFilename: jest.fn(),
            setAsStartPage: jest.fn()
        } as any;
        const mockConfigPath = '/project/config.ihp';
        mockConfigManager = new AuthordDocumentManager(mockConfigPath) as any;
        // Properly instantiate mock services with required constructor args
        mockDocService = new DocumentationService(mockConfigManager) as jest.Mocked<DocumentationService>;
        mockTopicsProvider = new TopicsProvider(mockTopicsService) as jest.Mocked<TopicsProvider>;

        // Create our DocumentationProvider instance
        documentationProvider = new DocumentationProvider(mockDocService, mockTopicsProvider);
    });

    describe('Constructor', () => {
        it('calls refresh on instantiation', () => {
            // The refresh is called in the constructor
            expect((documentationProvider as any).onDidChangeTreeDataEmitter.fire).toHaveBeenCalledTimes(1);
        });
    });

    describe('refresh', () => {
        it('should trigger onDidChangeTreeDataEmitter.fire', () => {
            const fireSpy = jest.spyOn((documentationProvider as any).onDidChangeTreeDataEmitter, 'fire');
            documentationProvider.refresh();
            expect(fireSpy).toHaveBeenCalled();
        });
    });

    describe('getTreeItem', () => {
        it('should return the given DocumentationItem', () => {
            const item = createDocItem('doc1', 'Documentation 1');
            const result = documentationProvider.getTreeItem(item);
            expect(result).toBe(item);
        });
    });

    describe('getChildren', () => {
        it('should return items from docService.getDocumentationItems', async () => {
            const mockItems = [
                createDocItem('doc1', 'Doc 1'),
                createDocItem('doc2', 'Doc 2'),
            ];
            mockDocService.getDocumentationItems.mockReturnValue(mockItems);

            const result = await documentationProvider.getChildren();
            expect(result).toEqual(mockItems);
            expect(mockDocService.getDocumentationItems).toHaveBeenCalled();
        });
    });

    describe('deleteDoc', () => {
        it('should warn if item has no id', async () => {
            const item = createDocItem(undefined, 'No ID');
            await documentationProvider.deleteDoc(item);
            expect(mockVSCode.window.showWarningMessage).toHaveBeenCalledWith('No document selected for deletion.');
            expect(mockDocService.deleteDoc).not.toHaveBeenCalled();
        });

        it('should confirm deletion and delete if user chooses Yes', async () => {
            (mockVSCode.window.showWarningMessage as jest.Mock).mockResolvedValue('Yes');
            mockDocService.deleteDoc.mockResolvedValue(true);

            const item = createDocItem('doc1', 'Doc 1');
            await documentationProvider.deleteDoc(item);

            expect(mockVSCode.window.showWarningMessage).toHaveBeenCalledWith(
                'Are you sure you want to delete documentation "Doc 1"?',
                { modal: true },
                'Yes'
            );
            expect(mockDocService.deleteDoc).toHaveBeenCalledWith('doc1');
            expect(mockVSCode.window.showInformationMessage).toHaveBeenCalledWith('Deleted documentation "Doc 1".');
            expect(mockTopicsProvider.refresh).toHaveBeenCalled();
        });

        it('should abort if user does not select Yes', async () => {
            (mockVSCode.window.showWarningMessage as jest.Mock).mockResolvedValue(undefined);

            const item = createDocItem('doc1', 'Doc 1');
            await documentationProvider.deleteDoc(item);

            expect(mockDocService.deleteDoc).not.toHaveBeenCalled();
            expect(mockVSCode.window.showInformationMessage).not.toHaveBeenCalled();
        });

        it('should show error message if deletion fails', async () => {
            (mockVSCode.window.showWarningMessage as jest.Mock).mockResolvedValue('Yes');
            mockDocService.deleteDoc.mockResolvedValue(false);

            const item = createDocItem('doc1', 'Doc 1');
            await documentationProvider.deleteDoc(item);

            expect(mockVSCode.window.showErrorMessage).toHaveBeenCalledWith('Failed to delete documentation "Doc 1".');
        });

        it('should catch and display error message if an error is thrown', async () => {
            (mockVSCode.window.showWarningMessage as jest.Mock).mockResolvedValue('Yes');
            mockDocService.deleteDoc.mockRejectedValue(new Error('Deletion error'));

            const item = createDocItem('doc1', 'Doc 1');
            await documentationProvider.deleteDoc(item);

            expect(mockVSCode.window.showErrorMessage).toHaveBeenCalledWith(
                'Error while deleting documentation: Error: Deletion error'
            );
        });
    });

    describe('renameDoc', () => {
        it('should warn if no id', async () => {
            const item = createDocItem(undefined, 'No ID');
            await documentationProvider.renameDoc(item);

            expect(mockVSCode.window.showWarningMessage).toHaveBeenCalledWith('No document selected for rename.');
            expect(mockDocService.renameDoc).not.toHaveBeenCalled();
        });

        it('should prompt for new name and rename doc successfully', async () => {
            (mockVSCode.window.showInputBox as jest.Mock).mockResolvedValue('New Name');
            mockDocService.renameDoc.mockResolvedValue(true);

            const item = createDocItem('doc1', 'Old Name');
            await documentationProvider.renameDoc(item);

            expect(mockVSCode.window.showInputBox).toHaveBeenCalledWith({
                prompt: 'Enter new documentation name',
                value: 'Old Name',
            });
            expect(mockDocService.renameDoc).toHaveBeenCalledWith('doc1', 'New Name');
            expect(mockVSCode.window.showInformationMessage).toHaveBeenCalledWith(
                'Renamed documentation "Old Name" to "New Name".'
            );
        });

        it('should do nothing if user cancels input', async () => {
            (mockVSCode.window.showInputBox as jest.Mock).mockResolvedValue('');

            const item = createDocItem('doc1', 'Old Name');
            await documentationProvider.renameDoc(item);

            expect(mockDocService.renameDoc).not.toHaveBeenCalled();
            expect(mockVSCode.window.showWarningMessage).toHaveBeenCalledWith('Rename canceled.');
        });

        it('should show error message on rename failure', async () => {
            (mockVSCode.window.showInputBox as jest.Mock).mockResolvedValue('New Name');
            mockDocService.renameDoc.mockResolvedValue(false);

            const item = createDocItem('doc1', 'Old Name');
            await documentationProvider.renameDoc(item);

            expect(mockVSCode.window.showErrorMessage).toHaveBeenCalledWith('Failed to rename documentation "Old Name".');
        });

        it('should catch and show error message if renameDoc throws', async () => {
            (mockVSCode.window.showInputBox as jest.Mock).mockResolvedValue('New Name');
            mockDocService.renameDoc.mockRejectedValue(new Error('Rename error'));

            const item = createDocItem('doc1', 'Old Name');
            await documentationProvider.renameDoc(item);

            expect(mockVSCode.window.showErrorMessage).toHaveBeenCalledWith(
                'Error while renaming documentation: Error: Rename error'
            );
        });
    });

    describe('addDoc', () => {
        beforeEach(() => {
            mockDocService.isDocIdUnique.mockReturnValue(true);
            mockDocService.addDoc.mockResolvedValue({
                id: 'someId',
                name: 'Some Name',
                'toc-elements': [],
            } as InstanceConfig);
        });

        it('should warn if user cancels doc name input', async () => {
            (mockVSCode.window.showInputBox as jest.Mock).mockResolvedValueOnce('');

            await documentationProvider.addDoc();
            expect(mockVSCode.window.showWarningMessage).toHaveBeenCalledWith('Document creation canceled.');
            expect(mockDocService.addDoc).not.toHaveBeenCalled();
        });

        it('should warn if user cancels doc ID input', async () => {
            (mockVSCode.window.showInputBox as jest.Mock)
                .mockResolvedValueOnce('My Doc') // doc name
                .mockResolvedValueOnce(''); // doc ID

            await documentationProvider.addDoc();
            expect(mockVSCode.window.showWarningMessage).toHaveBeenCalledWith('Document creation canceled.');
            expect(mockDocService.addDoc).not.toHaveBeenCalled();
        });

        it('should prompt again if ID is not unique, then create doc when unique', async () => {
            (mockVSCode.window.showInputBox as jest.Mock)
                .mockResolvedValueOnce('My Doc') // doc name
                .mockResolvedValueOnce('md')     // doc ID
                .mockResolvedValueOnce('md1');   // second ID attempt

            mockDocService.isDocIdUnique
                .mockReturnValueOnce(false) // for 'md'
                .mockReturnValueOnce(true); // for 'md1'

            await documentationProvider.addDoc();
            expect(mockDocService.addDoc).toHaveBeenCalledWith('md1', 'My Doc');
            expect(mockVSCode.window.showInformationMessage).toHaveBeenCalledWith(
                'Documentation "My Doc" created successfully with ID "md1".'
            );
        });

        it('should show error message if addDoc returns false or undefined', async () => {
            (mockVSCode.window.showInputBox as jest.Mock)
                .mockResolvedValueOnce('My Doc')
                .mockResolvedValueOnce('md');

            // If addDoc returns undefined or false, it's considered a failure
            mockDocService.addDoc.mockResolvedValue(false as unknown as InstanceConfig);

            await documentationProvider.addDoc();
            expect(mockVSCode.window.showErrorMessage).toHaveBeenCalledWith(
                'Failed to create documentation "My Doc" with ID "md".'
            );
        });

        it('should catch and show error message if addDoc throws', async () => {
            (mockVSCode.window.showInputBox as jest.Mock)
                .mockResolvedValueOnce('My Doc')
                .mockResolvedValueOnce('md');
            mockDocService.addDoc.mockRejectedValue(new Error('Creation error'));

            await documentationProvider.addDoc();
            expect(mockVSCode.window.showErrorMessage).toHaveBeenCalledWith(
                'Error while creating documentation: Error: Creation error'
            );
        });

        it('should refresh topicsProvider if creation succeeds', async () => {
            (mockVSCode.window.showInputBox as jest.Mock)
                .mockResolvedValueOnce('Doc Title')
                .mockResolvedValueOnce('docT');
            const createdDoc: InstanceConfig = {
                id: 'docT',
                name: 'Doc Title',
                'toc-elements': [{ topic: 'topic1.md', title: '', children: [] }],
            };
            mockDocService.addDoc.mockResolvedValue(createdDoc);

            await documentationProvider.addDoc();
            expect(mockTopicsProvider.refresh).toHaveBeenCalledWith(createdDoc['toc-elements'], 'docT');
        });
    });
});
