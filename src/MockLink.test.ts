import {
  ApolloClient,
  ApolloLink,
  InMemoryCache,
  Observable,
  from,
  gql,
} from "@apollo/client";
import type { FetchResult } from "@apollo/client";
import { describe, expect, test } from "vitest";
import { MockLink } from "./MockLink";
import type { MockRegistry } from "./types";

function createServerLink(
  response: FetchResult,
  onCall?: (operation: Parameters<NonNullable<ApolloLink["request"]>>[0]) => void
): ApolloLink {
  return new ApolloLink((operation) => {
    onCall?.(operation);
    return new Observable((observer) => {
      observer.next(response);
      observer.complete();
    });
  });
}

function createClient(
  mockRegistry: MockRegistry,
  serverResponse: FetchResult = { data: {} },
  onServerCall?: (operation: Parameters<NonNullable<ApolloLink["request"]>>[0]) => void
) {
  return new ApolloClient({
    link: from([
      new MockLink({ mockRegistry }),
      createServerLink(serverResponse, onServerCall),
    ]),
    cache: new InMemoryCache(),
  });
}

describe("MockLink", () => {
  test("returns an operation-level mock without hitting the server", async () => {
    const registry: MockRegistry = {
      GetCountries: {
        "top-three": {
          data: {
            countries: [
              { code: "US", name: "United States" },
              { code: "GB", name: "United Kingdom" },
              { code: "JP", name: "Japan" },
            ],
          },
          __path__: "Query",
        },
      },
    };
    let serverCalls = 0;
    const client = createClient(registry, { data: {} }, () => {
      serverCalls += 1;
    });

    const result = await client.query({
      query: gql`
        query GetCountries @mock(variant: "top-three") {
          countries {
            code
            name
          }
        }
      `,
      fetchPolicy: "no-cache",
    });

    expect(serverCalls).toBe(0);
    expect(result.data).toEqual({
      countries: [
        { code: "US", name: "United States" },
        { code: "GB", name: "United Kingdom" },
        { code: "JP", name: "Japan" },
      ],
    });
  });

  test("mocks one existing field while other fields come from the server", async () => {
    const registry: MockRegistry = {
      GetCountry: {
        "fictional-capital": {
          data: "Wakanda City",
          __path__: "country.capital",
        },
      },
    };
    const client = createClient(registry, {
      data: {
        country: {
          code: "US",
          name: "United States",
          emoji: "\u{1F1FA}\u{1F1F8}",
        },
      },
    });

    const result = await client.query({
      query: gql`
        query GetCountry($code: ID!) {
          country(code: $code) {
            code
            name
            capital @mock(variant: "fictional-capital")
            emoji
          }
        }
      `,
      variables: { code: "US" },
      fetchPolicy: "no-cache",
    });

    expect(result.data).toEqual({
      country: {
        code: "US",
        name: "United States",
        capital: "Wakanda City",
        emoji: "\u{1F1FA}\u{1F1F8}",
      },
    });
  });

  test("uses aliases when calculating mock paths and response keys", async () => {
    const registry: MockRegistry = {
      GetCountryAlias: {
        "fictional-capital": {
          data: "Wakanda City",
          __path__: "country.home",
        },
      },
    };
    const client = createClient(registry, {
      data: {
        country: {
          code: "US",
        },
      },
    });

    const result = await client.query({
      query: gql`
        query GetCountryAlias($code: ID!) {
          country(code: $code) {
            code
            home: capital @mock(variant: "fictional-capital")
          }
        }
      `,
      variables: { code: "US" },
      fetchPolicy: "no-cache",
    });

    expect(result.data).toEqual({
      country: {
        code: "US",
        home: "Wakanda City",
      },
    });
  });

  test("reads variant mocks from fragment mock files", async () => {
    const registry: MockRegistry = {
      CountryCapitalFields: {
        "fictional-capital": {
          data: "Wakanda City",
          __path__: "capital",
        },
      },
    };
    const client = createClient(registry, {
      data: {
        country: {
          __typename: "Country",
          code: "US",
        },
      },
    });

    const result = await client.query({
      query: gql`
        query GetCountryWithFragment($code: ID!) {
          country(code: $code) {
            __typename
            code
            ...CountryCapitalFields
          }
        }

        fragment CountryCapitalFields on Country {
          capital @mock(variant: "fictional-capital")
        }
      `,
      variables: { code: "US" },
      fetchPolicy: "no-cache",
    });

    expect(result.data).toEqual({
      country: {
        __typename: "Country",
        code: "US",
        capital: "Wakanda City",
      },
    });
  });

  test("mocks a field not yet returned by the server", async () => {
    const registry: MockRegistry = {
      GetCountryWithPopulation: {
        "estimated-population": {
          data: 331900000,
          __path__: "country.population",
        },
      },
    };
    const client = createClient(registry, {
      data: {
        country: {
          code: "US",
          name: "United States",
        },
      },
    });

    const result = await client.query({
      query: gql`
        query GetCountryWithPopulation($code: ID!) {
          country(code: $code) {
            code
            name
            population @mock(variant: "estimated-population")
          }
        }
      `,
      variables: { code: "US" },
      fetchPolicy: "no-cache",
    });

    expect(result.data).toEqual({
      country: {
        code: "US",
        name: "United States",
        population: 331900000,
      },
    });
  });

  test("mocks scalar fields using inline values without a mock file", async () => {
    const client = createClient(
      {},
      {
        data: {
          country: {
            code: "US",
            name: "United States",
          },
        },
      }
    );

    const result = await client.query({
      query: gql`
        query GetCountryInline($code: ID!) {
          country(code: $code) {
            code
            name
            capital @mock(value: "Wakanda City")
            population @mock(value: "331900000")
            isLandlocked @mock(value: "false")
          }
        }
      `,
      variables: { code: "US" },
      fetchPolicy: "no-cache",
    });

    expect(result.data).toEqual({
      country: {
        code: "US",
        name: "United States",
        capital: "Wakanda City",
        population: 331900000,
        isLandlocked: false,
      },
    });
  });

  test("mixes inline value and variant mocks in the same query", async () => {
    const registry: MockRegistry = {
      GetCountryMixed: {
        "current-weather": {
          data: {
            temperature: 72,
            condition: "Sunny",
          },
          __path__: "country.weather",
        },
      },
    };
    const client = createClient(registry, {
      data: {
        country: {
          code: "KE",
          name: "Kenya",
        },
      },
    });

    const result = await client.query({
      query: gql`
        query GetCountryMixed($code: ID!) {
          country(code: $code) {
            code
            name
            capital @mock(value: "Nairobi")
            weather @mock(variant: "current-weather") {
              temperature
              condition
            }
          }
        }
      `,
      variables: { code: "KE" },
      fetchPolicy: "no-cache",
    });

    expect(result.data).toEqual({
      country: {
        code: "KE",
        name: "Kenya",
        capital: "Nairobi",
        weather: {
          temperature: 72,
          condition: "Sunny",
        },
      },
    });
  });

  test("applies nested inline mocks to each item in a list response", async () => {
    const client = createClient(
      {},
      {
        data: {
          countries: [
            { code: "US", name: "United States" },
            { code: "GB", name: "United Kingdom" },
          ],
        },
      }
    );

    const result = await client.query({
      query: gql`
        query GetCountriesInline {
          countries {
            code
            name
            capital @mock(value: "Hidden Capital")
          }
        }
      `,
      fetchPolicy: "no-cache",
    });

    expect(result.data).toEqual({
      countries: [
        { code: "US", name: "United States", capital: "Hidden Capital" },
        { code: "GB", name: "United Kingdom", capital: "Hidden Capital" },
      ],
    });
  });

  test("mocks a complex nested field not yet returned by the server", async () => {
    const registry: MockRegistry = {
      GetCountryWithWeather: {
        "current-weather": {
          data: {
            temperature: 72,
            condition: "Partly Cloudy",
            forecast: [
              { day: "Monday", high: 75, low: 62, precipitation: 10 },
            ],
          },
          __path__: "country.weather",
        },
      },
    };
    const client = createClient(registry, {
      data: {
        country: {
          code: "US",
          name: "United States",
        },
      },
    });

    const result = await client.query({
      query: gql`
        query GetCountryWithWeather($code: ID!) {
          country(code: $code) {
            code
            name
            weather @mock(variant: "current-weather") {
              temperature
              condition
              forecast {
                day
                high
                low
                precipitation
              }
            }
          }
        }
      `,
      variables: { code: "US" },
      fetchPolicy: "no-cache",
    });

    expect(result.data).toEqual({
      country: {
        code: "US",
        name: "United States",
        weather: {
          temperature: 72,
          condition: "Partly Cloudy",
          forecast: [
            { day: "Monday", high: 75, low: 62, precipitation: 10 },
          ],
        },
      },
    });
  });
});
