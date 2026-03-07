import { ApolloClient, ApolloLink, InMemoryCache, Observable, from, gql } from "@apollo/client";
import type { FetchResult, Operation } from "@apollo/client";
import { print } from "graphql";
import { describe, expect, test } from "vitest";
import { MockLink } from "./MockLink";
import type { MockRegistry } from "./types";

function createClient(
  mockRegistry: MockRegistry,
  handleServerResponse: (operation: Operation) => FetchResult = () => ({ data: {} })
) {
  const state = {
    serverCalls: 0,
    forwardedQuery: "",
  };

  const serverLink = new ApolloLink((operation) => {
    state.serverCalls += 1;
    state.forwardedQuery = print(operation.query);

    return new Observable((observer) => {
      try {
        observer.next(handleServerResponse(operation));
        observer.complete();
      } catch (error) {
        observer.error(error);
      }
    });
  });

  const client = new ApolloClient({
    link: from([new MockLink({ mockRegistry }), serverLink]),
    cache: new InMemoryCache({ addTypename: false }),
  });

  return { client, state };
}

describe("MockLink", () => {
  test("supports operation-level mocks via @mock(name) without forwarding", async () => {
    const { client, state } = createClient({
      GetCountries: {
        "top-three": {
          data: {
            countries: [
              { code: "US", name: "United States" },
              { code: "GB", name: "United Kingdom" },
              { code: "JP", name: "Japan" },
            ],
          },
        },
      },
    });

    const result = await client.query({
      query: gql`
        query GetCountries @mock(name: "top-three") {
          countries {
            code
            name
          }
        }
      `,
      fetchPolicy: "no-cache",
    });

    expect(state.serverCalls).toBe(0);
    expect(result.data).toEqual({
      countries: [
        { code: "US", name: "United States" },
        { code: "GB", name: "United Kingdom" },
        { code: "JP", name: "Japan" },
      ],
    });
  });

  test("removes mocked fields before forwarding and merges the field mock into response data", async () => {
    const { client, state } = createClient(
      {
        GetCountry: {
          "fictional-capital": {
            data: "Wakanda City",
          },
        },
      },
      () => ({
        data: {
          country: {
            code: "US",
            name: "United States",
          },
        },
      })
    );

    const result = await client.query({
      query: gql`
        query GetCountry($code: ID!) {
          country(code: $code) {
            code
            name
            capital @mock(variant: "fictional-capital")
          }
        }
      `,
      variables: { code: "US" },
      fetchPolicy: "no-cache",
    });

    expect(state.serverCalls).toBe(1);
    expect(state.forwardedQuery).not.toContain("@mock");
    expect(state.forwardedQuery).not.toContain("capital");
    expect(result.data).toEqual({
      country: {
        code: "US",
        name: "United States",
        capital: "Wakanda City",
      },
    });
  });

  test("throws a helpful error when the requested variant is missing", async () => {
    const { client, state } = createClient({
      GetCountries: {
        "top-three": {
          data: {
            countries: [],
          },
        },
      },
    });

    await expect(
      client.query({
        query: gql`
          query GetCountries @mock(variant: "missing") {
            countries {
              code
            }
          }
        `,
        fetchPolicy: "no-cache",
      })
    ).rejects.toThrow(
      'Mock variant "missing" not found for operation "GetCountries". Available variants: top-three'
    );

    expect(state.serverCalls).toBe(0);
  });

  test("throws when the operation is unnamed", async () => {
    const { client, state } = createClient({});

    await expect(
      client.query({
        query: gql`
          query {
            countries {
              code
            }
          }
        `,
        fetchPolicy: "no-cache",
      })
    ).rejects.toThrow("Operation name is required when using MockLink.");

    expect(state.serverCalls).toBe(0);
  });
});
