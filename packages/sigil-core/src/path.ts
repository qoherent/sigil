export function normalizePath(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/\/+/g, "/");
  if (normalized === "") return ".";
  const absolute = normalized.startsWith("/");
  const parts: string[] = [];
  for (const part of normalized.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length > 0 && parts[parts.length - 1] !== "..") {
        parts.pop();
      } else if (!absolute) {
        parts.push(part);
      }
      continue;
    }
    parts.push(part);
  }
  const joined = parts.join("/");
  if (absolute) return `/${joined}`;
  return joined || ".";
}

export function dirname(path: string): string {
  const normalized = normalizePath(path);
  if (normalized === "/" || normalized === ".") return normalized;
  const index = normalized.lastIndexOf("/");
  if (index < 0) return ".";
  if (index === 0) return "/";
  return normalized.slice(0, index);
}

export function joinPath(...parts: string[]): string {
  return normalizePath(parts.filter(Boolean).join("/"));
}

export function isSigilFile(path: string): boolean {
  return normalizePath(path).endsWith(".sigil");
}

export function isModuleFile(path: string): boolean {
  return basename(path) === "#module.sigil";
}

export function basename(path: string): string {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf("/");
  return index < 0 ? normalized : normalized.slice(index + 1);
}

export function ancestorsFrom(startPath: string): string[] {
  let current = isSigilFile(startPath) ? dirname(startPath) : normalizePath(startPath);
  const ancestors: string[] = [];
  while (true) {
    ancestors.push(current);
    const parent = dirname(current);
    if (parent === current) break;
    if (current === ".") break;
    current = parent;
  }
  return ancestors;
}
