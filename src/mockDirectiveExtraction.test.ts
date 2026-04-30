import { describe, expect, test } from "vitest";
import { parse } from "graphql";
import { extractMockDirectives } from "./operation";

describe("mock directive extraction", () => {
  test("uses aliases for response paths and __path__ matching", () => {
    const document = parse(`
      query GetCountryAlias {
        country {
          home: capital @mock(variant: "fictional-capital")
        }
      }
    `);

    expect(extractMockDirectives(document).fieldMocks).toEqual([
      {
        variant: "fictional-capital",
        path: ["country", "home"],
        fieldName: "capital",
        fieldPath: "country.home",
        mockFileName: "GetCountryAlias",
      },
    ]);
  });

  test("collects fragment mocks with fragment-local mock file paths", () => {
    const document = parse(`
      query GetCountryWithFragment {
        country {
          code
          ...CountryCapitalFields
        }
      }

      fragment CountryCapitalFields on Country {
        capital @mock(variant: "fictional-capital")
      }
    `);

    expect(extractMockDirectives(document).fieldMocks).toEqual([
      {
        variant: "fictional-capital",
        path: ["country", "capital"],
        fieldName: "capital",
        fieldPath: "capital",
        mockFileName: "CountryCapitalFields",
      },
    ]);
  });
});
