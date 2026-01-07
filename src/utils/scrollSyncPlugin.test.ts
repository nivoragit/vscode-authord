import { scrollSyncPlugin } from './scrollSyncPlugin';

describe('scrollSyncPlugin', () => {
  it('adds code-line class and data-line to supported nodes', () => {
    const tree = {
      type: 'root',
      children: [
        {
          type: 'heading',
          position: { start: { line: 3 } },
          data: { hProperties: { class: 'existing' } },
        },
        {
          type: 'paragraph',
          position: { start: { line: 5 } },
        },
        {
          type: 'code',
          position: { start: { line: 8 } },
        },
      ],
    };

    const transform = (scrollSyncPlugin as unknown as () => (tree: any) => void)();
    transform(tree as any);

    const heading = tree.children[0] as any;
    expect(heading.data.hProperties.class).toBe('existing code-line');
    expect(heading.data.hProperties['data-line']).toBe('3');

    const paragraph = tree.children[1] as any;
    expect(paragraph.data.hProperties.class).toBe('code-line');
    expect(paragraph.data.hProperties['data-line']).toBe('5');

    const code = tree.children[2] as any;
    expect(code.data.hProperties.class).toBe('code-line');
    expect(code.data.hProperties['data-line']).toBe('8');
  });

  it('leaves unsupported nodes untouched', () => {
    const tree = {
      type: 'root',
      children: [
        {
          type: 'thematicBreak',
          position: { start: { line: 1 } },
        },
      ],
    };

    const transform = (scrollSyncPlugin as unknown as () => (tree: any) => void)();
    transform(tree as any);

    const node = tree.children[0] as any;
    expect(node.data).toBeUndefined();
  });
});
