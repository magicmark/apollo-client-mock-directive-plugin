import { describe, expect, test } from "vitest";
import { parse } from "graphql";
import { validateMockedOperation } from "./operation";

describe("validation rules", () => {
  test("requires exactly one of variant or value", () => {
    expect(() =>
      validateMockedOperation(parse(`query Bad { country { name @mock } }`))
    ).toThrow(/exactly one/);

    expect(() =>
      validateMockedOperation(
        parse(`
          query Bad {
            country {
              name @mock(variant: "name", value: "Wakanda")
            }
          }
        `)
      )
    ).toThrow(/exactly one/);
  });

  test("rejects reserved variant ids", () => {
    expect(() =>
      validateMockedOperation(
        parse(`
          query Bad {
            country {
              name @mock(variant: "__generated")
            }
          }
        `)
      )
    ).toThrow(/reserved/);
  });

  test("rejects variable-backed variants until the client implements that appendix", () => {
    expect(() =>
      validateMockedOperation(
        parse(`
          query Bad($variant: String!) {
            country {
              name @mock(variant: $variant)
            }
          }
        `)
      )
    ).toThrow(/Variable-backed variants are not supported/);
  });

  test("allows inline values only on leaf fields", () => {
    expect(() =>
      validateMockedOperation(
        parse(`
          query Bad {
            country @mock(value: "Wakanda") {
              name
            }
          }
        `)
      )
    ).toThrow(/leaf fields/);
  });

  test("rejects inline values on operation roots", () => {
    expect(() =>
      validateMockedOperation(
        parse(`
          query Bad @mock(value: "Wakanda") {
            country {
              name
            }
          }
        `)
      )
    ).toThrow(/operation root/);
  });

  test("rejects nested mocks across fragment boundaries", () => {
    expect(() =>
      validateMockedOperation(
        parse(`
          fragment CountryFields on Country {
            name @mock(value: "Wakanda")
          }

          query Bad {
            country @mock(variant: "full-country") {
              ...CountryFields
            }
          }
        `)
      )
    ).toThrow(/Nested @mock/);
  });

  test("rejects operations whose transformed root selection set would be empty", () => {
    expect(() =>
      validateMockedOperation(
        parse(`
          query Bad {
            country @mock(variant: "full-country") {
              code
              name
            }
          }
        `)
      )
    ).toThrow(/empty root selection set/);
  });

  test("allows operation-level mocks to replace the whole response", () => {
    expect(() =>
      validateMockedOperation(
        parse(`
          query Mocked @mock(variant: "full-response") {
            country {
              code
              name
            }
          }
        `)
      )
    ).not.toThrow();
  });
});
