export interface EvaluationSkillManifest {
  readonly id: string;
  readonly version: string;
  readonly inputs: readonly string[];
  readonly dependencies: readonly string[];
  readonly capabilities: readonly string[];
  readonly rules: readonly string[];
  readonly implementationEvidence: "context-only" | "compare";
  readonly output: "compiler-findings-v1";
}

export interface EvaluationSkillPackage {
  readonly manifest: EvaluationSkillManifest;
  readonly guidance: string;
}

export const AGENTIC_STAGE_IDS = [
  "semantic-readiness",
  "architecture-design",
  "current-code-compatibility",
  "standards-risk",
] as const;

export const COMPILATION_STAGE_IDS = [
  "deterministic-foundation",
  ...AGENTIC_STAGE_IDS,
] as const;

const EMBEDDED_SKILLS: Readonly<
  Record<string, { readonly guidance: string; readonly manifest: unknown }>
> = {
  "semantic-readiness": {
    guidance: readinessGuidance,
    manifest: readinessManifest,
  },
  "architecture-design": {
    guidance: architectureGuidance,
    manifest: architectureManifest,
  },
  "current-code-compatibility": {
    guidance: compatibilityGuidance,
    manifest: compatibilityManifest,
  },
  "standards-risk": {
    guidance: riskGuidance,
    manifest: riskManifest,
  },
};

/*
 * @sigil implements packages/compiler/src/evaluation-registry.sigil::SigilEvaluationSkillRegistry::EvaluationSkillPackage interface,logic,constraints,cases
 * @sigil implements packages/compiler/src/evaluation-skills.sigil::SigilEvaluationSkillRegistry::ImplementationEvidencePolicy logic,constraints
 * @sigil implements packages/compiler/src/evaluation-skills.sigil::SigilEvaluationSkillRegistry::ArchitectureModularityAndGraphHarmony logic,constraints,cases
 */
export async function loadEvaluationSkills(
  skillRoot?: URL,
): Promise<ReadonlyMap<string, EvaluationSkillPackage>> {
  const packages = new Map<string, EvaluationSkillPackage>();
  for (const id of AGENTIC_STAGE_IDS) {
    let guidance: string;
    let rawManifest: unknown;
    if (skillRoot) {
      const directory = new URL(`${id}/`, skillRoot);
      try {
        [guidance, rawManifest] = await Promise.all([
          Deno.readTextFile(new URL("SKILL.md", directory)),
          Deno.readTextFile(new URL("compile.json", directory)).then(
            JSON.parse,
          ),
        ]);
      } catch (error) {
        throw new Error(
          `Required evaluation skill ${id} could not be loaded: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    } else {
      ({ guidance, manifest: rawManifest } = EMBEDDED_SKILLS[id]);
    }
    const manifest = validateManifest(rawManifest, id);
    if (!guidance.trim()) {
      throw new Error(`Evaluation skill ${id} has an empty SKILL.md.`);
    }
    packages.set(id, { manifest, guidance });
  }
  return packages;
}

// @sigil implements packages/compiler/src/evaluation-skills.sigil::SigilEvaluationSkillRegistry::ImplementationEvidencePolicy logic,constraints
function validateManifest(
  value: unknown,
  expectedId: string,
): EvaluationSkillManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Evaluation skill ${expectedId} has an invalid manifest.`);
  }
  const item = value as Record<string, unknown>;
  if (item.id !== expectedId) {
    throw new Error(
      `Evaluation skill directory ${expectedId} declares id ${
        JSON.stringify(item.id)
      }.`,
    );
  }
  if (typeof item.version !== "string" || !item.version) {
    throw new Error(`Evaluation skill ${expectedId} requires a version.`);
  }
  for (const field of ["inputs", "dependencies", "capabilities", "rules"]) {
    const values = item[field];
    if (
      !Array.isArray(values) ||
      values.some((entry) => typeof entry !== "string" || !entry)
    ) {
      throw new Error(
        `Evaluation skill ${expectedId}.${field} must be a string array.`,
      );
    }
  }
  if (
    new Set(item.rules as string[]).size !== (item.rules as string[]).length
  ) {
    throw new Error(`Evaluation skill ${expectedId} declares duplicate rules.`);
  }
  if (!(item.capabilities as string[]).includes("read-workspace")) {
    throw new Error(
      `Evaluation skill ${expectedId} must declare read-workspace capability.`,
    );
  }
  if (
    !["context-only", "compare"].includes(String(item.implementationEvidence))
  ) {
    throw new Error(
      `Evaluation skill ${expectedId}.implementationEvidence must be context-only or compare.`,
    );
  }
  if (item.output !== "compiler-findings-v1") {
    throw new Error(
      `Evaluation skill ${expectedId} has unsupported output ${
        JSON.stringify(item.output)
      }.`,
    );
  }
  return item as unknown as EvaluationSkillManifest;
}
import architectureManifest from "../skills/architecture-design/compile.json" with {
  type: "json",
};
import architectureGuidance from "../skills/architecture-design/SKILL.md" with {
  type: "text",
};
import compatibilityManifest from "../skills/current-code-compatibility/compile.json" with {
  type: "json",
};
import compatibilityGuidance from "../skills/current-code-compatibility/SKILL.md" with {
  type: "text",
};
import readinessManifest from "../skills/semantic-readiness/compile.json" with {
  type: "json",
};
import readinessGuidance from "../skills/semantic-readiness/SKILL.md" with {
  type: "text",
};
import riskManifest from "../skills/standards-risk/compile.json" with {
  type: "json",
};
import riskGuidance from "../skills/standards-risk/SKILL.md" with {
  type: "text",
};
