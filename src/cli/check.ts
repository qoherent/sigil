import { type CommandResult, fail, hasHelpFlag, ok } from './commands.ts'

const CHECK_HELP = `Usage: qode check <files...>

Validate .qode concept files.
`

export function handleCheckCommand(args: readonly string[]): CommandResult {
  if (hasHelpFlag(args)) {
    return ok(CHECK_HELP)
  }

  const unknownOption = args.find((arg) => arg.startsWith('-'))
  if (unknownOption !== undefined) {
    return fail(`qode check: unknown option: ${unknownOption}\n`)
  }

  if (args.length === 0) {
    return fail('qode check: expected at least one file\n')
  }

  return ok('qode check: validation is not implemented yet\n')
}
