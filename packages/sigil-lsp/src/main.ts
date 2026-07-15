/** Sigil Language Server Protocol 3.18 stdio entrypoint. @module */
import { runLanguageServer } from "./protocol.ts";

export { runLanguageServer } from "./protocol.ts";
export { SigilLanguageServer } from "./server.ts";

if (import.meta.main) {
  try {
    const exitCode = await runLanguageServer(
      Deno.stdin.readable,
      Deno.stdout.writable,
    );
    Deno.exit(exitCode);
  } catch (error) {
    await Deno.stderr.write(
      new TextEncoder().encode(
        `${error instanceof Error ? error.message : String(error)}\n`,
      ),
    );
    Deno.exit(1);
  }
}
