# sigil-core

Current package version: **0.7.1**. Import with:

```ts
import { parseSigilDocument } from "jsr:@qoherent/sigil-core@0.7";
```

Raw parsing requires an explicit `sigilVersion`. Workspace APIs discover and
validate mandatory `.sigil/config.json` before loading `.sigil` files.

Shared Sigil implementation package.

`sigil-core` is the center of the platform. Every CLI command, editor feature,
renderer, agent context pack, and host integration should use this package
instead of reinterpreting Sigil independently.

Package docs:

- [_module.sigil](./_module.sigil): public `SigilCore` contract and
  package-wide operational decisions.
- [spec.md](spec.md): version 0.7 product requirements and acceptance scenarios.
- [architecture.md](architecture.md): architecture style, internal modules,
  dependency rules, and implementation guidelines.

Platform context lives in
[../../spec/sigil-platform-architecture.md](../../spec/sigil-platform-architecture.md).

Responsibilities:

- parse `.sigil` files;
- preserve source locations and semantic units;
- preserve attached typed literal blocks outside structural and reference
  interpretation;
- report strict per-name unused imports;
- canonically wrap prose at 79 content characters without counting indentation;
- parse and validate optional `.sigil/glossary.json`;
- resolve path-scoped glossary contexts and source-ranged prose occurrences;
- project only agent-visible glossary terms recognized in selected
  agent-context files while retaining excluded terms for full glossary and
  editor consumers;
- parse concept blocks and resolve flat public/private concept namespaces;
- parse optional free-form decision-rationale sections;
- identify the root project and workspace-member roots declared by
  `workspace.members`;
- resolve imports;
- project direct dependencies' public contracts and durable decisions into
  bounded agent dependency context;
- resolve `_module.sigil` as an explicit index in any included directory;
- keep every component public through explicit-file imports;
- collect component expansions;
- diagnose ungrouped interface concepts without making warnings fatal;
- build the workspace graph;
- produce diagnostics;
- expose agent and human projection primitives.

Non-responsibilities:

- parse CLI arguments;
- know about Codex prompts;
- know about VS Code APIs;
- own editor UI;
- own transport protocols such as LSP or MCP.
