import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { matchesSigilFile, parseSigilConfig } from "@qoherent/sigil-core";
import { CompilerFailure } from "./status.ts";
import type {
  CompilationProposal,
  ProposalWorkspacePersistedState,
} from "./types.ts";

const SESSION_PARENT = "qoherent-sigil-compiler-v1";
const EXCLUDED = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "vendor",
  "target",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  ".parcel-cache",
  ".pytest_cache",
  "__pycache__",
  ".venv",
  "venv",
  "tmp",
  "temp",
]);

export interface ProposalWorkspaceCreation {
  readonly workspace: SigilProposalWorkspace;
  readonly baseFingerprint: string;
  readonly selectedPaths: readonly string[];
}

export interface ProposalGenerationResult {
  readonly generation: number;
  readonly proposalFingerprint: string;
  readonly workspacePath: string;
}

// @sigil implements packages/compiler/src/proposal-workspace.sigil::SigilProposalWorkspace interface,logic,cases
export class SigilProposalWorkspace {
  private constructor(
    readonly sessionIdentity: string,
    private readonly root: string,
    readonly baseFingerprint: string,
    readonly selectedPaths: readonly string[],
    private generation = 0,
    private proposalFingerprint?: string,
  ) {}

  static async create(
    workspacePath: string,
    sessionIdentity: string,
  ): Promise<ProposalWorkspaceCreation> {
    assertSessionIdentity(sessionIdentity);
    const root = proposalRoot(sessionIdentity);
    await Deno.mkdir(sessionParent(), { recursive: true, mode: 0o700 });
    await Deno.chmod(sessionParent(), 0o700).catch(() => {});
    try {
      await Deno.mkdir(root, { recursive: true, mode: 0o700 });
      await writeMarker(root, sessionIdentity);
      const selectedPaths: string[] = [];
      await copyWorkspace(
        resolve(workspacePath),
        join(root, "base"),
        selectedPaths,
      );
      await copyTree(join(root, "base"), join(root, "active"));
      const baseFingerprint = await fingerprintTree(join(root, "base"));
      const workspace = new SigilProposalWorkspace(
        sessionIdentity,
        root,
        baseFingerprint,
        selectedPaths.sort(),
      );
      return {
        workspace,
        baseFingerprint,
        selectedPaths: workspace.selectedPaths,
      };
    } catch (error) {
      await Deno.remove(root, { recursive: true }).catch(() => {});
      if (error instanceof CompilerFailure) throw error;
      throw hostFailure("Could not create proposal workspace", error);
    }
  }

  static async restore(
    state: ProposalWorkspacePersistedState,
  ): Promise<SigilProposalWorkspace> {
    assertSessionIdentity(state.sessionIdentity);
    if (state.version !== 1 || state.directoryName !== state.sessionIdentity) {
      throw new CompilerFailure(
        "COMPILER_WORKSPACE_STATE",
        "Invalid proposal workspace state.",
      );
    }
    const root = proposalRoot(state.sessionIdentity);
    await verifyMarker(root, state.sessionIdentity);
    const actual = await fingerprintTree(join(root, "base"));
    if (actual !== state.baseFingerprint) {
      throw new CompilerFailure(
        "COMPILER_WORKSPACE_STATE",
        "Proposal base fingerprint mismatch.",
      );
    }
    return new SigilProposalWorkspace(
      state.sessionIdentity,
      root,
      state.baseFingerprint,
      state.selectedPaths,
      state.generation ?? 0,
      state.proposalFingerprint,
    );
  }

  persistedState(): ProposalWorkspacePersistedState {
    return {
      version: 1,
      sessionIdentity: this.sessionIdentity,
      directoryName: this.sessionIdentity,
      baseFingerprint: this.baseFingerprint,
      selectedPaths: this.selectedPaths,
      ...(this.generation ? { generation: this.generation } : {}),
      ...(this.proposalFingerprint
        ? { proposalFingerprint: this.proposalFingerprint }
        : {}),
    };
  }

  async apply(
    proposal: CompilationProposal,
  ): Promise<ProposalGenerationResult> {
    await verifyMarker(this.root, this.sessionIdentity);
    if (this.generation >= 0xffff_ffff) {
      throw new CompilerFailure(
        "COMPILER_GENERATION_EXHAUSTED",
        "Proposal generation is exhausted.",
      );
    }
    const entries = Object.entries(proposal.sources).sort(([a], [b]) =>
      a.localeCompare(b)
    );
    const parsedConfig = parseSigilConfig(
      await Deno.readTextFile(join(this.root, "base", ".sigil", "config.json")),
    );
    if (
      !parsedConfig.config ||
      parsedConfig.diagnostics.some((item) => item.severity === "error")
    ) {
      throw new CompilerFailure(
        "COMPILER_WORKSPACE_STATE",
        "Proposal base configuration is invalid.",
      );
    }
    for (const [path, source] of entries) {
      if (
        !validProposalPath(path) || typeof source !== "string" ||
        !matchesSigilFile(path, parsedConfig.config)
      ) {
        throw new CompilerFailure(
          "COMPILER_INVALID_PROPOSAL",
          `Invalid proposal source ${JSON.stringify(path)}.`,
        );
      }
    }
    const staging = join(this.root, `staging-${crypto.randomUUID()}`);
    try {
      await copyTree(join(this.root, "base"), staging);
      for (const [path, source] of entries) {
        const destination = resolve(staging, path);
        if (!contained(staging, destination)) {
          throw new CompilerFailure(
            "COMPILER_INVALID_PROPOSAL",
            `Proposal path escapes the workspace: ${path}`,
          );
        }
        await Deno.mkdir(resolve(destination, ".."), { recursive: true });
        await Deno.writeTextFile(destination, source, {
          create: true,
          mode: 0o600,
        });
      }
      const old = join(this.root, `old-${crypto.randomUUID()}`);
      await Deno.rename(join(this.root, "active"), old);
      try {
        await Deno.rename(staging, join(this.root, "active"));
      } catch (error) {
        await Deno.rename(old, join(this.root, "active")).catch(() => {});
        throw error;
      }
      await Deno.remove(old, { recursive: true });
      this.generation++;
      this.proposalFingerprint = await digest(JSON.stringify({
        domain: "sigil-proposal-v1",
        baseFingerprint: this.baseFingerprint,
        sources: entries,
      }));
      return {
        generation: this.generation,
        proposalFingerprint: this.proposalFingerprint,
        workspacePath: join(this.root, "active"),
      };
    } catch (error) {
      await Deno.remove(staging, { recursive: true }).catch(() => {});
      if (error instanceof CompilerFailure) throw error;
      throw hostFailure("Could not materialize proposal", error);
    }
  }

  evaluationPath(): string {
    return join(this.root, "active");
  }

  async close(): Promise<void> {
    const info = await Deno.lstat(this.root).catch((error) => {
      if (error instanceof Deno.errors.NotFound) return undefined;
      throw error;
    });
    if (!info) return;
    await verifyMarker(this.root, this.sessionIdentity);
    try {
      await Deno.remove(this.root, { recursive: true });
    } catch (error) {
      throw hostFailure("Could not remove proposal workspace", error);
    }
  }
}

export function sessionParent(): string {
  if (!cachedTemporaryRoot) {
    const probe = Deno.makeTempDirSync({ prefix: ".sigil-temp-root-" });
    cachedTemporaryRoot = dirname(probe);
    Deno.removeSync(probe);
  }
  return join(cachedTemporaryRoot, SESSION_PARENT);
}

let cachedTemporaryRoot: string | undefined;

function proposalRoot(identity: string): string {
  return join(sessionParent(), identity, "proposal");
}

function assertSessionIdentity(value: string): void {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      .test(value)
  ) {
    throw new CompilerFailure(
      "COMPILER_INVALID_SESSION_IDENTITY",
      "Session identity must be a canonical UUID version 4.",
    );
  }
}

async function writeMarker(root: string, identity: string): Promise<void> {
  await Deno.writeTextFile(
    join(root, "owner.json"),
    JSON.stringify({ formatVersion: 1, sessionIdentity: identity }),
    {
      createNew: true,
      mode: 0o600,
    },
  );
}

async function verifyMarker(root: string, identity: string): Promise<void> {
  try {
    const info = await Deno.lstat(root);
    const markerInfo = await Deno.lstat(join(root, "owner.json"));
    if (
      !info.isDirectory || info.isSymlink || !markerInfo.isFile ||
      markerInfo.isSymlink
    ) throw new Error("unsafe file kind");
    const marker = JSON.parse(
      await Deno.readTextFile(join(root, "owner.json")),
    );
    if (marker.formatVersion !== 1 || marker.sessionIdentity !== identity) {
      throw new Error("marker mismatch");
    }
  } catch (error) {
    throw new CompilerFailure(
      "COMPILER_WORKSPACE_OWNERSHIP_UNVERIFIED",
      "Proposal workspace ownership could not be verified.",
      { cause: error },
    );
  }
}

async function copyWorkspace(
  source: string,
  destination: string,
  selected: string[],
): Promise<void> {
  await Deno.mkdir(destination, { recursive: true, mode: 0o700 });
  async function visit(current: string): Promise<void> {
    for await (const entry of Deno.readDir(current)) {
      if (entry.isSymlink) {
        if (entry.name === ".sigil" || entry.name.endsWith(".sigil")) {
          throw new CompilerFailure(
            "COMPILER_UNSAFE_SNAPSHOT_PATH",
            `Configured Sigil evidence cannot be reached through a symbolic link: ${
              join(current, entry.name)
            }`,
          );
        }
        continue;
      }
      if (EXCLUDED.has(entry.name)) continue;
      const from = join(current, entry.name);
      const rel = relative(source, from).split(sep).join("/");
      const to = join(destination, rel);
      if (entry.isDirectory) {
        await Deno.mkdir(to, { recursive: true, mode: 0o700 });
        await visit(from);
      } else if (entry.isFile) {
        const before = await Deno.stat(from);
        await Deno.mkdir(resolve(to, ".."), { recursive: true });
        await Deno.copyFile(from, to);
        const after = await Deno.stat(from);
        if (
          before.size !== after.size ||
          before.mtime?.getTime() !== after.mtime?.getTime()
        ) {
          throw new CompilerFailure(
            "COMPILER_SNAPSHOT_CHANGED",
            `Selected evidence changed while the proposal base was copied: ${rel}`,
          );
        }
        selected.push(rel);
      }
    }
  }
  await visit(source);
}

async function copyTree(source: string, destination: string): Promise<void> {
  await Deno.mkdir(destination, { recursive: true, mode: 0o700 });
  for await (const entry of Deno.readDir(source)) {
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.isDirectory) await copyTree(from, to);
    else if (entry.isFile) await Deno.copyFile(from, to);
  }
}

async function fingerprintTree(root: string): Promise<string> {
  const entries: [string, string][] = [];
  async function visit(path: string): Promise<void> {
    for await (const entry of Deno.readDir(path)) {
      const child = join(path, entry.name);
      if (entry.isDirectory) await visit(child);
      else if (entry.isFile) {
        entries.push([
          relative(root, child).split(sep).join("/"),
          await digestBytes(await Deno.readFile(child)),
        ]);
      }
    }
  }
  await visit(root);
  entries.sort(([a], [b]) => a.localeCompare(b));
  return digest(JSON.stringify({ domain: "sigil-base-v1", entries }));
}

function validProposalPath(path: string): boolean {
  return path.endsWith(".sigil") && path === path.replaceAll("\\", "/") &&
    !path.startsWith("/") && !path.split("/").includes("..") &&
    basename(path) !== ".sigil";
}

function contained(root: string, path: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return rel !== ".." && !rel.startsWith(`..${sep}`);
}

function digest(value: string): Promise<string> {
  return digestBytes(new TextEncoder().encode(value));
}

async function digestBytes(value: Uint8Array): Promise<string> {
  const input = Uint8Array.from(value);
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", input.buffer),
  );
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hostFailure(message: string, cause: unknown): CompilerFailure {
  return new CompilerFailure(
    "COMPILER_WORKSPACE_HOST_FAILURE",
    `${message}: ${cause instanceof Error ? cause.message : String(cause)}`,
    { cause },
  );
}
