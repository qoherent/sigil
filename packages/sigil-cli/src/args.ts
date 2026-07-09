export type CommandName = "parse" | "check" | "graph" | "context" | "render";
export type OutputFormat = "json" | "text" | "markdown";

export interface GlobalOptions {
  readonly root?: string;
  readonly format?: OutputFormat;
  readonly pretty: boolean;
  readonly quiet: boolean;
}

export type CommandRequest =
  | ParseRequest
  | CheckRequest
  | GraphRequest
  | ContextRequest
  | RenderRequest;

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

export type ParseArgsResult =
  | { readonly kind: "ok"; readonly request: CommandRequest }
  | UsageError;

export function parseArgs(argv: readonly string[]): ParseArgsResult {
  const [commandName, ...rest] = argv;
  if (!isCommand(commandName)) {
    return usage(`Expected command: parse, check, graph, context, or render.`);
  }

  const positional: string[] = [];
  let root: string | undefined;
  let format: OutputFormat | undefined;
  let pretty = false;
  let quiet = false;
  let component: string | undefined;
  let file: string | undefined;

  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index];
    switch (arg) {
      case "--root":
        root = requiredValue(rest, ++index, "--root");
        if (root === undefined) return usage("--root requires a value.");
        break;
      case "--format": {
        const value = requiredValue(rest, ++index, "--format");
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
      case "--component":
        component = requiredValue(rest, ++index, "--component");
        if (component === undefined) {
          return usage("--component requires a value.");
        }
        break;
      case "--file":
        file = requiredValue(rest, ++index, "--file");
        if (file === undefined) return usage("--file requires a value.");
        break;
      default:
        if (arg.startsWith("-")) return usage(`Unsupported option ${arg}.`);
        positional.push(arg);
    }
  }

  const base = { root, format, pretty, quiet };

  if (commandName === "parse") {
    if (positional.length !== 1) {
      return usage("parse requires exactly one file.");
    }
    return {
      kind: "ok",
      request: { command: "parse", file: positional[0], ...base },
    };
  }

  if (commandName === "check") {
    if (positional.length > 1) return usage("check accepts at most one path.");
    return {
      kind: "ok",
      request: { command: "check", path: positional[0], ...base },
    };
  }

  if (commandName === "graph") {
    if (positional.length > 1) return usage("graph accepts at most one path.");
    return {
      kind: "ok",
      request: { command: "graph", path: positional[0], ...base },
    };
  }

  if (commandName === "context") {
    if (positional.length > 1) {
      return usage("context accepts at most one path.");
    }
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

  if (positional.length > 1) return usage("render accepts at most one path.");
  return {
    kind: "ok",
    request: { command: "render", path: positional[0], ...base },
  };
}

function requiredValue(
  args: readonly string[],
  index: number,
  flag: string,
): string | undefined {
  const value = args[index];
  return value && !value.startsWith("-") ? value : undefined;
}

function isCommand(value: string | undefined): value is CommandName {
  return value === "parse" || value === "check" || value === "graph" ||
    value === "context" || value === "render";
}

function isFormat(value: string | undefined): value is OutputFormat {
  return value === "json" || value === "text" || value === "markdown";
}

function usage(message: string): UsageError {
  return { kind: "usage-error", message };
}
