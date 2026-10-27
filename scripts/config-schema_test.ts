import { deepStrictEqual as equal } from "node:assert/strict";
import { Ajv2020 } from "ajv-2020";

/**
 * The workspace config is defined twice: the strict parser in the Rust core and
 * the published JSON Schema in docs/spec/sigil-config.schema.json. The Rust
 * tests replay every fixture against the parser (`parserValid`); this checks
 * the schema against the same fixtures. A structural fixture must be accepted
 * or refused by both alike. A parser-only fixture states the schema's own
 * outcome (`schemaValid`), where the schema cannot express the parser's rule.
 * A malformed-source fixture is not JSON, so only the parser sees it. The
 * conventions check rules (docs/spec/sigil-conventions.schema.json) are
 * replayed the same way against conventions-parity.json.
 */
interface Fixture {
  name: string;
  category: "structural-parity" | "parser-only-semantic" | "malformed-source";
  source: string;
  parserValid: boolean;
  schemaValid?: boolean;
}

const root = new URL("..", import.meta.url);
const readFixtures = async (name: string) =>
  JSON.parse(
    await Deno.readTextFile(
      new URL(`packages/core/tests/fixtures/${name}`, root),
    ),
  ) as Fixture[];
const compileSchema = async (name: string) =>
  new Ajv2020({ allErrors: true, strict: true }).compile(
    JSON.parse(await Deno.readTextFile(new URL(`docs/spec/${name}`, root))),
  );

const fixtures = await readFixtures("config-parity.json");
const validate = await compileSchema("sigil-config.schema.json");
const conventionFixtures = await readFixtures("conventions-parity.json");
const validateConventions = await compileSchema(
  "sigil-conventions.schema.json",
);

/** Names of the fixtures replayed, so a silent skip cannot pass. */
function replay(
  cases: Fixture[],
  validator: ((value: unknown) => boolean) & { errors?: unknown },
): string[] {
  const checked: string[] = [];
  for (const fixture of cases) {
    if (fixture.category === "malformed-source") continue;
    const expected = fixture.category === "structural-parity"
      ? fixture.parserValid
      : fixture.schemaValid;
    equal(
      typeof expected,
      "boolean",
      `${fixture.name} states no schema outcome`,
    );
    equal(
      validator(JSON.parse(fixture.source)),
      expected,
      `${fixture.name}: ${JSON.stringify(validator.errors)}`,
    );
    checked.push(fixture.name);
  }
  return checked;
}

Deno.test("every config fixture gets the schema outcome it records", () => {
  const checked = replay(fixtures, validate);
  equal(checked.length, 57);
});

Deno.test("every conventions fixture gets the schema outcome it records", () => {
  const checked = replay(conventionFixtures, validateConventions);
  equal(checked.length, 27);
});

Deno.test("the conventions schema accepts a label the parser refuses", () => {
  const differing = conventionFixtures.filter((fixture) =>
    fixture.category === "parser-only-semantic"
  );
  equal(differing.map((fixture) => fixture.name), ["label-leading-whitespace"]);
  for (const fixture of differing) {
    equal(fixture.parserValid, false, fixture.name);
    equal(fixture.schemaValid, true, fixture.name);
  }
});

Deno.test("a schema-only difference is recorded as one, never as agreement", () => {
  const differing = fixtures.filter((fixture) =>
    fixture.category === "parser-only-semantic"
  );
  equal(differing.length, 5);
  for (const fixture of differing) {
    equal(fixture.parserValid, false, fixture.name);
    equal(fixture.schemaValid, true, fixture.name);
  }
});
