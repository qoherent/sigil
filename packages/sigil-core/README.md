# sigil-core

Shared Sigil implementation package.

`sigil-core` is the center of the platform.
Every CLI command, editor feature, renderer, agent context pack, and host integration should use this package instead of reinterpreting Sigil independently.

Package docs:

- [spec.md](spec.md): v1 product requirements and acceptance scenarios.
- [architecture.md](architecture.md): architecture style, internal modules, dependency rules, and implementation guidelines.

Platform context lives in [../../spec/sigil-platform-architecture.md](../../spec/sigil-platform-architecture.md).

Responsibilities:

- parse `.sigil` files;
- preserve source locations and semantic lines;
- resolve imports;
- collect component expansions;
- build the workspace graph;
- produce diagnostics;
- expose agent and human projection primitives.

Non-responsibilities:

- parse CLI arguments;
- know about Codex prompts;
- know about VS Code APIs;
- own editor UI;
- own transport protocols such as LSP or MCP.
