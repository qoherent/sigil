import { InMemorySigilFileSystem } from "../src/filesystem.ts";
import { loadSigilWorkspace } from "../src/workspace.ts";
import { resolveSigilWorkspace } from "../src/pipeline.ts";
import {
  isSupportedImplementationSource,
  ownedImplementationTargetsFor,
  ownershipDiagnosticsFor,
} from "../src/implementation-ownership.ts";
import { assert, assertEquals } from "./assert.ts";
const configSource = () =>
  JSON.stringify({
    sigilVersion: "0.8.0",
    workspace: { name: "test" },
    files: { include: ["**/*.sigil"] },
  });

// @sigil tests packages/core/src/implementation-ownership.sigil::SigilImplementationOwnership::OwnedImplementationLookup interface,cases
Deno.test("projects implementation targets from entrypoint comments", async () => {
  const fs = new InMemorySigilFileSystem({
    ".sigil/config.json": configSource(),
    "ownership.sigil": `component Ownership {
  goal {
    Own implementation targets.
  }

  interface {
    OwnedImplementationTargets {
      Own source and test entrypoints.
    }

    OtherTargets {
      Own an agent-facing workflow.
    }
  }

  logic {
    OwnedImplementationTargets {
      Resolve ownership annotations.
    }
  }

  constraints {
    Ownership annotations remain deterministic.
  }

  cases {
    OwnedImplementationTargets {
      A test entrypoint links to this behavior.
    }
  }
}
`,
  });
  const resolved = resolveSigilWorkspace(
    await loadSigilWorkspace(fs, { startPath: "." }),
  );
  const implementationSources = [
    {
      filePath: "packages/core/src/parser.ts",
      text:
        "// @sigil implements ownership.sigil::Ownership::OwnedImplementationTargets interface,logic\nexport function parseSigilDocument() {}\n",
    },
    {
      filePath: "packages/core/tests/core_test.ts",
      text:
        "// @sigil tests ownership.sigil::Ownership::OwnedImplementationTargets cases\nfunction implementationTargets() {}\n",
    },
    {
      filePath: "packages/core/src/config.ts",
      text:
        "// @sigil uses ownership.sigil::Ownership logic,constraints\nexport function parseSigilConfig() {}\n",
    },
    {
      filePath: "packages/cli/README.md",
      text: "<!-- @sigil uses ownership.sigil::Ownership cases -->\n# CLI\n",
    },
    {
      filePath: "packages/core/tests/ignored.json",
      text:
        '{"annotation":"@sigil tests ownership.sigil::Ownership::OwnedImplementationTargets interface"}\n',
    },
  ];
  const full = ownedImplementationTargetsFor(
    resolved,
    implementationSources,
    { componentName: "Ownership", declarationPath: "ownership.sigil" },
  );
  assert(full);
  assertEquals(full.owningComponent.name, "Ownership");
  assertEquals(full.targets.length, 4);
  assertEquals(full.sectionName, undefined);
  assertEquals(
    full.targets.map((item) => item.artifactKind).join(","),
    "markdown,code,code,test",
  );
  assertEquals(
    full.targets.map((item) => item.sections.join("+")).join(","),
    "cases,logic+constraints,interface+logic,cases",
  );
  assertEquals(
    full.targets.map((item) => `${item.filePath}:${item.symbolIdentity ?? ""}`)
      .join(","),
    "packages/cli/README.md:,packages/core/src/config.ts:parseSigilConfig,packages/core/src/parser.ts:parseSigilDocument,packages/core/tests/core_test.ts:implementationTargets",
  );
  const scoped = ownedImplementationTargetsFor(
    resolved,
    implementationSources,
    { componentName: "Ownership", declarationPath: "ownership.sigil" },
    "OwnedImplementationTargets",
  );
  assert(scoped);
  assertEquals(scoped.targets.length, 2);
  const sectionScoped = ownedImplementationTargetsFor(
    resolved,
    implementationSources,
    { componentName: "Ownership", declarationPath: "ownership.sigil" },
    "OwnedImplementationTargets",
    "logic",
  );
  assert(sectionScoped);
  assertEquals(sectionScoped.sectionName, "logic");
  assertEquals(sectionScoped.targets.length, 1);
  assertEquals(sectionScoped.targets[0].symbolIdentity, "parseSigilDocument");
  assertEquals(
    ownedImplementationTargetsFor(
      resolved,
      implementationSources,
      { componentName: "Ownership", declarationPath: "other.sigil" },
    ),
    undefined,
  );
  assertEquals(full.targets[0].artifactKind, "markdown");
  assertEquals(full.targets[0].filePath, "packages/cli/README.md");
  assertEquals(full.diagnostics.length, 0);
  assertEquals(full.targets[1].location?.line, 2);

  const diagnostics = ownershipDiagnosticsFor(resolved, [
    ...implementationSources,
    {
      filePath: "packages/core/src/invalid.ts",
      text:
        "// @sigil implements ownership.sigil::Ownership::Missing interface\n" +
        "export function invalid() {}\n",
    },
  ]);
  assertEquals(diagnostics.length, 1);
  assertEquals(diagnostics[0].code, "SIGIL_IMPLEMENTATION_ANNOTATION");
  assert(diagnostics[0].message.includes('unknown or ambiguous Tag "Missing"'));
});

/*
 * @sigil tests packages/core/src/implementation-ownership.sigil::SigilImplementationOwnership::ComponentFileRegions logic,constraints,cases
 * @sigil tests packages/core/src/implementation-ownership.sigil::SigilImplementationOwnership::ImplementationSourceSupport cases
 */
Deno.test("projects implementation targets from frontend surfaces", async () => {
  const fs = new InMemorySigilFileSystem({
    ".sigil/config.json": configSource(),
    "screen.sigil": `component ScreenSurface {
  goal {
    Own one screen surface.
  }

  interface {
    ScreenContract {
      Expose props, emitted events, and visible regions.
    }
  }

  state {
    ScreenContract {
      Track loading, empty, and error modes.
    }
  }

  logic {
    ScreenContract {
      Transition between presentation modes.
    }
  }

  constraints {
    ScreenContract {
      Keyboard operation remains available in every mode.
    }
  }

  cases {
    ScreenContract {
      A screen renders its empty mode.
    }
  }
}
`,
  });
  const resolved = resolveSigilWorkspace(
    await loadSigilWorkspace(fs, { startPath: "." }),
  );
  const identity = {
    componentName: "ScreenSurface",
    declarationPath: "screen.sigil",
  };
  const implementationSources = [
    {
      filePath: "src/Bare.vue",
      text: [
        "<script setup>",
        "// @sigil uses screen.sigil::ScreenSurface::ScreenContract logic",
        "import { ref } from 'vue'",
        "</script>",
        "",
      ].join("\n"),
    },
    {
      filePath: "src/Screen.svelte",
      text:
        "<!-- @sigil tests screen.sigil::ScreenSurface::ScreenContract cases -->\n<div></div>\n",
    },
    {
      filePath: "src/pages/index.astro",
      text: [
        "---",
        "// @sigil implements screen.sigil::ScreenSurface::ScreenContract state",
        "function load() {}",
        "---",
        "<div />",
        "",
      ].join("\n"),
    },
    {
      filePath: "web_src/components/Screen.vue",
      text: [
        "<template>",
        "  <!-- @sigil implements screen.sigil::ScreenSurface::ScreenContract interface -->",
        '  <div class="screen" />',
        "</template>",
        "",
        '<script setup lang="ts">',
        "// @sigil implements screen.sigil::ScreenSurface::ScreenContract logic",
        "function toggleMode() {}",
        "</script>",
        "",
        "<style scoped>",
        "/* @sigil implements screen.sigil::ScreenSurface::ScreenContract constraints */",
        ".screen { color: red; }",
        "</style>",
        "",
      ].join("\n"),
    },
    {
      filePath: "web_src/css/screen.css",
      text:
        "/* @sigil implements screen.sigil::ScreenSurface::ScreenContract state */\n" +
        '.screen { background: url(https://example.test/a.png); content: "//"; }\n',
    },
    {
      filePath: "web_src/templates/screen.html",
      text:
        "<!-- @sigil uses screen.sigil::ScreenSurface::ScreenContract interface -->\n<div></div>\n",
    },
  ];

  const projection = ownedImplementationTargetsFor(
    resolved,
    implementationSources,
    identity,
  );
  assert(projection);
  assertEquals(projection.diagnostics.length, 0);
  assertEquals(
    projection.targets.map((item) =>
      `${item.filePath}:${item.symbolIdentity ?? ""}`
    ).join(","),
    [
      "src/Bare.vue:",
      "src/Screen.svelte:",
      "src/pages/index.astro:load",
      "web_src/components/Screen.vue:",
      "web_src/components/Screen.vue:",
      "web_src/components/Screen.vue:toggleMode",
      "web_src/css/screen.css:",
      "web_src/templates/screen.html:",
    ].join(","),
  );

  // A single-file component contributes one target per region: template markup
  // and scoped style bind to the file, while the script block resolves a symbol.
  const singleFileComponent = projection.targets.filter((item) =>
    item.filePath === "web_src/components/Screen.vue"
  );
  assertEquals(singleFileComponent.length, 3);
  assertEquals(
    singleFileComponent.flatMap((item) => item.sections).sort().join(","),
    "constraints,interface,logic",
  );
  assertEquals(
    singleFileComponent.every((item) => item.artifactKind === "code"),
    true,
  );
  assertEquals(
    projection.targets.find((item) => item.filePath === "src/Screen.svelte")
      ?.artifactKind,
    "test",
  );

  // A `<script setup>` block has no exported definition, so its annotation
  // falls back to the file instead of reporting a detached annotation.
  const bare = projection.targets.find((item) =>
    item.filePath === "src/Bare.vue"
  );
  assertEquals(bare?.symbolIdentity, undefined);
  assertEquals(bare?.relation, "uses");

  // Plain CSS has no line-comment form, so one annotation in a block comment is
  // valid rather than a comment-form violation.
  assertEquals(
    ownershipDiagnosticsFor(resolved, implementationSources).length,
    0,
  );

  const scoped = ownedImplementationTargetsFor(
    resolved,
    implementationSources,
    identity,
    "ScreenContract",
    "state",
  );
  assert(scoped);
  assertEquals(
    scoped.targets.map((item) => item.filePath).join(","),
    "src/pages/index.astro,web_src/css/screen.css",
  );
});

/*
 * @sigil tests packages/core/src/implementation-ownership.sigil::SigilImplementationOwnership::ComponentFileRegions logic,constraints,cases
 * @sigil tests packages/core/src/implementation-ownership.sigil::SigilImplementationOwnership::ImplementationSourceSupport cases
 */
Deno.test("projects implementation targets from markup and template sources", async () => {
  const fs = new InMemorySigilFileSystem({
    ".sigil/config.json": configSource(),
    "page.sigil": `component PageSurface {
  goal {
    Own one server-rendered page surface.
  }

  interface {
    PageContract {
      Expose the rendered regions and their actions.
    }
  }

  logic {
    PageContract {
      Wire the rendered regions to their handlers.
    }
  }
}
`,
  });
  const resolved = resolveSigilWorkspace(
    await loadSigilWorkspace(fs, { startPath: "." }),
  );
  const identity = {
    componentName: "PageSurface",
    declarationPath: "page.sigil",
  };
  const annotation =
    "@sigil implements page.sigil::PageSurface::PageContract logic";
  const implementationSources = [
    // An embedded script block in a markup source is a code region, so its
    // annotation resolves to the following definition instead of being dropped.
    {
      filePath: "templates/inline.html",
      text: [
        '<div id="root"></div>',
        "<script>",
        `// ${annotation}`,
        "function inlineHandler() {}",
        "</script>",
        "",
      ].join("\n"),
    },
    // A Go template comment is stripped server-side, so it carries an annotation
    // without emitting it to the rendered page.
    {
      filePath: "templates/screens/list.tmpl",
      text: `{{/* ${annotation} */}}\n<div>{{.Title}}</div>\n`,
    },
    // Trim markers surround the same comment form.
    {
      filePath: "templates/screens/trim.gohtml",
      text: `{{- /* ${annotation} */ -}}\n<div></div>\n`,
    },
    // An HTML comment remains valid in both families.
    {
      filePath: "templates/plain.html",
      text: `<!-- ${annotation} -->\n<div></div>\n`,
    },
  ];

  const projection = ownedImplementationTargetsFor(
    resolved,
    implementationSources,
    identity,
  );
  assert(projection);
  assertEquals(projection.diagnostics.length, 0);
  assertEquals(
    projection.targets.map((item) =>
      `${item.filePath}:${item.symbolIdentity ?? ""}`
    ).join(","),
    [
      "templates/inline.html:inlineHandler",
      "templates/plain.html:",
      "templates/screens/list.tmpl:",
      "templates/screens/trim.gohtml:",
    ].join(","),
  );
  assertEquals(
    ownershipDiagnosticsFor(resolved, implementationSources).length,
    0,
  );

  // Server-rendered template families are supported sources.
  for (const path of ["a.tmpl", "a.gohtml", "a.html", "a.htm"]) {
    assertEquals(isSupportedImplementationSource(path), true);
  }

  // The template comment form belongs to the family that defines it. The same
  // text in any other markup or component source is ordinary content, not
  // ownership metadata: `{{ }}` is interpolation syntax in several of them.
  const templateComment = `{{/* ${annotation} */}}`;
  for (
    const [path, text] of [
      ["a.html", `${templateComment}\n<div></div>\n`],
      ["a.htm", `${templateComment}\n<div></div>\n`],
      ["a.vue", `<template>\n  ${templateComment}\n  <div/>\n</template>\n`],
      ["a.svelte", `${templateComment}\n<div></div>\n`],
      ["a.astro", `${templateComment}\n<div></div>\n`],
    ] as [string, string][]
  ) {
    const foreign = ownedImplementationTargetsFor(
      resolved,
      [{ filePath: path, text }],
      identity,
    );
    assert(foreign);
    assertEquals(foreign.targets.length, 0);
    assertEquals(
      ownershipDiagnosticsFor(resolved, [{ filePath: path, text }]).length,
      0,
    );
  }
});

// @sigil tests packages/core/src/implementation-ownership.sigil::SigilImplementationOwnership::SectionSelection constraints
Deno.test("diagnoses invalid implementation relations and section selectors", async () => {
  const fs = new InMemorySigilFileSystem({
    ".sigil/config.json": configSource(),
    "ownership.sigil": `component Ownership {
  goal {
    Own implementation targets.
  }

  interface {
    EntryPoint {
      Own one entrypoint.
    }
  }

  logic {
    Resolve ownership.
  }
}
`,
  });
  const resolved = resolveSigilWorkspace(
    await loadSigilWorkspace(fs, { startPath: "." }),
  );
  const invalidAnnotations = [
    "@sigil follows ownership.sigil::Ownership logic",
    "@sigil validates ownership.sigil::Ownership logic",
    "@sigil related ownership.sigil::Ownership logic",
    "@sigil implements ownership.sigil::Ownership",
    "@sigil implements ownership.sigil::Ownership logic,",
    "@sigil implements ownership.sigil::Ownership logic, constraints",
    "@sigil implements ownership.sigil::Ownership logic,logic",
    "@sigil implements ownership.sigil::Ownership goal",
    "@sigil implements ownership.sigil::Ownership decisions",
    "@sigil implements ownership.sigil::Ownership unknown",
    "@sigil implements ownership.sigil::Ownership::EntryPoint logic",
  ];
  const projection = ownedImplementationTargetsFor(
    resolved,
    invalidAnnotations.map((annotation, index) => ({
      filePath: `src/invalid-${index}.ts`,
      text: `// ${annotation}\nexport function invalid${index}() {}\n`,
    })),
    { componentName: "Ownership", declarationPath: "ownership.sigil" },
  );
  assert(projection);
  assertEquals(projection.targets.length, 0);
  assertEquals(projection.diagnostics.length, invalidAnnotations.length);
  assert(
    projection.diagnostics.some((item) =>
      item.message.includes("repeats section selector logic")
    ),
  );
  assert(
    projection.diagnostics.some((item) =>
      item.message.includes("unsupported section selector goal")
    ),
  );
  assert(
    projection.diagnostics.some((item) =>
      item.message.includes(
        'section logic without a matching occurrence on Tag "EntryPoint"',
      )
    ),
  );
});

// @sigil tests packages/core/src/implementation-ownership.sigil::SigilImplementationOwnership::AnnotationPlacement constraints
Deno.test("requires multiline comments for multiple ownership annotations", async () => {
  const fs = new InMemorySigilFileSystem({
    ".sigil/config.json": configSource(),
    "ownership.sigil": `component Ownership {
  goal {
    Own implementation targets.
  }

  interface {
    EntryPoint {
      Own one entrypoint.
    }
  }
}
`,
  });
  const resolved = resolveSigilWorkspace(
    await loadSigilWorkspace(fs, { startPath: "." }),
  );
  const projection = ownedImplementationTargetsFor(
    resolved,
    [{
      filePath: "src/entrypoint.ts",
      text: `/*
 * @sigil implements ownership.sigil::Ownership::EntryPoint interface
 * @sigil tests ownership.sigil::Ownership::EntryPoint interface
 */
export class EntryPoint {}
`,
    }],
    { componentName: "Ownership", declarationPath: "ownership.sigil" },
  );
  assert(projection);
  assertEquals(projection.targets.length, 2);
  assertEquals(projection.targets[0].symbolIdentity, "EntryPoint");
  assertEquals(projection.diagnostics.length, 0);
});

// @sigil tests packages/core/src/implementation-ownership.sigil::SigilImplementationOwnership::AnnotationPlacement constraints
Deno.test("diagnoses detached implementation ownership comments", async () => {
  const fs = new InMemorySigilFileSystem({
    ".sigil/config.json": configSource(),
    "ownership.sigil": `component Ownership {
  goal {
    Own implementation targets.
  }

  interface {
    EntryPoint {
      Own one entrypoint.
    }
  }
}
`,
  });
  const resolved = resolveSigilWorkspace(
    await loadSigilWorkspace(fs, { startPath: "." }),
  );
  const projection = ownedImplementationTargetsFor(
    resolved,
    [{
      filePath: "src/detached.ts",
      text:
        "// @sigil implements ownership.sigil::Ownership::EntryPoint interface\nconst value = 1;\n",
    }],
    { componentName: "Ownership", declarationPath: "ownership.sigil" },
  );
  assert(projection);
  assertEquals(projection.targets.length, 0);
  assertEquals(projection.diagnostics.length, 1);
});

// @sigil tests packages/core/src/implementation-ownership.sigil::SigilImplementationOwnership::AnnotationPlacement constraints
Deno.test("resolves entrypoints using each language's declaration syntax", async () => {
  const fs = new InMemorySigilFileSystem({
    ".sigil/config.json": configSource(),
    "ownership.sigil": `component Ownership {
  goal {
    Own implementation targets.
  }

  interface {
    EntryPoint {
      Own language entrypoints.
    }
  }
}
`,
  });
  const resolved = resolveSigilWorkspace(
    await loadSigilWorkspace(fs, { startPath: "." }),
  );
  const target = "ownership.sigil::Ownership::EntryPoint interface";
  const sources = [
    {
      filePath: "src/worker.py",
      text: `# @sigil implements ${target}\ndef process_job():\n    pass\n`,
    },
    {
      filePath: "src/worker.rs",
      text: `// @sigil implements ${target}\npub struct Worker {}\n`,
    },
    {
      filePath: "src/worker.go",
      text: `// @sigil implements ${target}\nfunc Run() {}\n`,
    },
    {
      filePath: "src/Worker.java",
      text: `// @sigil implements ${target}\npublic void execute() {}\n`,
    },
    {
      filePath: "src/Worker.swift",
      text: `// @sigil implements ${target}\npublic func start() {}\n`,
    },
    {
      filePath: "src/Worker.kt",
      text: `// @sigil implements ${target}\nsuspend fun dispatch() {}\n`,
    },
  ];
  const projection = ownedImplementationTargetsFor(
    resolved,
    sources,
    { componentName: "Ownership", declarationPath: "ownership.sigil" },
    "EntryPoint",
  );
  assert(projection);
  assertEquals(projection.diagnostics.length, 0);
  assertEquals(
    projection.targets.map((item) => item.symbolIdentity).join(","),
    "execute,dispatch,start,Run,process_job,Worker",
  );
});

// @sigil tests packages/core/src/implementation-ownership.sigil::SigilImplementationOwnership::AnnotationPlacement constraints
Deno.test("resolves nested and constrained C++ template entrypoints", async () => {
  const fs = new InMemorySigilFileSystem({
    ".sigil/config.json": configSource(),
    "ownership.sigil": `component Ownership {
  goal {
    Own implementation targets.
  }

  interface {
    EntryPoint {
      Own language entrypoints.
    }
  }
}
`,
  });
  const resolved = resolveSigilWorkspace(
    await loadSigilWorkspace(fs, { startPath: "." }),
  );
  const target = "ownership.sigil::Ownership::EntryPoint interface";
  const projection = ownedImplementationTargetsFor(
    resolved,
    [
      {
        filePath: "src/repository.hpp",
        text:
          `// @sigil implements ${target}\ntemplate <\n  typename T\n>\nclass Repository {};\n`,
      },
      {
        filePath: "src/repository.cpp",
        text:
          `// @sigil implements ${target}\ntemplate <typename T>\nT makeRepository() {}\n`,
      },
      {
        filePath: "src/default-repository.hpp",
        text:
          `// @sigil implements ${target}\ntemplate <typename T = std::vector<int>>\nclass DefaultRepository {};\n`,
      },
      {
        filePath: "src/deep-repository.hpp",
        text:
          `// @sigil implements ${target}\ntemplate <typename T = std::map<int, std::vector<std::pair<int, int>>>>\nclass DeepRepository {};\n`,
      },
      {
        filePath: "src/constrained-repository.hpp",
        text:
          `// @sigil implements ${target}\ntemplate <typename T>\nrequires std::default_initializable<T>\nclass ConstrainedRepository {};\n`,
      },
      {
        filePath: "src/sized-repository.hpp",
        text:
          `// @sigil implements ${target}\ntemplate <typename T>\nrequires (\n  sizeof(T) > 0\n)\nclass SizedRepository {};\n`,
      },
      {
        filePath: "src/constrained-repository.cpp",
        text:
          `// @sigil implements ${target}\ntemplate <typename T>\nrequires std::copyable<T>\nT makeConstrainedRepository() {}\n`,
      },
    ],
    { componentName: "Ownership", declarationPath: "ownership.sigil" },
    "EntryPoint",
  );
  assert(projection);
  assertEquals(projection.diagnostics.length, 0);
  assertEquals(
    projection.targets.map((item) => item.symbolIdentity).sort().join(","),
    "ConstrainedRepository,DeepRepository,DefaultRepository,Repository,SizedRepository,makeConstrainedRepository,makeRepository",
  );
});

// @sigil tests packages/core/src/implementation-ownership.sigil::SigilImplementationOwnership::AnnotationPlacement constraints
Deno.test("resolves Go and Node test entrypoints", async () => {
  const fs = new InMemorySigilFileSystem({
    ".sigil/config.json": configSource(),
    "ownership.sigil": `component Ownership {
  goal {
    Own implementation targets.
  }

  interface {
    EntryPoint {
      Own language entrypoints.
    }
  }
}
`,
  });
  const resolved = resolveSigilWorkspace(
    await loadSigilWorkspace(fs, { startPath: "." }),
  );
  const target = "ownership.sigil::Ownership::EntryPoint interface";
  const sources = [
    {
      filePath: "src/worker_test.go",
      text: `// @sigil tests ${target}\nfunc TestWorker(t *testing.T) {}\n`,
    },
    {
      filePath: "src/worker.test.ts",
      text: `// @sigil tests ${target}\ntest("runs worker", () => {});\n`,
    },
    {
      filePath: "src/worker.test.cjs",
      text: `// @sigil tests ${target}\nit.skip("skips worker", () => {});\n`,
    },
    {
      filePath: "src/worker.test.mts",
      text:
        `// @sigil tests ${target}\ndescribe.only("worker suite", () => {});\n`,
    },
  ];
  const projection = ownedImplementationTargetsFor(
    resolved,
    sources,
    { componentName: "Ownership", declarationPath: "ownership.sigil" },
    "EntryPoint",
  );
  assert(projection);
  assertEquals(projection.diagnostics.length, 0);
  assertEquals(
    projection.targets.map((item) => item.symbolIdentity).sort().join(","),
    "TestWorker,runs worker,skips worker,worker suite",
  );
});

// @sigil tests packages/core/src/implementation-ownership.sigil::SigilImplementationOwnership::AnnotationPlacement constraints
Deno.test("ignores annotation examples inside strings and Markdown fences", async () => {
  const fs = new InMemorySigilFileSystem({
    ".sigil/config.json": configSource(),
    "ownership.sigil": `component Ownership {
  goal {
    Own implementation targets.
  }

  interface {
    EntryPoint {
      Own one entrypoint.
    }
  }
}
`,
  });
  const resolved = resolveSigilWorkspace(
    await loadSigilWorkspace(fs, { startPath: "." }),
  );
  const target = "ownership.sigil::Ownership::EntryPoint interface";
  const projection = ownedImplementationTargetsFor(
    resolved,
    [
      {
        filePath: "src/examples.ts",
        text:
          `const example = \`// @sigil implements ${target}\nfunction fake() {}\`;\n`,
      },
      {
        filePath: "workflow.md",
        text: `\`\`\`md\n<!-- @sigil uses ${target} -->\n\`\`\`\n`,
      },
    ],
    { componentName: "Ownership", declarationPath: "ownership.sigil" },
  );
  assert(projection);
  assertEquals(projection.targets.length, 0);
  assertEquals(projection.diagnostics.length, 0);
});
