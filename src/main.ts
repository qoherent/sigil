import { runQodeCommand } from './cli/mod.ts'

export { runQodeCommand } from './cli/mod.ts'

if (import.meta.main) {
  const result = runQodeCommand(Deno.args)
  const encoder = new TextEncoder()

  if (result.stdout.length > 0) {
    await Deno.stdout.write(encoder.encode(result.stdout))
  }

  if (result.stderr.length > 0) {
    await Deno.stderr.write(encoder.encode(result.stderr))
  }

  Deno.exit(result.status)
}
