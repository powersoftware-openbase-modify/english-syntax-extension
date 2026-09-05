import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ValidationError } from "./analysis-validator";
import { validateCoreBatch } from "./analysis-validator";
import { tokenize } from "./segmenter";

interface ValidatorMessageFixture {
  schemaVersion: number;
  coveredMessageSubstrings: string[];
  cases: ValidatorMessageCase[];
}

interface ValidatorMessageCase {
  id: string;
  sentence: {
    id: string;
    text: string;
  };
  raw: unknown;
  expected: ValidationError[];
}

const fixture = JSON.parse(
  readFileSync(
    new URL("../../../shared-fixtures/validator-messages.json", import.meta.url),
    "utf8",
  ),
) as ValidatorMessageFixture;

function actualErrors(testCase: ValidatorMessageCase): ValidationError[] {
  const sentence = {
    sentenceId: testCase.sentence.id,
    text: testCase.sentence.text,
    tokens: tokenize(testCase.sentence.text),
  };
  const result = validateCoreBatch(testCase.raw, [sentence], "validator-messages-fixture");
  expect(result.ok, `fixture case ${testCase.id} must be invalid`).toBe(false);
  return result.ok ? [] : result.errors;
}

describe("shared validator message fixture", () => {
  it("has an unambiguous versioned schema", () => {
    expect(fixture.schemaVersion).toBe(1);
    expect(fixture.cases.length).toBeGreaterThan(0);
    expect(new Set(fixture.cases.map(({ id }) => id)).size).toBe(fixture.cases.length);
    expect(fixture.cases.every(({ expected }) => expected.length > 0)).toBe(true);
  });

  it.each(fixture.cases)("matches the complete ordered errors for $id", (testCase) => {
    expect(actualErrors(testCase)).toEqual(testCase.expected);
  });

  it("keeps covered message substrings closed over all fixture errors", () => {
    const messages = fixture.cases.flatMap(actualErrors).map(({ message }) => message);

    expect(
      fixture.coveredMessageSubstrings.filter(
        (substring) => !messages.some((message) => message.includes(substring)),
      ),
      "every declared substring must be represented by an actual fixture error",
    ).toEqual([]);
    expect(
      messages.filter(
        (message) =>
          !fixture.coveredMessageSubstrings.some((substring) => message.includes(substring)),
      ),
      "every actual fixture error must belong to a declared covered message family",
    ).toEqual([]);
  });
});
