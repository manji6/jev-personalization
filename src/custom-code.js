import { parse } from "acorn";
export function validCustomCode(source) {
  try {
    const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
    if (ast.body.length !== 1) return false;
    const node = ast.body[0];
    return (
      node.type === "ExportNamedDeclaration" &&
      node.declaration?.type === "FunctionDeclaration" &&
      node.declaration.id?.name === "render" &&
      !node.declaration.generator
    );
  } catch {
    return false;
  }
}
