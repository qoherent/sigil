# sigil-core

Shared Sigil implementation package.

`sigil-core` is the center of the platform.
Every CLI command, editor feature, renderer, agent context pack, and host integration should use this package instead of reinterpreting Sigil independently.

Planned responsibilities:

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
