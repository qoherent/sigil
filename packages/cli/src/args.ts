import { COMPILATION_STAGE_IDS } from "@qoherent/sigil-compiler";

export type CommandName =
  | "skill"
  | "init"
  | "config"
  | "version"
  | "parse"
  | "check"
  | "fmt"
  | "glossary"
  | "graph"
  | "context"
  | "retrieve"
  | "compile"
  | "render";
export type HelpTopic =
  | CommandName
  | "root"
  | "skill-list"
  | "skill-install"
  | "config-set-default"
  | "config-set-profile";
export type OutputFormat = "json" | "jsonl" | "text" | "markdown";
export type SkillAgent = "codex" | "claude" | "opencode" | "pi";

export interface GlobalOptions {
  readonly root?: string;
  readonly format?: OutputFormat;
  readonly pretty: boolean;
  readonly quiet: boolean;
}

export type CommandRequest =
  | SkillListRequest
  | SkillInstallRequest
  | InitRequest
  | ConfigSetDefaultRequest
  | ConfigSetProfileRequest
  | VersionRequest
  | ParseRequest
  | CheckRequest
  | FmtRequest
  | GlossaryRequest
  | GraphRequest
  | ContextRequest
  | RetrieveRequest
  | CompileRequest
  | RenderRequest;
export interface SkillListRequest extends GlobalOptions {
  readonly command: "skill-list";
}
export interface SkillInstallRequest extends GlobalOptions {
  readonly command: "skill-install";
  readonly project: boolean;
  readonly agents: readonly SkillAgent[];
}
export interface InitRequest extends GlobalOptions {
  readonly command: "init";
  readonly path?: string;
  readonly name?: string;
  readonly include: readonly string[];
  readonly exclude: readonly string[];
}
export interface ConfigSetDefaultRequest extends GlobalOptions {
  readonly command: "config-set-default";
  readonly path?: string;
  readonly profile: string;
  readonly agentProfile?: string;
}
export interface ConfigSetProfileRequest extends GlobalOptions {
  readonly command: "config-set-profile";
  readonly path?: string;
  readonly profileName: string;
  readonly extendsProfile?: string;
  readonly main?: readonly string[];
  readonly stages: Readonly<Record<string, readonly string[]>>;
  readonly disableStages: readonly string[];
  readonly newEvaluators: Readonly<Record<string, string>>;
  readonly models: Readonly<Record<string, string>>;
  readonly implementationIds: Readonly<Record<string, string>>;
  readonly implementationVersions: Readonly<Record<string, string>>;
}
export interface VersionRequest extends GlobalOptions {
  readonly command: "version";
  readonly path?: string;
}
export interface ParseRequest extends GlobalOptions {
  readonly command: "parse";
  readonly file: string;
}
export interface CheckRequest extends GlobalOptions {
  readonly command: "check";
  readonly path?: string;
  readonly showLocations: boolean;
}
export interface FmtRequest extends GlobalOptions {
  readonly command: "fmt";
  readonly path?: string;
  readonly check: boolean;
}
export interface GlossaryRequest extends GlobalOptions {
  readonly command: "glossary";
  readonly path?: string;
}
export interface GraphRequest extends GlobalOptions {
  readonly command: "graph";
  readonly path?: string;
}
export interface ContextRequest extends GlobalOptions {
  readonly command: "context";
  readonly component?: string;
  readonly file?: string;
  readonly includeDependents: boolean;
  readonly path?: string;
}
export interface RetrieveRequest extends GlobalOptions {
  readonly command: "retrieve";
  readonly component?: string;
  readonly file?: string;
  readonly purpose: "semantic" | "architecture" | "implementation";
  readonly maxEvidenceBytes?: number;
  readonly path?: string;
}
export interface CompileRequest extends GlobalOptions {
  readonly command: "compile";
  readonly stage?: string;
  readonly focus?: "design" | "implementation";
  readonly component?: string;
  readonly file?: string;
  readonly directory?: string;
  readonly exactTarget?: boolean;
  readonly position?: {
    readonly line: number;
    readonly column: number;
  };
  readonly path?: string;
  readonly profile?: string;
  readonly agent: boolean;
  readonly noCache: boolean;
  readonly output?: string;
}
export interface RenderRequest extends GlobalOptions {
  readonly command: "render";
  readonly path?: string;
}
export interface UsageError {
  readonly kind: "usage-error";
  readonly message: string;
  readonly helpTopic: HelpTopic;
}
export type ParseArgsResult = {
  readonly kind: "ok";
  readonly request: CommandRequest;
} | {
  readonly kind: "help";
  readonly helpTopic: HelpTopic;
} | {
  readonly kind: "cli-version";
} | UsageError;

/*
 * @sigil implements packages/cli/_module.sigil::SigilCli::CliInvocation interface,logic,cases
 * @sigil implements packages/cli/_module.sigil::SigilCli::CompilationFacade interface,logic,constraints,cases
 * @sigil implements packages/cli/_module.sigil::SigilCli::CompilationConfigurationCommand interface,logic,constraints,cases
 */
export function parseArgs(argv: readonly string[]): ParseArgsResult {
  if (argv[0] === "--help") return { kind: "help", helpTopic: "root" };
  if (argv[0] === "--version") return { kind: "cli-version" };

  const [commandName, ...rest] = argv;
  if (!isCommand(commandName)) {
    return usage(
      commandName
        ? `Unknown command "${commandName}".`
        : "Expected command: skill, init, config, version, parse, check, fmt, glossary, graph, context, retrieve, compile, or render.",
      "root",
    );
  }

  const commandHelpTopic = helpTopicFor(commandName, rest[0]);
  if (commandName === "skill") {
    if (rest[0] === "--help") {
      return { kind: "help", helpTopic: "skill" };
    }
    if (
      (rest[0] === "list" || rest[0] === "install") &&
      rest.includes("--help")
    ) {
      return { kind: "help", helpTopic: `skill-${rest[0]}` };
    }
    if (rest.includes("--help")) {
      return usage(
        rest[0] && !rest[0].startsWith("-")
          ? `Unknown skill subcommand "${rest[0]}".`
          : "skill requires exactly one subcommand: list or install.",
        "skill",
      );
    }
  } else if (commandName === "config") {
    if (rest[0] === "--help") {
      return { kind: "help", helpTopic: "config" };
    }
    if (
      (rest[0] === "set-default" || rest[0] === "set-profile") &&
      rest.includes("--help")
    ) {
      return { kind: "help", helpTopic: `config-${rest[0]}` };
    }
    if (rest.includes("--help")) {
      return usage(
        rest[0] && !rest[0].startsWith("-")
          ? `Unknown config subcommand "${rest[0]}".`
          : "config requires exactly one subcommand: set-default or set-profile.",
        "config",
      );
    }
  } else if (rest.includes("--help")) {
    return {
      kind: "help",
      helpTopic: commandName,
    };
  }

  const positional: string[] = [];
  let root: string | undefined;
  let format: OutputFormat | undefined;
  let pretty = false;
  let quiet = false;
  let component: string | undefined;
  let file: string | undefined;
  let position: CompileRequest["position"];
  let directory: string | undefined;
  let exactTarget = false;
  let maxEvidenceBytes: number | undefined;
  let includeDependents = false;
  let name: string | undefined;
  const include: string[] = [];
  const exclude: string[] = [];
  let project = false;
  let agent: SkillAgent | "all" | undefined;
  let showLocations = false;
  let profile: string | undefined;
  let compileAgent = false;
  let focus: CompileRequest["focus"];
  let noCache = false;
  let output: string | undefined;
  let check = false;
  let purpose: RetrieveRequest["purpose"] | undefined;
  let agentProfile: string | undefined;
  let extendsProfile: string | undefined;
  let main: string[] | undefined;
  const stages: Record<string, string[]> = {};
  const disableStages: string[] = [];
  const newEvaluators: Record<string, string> = {};
  const models: Record<string, string> = {};
  const implementationIds: Record<string, string> = {};
  const implementationVersions: Record<string, string> = {};

  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index];
    const take = (flag: string): string | UsageError => {
      const value = rest[++index];
      return value && !value.startsWith("-")
        ? value
        : usage(`${flag} requires a value.`, commandHelpTopic);
    };
    switch (arg) {
      case "--root": {
        const value = take(arg);
        if (typeof value !== "string") return value;
        root = value;
        break;
      }
      case "--format": {
        const value = take(arg);
        if (typeof value !== "string") return value;
        if (!isFormat(value)) {
          return usage(
            "--format must be json, text, or markdown.",
            commandHelpTopic,
          );
        }
        format = value;
        break;
      }
      case "--pretty":
        pretty = true;
        break;
      case "--quiet":
        quiet = true;
        break;
      case "--show-locations":
        showLocations = true;
        break;
      case "--project":
        project = true;
        break;
      case "--agent": {
        if (commandName === "compile") {
          compileAgent = true;
          break;
        }
        const value = take(arg);
        if (typeof value !== "string") return value;
        if (!isSkillAgent(value) && value !== "all") {
          return usage(
            "--agent must be codex, claude, opencode, pi, or all.",
            commandHelpTopic,
          );
        }
        agent = value;
        break;
      }
      case "--component": {
        const value = take(arg);
        if (typeof value !== "string") return value;
        component = value;
        break;
      }
      case "--directory": {
        const value = take(arg);
        if (typeof value !== "string") return value;
        directory = value;
        break;
      }
      case "--exact-target": {
        exactTarget = true;
        break;
      }
      case "--file": {
        const value = take(arg);
        if (typeof value !== "string") return value;
        file = value;
        break;
      }
      case "--position": {
        const value = take(arg);
        if (typeof value !== "string") return value;
        const match = /^([1-9]\d*):([1-9]\d*)$/.exec(value);
        if (!match) {
          return usage(
            "--position must be a one-based line:column pair.",
            commandHelpTopic,
          );
        }
        position = { line: Number(match[1]), column: Number(match[2]) };
        break;
      }
      case "--profile": {
        const value = take(arg);
        if (typeof value !== "string") return value;
        profile = value;
        break;
      }
      case "--focus": {
        const value = take(arg);
        if (typeof value !== "string") return value;
        if (value !== "design" && value !== "implementation") {
          return usage(
            "--focus must be design or implementation.",
            commandHelpTopic,
          );
        }
        focus = value;
        break;
      }
      case "--no-cache":
        noCache = true;
        break;
      case "--check":
        check = true;
        break;
      case "--output": {
        const value = take(arg);
        if (typeof value !== "string") return value;
        output = value;
        break;
      }
      case "--include-dependents":
        includeDependents = true;
        break;
      case "--max-evidence-bytes": {
        const value = take(arg);
        if (typeof value !== "string") return value;
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed < 0) {
          return usage(
            "--max-evidence-bytes must be a non-negative integer.",
            commandHelpTopic,
          );
        }
        maxEvidenceBytes = parsed;
        break;
      }
      case "--purpose": {
        const value = take(arg);
        if (typeof value !== "string") return value;
        if (
          value !== "semantic" && value !== "architecture" &&
          value !== "implementation"
        ) {
          return usage(
            "--purpose must be semantic, architecture, or implementation.",
            commandHelpTopic,
          );
        }
        purpose = value;
        break;
      }
      case "--name": {
        const value = take(arg);
        if (typeof value !== "string") return value;
        name = value;
        break;
      }
      case "--include": {
        const value = take(arg);
        if (typeof value !== "string") return value;
        include.push(value);
        break;
      }
      case "--exclude": {
        const value = take(arg);
        if (typeof value !== "string") return value;
        exclude.push(value);
        break;
      }
      case "--agent-profile": {
        const value = take(arg);
        if (typeof value !== "string") return value;
        agentProfile = value;
        break;
      }
      case "--extends": {
        const value = take(arg);
        if (typeof value !== "string") return value;
        extendsProfile = value;
        break;
      }
      case "--main": {
        const value = take(arg);
        if (typeof value !== "string") return value;
        main = value.split(",").filter(Boolean);
        break;
      }
      case "--stage": {
        const value = take(arg);
        if (typeof value !== "string") return value;
        const pair = splitKeyValue(value);
        if (!pair) {
          return usage(
            "--stage requires stageId=evaluatorId[,evaluatorId ...].",
            commandHelpTopic,
          );
        }
        stages[pair[0]] = pair[1].split(",").filter(Boolean);
        break;
      }
      case "--disable-stage": {
        const value = take(arg);
        if (typeof value !== "string") return value;
        disableStages.push(value);
        break;
      }
      case "--evaluator": {
        const value = take(arg);
        if (typeof value !== "string") return value;
        const pair = splitKeyValue(value);
        if (!pair) {
          return usage(
            "--evaluator requires evaluatorId=provider.",
            commandHelpTopic,
          );
        }
        newEvaluators[pair[0]] = pair[1];
        break;
      }
      case "--model": {
        const value = take(arg);
        if (typeof value !== "string") return value;
        const pair = splitKeyValue(value);
        if (!pair) {
          return usage("--model requires evaluatorId=model.", commandHelpTopic);
        }
        models[pair[0]] = pair[1];
        break;
      }
      case "--implementation-id": {
        const value = take(arg);
        if (typeof value !== "string") return value;
        const pair = splitKeyValue(value);
        if (!pair) {
          return usage(
            "--implementation-id requires evaluatorId=value.",
            commandHelpTopic,
          );
        }
        implementationIds[pair[0]] = pair[1];
        break;
      }
      case "--implementation-version": {
        const value = take(arg);
        if (typeof value !== "string") return value;
        const pair = splitKeyValue(value);
        if (!pair) {
          return usage(
            "--implementation-version requires evaluatorId=value.",
            commandHelpTopic,
          );
        }
        implementationVersions[pair[0]] = pair[1];
        break;
      }
      default:
        if (arg.startsWith("-")) {
          return usage(`Unsupported option ${arg}.`, commandHelpTopic);
        }
        positional.push(arg);
    }
  }

  const base = { root, format, pretty, quiet };
  if (commandName !== "fmt" && check) {
    return usage(`${commandName} does not accept --check.`, commandHelpTopic);
  }
  if (
    commandName !== "context" && commandName !== "retrieve" &&
    commandName !== "compile" &&
    (component || file || position)
  ) {
    return usage(
      `${commandName} does not accept --component, --file, or --position.`,
      commandHelpTopic,
    );
  }
  if (commandName !== "compile" && (directory || exactTarget)) {
    return usage(
      `${commandName} does not accept --directory or --exact-target.`,
      commandHelpTopic,
    );
  }
  if (commandName !== "context" && includeDependents) {
    return usage(
      `${commandName} does not accept --include-dependents.`,
      commandHelpTopic,
    );
  }
  if (commandName !== "retrieve" && purpose) {
    return usage(`${commandName} does not accept --purpose.`, commandHelpTopic);
  }
  if (commandName !== "retrieve" && maxEvidenceBytes !== undefined) {
    return usage(
      `${commandName} does not accept --max-evidence-bytes.`,
      commandHelpTopic,
    );
  }
  if (commandName !== "compile" && position) {
    return usage(
      `${commandName} does not accept --position.`,
      commandHelpTopic,
    );
  }
  if (commandName !== "init" && (name || include.length || exclude.length)) {
    return usage(
      `${commandName} does not accept init options.`,
      commandHelpTopic,
    );
  }
  if (commandName !== "skill" && (project || agent)) {
    return usage(
      `${commandName} does not accept skill options.`,
      commandHelpTopic,
    );
  }
  if (commandName !== "check" && showLocations) {
    return usage(
      `${commandName} does not accept --show-locations.`,
      commandHelpTopic,
    );
  }
  if (commandName !== "compile" && commandName !== "config" && profile) {
    return usage(`${commandName} does not accept --profile.`, commandHelpTopic);
  }
  if (
    commandName !== "compile" &&
    (compileAgent || focus || noCache || output || format === "jsonl")
  ) {
    return usage(
      `${commandName} does not accept compile options.`,
      commandHelpTopic,
    );
  }
  if (
    commandName !== "config" &&
    (agentProfile || extendsProfile || main || Object.keys(stages).length ||
      disableStages.length || Object.keys(newEvaluators).length ||
      Object.keys(models).length || Object.keys(implementationIds).length ||
      Object.keys(implementationVersions).length)
  ) {
    return usage(
      `${commandName} does not accept config options.`,
      commandHelpTopic,
    );
  }
  if (commandName === "skill") {
    if (root) {
      return usage("skill commands do not accept --root.", commandHelpTopic);
    }
    if (positional.length === 0) {
      return usage(
        "skill requires exactly one subcommand: list or install.",
        "skill",
      );
    }
    if (!["list", "install"].includes(positional[0])) {
      return usage(
        `Unknown skill subcommand "${positional[0]}".`,
        "skill",
      );
    }
    if (positional.length > 1) {
      return usage(
        `skill ${positional[0]} does not accept positional arguments.`,
        `skill-${positional[0]}` as "skill-list" | "skill-install",
      );
    }
    if (positional[0] === "list") {
      if (project || agent) {
        return usage(
          "skill list does not accept installation options.",
          "skill-list",
        );
      }
      return { kind: "ok", request: { command: "skill-list", ...base } };
    }
    return {
      kind: "ok",
      request: {
        command: "skill-install",
        project,
        agents: !agent || agent === "all"
          ? ["codex", "claude", "opencode", "pi"]
          : [agent],
        ...base,
      },
    };
  }
  if (commandName === "init") {
    if (root) {
      return usage(
        "init uses its path argument and does not accept --root.",
        "init",
      );
    }
    if (positional.length > 1) {
      return usage("init accepts at most one path.", "init");
    }
    return {
      kind: "ok",
      request: {
        command: "init",
        path: positional[0],
        name,
        include,
        exclude,
        ...base,
      },
    };
  }
  if (commandName === "config") {
    if (root) {
      return usage(
        "config uses its path argument and does not accept --root.",
        "config",
      );
    }
    if (format && format !== "json") {
      return usage("--format must be json for config.", "config");
    }
    if (positional.length === 0) {
      return usage(
        "config requires exactly one subcommand: set-default or set-profile.",
        "config",
      );
    }
    if (positional[0] !== "set-default" && positional[0] !== "set-profile") {
      return usage(`Unknown config subcommand "${positional[0]}".`, "config");
    }
    const subcommandPositional = positional.slice(1);
    if (positional[0] === "set-default") {
      if (!profile) {
        return usage(
          "config set-default requires --profile.",
          "config-set-default",
        );
      }
      if (subcommandPositional.length > 1) {
        return usage(
          "config set-default accepts at most one path.",
          "config-set-default",
        );
      }
      if (
        extendsProfile || main || Object.keys(stages).length ||
        disableStages.length || Object.keys(newEvaluators).length ||
        Object.keys(models).length || Object.keys(implementationIds).length ||
        Object.keys(implementationVersions).length
      ) {
        return usage(
          "config set-default does not accept set-profile options.",
          "config-set-default",
        );
      }
      return {
        kind: "ok",
        request: {
          command: "config-set-default",
          path: subcommandPositional[0],
          profile,
          agentProfile,
          ...base,
        },
      };
    }
    const profileName = subcommandPositional[0];
    if (!profileName) {
      return usage(
        "config set-profile requires a profile name.",
        "config-set-profile",
      );
    }
    if (subcommandPositional.length > 2) {
      return usage(
        "config set-profile accepts a name and at most one path.",
        "config-set-profile",
      );
    }
    if (profile || agentProfile) {
      return usage(
        "config set-profile does not accept --profile or --agent-profile.",
        "config-set-profile",
      );
    }
    return {
      kind: "ok",
      request: {
        command: "config-set-profile",
        path: subcommandPositional[1],
        profileName,
        extendsProfile,
        main,
        stages,
        disableStages,
        newEvaluators,
        models,
        implementationIds,
        implementationVersions,
        ...base,
      },
    };
  }
  if (commandName === "version") {
    if (positional.length > 1) {
      return usage("version accepts at most one path.", "version");
    }
    return {
      kind: "ok",
      request: { command: "version", path: positional[0], ...base },
    };
  }
  if (commandName === "parse") {
    if (positional.length !== 1) {
      return usage("parse requires exactly one file.", "parse");
    }
    return {
      kind: "ok",
      request: { command: "parse", file: positional[0], ...base },
    };
  }
  if (
    commandName === "check" || commandName === "fmt" ||
    commandName === "glossary" ||
    commandName === "graph" ||
    commandName === "render"
  ) {
    if (
      commandName === "fmt" && format &&
      !["json", "text"].includes(format)
    ) {
      return usage("--format must be text or json for fmt.", "fmt");
    }
    if (positional.length > 1) {
      return usage(
        `${commandName} accepts at most one path.`,
        commandName,
      );
    }
    return {
      kind: "ok",
      request: {
        command: commandName,
        path: positional[0],
        ...(commandName === "fmt" ? { check } : {}),
        ...base,
        ...(commandName === "check" ? { showLocations } : {}),
      } as
        | CheckRequest
        | FmtRequest
        | GlossaryRequest
        | GraphRequest
        | RenderRequest,
    };
  }
  if (commandName === "retrieve") {
    if (positional.length > 1) {
      return usage("retrieve accepts at most one workspace path.", "retrieve");
    }
    if (!purpose) {
      return usage(
        "retrieve requires --purpose semantic, architecture, or implementation.",
        "retrieve",
      );
    }
    if (!!component === !!file) {
      return usage(
        "retrieve requires exactly one of --component or --file.",
        "retrieve",
      );
    }
    if (format && !["json", "markdown"].includes(format)) {
      return usage(
        "--format must be json or markdown for retrieve.",
        "retrieve",
      );
    }
    return {
      kind: "ok",
      request: {
        command: "retrieve",
        component,
        maxEvidenceBytes,
        file,
        purpose,
        path: positional[0],
        ...base,
      },
    };
  }
  if (commandName === "compile") {
    if (compileAgent && profile) {
      return usage(
        "compile accepts either --profile or --agent, not both.",
        "compile",
      );
    }
    const stage = COMPILATION_STAGE_IDS.includes(
        positional[0] as typeof COMPILATION_STAGE_IDS[number],
      )
      ? positional[0]
      : undefined;
    const paths = stage ? positional.slice(1) : positional;
    if (stage && focus) {
      return usage(
        "compile accepts either a positional stage or --focus, not both.",
        "compile",
      );
    }
    if (paths.length > 1) {
      return usage(
        "compile accepts an optional stage followed by at most one path.",
        "compile",
      );
    }
    if (component && file) {
      return usage(
        "compile accepts only one of --component or --file.",
        "compile",
      );
    }
    if (position && !file) {
      return usage("compile accepts --position only with --file.", "compile");
    }
    if (position && component) {
      return usage(
        "compile does not accept --position with --component.",
        "compile",
      );
    }
    if (
      format && format !== "jsonl" && format !== "text" &&
      format !== "markdown"
    ) {
      return usage(
        "--format must be text, jsonl, or markdown for compile.",
        "compile",
      );
    }
    const selectors = [
      component ? "--component" : undefined,
      file ? "--file" : undefined,
      directory ? "--directory" : undefined,
    ].filter(Boolean);
    if (selectors.length > 1) {
      return usage(
        `compile accepts only one of ${selectors.join(", ")}.`,
        "compile",
      );
    }
    if (position && !file) {
      return usage("compile --position requires --file.", "compile");
    }
    if (exactTarget && selectors.length === 0) {
      return usage(
        "compile --exact-target requires a selector to preserve.",
        "compile",
      );
    }
    return {
      kind: "ok",
      request: {
        command: "compile",
        stage,
        focus,
        component,
        file,
        directory,
        exactTarget,
        position,
        path: paths[0],
        profile,
        agent: compileAgent,
        noCache,
        output,
        ...base,
      },
    };
  }
  if (positional.length > 1) {
    return usage("context accepts at most one path.", "context");
  }
  if (component && file) {
    return usage(
      "context accepts only one of --component or --file.",
      "context",
    );
  }
  if (!component && !file) {
    return usage("context requires --component or --file.", "context");
  }
  if (includeDependents && !component) {
    return usage(
      "context accepts --include-dependents only with --component.",
      "context",
    );
  }
  return {
    kind: "ok",
    request: {
      command: "context",
      component,
      file,
      includeDependents,
      path: positional[0],
      ...base,
    },
  };
}

function isCommand(value: string | undefined): value is CommandName {
  return value === "skill" || value === "init" || value === "config" ||
    value === "version" ||
    value === "parse" ||
    value === "check" || value === "fmt" || value === "glossary" ||
    value === "graph" ||
    value === "context" ||
    value === "retrieve" ||
    value === "compile" ||
    value === "render";
}
function splitKeyValue(value: string): readonly [string, string] | undefined {
  const index = value.indexOf("=");
  if (index <= 0 || index === value.length - 1) return undefined;
  return [value.slice(0, index), value.slice(index + 1)];
}
function isSkillAgent(value: string): value is SkillAgent {
  return value === "codex" || value === "claude" || value === "opencode" ||
    value === "pi";
}
function isFormat(value: string): value is OutputFormat {
  return value === "json" || value === "jsonl" || value === "text" ||
    value === "markdown";
}
function helpTopicFor(
  commandName: CommandName,
  firstArgument: string | undefined,
): HelpTopic {
  if (
    commandName === "skill" &&
    (firstArgument === "list" || firstArgument === "install")
  ) {
    return `skill-${firstArgument}`;
  }
  if (
    commandName === "config" &&
    (firstArgument === "set-default" || firstArgument === "set-profile")
  ) {
    return `config-${firstArgument}`;
  }
  return commandName;
}
function usage(message: string, helpTopic: HelpTopic): UsageError {
  return { kind: "usage-error", message, helpTopic };
}
