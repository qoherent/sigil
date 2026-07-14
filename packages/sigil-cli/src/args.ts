export type CommandName =
  | "init"
  | "version"
  | "parse"
  | "check"
  | "graph"
  | "context"
  | "render";
export type OutputFormat = "json" | "text" | "markdown";

export interface GlobalOptions {
  readonly root?: string;
  readonly format?: OutputFormat;
  readonly pretty: boolean;
  readonly quiet: boolean;
}

export type CommandRequest =
  | InitRequest
  | VersionRequest
  | ParseRequest
  | CheckRequest
  | GraphRequest
  | ContextRequest
  | RenderRequest;
export interface InitRequest extends GlobalOptions {
  readonly command: "init";
  readonly path?: string;
  readonly name?: string;
  readonly include: readonly string[];
  readonly exclude: readonly string[];
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
}
export interface GraphRequest extends GlobalOptions {
  readonly command: "graph";
  readonly path?: string;
}
export interface ContextRequest extends GlobalOptions {
  readonly command: "context";
  readonly component?: string;
  readonly file?: string;
  readonly path?: string;
}
export interface RenderRequest extends GlobalOptions {
  readonly command: "render";
  readonly path?: string;
}
export interface UsageError {
  readonly kind: "usage-error";
  readonly message: string;
}
export type ParseArgsResult = {
  readonly kind: "ok";
  readonly request: CommandRequest;
} | UsageError;

export function parseArgs(argv: readonly string[]): ParseArgsResult {
  const [commandName, ...rest] = argv;
  if (!isCommand(commandName)) {
    return usage(
      "Expected command: init, version, parse, check, graph, context, or render.",
    );
  }

  const positional: string[] = [];
  let root: string | undefined;
  let format: OutputFormat | undefined;
  let pretty = false;
  let quiet = false;
  let component: string | undefined;
  let file: string | undefined;
  let name: string | undefined;
  const include: string[] = [];
  const exclude: string[] = [];

  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index];
    const take = (flag: string): string | UsageError => {
      const value = rest[++index];
      return value && !value.startsWith("-")
        ? value
        : usage(`${flag} requires a value.`);
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
          return usage("--format must be json, text, or markdown.");
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
      case "--component": {
        const value = take(arg);
        if (typeof value !== "string") return value;
        component = value;
        break;
      }
      case "--file": {
        const value = take(arg);
        if (typeof value !== "string") return value;
        file = value;
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
      default:
        if (arg.startsWith("-")) return usage(`Unsupported option ${arg}.`);
        positional.push(arg);
    }
  }

  const base = { root, format, pretty, quiet };
  if (commandName !== "context" && (component || file)) {
    return usage(`${commandName} does not accept --component or --file.`);
  }
  if (commandName !== "init" && (name || include.length || exclude.length)) {
    return usage(`${commandName} does not accept init options.`);
  }
  if (commandName === "init") {
    if (root) {
      return usage("init uses its path argument and does not accept --root.");
    }
    if (positional.length > 1) return usage("init accepts at most one path.");
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
  if (commandName === "version") {
    if (positional.length > 1) {
      return usage("version accepts at most one path.");
    }
    return {
      kind: "ok",
      request: { command: "version", path: positional[0], ...base },
    };
  }
  if (commandName === "parse") {
    if (positional.length !== 1) {
      return usage("parse requires exactly one file.");
    }
    return {
      kind: "ok",
      request: { command: "parse", file: positional[0], ...base },
    };
  }
  if (
    commandName === "check" || commandName === "graph" ||
    commandName === "render"
  ) {
    if (positional.length > 1) {
      return usage(`${commandName} accepts at most one path.`);
    }
    return {
      kind: "ok",
      request: { command: commandName, path: positional[0], ...base } as
        | CheckRequest
        | GraphRequest
        | RenderRequest,
    };
  }
  if (positional.length > 1) return usage("context accepts at most one path.");
  if (component && file) {
    return usage("context accepts only one of --component or --file.");
  }
  if (!component && !file) {
    return usage("context requires --component or --file.");
  }
  return {
    kind: "ok",
    request: {
      command: "context",
      component,
      file,
      path: positional[0],
      ...base,
    },
  };
}

function isCommand(value: string | undefined): value is CommandName {
  return value === "init" || value === "version" || value === "parse" ||
    value === "check" || value === "graph" || value === "context" ||
    value === "render";
}
function isFormat(value: string): value is OutputFormat {
  return value === "json" || value === "text" || value === "markdown";
}
function usage(message: string): UsageError {
  return { kind: "usage-error", message };
}
