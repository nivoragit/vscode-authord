export function stripMarkdownCommentDirectives(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const filtered = lines.filter((line) => !/^\s*\[\/\/\]:\s*#\s*\(.*\)\s*$/.test(line));
  return filtered.join("\n");
}
