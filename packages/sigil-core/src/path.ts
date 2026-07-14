export function normalizePath(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/\/+/g, "/");
  if (normalized === "") return ".";
  const drive = normalized.match(/^([A-Za-z]:)(?:\/|$)/)?.[1];
  const absolute = normalized.startsWith("/") || drive !== undefined;
  const body = drive === undefined
    ? normalized
    : normalized.slice(drive.length);
  const parts: string[] = [];
  for (const part of body.split("/")) {
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
  if (drive !== undefined) return joined ? `${drive}/${joined}` : `${drive}/`;
  if (absolute) return `/${joined}`;
  return joined || ".";
}

export function dirname(path: string): string {
  const normalized = normalizePath(path);
  if (
    normalized === "/" || normalized === "." ||
    /^[A-Za-z]:\/$/.test(normalized)
  ) return normalized;
  const index = normalized.lastIndexOf("/");
  if (index < 0) return ".";
  if (index === 0) return "/";
  if (index === 2 && /^[A-Za-z]:\//.test(normalized)) {
    return normalized.slice(0, 3);
  }
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

export function relativePath(root: string, path: string): string {
  const normalizedRoot = normalizePath(root);
  const normalizedPath = normalizePath(path);
  if (normalizedRoot === ".") return normalizedPath;
  if (normalizedPath === normalizedRoot) return ".";
  const prefix = normalizedRoot === "/" ? "/" : `${normalizedRoot}/`;
  return normalizedPath.startsWith(prefix)
    ? normalizedPath.slice(prefix.length)
    : normalizedPath;
}

export function ancestorsFrom(startPath: string): string[] {
  let current = isSigilFile(startPath)
    ? dirname(startPath)
    : normalizePath(startPath);
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
