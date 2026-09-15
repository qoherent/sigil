export function assert(
  value: unknown,
  message = "Assertion failed",
): asserts value {
  if (!value) throw new Error(message);
}

export function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`Expected ${b}, received ${a}`);
}
