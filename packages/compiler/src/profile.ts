import type {
  AgentCapabilityContract,
  CanonicalCommandFamily,
  CanonicalCommandFamilyIdentifier,
  CompilationFocus,
} from "./types.ts";

const INSPECTION_IDENTIFIERS = [
  "workspace.read",
  "workspace.glob",
  "workspace.grep",
  "workspace.list",
  "sigil.version",
  "sigil.parse",
  "sigil.check",
  "sigil.fmt-check",
  "sigil.glossary",
  "sigil.graph",
  "sigil.context",
  "sigil.render",
  "git.status",
  "git.diff",
  "git.show",
  "git.log",
  "git.grep",
  "git.ls-files",
] as const satisfies readonly CanonicalCommandFamilyIdentifier[];

const DENIAL_IDENTIFIERS = [
  "sigil.init",
  "sigil.fmt-write",
  "sigil.compile",
  "sigil.skill-install",
  "network.client",
  "filesystem.mutate",
  "code.generate",
  "implementation.execute",
] as const satisfies readonly CanonicalCommandFamilyIdentifier[];

const NATIVE_TOOLS: Partial<
  Record<CanonicalCommandFamilyIdentifier, readonly string[]>
> = {
  "workspace.read": ["read"],
  "workspace.glob": ["glob", "find"],
  "workspace.grep": ["grep"],
  "workspace.list": ["list", "ls"],
};

// @sigil implements packages/compiler/src/profile.sigil::SigilCompilationProfile::CanonicalCommandFamily interface
export function resolveCanonicalCommandFamily(
  identifier: CanonicalCommandFamilyIdentifier,
): CanonicalCommandFamily {
  const nativeTools = NATIVE_TOOLS[identifier] ?? [];
  const denied = DENIAL_IDENTIFIERS.includes(
    identifier as typeof DENIAL_IDENTIFIERS[number],
  );
  const [executable, ...subcommand] = identifier.split(".");
  return Object.freeze({
    identifier,
    operationKind: denied
      ? "denial"
      : nativeTools.length
      ? "native-tool"
      : "command",
    nativeTools: Object.freeze([...nativeTools]),
    ...(nativeTools.length || denied
      ? {}
      : { executable, subcommand: Object.freeze(subcommand) }),
    options: Object.freeze([]),
    pathPolicy: denied ? "none" : "workspace-confined",
    permittedEffects: denied
      ? Object.freeze([])
      : Object.freeze(["read", "stdout", "stderr"] as const),
  });
}

// @sigil implements packages/compiler/src/profile.sigil::SigilCompilationProfile::AgentCapabilityContract interface,constraints
export const COMPILER_AGENT_CAPABILITIES: AgentCapabilityContract = Object
  .freeze({
    workspaceAccess: "read-only",
    network: false,
    approvalEscalation: false,
    ephemeral: true,
    allowedCommands: Object.freeze([...INSPECTION_IDENTIFIERS]),
    forbiddenCommands: Object.freeze([...DENIAL_IDENTIFIERS]),
    commandFamilies: Object.freeze(
      [...INSPECTION_IDENTIFIERS, ...DENIAL_IDENTIFIERS].map(
        resolveCanonicalCommandFamily,
      ),
    ),
  });

// @sigil implements packages/compiler/src/compiler.sigil::SigilCompiler::OneShotCompilation logic,cases
export function stageForCompilationFocus(
  focus: CompilationFocus | undefined,
): string | undefined {
  return focus === "design"
    ? "architecture-design"
    : focus === "implementation"
    ? "current-code-compatibility"
    : undefined;
}
