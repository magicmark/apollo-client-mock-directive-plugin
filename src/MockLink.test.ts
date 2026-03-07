import { ApolloClient, ApolloLink, InMemoryCache, Observable, from, gql } from "@apollo/client";
import { describe, expect, test } from "vitest";
import { MockLink } from "./MockLink";

function createServerLink(result: unknown, onCall?: () => void): ApolloLink {
  return new ApolloLink(() => {
    onCall?.();
    return new Observable((observer) => {
      observer.next(result as never);
      observer.complete();
    });
  });
}

describe("MockLink", () => {
  test("operation-level @mock returns the mocked result without hitting server", async () => {
    const registry = {
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
    };

    let serverCalls = 0;
    const serverLink = createServerLink({}, () => {
      serverCalls += 1;
    });

    const client = new ApolloClient({
      link: from([new MockLink({ mockRegistry: registry }), serverLink]),
      cache: new InMemoryCache({ addTypename: false }),
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

    expect(serverCalls).toBe(0);
    expect(result.data).toEqual({
      countries: [
        { code: "US", name: "United States" },
        { code: "GB", name: "United Kingdom" },
        { code: "JP", name: "Japan" },
      ],
    });
  });

  test("field-level @mock on existing field merges mocked field with server fields", async () => {
    const registry = {
      GetCountry: {
        "fictional-capital": {
          data: "Wakanda City",
        },
      },
    };

    const serverLink = createServerLink({
      data: {
        country: {
          code: "US",
          name: "United States",
        },
      },
    });

    const client = new ApolloClient({
      link: from([new MockLink({ mockRegistry: registry }), serverLink]),
      cache: new InMemoryCache({ addTypename: false }),
    });

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

    expect(result.data).toEqual({
      country: {
        code: "US",
        name: "United States",
        capital: "Wakanda City",
      },
    });
  });

  test("field-level @mock on new field adds field that server does not return", async () => {
    const registry = {
      GetCountryWithPopulation: {
        "estimated-population": {
          data: 331900000,
        },
      },
    };

    const serverLink = createServerLink({
      data: {
        country: {
          code: "US",
          name: "United States",
        },
      },
    });

    const client = new ApolloClient({
      link: from([new MockLink({ mockRegistry: registry }), serverLink]),
      cache: new InMemoryCache({ addTypename: false }),
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

  test("field-level @mock on new nested type adds nested object", async () => {
    const registry = {
      GetCountryWithWeather: {
        "current-weather": {
          data: {
            temperature: 72,
            condition: "Partly Cloudy",
            forecast: [
              { day: "Monday", high: 75, low: 62, precipitation: 10 },
            ],
          },
        },
      },
    };

    const serverLink = createServerLink({
      data: {
        country: {
          code: "US",
          name: "United States",
        },
      },
    });

    const client = new ApolloClient({
      link: from([new MockLink({ mockRegistry: registry }), serverLink]),
      cache: new InMemoryCache({ addTypename: false }),
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
