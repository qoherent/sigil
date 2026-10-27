/** What the language server says about the workspace of one document. */
export type DocumentWorkspace =
  | { state: "workspace"; name: string; root: string }
  | { state: "excluded"; name: string; root: string; reason: string }
  | { state: "none"; reason: string };

export interface IndicatorView {
  visible: boolean;
  text: string;
  tooltip: string;
  /** The entry draws attention: the file is served by no workspace. */
  warning: boolean;
}

const HIDDEN: IndicatorView = {
  visible: false,
  text: "",
  tooltip: "",
  warning: false,
};

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** The server's answer, or undefined when it is not one of the three states. */
export function parseDocumentWorkspace(
  value: unknown,
): DocumentWorkspace | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const answer = value as Record<string, unknown>;
  const reason = text(answer.reason);
  if (answer.state === "none") {
    return reason ? { state: "none", reason } : undefined;
  }
  const name = text(answer.name);
  const root = text(answer.root);
  if (!name || !root) return undefined;
  if (answer.state === "workspace") return { state: "workspace", name, root };
  if (answer.state === "excluded") {
    return reason ? { state: "excluded", name, root, reason } : undefined;
  }
  return undefined;
}

/** The status bar entry for an answer; no answer hides the entry. */
export function indicatorView(
  answer: DocumentWorkspace | undefined,
): IndicatorView {
  if (!answer) return HIDDEN;
  switch (answer.state) {
    case "workspace":
      return {
        visible: true,
        text: `$(root-folder) ${answer.name}`,
        tooltip: `Sigil workspace ${answer.name}\n${answer.root}`,
        warning: false,
      };
    case "excluded":
      return {
        visible: true,
        text: `$(warning) ${answer.name}: file not selected`,
        tooltip:
          `${answer.reason}\nSigil workspace ${answer.name}\n${answer.root}`,
        warning: true,
      };
    case "none":
      return {
        visible: true,
        text: "$(warning) No Sigil workspace",
        tooltip: answer.reason,
        warning: true,
      };
  }
}
