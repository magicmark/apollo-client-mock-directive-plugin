import { describe, test, expect, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import {
  ApolloClient,
  ApolloLink,
  InMemoryCache,
  Observable,
  gql,
  from,
} from "@apollo/client";
import type { FetchResult } from "@apollo/client";
import { ApolloProvider, useQuery } from "@apollo/client/react";
import { MockLink } from "./MockLink";
import type { MockRegistry } from "./types";

afterEach(cleanup);

/**
 * A fake "server" link that returns a canned response.
 * This simulates the downstream server for field-level mock tests,
 * so we don't need real network access.
 */
function createServerLink(
  response: FetchResult
): ApolloLink {
  return new ApolloLink(() => {
    return new Observable((observer) => {
      observer.next(response);
      observer.complete();
    });
  });
}

/**
 * Helper: creates an Apollo Client with MockLink chained before a fake server link.
 */
function createClient(
  mockRegistry: MockRegistry,
  serverResponse?: FetchResult
) {
  const mockLink = new MockLink({ mockRegistry });
  const serverLink = createServerLink(
    serverResponse ?? { data: {} }
  );
  return new ApolloClient({
    link: from([mockLink, serverLink]),
    cache: new InMemoryCache(),
  });
}

/**
 * Helper: renders a component that executes a query and displays the JSON result.
 */
function QueryRenderer({
  query,
  variables,
}: {
  query: ReturnType<typeof gql>;
  variables?: Record<string, unknown>;
}) {
  const { data, loading, error } = useQuery(query, { variables });
  if (loading) return <div>loading</div>;
  if (error) return <div data-testid="error">error: {error.message}</div>;
  return <div data-testid="result">{JSON.stringify(data)}</div>;
}

// ---------------------------------------------------------------------------
// Test 1: Operation-level mock — entire response is mocked, no network request
// ---------------------------------------------------------------------------
describe("operation-level @mock", () => {
  test("returns fully mocked response without hitting the server", async () => {
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
          __appliesTo__: "Query",
        },
      },
    };

    const query = gql`
      query GetCountries @mock(variant: "top-three") {
        countries {
          code
          name
        }
      }
    `;

    const client = createClient(registry);

    render(
      <ApolloProvider client={client}>
        <QueryRenderer query={query} />
      </ApolloProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("result")).toBeTruthy();
    });

    const result = JSON.parse(screen.getByTestId("result").textContent!);
    expect(result.countries).toHaveLength(3);
    expect(result.countries[0]).toEqual({
      code: "US",
      name: "United States",
    });
    expect(result.countries[2]).toEqual({ code: "JP", name: "Japan" });
  });
});

// ---------------------------------------------------------------------------
// Test 2: Field-level mock — capital is mocked, rest comes from server
// ---------------------------------------------------------------------------
describe("field-level @mock on existing field", () => {
  test("mocks one field while other fields come from server", async () => {
    const registry: MockRegistry = {
      GetCountry: {
        "fictional-capital": {
          data: "Wakanda City",
          __appliesTo__: "Country.capital",
        },
      },
    };

    const query = gql`
      query GetCountry($code: ID!) {
        country(code: $code) {
          code
          name
          capital @mock(variant: "fictional-capital")
          emoji
        }
      }
    `;

    // The server returns the real fields (capital is stripped from the
    // request, so the server wouldn't return it).
    const client = createClient(registry, {
      data: {
        country: {
          code: "US",
          name: "United States",
          emoji: "\u{1F1FA}\u{1F1F8}",
        },
      },
    });

    render(
      <ApolloProvider client={client}>
        <QueryRenderer query={query} variables={{ code: "US" }} />
      </ApolloProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("result")).toBeTruthy();
    });

    const result = JSON.parse(screen.getByTestId("result").textContent!);
    // Mocked field
    expect(result.country.capital).toBe("Wakanda City");
    // Real fields from server
    expect(result.country.code).toBe("US");
    expect(result.country.name).toBe("United States");
  });
});

// ---------------------------------------------------------------------------
// Test 3: Field-level mock on a field that doesn't exist in the schema yet
// ---------------------------------------------------------------------------
describe("field-level @mock on new field", () => {
  test("mocks a field not yet in the server schema", async () => {
    const registry: MockRegistry = {
      GetCountryWithPopulation: {
        "estimated-population": {
          data: 331900000,
          __appliesTo__: "Country.population",
        },
      },
    };

    const query = gql`
      query GetCountryWithPopulation($code: ID!) {
        country(code: $code) {
          code
          name
          population @mock(variant: "estimated-population")
        }
      }
    `;

    const client = createClient(registry, {
      data: {
        country: {
          code: "US",
          name: "United States",
        },
      },
    });

    render(
      <ApolloProvider client={client}>
        <QueryRenderer query={query} variables={{ code: "US" }} />
      </ApolloProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("result")).toBeTruthy();
    });

    const result = JSON.parse(screen.getByTestId("result").textContent!);
    // Mocked new field merged in
    expect(result.country.population).toBe(331900000);
    // Real fields still present
    expect(result.country.code).toBe("US");
    expect(result.country.name).toBe("United States");
  });
});

// ---------------------------------------------------------------------------
// Test 4: Field-level mock inside a list — same value applied to every item
// ---------------------------------------------------------------------------
describe("field-level @mock inside a list", () => {
  test("applies the same mock value to every item in the list", async () => {
    const registry: MockRegistry = {
      GetBusinesses: {
        "morning-only": {
          data: {
            open: "8:00am",
            close: "12:00pm",
          },
          __appliesTo__: "Business.hours",
        },
      },
    };

    const query = gql`
      query GetBusinesses {
        businesses {
          name
          hours @mock(variant: "morning-only") {
            open
            close
          }
        }
      }
    `;

    const client = createClient(registry, {
      data: {
        businesses: [
          { name: "The Great British Bakery" },
          { name: "El Greco Deli" },
          { name: "Taco Wheels" },
        ],
      },
    });

    render(
      <ApolloProvider client={client}>
        <QueryRenderer query={query} />
      </ApolloProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("result")).toBeTruthy();
    });

    const result = JSON.parse(screen.getByTestId("result").textContent!);
    expect(result.businesses).toHaveLength(3);
    // Each item gets the same mock value for hours
    for (const business of result.businesses) {
      expect(business.hours).toEqual({ open: "8:00am", close: "12:00pm" });
    }
    // Server-provided fields are preserved
    expect(result.businesses[0].name).toBe("The Great British Bakery");
    expect(result.businesses[1].name).toBe("El Greco Deli");
    expect(result.businesses[2].name).toBe("Taco Wheels");
  });
});

// ---------------------------------------------------------------------------
// Test 5: Field-level mock inside a deeply nested list
// ---------------------------------------------------------------------------
describe("field-level @mock inside nested lists", () => {
  test("applies mock value through multiple levels of nesting", async () => {
    const registry: MockRegistry = {
      GetBusinessMenus: {
        "placeholder-blur": {
          data: "data:image/png;base64,iVBOR...",
          __appliesTo__: "Photo.blurHash",
        },
      },
    };

    const query = gql`
      query GetBusinessMenus {
        businesses {
          name
          menuItems {
            name
            photo {
              url
              blurHash @mock(variant: "placeholder-blur")
            }
          }
        }
      }
    `;

    const client = createClient(registry, {
      data: {
        businesses: [
          {
            name: "The Great British Bakery",
            menuItems: [
              { name: "Scone", photo: { url: "https://example.com/scone.jpg" } },
              { name: "Crumpet", photo: { url: "https://example.com/crumpet.jpg" } },
            ],
          },
          {
            name: "Taco Wheels",
            menuItems: [
              { name: "Tacos", photo: { url: "https://example.com/tacos.jpg" } },
            ],
          },
        ],
      },
    });

    render(
      <ApolloProvider client={client}>
        <QueryRenderer query={query} />
      </ApolloProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("result")).toBeTruthy();
    });

    const result = JSON.parse(screen.getByTestId("result").textContent!);
    // All photos across all businesses get the same blurHash
    expect(result.businesses[0].menuItems[0].photo.blurHash).toBe(
      "data:image/png;base64,iVBOR..."
    );
    expect(result.businesses[0].menuItems[1].photo.blurHash).toBe(
      "data:image/png;base64,iVBOR..."
    );
    expect(result.businesses[1].menuItems[0].photo.blurHash).toBe(
      "data:image/png;base64,iVBOR..."
    );
    // Server-provided fields are preserved
    expect(result.businesses[0].menuItems[0].photo.url).toBe(
      "https://example.com/scone.jpg"
    );
    expect(result.businesses[0].menuItems[0].name).toBe("Scone");
    expect(result.businesses[1].name).toBe("Taco Wheels");
  });
});

// ---------------------------------------------------------------------------
// Test 6: Field-level mock on a nested type that doesn't exist in the schema
// ---------------------------------------------------------------------------
describe("field-level @mock on new nested type", () => {
  test("mocks a complex nested field not yet in the server schema", async () => {
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
          __appliesTo__: "Country.weather",
        },
      },
    };

    const query = gql`
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
    `;

    const client = createClient(registry, {
      data: {
        country: {
          code: "US",
          name: "United States",
        },
      },
    });

    render(
      <ApolloProvider client={client}>
        <QueryRenderer query={query} variables={{ code: "US" }} />
      </ApolloProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("result")).toBeTruthy();
    });

    const result = JSON.parse(screen.getByTestId("result").textContent!);
    // Mocked nested type
    expect(result.country.weather.temperature).toBe(72);
    expect(result.country.weather.condition).toBe("Partly Cloudy");
    expect(result.country.weather.forecast).toHaveLength(1);
    expect(result.country.weather.forecast[0].day).toBe("Monday");
    // Real fields still present
    expect(result.country.code).toBe("US");
    expect(result.country.name).toBe("United States");
  });
});
