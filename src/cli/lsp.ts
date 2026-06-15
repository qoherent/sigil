import { type CommandResult, fail, hasHelpFlag, ok } from './commands.ts'

const LSP_HELP = `Usage: qode lsp [--help]

starts the Qode language server over stdio.
`

export function handleLspCommand(args: readonly string[]): CommandResult {
  if (hasHelpFlag(args)) {
    return ok(LSP_HELP)
  }

  const unknownOption = args.find((arg) => arg.startsWith('-'))
  if (unknownOption !== undefined) {
    return fail(`qode lsp: unknown option: ${unknownOption}\n`)
  }

  return fail('qode lsp: language server is not implemented yet\n')
}
