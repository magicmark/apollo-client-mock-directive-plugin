import { describe, expect, test } from "vitest";
import { parse, print, type DocumentNode } from "graphql";
import { transformMockedOperation } from "./operation";

function expectOperationToEqual(
  actual: DocumentNode,
  expectedSource: string
): void {
  expect(print(actual)).toBe(print(parse(expectedSource)));
}

describe("operation transforms", () => {
  test("removes mocked selections, empty fragments, and now-unused variables", () => {
    const document = parse(`
      query GetCountry($code: ID!, $planet: String!, $includeMock: Boolean!) {
        country(code: $code) {
          code
          ...CountryFields
          ...OnlyMockedFields
          greeting(planet: $planet) @mock(value: "hello")
          skipped @include(if: $includeMock) @mock(value: "true")
          weather @mock(variant: "current-weather") {
            temperature
          }
        }
      }

      fragment CountryFields on Country {
        capital @mock(value: "Wakanda City")
        name
      }

      fragment OnlyMockedFields on Country {
        population @mock(value: "331900000")
      }
    `);

    expectOperationToEqual(
      transformMockedOperation(document),
      /* GraphQL */ `
        query GetCountry($code: ID!) {
          country(code: $code) {
            code
            ...CountryFields
          }
        }

        fragment CountryFields on Country {
          name
        }
      `
    );
  });

  test("removes parents whose selection sets become empty", () => {
    const document = parse(`
      query GetCountry($code: ID!, $format: String!) {
        country(code: $code) {
          emptyParent {
            capital(format: $format) @mock(value: "Wakanda City")
          }
          name
        }
      }
    `);

    expectOperationToEqual(
      transformMockedOperation(document),
      /* GraphQL */ `
        query GetCountry($code: ID!) {
          country(code: $code) {
            name
          }
        }
      `
    );
  });

  test("removes fragment definitions that become unused after mocked fields are removed", () => {
    const document = parse(`
      query GetCountry {
        country @mock(variant: "full-country") {
          ...CountryFields
        }
        continent {
          code
        }
      }

      fragment CountryFields on Country {
        code
        name
      }
    `);

    expectOperationToEqual(
      transformMockedOperation(document),
      /* GraphQL */ `
        query GetCountry {
          continent {
            code
          }
        }
      `
    );
  });
});
