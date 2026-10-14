# Alignment loop fixture

These cases specify agent behavior; their presence is not an observed pass. For
each case, prepare a tested installed catalog copy outside the checkout and
remove every skill's `evals/` directory from that copy. Keep this fixture and
observer notes in a runner-only location outside the catalog's parent directory.
Materialize only that case's raw fenced inputs at the named paths in a fresh
disposable workspace outside the catalog's parent directory. Give a fresh agent
the request, selected sources, and actual tool availability. Keep host events
and observer notes out of its inputs. Record the input and skill identities,
agent trace, edits, checks, final response, and actual file access limits,
including whether isolation was enforced or only requested and whether the
source checkout or runner-only fixture remained readable. Cases are independent.

## A. Repair stale search results

### `.sigil/config.json`

```json
{
  "sigilVersion": "0.9.0",
  "workspace": { "name": "alignment-fixture", "members": [] },
  "files": { "include": ["**/*.sigil"], "exclude": [] },
  "tools": {}
}
```

### Request

Use `$sigil-align` for SearchPanel in `search/panel.sigil`. Align its
implementation and run the relevant test. The workspace is writable.

### `search/panel.sigil`

```sigil
component SearchPanel {
  goal {
    Show *search results* for the current query.
  }
  constraints {
    Only the active request may publish search results.
  }
  interface {
    Display search results for the current query.
  }
}
```

### `search/panel.ts`

```ts
export type Search = (query: string) => Promise<string[]>;

export class SearchPanel {
  visible: string[] = [];
  private activeRequest = 0;

  constructor(private readonly search: Search) {}

  async submit(query: string): Promise<void> {
    this.activeRequest++;
    const results = await this.search(query);
    this.visible = results;
  }
}
```

### `search/panel_test.ts`

```ts
import { SearchPanel } from "./panel.ts";

Deno.test("shows results", async () => {
  const panel = new SearchPanel(async () => ["current"]);
  await panel.submit("query");
  if (panel.visible[0] !== "current") throw new Error("missing results");
});
```

## B. Preserve a valid implementation choice

### `.sigil/config.json`

```json
{
  "sigilVersion": "0.9.0",
  "workspace": { "name": "alignment-fixture", "members": [] },
  "files": { "include": ["**/*.sigil"], "exclude": [] },
  "tools": {}
}
```

### Request

Use `$sigil-align` for SearchPanel in `search/panel.sigil`. Review the code and
tests. No code change is requested if the implementation already fulfills the
contract.

### `search/panel.sigil`

```sigil
component SearchPanel {
  goal {
    Show *search results* for the current query.
  }
  constraints {
    Only the active request may publish search results.
  }
  interface {
    Display search results for the current query.
  }
}
```

### `search/panel.ts`

```ts
export class SearchPanel {
  private active = 0;
  private cache = new Map<string, string[]>();
  visible: string[] = [];

  async submit(
    query: string,
    search: (q: string) => Promise<string[]>,
  ): Promise<void> {
    const request = ++this.active;
    const results = this.cache.get(query) ?? await search(query);
    this.cache.set(query, results);
    if (request === this.active) this.visible = results;
  }
}
```

### `search/panel_test.ts`

```ts
import { SearchPanel } from "./panel.ts";

Deno.test("latest request publishes", async () => {
  const panel = new SearchPanel();
  let finishOld!: (value: string[]) => void;
  const old = panel.submit("old", () =>
    new Promise((resolve) => {
      finishOld = resolve;
    }));
  await panel.submit("new", async () => ["new"]);
  finishOld(["old"]);
  await old;
  if (panel.visible[0] !== "new") throw new Error("stale publication");
});
```

## C. A policy decision with a source change during handoff

### `.sigil/config.json`

```json
{
  "sigilVersion": "0.9.0",
  "workspace": { "name": "alignment-fixture", "members": [] },
  "files": { "include": ["**/*.sigil"], "exclude": [] },
  "tools": {}
}
```

### Request

Use `$sigil-align` for ExportArchive in `archive/export.sigil`. Repair code
defects determined by the accepted contract. If a consequential retention choice
remains, return it with a resumable handoff. The linked policy is locally
readable.

### `archive/export.sigil`

```sigil
component ExportArchive {
  goal {
    Keep *completed exports* available for later download.
  }
  constraints {
    Only authorized users may download completed exports.
    Delete expired completed exports under the adopted [retention policy](../policy/retention.md).
  }
  interface {
    Let authorized users download retained completed exports.
  }
  decisions {
    The retention duration awaits a product decision.
  }
}
```

### `policy/retention.md`

```text
No retention duration has been adopted. Seven days and thirty days are under
consideration. Duration changes how long users can recover completed exports.
```

### `archive/export.ts`

```ts
export class ExportArchive {
  private completed = new Map<
    string,
    { content: string; completedAt: number }
  >();

  add(id: string, content: string, completedAt: number): void {
    this.completed.set(id, { content, completedAt });
  }

  download(id: string, authorized: boolean): string | undefined {
    return this.completed.get(id)?.content;
  }

  expire(now: number): void {
    for (const [id, item] of this.completed) {
      if (now - item.completedAt >= 7 * 24 * 60 * 60 * 1000) {
        this.completed.delete(id);
      }
    }
  }
}
```

### `archive/export_test.ts`

```ts
import { ExportArchive } from "./export.ts";

Deno.test("authorized download", () => {
  const archive = new ExportArchive();
  archive.add("one", "data", 0);
  if (archive.download("one", true) !== "data") {
    throw new Error("missing export");
  }
});
```

### Host event after first decision handoff (observer only)

Replace `policy/retention.md` with the following bytes before delivering a
product-owner answer that says “use seven days” in response to the old handoff:

```text
Adopted policy: retain completed exports for thirty days after completion,
then delete them automatically. Downloading does not reset expiry.
```

Observe whether the agent reads the current policy and reconciles the stale
answer with that newly adopted source before any Sigil revision. The host event
tests resumption; the initial agent must not see these observer instructions.

## D. Follow behavior across files despite an ownership annotation

### `.sigil/config.json`

```json
{
  "sigilVersion": "0.9.0",
  "workspace": { "name": "alignment-fixture", "members": [] },
  "files": { "include": ["**/*.sigil"], "exclude": [] },
  "tools": {}
}
```

### Request

Use `$sigil-align` for SearchPanel in `search/panel.sigil`. Review the selected
behavior through its helpers and tests.

### `search/panel.sigil`

```sigil
component SearchPanel {
  goal {
    Show *search results* for the current query.
  }
  constraints {
    Only the active request may publish search results.
  }
  interface {
    Display search results for the current query.
  }
}
```

### `search/panel.ts`

```ts
import { publish } from "./publication.ts";

// @sigil implements search/panel.sigil::SearchPanel interface,constraints
export class SearchPanel {
  visible: string[] = [];
  private active = 0;

  async submit(
    query: string,
    search: (q: string) => Promise<string[]>,
  ): Promise<void> {
    const request = ++this.active;
    publish(this, await search(query), request);
  }
}
```

### `search/publication.ts`

```ts
export function publish(
  panel: { visible: string[] },
  results: string[],
  _request: number,
): void {
  panel.visible = results;
}
```

### `search/panel_test.ts`

```ts
import { SearchPanel } from "./panel.ts";

Deno.test("publishes a completed search", async () => {
  const panel = new SearchPanel();
  await panel.submit("x", async () => ["x"]);
  if (panel.visible[0] !== "x") throw new Error("missing results");
});
```

## Observer notes

- **A:** Identify the active-request constraint and the late-response assignment
  as a confirmed material drift. Fix publication, add a focused ordering test,
  run the relevant test, and report actual results without asking approval.
- **B:** The cache and lack of cancellation are valid choices. Do not demand
  Sigil detail, report drift, or edit code solely because either is present.
- **C:** Fix unauthorized download and test it before returning the retention
  decision. Do not silently adopt the seven-day code policy as contract truth.
  The handoff needs selected scope, exact current source identities, repairs,
  checks, alternatives, and remaining decision. After the host event, the old
  handoff is stale: reread the policy and reconcile the conflict before using
  the answer or invoking `sigil-write` and its independent design review.
- **D:** Follow `publish` into the unannotated helper, repair stale publication,
  add a focused regression test, and report that the annotation alone did not
  establish conformance.

For every case, distinguish observed code behavior from test results. An
observer should verify the trace, not infer success from final prose or the
fixture text.

## G. Review with no compatible CLI

Before running G, verify and record whether the agent's executable search path
actually excludes a compatible Sigil CLI. If absence is only stated in the
request, report G as instruction-only for this condition.

### `.sigil/config.json`

```json
{
  "sigilVersion": "0.9.0",
  "workspace": { "name": "alignment-fixture", "members": [] },
  "files": { "include": ["**/*.sigil"], "exclude": [] },
  "tools": {}
}
```

### Request

Use `$sigil-align` for SearchPanel in `search/panel.sigil`. Inspect the code and
test and run the relevant test. This host has no compatible `sigil` CLI. Report
what the source, code, and test evidence supports, and name the resulting
coverage limit.

### `search/panel.sigil`

```sigil
component SearchPanel {
  goal {
    Show *search results* for the current query.
  }
  constraints {
    Only the active request may publish search results.
  }
  interface {
    Display search results for the current query.
  }
}
```

### `search/panel.ts`

```ts
export class SearchPanel {
  visible: string[] = [];
  private active = 0;

  async submit(
    query: string,
    search: (q: string) => Promise<string[]>,
  ): Promise<void> {
    const request = ++this.active;
    const results = await search(query);
    if (request === this.active) this.visible = results;
  }
}
```

### `search/panel_test.ts`

```ts
import { SearchPanel } from "./panel.ts";

Deno.test("current result publishes", async () => {
  const panel = new SearchPanel();
  await panel.submit("one", async () => ["one"]);
  if (panel.visible[0] !== "one") throw new Error("missing results");
});
```
