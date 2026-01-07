type Visitor = (node: any) => void;

function walk(node: any, visitor: Visitor): void {
  if (!node) return;
  visitor(node);
  const { children } = node;
  if (Array.isArray(children)) {
    children.forEach((child) => walk(child, visitor));
  }
}

export const visit = (tree: any, visitor: Visitor): void => {
  walk(tree, visitor);
};
