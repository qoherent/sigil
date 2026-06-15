import { assertEquals, assertStringIncludes } from '@std/assert'
import { runQodeCommand } from '../src/cli/mod.ts'

Deno.test('qode --help returns usage text', () => {
  const result = runQodeCommand(['--help'])

  assertEquals(result.status, 0)
  assertStringIncludes(result.stdout, 'Usage: qode')
  assertStringIncludes(result.stdout, 'qode check')
  assertStringIncludes(result.stdout, 'qode lsp')
  assertEquals(result.stderr, '')
})

Deno.test('qode check with no files reports a clear error', () => {
  const result = runQodeCommand(['check'])

  assertEquals(result.status, 1)
  assertEquals(result.stdout, '')
  assertStringIncludes(result.stderr, 'qode check')
  assertStringIncludes(result.stderr, 'expected at least one file')
})

Deno.test('qode lsp --help documents language server startup', () => {
  const result = runQodeCommand(['lsp', '--help'])

  assertEquals(result.status, 0)
  assertStringIncludes(result.stdout, 'Usage: qode lsp')
  assertStringIncludes(result.stdout, 'starts the Qode language server')
  assertEquals(result.stderr, '')
})

Deno.test('invalid commands return non-zero status', () => {
  const result = runQodeCommand(['unknown'])

  assertEquals(result.status, 1)
  assertEquals(result.stdout, '')
  assertStringIncludes(result.stderr, 'Unknown command: unknown')
})
