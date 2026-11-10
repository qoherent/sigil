# Field report: ops rules checked against shell scripts

Sigil used on work that is not a codebase: the rules for when benchmark jobs may evict a model from a GPU server and must restore it, checked against the 9 shell scripts that do the evicting and restoring.

**Setup:** one component, 39 Facets, written from an existing markdown rulebook (snapshot before evicting, exact restore, restore checked as the acceptance test, an overnight time window, a morning hold on one server, look before every start, every take gets a release). `.sigil/config.json` selected the 9 scripts. Built `sigil` from `main` with cargo.

## What worked

- **The prepared request exposed prose bugs before any law ran.** The per-Facet name lists showed references that silently did not resolve (issue 1 below).
- **The Loose design round found 8 flow steps that never finish:** "then" states order, not consumption, so nothing used the snapshot step's output. A real gap in how the rules were written.
- **Alignment reported Drift** with 13 unanswered promises over 5 concepts and 35 undesigned elements. The obligation list (time window, morning hold, look before start, backup location) came out as one table. Each one was confirmed by reading the scripts.
- **Incremental reuse:** after a prose edit, only 3 of 25 units were re-asked.

## Issues

### 1. A Tag reference that differs in case, or wraps across a line, silently stops counting

`*Real work*` did not match the Tag "real work", and two Tag names wrapped across a line break stopped being references. `sigil check` passed all three. The author only sees it by reading the prepared request's name lists.

**Suggestion:** match Tag names case-insensitively and with whitespace normalized, or have `sigil check` warn on a near-match.

### 2. No way to say "deletes" or "at this time of day"

The code vocabulary has `uses`, `owns`, `invokes` and `dependsOn`, but no `writes` or `deletes`, and a prohibition whose subject is a Tag can never be breached. So "a restore must not delete files" cannot be checked. There is also no time-of-day measure, so a rule like "only between 17:00 and 06:00" stays prose.

**Suggestion:** a `writes`/`deletes` act in the code vocabulary, and a time-window measure for constraints.

### 3. Checking a script is token-heavy, and per-component verdicts hide per-file gaps

- **Cost:** the design guidance is about 71 KB per prepare. Each code file's `request.json` was about 261 KB for a 3.6 KB script (roughly 70x), about 65k tokens per fresh child, so about 600k tokens for 9 files run by the book.
- **Granularity:** obligations are answered per component. Of six restore scripts, one verifies the restored model's id; four only grep the response for a generic word. Because one script did it right, the obligation counted as met for all of them.

**Suggestion:** a trimmed per-file request (only the Facets that file could touch), and an option to answer obligations per file or per instance rather than per component.
