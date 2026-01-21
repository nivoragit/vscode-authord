type Visitor = (node: any) => void;
type Test = string | ((node: any) => boolean);

function walk(node: any, visitor: Visitor): void {
  if (!node) return;
  visitor(node);
  const { children } = node;
  if (Array.isArray(children)) {
    children.forEach((child) => walk(child, visitor));
  }
}

export const visit = (tree: any, testOrVisitor: Test | Visitor, visitor?: Visitor): void => {
  const resolvedVisitor = typeof testOrVisitor === "function" && !visitor
    ? testOrVisitor
    : visitor;
  if (!resolvedVisitor) return;
  walk(tree, resolvedVisitor);
};
