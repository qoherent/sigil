import assert from "node:assert/strict";
import test from "node:test";
import { type DesignReport, nativeState } from "../../src/compilation.ts";
import { sourceDigest } from "../../src/coordinates.ts";
import {
  type ProjectedDiagnostic,
  publishCompilationDiagnostics,
} from "../../src/diagnostic-projection.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function harness() {
  const entered = deferred(), release = deferred();
  const sources = new Map(["first.sigil", "second.sigil"].map((source) => {
    const text = `source ${source}`;
    return [source, {
      bytes: Buffer.from(text),
      document: {
        version: 1,
        isDirty: false,
        text,
        getText() {
          return this.text;
        },
      },
    }];
  }));
  const publications: { codes: string[]; status: string }[] = [];
  const visible = {
    diagnostics: [] as readonly ProjectedDiagnostic[],
    status: "compiling",
  };
  const report = (
    code: string,
    state: DesignReport["state"],
  ): DesignReport => ({
    version: 6,
    source: "workspace",
    state,
    identity: {},
    iterations: 1,
    findings: [{
      class: "gap",
      law: code,
      subject: "Facet",
      object: "Tag",
      claims: [],
      component: "A",
      section: "interface",
      detail: code,
      locations: [...sources].map(([source, { bytes }]) => ({
        source,
        side: "design",
        coordinate_system: "utf8-bytes",
        source_digest: sourceDigest(bytes),
        range: { start: 0, end: 6 },
      })),
    }],
  });
  function start(report: DesignReport, isCurrent: () => boolean, pause = true) {
    return publishCompilationDiagnostics(report, {
      async loadSource(source) {
        if (pause && source === "second.sigil") {
          // The first document has already been captured and mapped.
          entered.resolve();
          await release.promise;
        }
        return sources.get(source)!;
      },
      isCurrent,
      publish(diagnostics) {
        visible.diagnostics = diagnostics;
        visible.status = nativeState(report)!;
        publications.push({
          codes: diagnostics.map((d) => d.finding.code),
          status: visible.status,
        });
      },
    });
  }
  return { sources, entered, release, publications, visible, report, start };
}

for (const change of ["dirty", "saved version"] as const) {
  test(`a ${change} edit to an already captured document prevents publication`, async () => {
    const h = harness();
    const pending = h.start(h.report("obsolete", "disjoint"), () => true);
    await h.entered.promise;
    const document = h.sources.get("first.sigil")!.document;
    if (change === "dirty") document.isDirty = true;
    else document.version++;
    document.text = "changed after its range was mapped";
    h.release.resolve();
    await assert.rejects(
      pending,
      /Source changed during diagnostic projection/,
    );
    assert.deepEqual(h.publications, []);
    assert.deepEqual(h.visible, { diagnostics: [], status: "compiling" });
  });
}

test("a workspace edit during projection preserves the stale status", async () => {
  const h = harness();
  let revision = 1;
  const startedAt = revision;
  const pending = h.start(
    h.report("obsolete", "disjoint"),
    () => revision === startedAt,
  );
  await h.entered.promise;
  revision++;
  h.sources.get("first.sigil")!.document.version++;
  h.visible.status = "stale";
  h.release.resolve();
  await pending;
  assert.deepEqual(h.publications, []);
  assert.deepEqual(h.visible, { diagnostics: [], status: "stale" });
});

test("a replacement compilation stays visible when an obsolete projection finishes", async () => {
  const h = harness();
  const obsolete = {}, replacement = {};
  let active = obsolete;
  const pending = h.start(
    h.report("obsolete", "disjoint"),
    () => active === obsolete,
  );
  await h.entered.promise;
  assert.deepEqual(h.publications, []);

  active = replacement;
  await h.start(
    h.report("replacement", "coherent"),
    () => active === replacement,
    false,
  );
  const replacementDiagnostics = h.visible.diagnostics;
  assert.equal(h.visible.status, "Coherent");
  assert.equal(replacementDiagnostics.length, 2);
  h.release.resolve();
  await pending;

  assert.deepEqual(h.publications, [{
    codes: ["replacement", "replacement"],
    status: "Coherent",
  }]);
  assert.equal(h.visible.diagnostics, replacementDiagnostics);
  assert.equal(h.visible.status, "Coherent");
});

test("Facet findings retain half-open native UTF-8 byte ranges", async () => {
  const h = harness();
  await h.start(h.report("facet", "loose"), () => true, false);
  assert.deepEqual(h.visible.diagnostics[0].range, {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 6 },
  });
  assert.equal(h.visible.diagnostics[0].finding.code, "facet");
});

test("implementation file diagnostics filter to that code file and verify its digest", async () => {
  const text = "😀 café results", bytes = Buffer.from(text);
  const finding = {
    law: "code-breach",
    subject: "element",
    object: "promise",
    detail: "Code disagrees",
    claims: [],
    codeRows: [],
    locations: ["src/a.ts", "src/b.ts"].map((source) => ({
      side: "implementation" as const,
      source,
      coordinate_system: "utf8-bytes" as const,
      source_digest: sourceDigest(bytes),
      range: { start: 5, end: bytes.length },
    })),
  };
  const report = {
    version: 1 as const,
    source: "workspace" as const,
    state: "drift" as const,
    designState: "coherent" as const,
    identity: {},
    iterations: 1,
    incompleteReasons: [],
    findings: [finding],
    undesignedFiles: [],
    undesignedElements: [],
    unanswered: [],
    unreadFiles: [],
    selection: {},
    designFindings: [],
  };
  let published: readonly ProjectedDiagnostic[] = [];
  const loaded: string[] = [];
  const host = {
    sourceFilter: "src/a.ts",
    isCurrent: () => true,
    loadSource(source: string) {
      loaded.push(source);
      return Promise.resolve({
        bytes,
        document: { version: 1, isDirty: false, getText: () => text },
      });
    },
    publish(diagnostics: readonly ProjectedDiagnostic[]) {
      published = diagnostics;
    },
  };
  await publishCompilationDiagnostics(report, host);
  assert.deepEqual(loaded, ["src/a.ts"]);
  assert.equal(published.length, 1);
  assert.equal(published[0].source, "src/a.ts");
  assert.deepEqual(published[0].range, {
    start: { line: 0, character: 3 },
    end: { line: 0, character: text.length },
  });
  published = [];
  finding.locations[0].source_digest = "0".repeat(64);
  await assert.rejects(
    publishCompilationDiagnostics(report, host),
    /Stale source/,
  );
  assert.deepEqual(published, []);
});

test("an unanswered promise included in native findings projects once as a Drift error", async () => {
  const bytes = Buffer.from("promise");
  const finding = {
    law: "unanswered-promise",
    subject: "A",
    object: "promise",
    detail: "No implementation supplies the promise",
    claims: [],
    codeRows: [],
    locations: [{
      side: "design" as const,
      source: "a.sigil",
      coordinate_system: "utf8-bytes" as const,
      source_digest: sourceDigest(bytes),
      range: { start: 0, end: bytes.length },
    }],
  };
  const report = {
    version: 1 as const,
    source: "workspace" as const,
    state: "drift" as const,
    designState: "coherent" as const,
    identity: {},
    iterations: 1,
    incompleteReasons: [],
    findings: [finding],
    unanswered: [finding],
    undesignedFiles: [],
    undesignedElements: [],
    unreadFiles: [],
    selection: {},
    designFindings: [],
  };
  let projected: readonly ProjectedDiagnostic[] = [];
  await publishCompilationDiagnostics(report, {
    isCurrent: () => true,
    loadSource() {
      return Promise.resolve({
        bytes,
        document: { version: 1, isDirty: false, getText: () => "promise" },
      });
    },
    publish(value) {
      projected = value;
    },
  });
  assert.equal(projected.length, 1);
  assert.equal(projected[0].finding.severity, "error");
});
