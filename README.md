# Qode

Qode is a typed architectural specification language for LLM-first implementation.

It is a compact language for describing software and systems at the architectural level: precise enough for an LLM to simulate, test, and eventually implement, but intentionally less detailed than code.

The specification is the source of truth.

The first practical milestone is editor and CLI support for the language: parsing, diagnostics, TypeScript-compatible declarations, and LSP navigation. Runtime LLM execution is a future milestone, not part of the current LSP PRD.

See [PRD.md](./PRD.md) for the current LSP execution plan and [ARCHITECTURE.md](./ARCHITECTURE.md) for durable technical design.

## Product Idea

Code combines several distinct concerns:

- what a system is for
- what it exposes
- what states it can occupy
- how it should behave
- how that behavior happens to be implemented

Qode separates architectural meaning from implementation.

Its design goal is:

> A concept is sufficiently specified when a human or LLM can operate its interface without reading or writing its implementation.

This makes it possible to validate an architecture before committing to code.

## Core Form

```ts
concept Name<T> {
  goal:
    why the concept exists and what outcome it enables.

  definition {
    type declarations;
    internal capabilities and function signatures;
  }

  interface {
    externally accessible constructors, methods, fields, ports, or messages;
  }

  state {
    architecturally meaningful states and their typed data;
  }

  behavior:
    typed English describing transitions, conditions, invariants, and edge cases.
}
```

## Meaning of Each Section

`concept` defines the system boundary and its identity. A concept may later be decomposed into smaller concepts using the same structure recursively.

`goal` describes why the system exists. It gives the top-down criterion against which generated implementations and design choices can be judged.

`definition` provides the concept's vocabulary and internal capabilities. It combines TypeScript-compatible type declarations and function signatures that matter architecturally but are not necessarily part of the public interface.

`interface` defines how the surrounding system can interact with the concept. It represents architectural inputs and outputs, not implementation methods by default.

`state` defines the meaningful modes the concept may occupy. State declarations establish the system's state-machine vocabulary without prescribing how state is stored.

`behavior` defines how the concept acts over time. It explains, in concise English and using declared types, how interface calls and external conditions affect state and outputs.

## Design Principles

### Architect-Level, Not Coder-Level

The specification describes observable structure and behavior.

It should not describe queues, fields, algorithms, loops, storage layout, mutation strategy, or other implementation details unless they are themselves architecturally significant.

### TypeScript-Compatible Declarations

Where formal precision is valuable, Qode reuses TypeScript syntax and semantics:

- generics
- function signatures
- interfaces
- aliases
- unions
- intersections
- optional values
- structural typing
- utility types

Qode may use its own parser and AST, but should remain close enough to TypeScript to reuse parts of its ecosystem, type definitions, tooling concepts, diagnostics, and syntax highlighting.

### Explicit State Machines

State cannot be reduced to prose without losing architectural meaning.

```ts
state {
  Waiting;
  Value<T>;
  Failure(reason: Reason);
}
```

These are architectural states, not an object's internal storage representation.

### Behavior Is Typed English

After the typed declarations and state model, behavior is written in concise natural language.

The prose must use the names and types already declared in the concept.

It describes:

- state transitions
- transition conditions
- outputs
- continuation and propagation
- concurrency or timing expectations
- invariants
- exceptional cases
- ignored or forbidden operations

The language does not attempt to replace English with another low-level event DSL. An LLM interpretation pass is assumed in future runtime milestones.

## Example

```ts
concept Promise<T> {
  goal:
    a non-blocking handle to a value that may arrive now, later, or fail.

  definition {
    type Reason = any;
    type Handler<I, O> = (input: I) => O | PromiseLike<O>;

    resolve(value: T | PromiseLike<T>): void;
    reject(reason?: Reason): void;
  }

  interface {
    new Promise<T>(
      execute: (
        resolve: (value: T | PromiseLike<T>) => void,
        reject: (reason?: Reason) => void
      ) => void
    );

    then<U>(fn: Handler<T, U>): Promise<U>;
    catch<U>(fn: Handler<Reason, U>): Promise<T | U>;
  }

  state {
    Pending;
    Resolved(value: T);
    Rejected(reason: Reason);
  }

  behavior:
    A new Promise starts Pending and immediately runs execute(resolve, reject).

    While Pending, resolve(value) settles the Promise as Resolved(value).
    If value is PromiseLike<T>, the Promise follows its eventual outcome.

    While Pending, reject(reason) settles the Promise as Rejected(reason).

    Once settled, later resolve or reject calls have no effect.

    then(fn) intercepts a resolved value.
    catch(fn) intercepts a rejected reason.

    A non-matching handler is skipped and the existing outcome continues.

    A handler produces a new Promise for its returned value, followed
    PromiseLike, or thrown error.

    A handler attached while Pending runs after the Promise settles.

    Multiple handlers attached to one Promise are independent and each
    matching handler runs once.
}
```

## Current Milestone: LSP and CLI

The current implementation target is language tooling:

- parse `.qode` files
- validate TypeScript-compatible regions
- expose diagnostics through CLI and LSP
- generate virtual TypeScript declarations for editor intelligence
- support navigation between concept files and configured TypeScript implementations
- compile to a self-contained `qode` binary

The current milestone is detailed in [PRD.md](./PRD.md).

## Future Milestones

### LLM Semantic Execution

The first executable form of a concept can be a semantic stub:

```ts
export function add(a: number, b: number): number {
  return LLM.pretend()
}
```

The runtime supplies the LLM with:

- the relevant concept
- the invoked interface member
- typed arguments
- expected return type
- current conceptual state
- applicable behavioral rules

The LLM returns the result and any state transition described by the specification.

This is not a conventional mock. A mock contains manually programmed substitute behavior. A semantic stub derives substitute behavior from the architectural specification.

### Hybrid Implementation

Implemented members run as normal code. Unimplemented members continue to use semantic stubs.

### Concrete Implementation

Real code replaces all semantic stubs. The concept remains the architectural contract and can generate tests, documentation, state diagrams, implementation plans, and conformance checks.

## Development Lifecycle

```text
Concept specification
  |
Type and state validation
  |
LLM semantic execution
  |
Examples, tests, prototypes, and UX validation
  |
Hybrid implementation
  |
Real implementation
  |
Conformance checking against the original concept
```

The current project is at the type, state, CLI, and LSP validation stage.

## Relationship to Systems Thinking

```text
concept    = system boundary
goal       = purpose and desired outcome
definition = shared vocabulary and internal capabilities
interface  = inputs and outputs
state      = system memory and modes
behavior   = transitions, feedback, propagation, and edge cases
```

Hierarchy is recursive: any concept may be opened and described as a system of smaller concepts.

## Positioning

Qode is not intended to be:

- a general-purpose programming language
- a formal verification language
- a code-shaped state-machine DSL
- a collection of test scenarios
- a prompt format
- a replacement for TypeScript

It is an architectural source language designed for a world where LLMs can interpret intent and fill the gap between specification and implementation.

Its central product proposition is:

> Specify the system once at the level architects reason about it, execute that meaning immediately through an LLM, and replace simulation with real code without changing the contract.

## Development

```sh
deno task dev
deno task test
deno task check
deno task build
```

The built binary is written to `build/qode`.

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for parser, AST, TypeScript projection, language service, LSP, and CLI architecture.
