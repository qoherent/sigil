import { basename, isAbsolute, join, posix, resolve } from "node:path";

/** Explicit inputs: additions require a deliberate packaging decision. */
export const LANGUAGE_SOURCES = [
  "spec/sigil-reference.md",
  "spec/sigil.ebnf",
  "spec/sigil-language.md",
  "spec/sigil-config.md",
  "spec/sigil-config.schema.json",
] as const;
export const LANGUAGE_PACK_PATH =
  "integrations/skills/sigil-understand/references/language";
const UPSTREAM = "https://github.com/farhoud/sigil";
const MANIFEST = "manifest.json";
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const encoder = new TextEncoder();

export interface DocumentaryLink {
  destination: string;
  start: number;
  end: number;
}
export interface LanguageManifest {
  formatVersion: 1;
  sigilVersion: "0.8.0";
  upstreamRepository: string;
  upstreamRevision: string;
  transformation: "documentary-background-links-v1";
  sources: {
    source: string;
    output: string;
    sourceSha256: string;
    outputSha256: string;
  }[];
}

/** Mask code without changing offsets; examples are source, not documentation links. */
function documentaryText(markdown: string): string {
  const blank = (value: string) => value.replace(/[^\r\n]/g, " ");
  let fence: { character: string; length: number } | undefined;
  const prose = markdown.replace(/[^\r\n]*(?:\r\n|\n|\r|$)/g, (line) => {
    if (fence) {
      const close = line.match(/^ {0,3}(`+|~+)[ \t]*(?:\r?\n|\r|$)$/);
      if (
        close && close[1][0] === fence.character &&
        close[1].length >= fence.length
      ) fence = undefined;
      return blank(line);
    }
    const open = line.match(/^ {0,3}(`{3,}|~{3,})([^\r\n]*)/);
    if (open && (open[1][0] !== "`" || !open[2].includes("`"))) {
      fence = { character: open[1][0], length: open[1].length };
      return blank(line);
    }
    return line;
  });
  // Only an equal-length backtick run closes an inline span. Unmatched ticks
  // remain prose. Fenced blocks have already been masked.
  const runs = [...prose.matchAll(/`+/g)];
  let result = "";
  let cursor = 0;
  for (let i = 0; i < runs.length; i++) {
    const opening = runs[i];
    const closing = runs.findIndex((run, index) =>
      index > i && run[0].length === opening[0].length
    );
    if (closing < 0) continue;
    const end = runs[closing].index! + runs[closing][0].length;
    result += prose.slice(cursor, opening.index) +
      blank(prose.slice(opening.index, end));
    cursor = end;
    i = closing;
  }
  return result + prose.slice(cursor);
}

/** Documentary inline destinations and reference definitions, with source offsets.
 * Supports the bundle's Markdown, including angle destinations and balanced
 * parentheses. This is a packaging scanner, not the Sigil link parser.
 */
export function documentaryLinks(markdown: string): DocumentaryLink[] {
  const prose = documentaryText(markdown);
  const links: DocumentaryLink[] = [];
  const starts =
    /!?\[(?:\\.|[^\]\\\r\n])*\]\(|^ {0,3}\[(?:\\.|[^\]\\\r\n])+\]:[ \t]*/gm;
  for (const match of prose.matchAll(starts)) {
    let start = match.index! + match[0].length;
    while (/[ \t\r\n]/.test(prose[start] ?? "") && start < prose.length) {
      start++;
    }
    let end = start;
    if (prose[start] === "<") {
      start++;
      end = prose.indexOf(">", start);
      if (end < 0) continue;
    } else {
      let depth = 0;
      while (end < prose.length) {
        const char = prose[end];
        if (/\s/.test(char)) break;
        if (char === "\\" && end + 1 < prose.length) {
          end += 2;
          continue;
        }
        if (char === "(") depth++;
        if (char === ")") {
          if (depth === 0) break;
          depth--;
        }
        end++;
      }
    }
    if (end > start) {
      links.push({ destination: markdown.slice(start, end), start, end });
    }
  }
  return links;
}

function localDestination(destination: string): boolean {
  return !/^[a-z][a-z0-9+.-]*:/i.test(destination) &&
    !destination.startsWith("#") && !destination.startsWith("//");
}

export function renderLanguageSource(
  source: string,
  text: string,
  revision: string,
): string {
  if (!source.endsWith(".md")) return text;
  let output = text;
  for (const link of documentaryLinks(text).reverse()) {
    if (!localDestination(link.destination)) continue;
    const split = link.destination.search(/[?#]/);
    const path = split < 0
      ? link.destination
      : link.destination.slice(0, split);
    const suffix = split < 0 ? "" : link.destination.slice(split);
    const target = posix.normalize(
      posix.join(posix.dirname(source), decodeURIComponent(path)),
    );
    if ((LANGUAGE_SOURCES as readonly string[]).includes(target)) continue;
    if (target.startsWith("../") || isAbsolute(path)) {
      throw new Error(
        `Background link escapes repository: ${source}: ${link.destination}`,
      );
    }
    const pinned = `${UPSTREAM}/blob/${revision}/${
      target.split("/").map(encodeURIComponent).join("/")
    }${suffix}`;
    output = output.slice(0, link.start) + pinned + output.slice(link.end);
  }
  return output;
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return [...new Uint8Array(digest)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function assertManifest(manifest: LanguageManifest): void {
  if (
    manifest.formatVersion !== 1 || manifest.sigilVersion !== "0.8.0" ||
    manifest.upstreamRepository !== UPSTREAM ||
    !/^[0-9a-f]{40}$/.test(manifest.upstreamRevision) ||
    manifest.transformation !== "documentary-background-links-v1" ||
    !Array.isArray(manifest.sources) ||
    manifest.sources.length !== LANGUAGE_SOURCES.length
  ) throw new Error("Invalid language pack manifest");
  for (const [index, item] of manifest.sources.entries()) {
    if (
      item.source !== LANGUAGE_SOURCES[index] ||
      item.output !== basename(item.source) ||
      !/^[0-9a-f]{64}$/.test(item.sourceSha256) ||
      !/^[0-9a-f]{64}$/.test(item.outputSha256)
    ) {
      throw new Error(`Invalid language pack source entry ${index}`);
    }
  }
}

async function readManifest(packDirectory: string): Promise<LanguageManifest> {
  const manifest = JSON.parse(
    await Deno.readTextFile(join(packDirectory, MANIFEST)),
  );
  assertManifest(manifest);
  return manifest;
}

/** Installed-bundle check: source checkout, git, compiler and network are unnecessary. */
export async function validateBundledLanguagePack(
  packDirectory: string,
): Promise<LanguageManifest> {
  const manifest = await readManifest(packDirectory);
  const allowed = new Set([
    MANIFEST,
    ...manifest.sources.map((item) => item.output),
  ]);
  for await (const entry of Deno.readDir(packDirectory)) {
    if (!entry.isFile || !allowed.has(entry.name)) {
      throw new Error(`Unexpected language pack entry: ${entry.name}`);
    }
  }
  for (const item of manifest.sources) {
    const bytes = await Deno.readFile(join(packDirectory, item.output));
    if (await sha256(bytes) !== item.outputSha256) {
      throw new Error(`Bundled output drift: ${item.output}`);
    }
    if (!item.output.endsWith(".md")) continue;
    for (const { destination } of documentaryLinks(decoder.decode(bytes))) {
      if (!localDestination(destination)) continue;
      const path = decodeURIComponent(destination.split(/[?#]/)[0]);
      const target = resolve(packDirectory, path);
      if (
        isAbsolute(path) || !allowed.has(posix.normalize(path)) ||
        !(await Deno.stat(target)).isFile
      ) {
        throw new Error(
          `Missing bundled language reference: ${item.output}: ${destination}`,
        );
      }
    }
  }
  return manifest;
}

/** Repository check additionally verifies source identity and exact reproduction. */
export async function validateLanguagePack(
  repoRoot: string,
  packDirectory = join(repoRoot, LANGUAGE_PACK_PATH),
): Promise<LanguageManifest> {
  const manifest = await validateBundledLanguagePack(packDirectory);
  for (const item of manifest.sources) {
    const bytes = await Deno.readFile(join(repoRoot, item.source));
    if (await sha256(bytes) !== item.sourceSha256) {
      throw new Error(
        `Source drift: ${item.source}; run sync-skill-language.ts`,
      );
    }
    const expected = encoder.encode(
      renderLanguageSource(
        item.source,
        decoder.decode(bytes),
        manifest.upstreamRevision,
      ),
    );
    if (await sha256(expected) !== item.outputSha256) {
      throw new Error(`Language pack reproduction mismatch: ${item.output}`);
    }
  }
  return manifest;
}

/** Explicit sync reuses the recorded revision unless the maintainer supplies a new pin. */
export async function syncLanguagePack(
  repoRoot: string,
  options: { revision?: string; packDirectory?: string } = {},
): Promise<LanguageManifest> {
  const packDirectory = options.packDirectory ??
    join(repoRoot, LANGUAGE_PACK_PATH);
  let revision = options.revision;
  if (!revision) {
    revision = (await readManifest(packDirectory)).upstreamRevision;
  }
  if (!/^[0-9a-f]{40}$/.test(revision)) {
    throw new Error(
      "Supply a full 40-character upstream commit with --revision",
    );
  }
  const manifest: LanguageManifest = {
    formatVersion: 1,
    sigilVersion: "0.8.0",
    upstreamRepository: UPSTREAM,
    upstreamRevision: revision,
    transformation: "documentary-background-links-v1",
    sources: [],
  };
  await Deno.mkdir(packDirectory, { recursive: true });
  for (const source of LANGUAGE_SOURCES) {
    const bytes = await Deno.readFile(join(repoRoot, source));
    const output = encoder.encode(
      renderLanguageSource(source, decoder.decode(bytes), revision),
    );
    const name = basename(source);
    await Deno.writeFile(join(packDirectory, name), output);
    manifest.sources.push({
      source,
      output: name,
      sourceSha256: await sha256(bytes),
      outputSha256: await sha256(output),
    });
  }
  await Deno.writeTextFile(
    join(packDirectory, MANIFEST),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  return manifest;
}

if (import.meta.main) {
  const args = [...Deno.args];
  const check = args[0] === "--check";
  if (check) args.shift();
  let revision: string | undefined;
  if (args[0] === "--revision") {
    args.shift();
    revision = args.shift();
    if (!revision) {
      throw new Error("--revision requires a full upstream commit");
    }
  }
  if (args.length || (check && revision)) {
    throw new Error(
      "Usage: sync-skill-language.ts [--check | --revision <commit>]",
    );
  }
  const root = resolve(import.meta.dirname!, "..");
  if (check) await validateLanguagePack(root);
  else await syncLanguagePack(root, { revision });
  console.log(
    check
      ? "Language pack reproduces from its recorded sources."
      : "Language pack synchronized.",
  );
}
