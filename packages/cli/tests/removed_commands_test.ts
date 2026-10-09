import { assert, assertEquals } from "@std/assert";
import { runCli } from "../src/main.ts";

// @sigil tests packages/cli/_module.sigil::SigilCli::RemovedSemanticCommands interface
Deno.test("removed semantic routes reject usage and are absent from CLI help", async () => {
  for (
    const subcommand of [
      "intent",
      "status",
      "answer",
      "accept",
      "project",
      "slice",
      "receipts",
      "verify",
      "artifacts",
      "migrate",
    ]
  ) {
    const result = await runCli(["semantic", subcommand]);
    assertEquals(result.exitCode, 2, subcommand);
    assertEquals(result.stdout, "");
    assert(result.stderr.includes('Unknown command "semantic"'));
  }
  const help = await runCli(["--help"]);
  assert(!/^\s+semantic\s/m.test(help.stdout));
  assert(!/^\s+export\s/m.test(help.stdout));
  const exported = await runCli(["export", "design"]);
  assertEquals(exported.exitCode, 2);
  assertEquals(exported.stdout, "");
  assert(exported.stderr.includes('Unknown command "export"'));
});

Deno.test("legacy compilation/config/runtime commands and event flags are absent", async () => {
  const help = await runCli(["--help"]);
  for (const command of ["compile", "config", "doctor"]) {
    for (
      const args of [[command], [command, "--help"], [
        command,
        "--format",
        "jsonl",
      ]]
    ) {
      const result = await runCli(args);
      assertEquals(result.exitCode, 2);
      assertEquals(result.stdout, "");
      assert(result.stderr.includes(`Unknown command "${command}"`));
    }
    assert(!new RegExp(`^\\s+${command}\\s`, "m").test(help.stdout));
  }
  for (
    const flag of [
      "--profile",
      "--focus",
      "--stage",
      "--position",
      "--no-cache",
      "--handoff",
      "--receipts",
      "--model",
      "--evaluator",
    ]
  ) {
    assertEquals((await runCli(["check", flag, "legacy"])).exitCode, 2, flag);
  }
  assertEquals((await runCli(["check", "--format", "jsonl"])).exitCode, 2);
});
