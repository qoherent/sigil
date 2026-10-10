import { strictEqual as equal } from "node:assert/strict";
import * as claims from "./claims.ts";

Deno.test("implementation evidence requires current report, matching identity and valid state exit", () => {
  const identity = {
    workspaceDigest: "workspace",
    designBindingDigest: "design",
    selectionDigest: "selection",
    namesDigest: "names",
    implementationDigest: "code",
    guidanceFingerprint: "guidance",
    vocabularyGeneration: 1,
  };
  const input = {
    privateStore: "/tmp/private",
    exitCode: 0,
    workspaceDigest: "workspace",
    guidanceFingerprint: "guidance",
    vocabularyGeneration: 1,
    memoKeys: [],
    result: {
      version: 1,
      scope: "workspace",
      state: "closed",
      designState: "coherent",
      findings: 0,
      unreadUnits: 0,
      incompleteReasons: [],
      report: "/tmp/private/claims/workspace.align.json",
      judgmentContext: "/tmp/private/claims/workspace.align.context.json",
      ...identity,
    },
    report: {
      version: 1,
      source: "workspace",
      state: "closed",
      designState: "coherent",
      findings: [],
      unreadFiles: [],
      incompleteReasons: [],
      identity,
    },
    context: {
      version: 1,
      source: "workspace",
      identity,
      designCheck: {
        identity: { bindingDigest: "design" },
        linked: { workspaceDigest: "workspace" },
      },
      selection: { fingerprint: "selection" },
    },
  };
  equal(claims.validateAlignmentEvidence(input).valid, true);
  equal(
    claims.validateAlignmentEvidence({ ...input, exitCode: 1 }).valid,
    false,
  );
  equal(
    claims.validateAlignmentEvidence({
      ...input,
      report: { ...input.report, version: 6 },
    }).valid,
    false,
  );
  equal(
    claims.validateAlignmentEvidence({
      ...input,
      context: {
        ...input.context,
        identity: { ...identity, namesDigest: "stale" },
      },
    }).valid,
    false,
  );
  equal(
    claims.validateAlignmentEvidence({
      ...input,
      result: { ...input.result, report: "/elsewhere/workspace.align.json" },
    }).valid,
    false,
  );
});
