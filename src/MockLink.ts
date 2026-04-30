import { ApolloLink, Observable } from "@apollo/client";
import type { Operation, FetchResult } from "@apollo/client";
import type { MockDirectiveInfo, MockRegistry, MockVariant } from "./types";
import {
  coerceInlineValue,
  extractMockDirectives,
  transformMockedOperation,
  validateMockedOperation,
} from "./operation";

export interface MockLinkOptions {
  mockRegistry: MockRegistry;
}

/**
 * MockLink implements the @mock directive specification for Apollo Client.
 *
 * It intercepts GraphQL operations, detects @mock directives, strips mocked
 * fields from server requests, and merges mock data into responses.
 */
export class MockLink extends ApolloLink {
  private mockRegistry: MockRegistry;

  constructor(options: MockLinkOptions) {
    super();
    this.mockRegistry = options.mockRegistry;
  }

  request(operation: Operation, forward: any): Observable<FetchResult> {
    const { query, operationName } = operation;

    // Check if operation has any @mock directives and validate the pieces of
    // the spec that do not require schema awareness.
    validateMockedOperation(query, operationName);
    const mockInfo = extractMockDirectives(query, operationName);

    // If operation-level mock exists, return fully mocked response
    if (mockInfo.operationMock) {
      return new Observable((observer) => {
        try {
          const response = this.getMockedOperationResponse(
            mockInfo.operationMock!.mockFileName,
            mockInfo.operationMock!.variant,
            mockInfo.operationMock!.fieldPath
          );
          observer.next(response);
          observer.complete();
        } catch (error) {
          observer.error(error);
        }
      });
    }

    // If no field-level mocks, just forward
    if (mockInfo.fieldMocks.length === 0) {
      return forward(operation);
    }

    // Transform query to remove @mock directives
    const transformedQuery = transformMockedOperation(query);

    // Update the operation's query
    operation.query = transformedQuery;

    // Forward operation and merge mock data into response
    return new Observable((observer) => {
      const subscription = forward(operation).subscribe({
        next: (result: FetchResult) => {
          try {
            const mergedResult = this.mergeMockData(
              result,
              mockInfo.fieldMocks
            );
            observer.next(mergedResult);
          } catch (error) {
            observer.error(error);
          }
        },
        error: (error: any) => observer.error(error),
        complete: () => observer.complete(),
      });

      return () => subscription.unsubscribe();
    });
  }

  /**
   * Get fully mocked operation response
   */
  private getMockedOperationResponse(
    operationName: string,
    variant: string,
    expectedPath: string
  ): FetchResult {
    const mockFile = this.mockRegistry[operationName];

    if (!mockFile) {
      throw new Error(
        `No mock file found for operation "${operationName}". ` +
        `Expected a mock file at __graphql_mocks__/${operationName}.json`
      );
    }

    const mockVariant = mockFile[variant];

    if (!mockVariant) {
      const availableVariants = Object.keys(mockFile).filter(k => !k.startsWith("__"));
      throw new Error(
        `Mock variant "${variant}" not found for operation "${operationName}". ` +
        `Available variants: ${availableVariants.join(", ")}`
      );
    }

    this.assertMockVariant(mockVariant, variant, operationName, expectedPath);

    return {
      data: this.cloneValue(mockVariant.data),
      errors: mockVariant.errors,
      extensions: mockVariant.extensions,
    };
  }

  /**
   * Merge mock data into server response
   */
  private mergeMockData(
    result: FetchResult,
    fieldMocks: MockDirectiveInfo[]
  ): FetchResult {
    if (fieldMocks.length === 0) {
      return result;
    }

    const mergedData = result.data == null ? {} : this.cloneValue(result.data);
    const mergedErrors = result.errors ? [...result.errors] : [];
    const mergedExtensions = result.extensions ? { ...result.extensions } : {};

    // Apply each mock
    for (const mockInfo of fieldMocks) {
      // Inline value: use directly without consulting mock file
      if (mockInfo.value != null) {
        this.setValueAtPath(
          mergedData,
          mockInfo.path,
          coerceInlineValue(mockInfo.value)
        );
        continue;
      }

      const mockFile = this.mockRegistry[mockInfo.mockFileName];

      if (!mockFile) {
        throw new Error(
          `No mock file found for "${mockInfo.mockFileName}". ` +
          `Expected a mock file at __graphql_mocks__/${mockInfo.mockFileName}.json`
        );
      }

      const mockVariant = mockFile[mockInfo.variant];

      if (!mockVariant) {
        const availableVariants = Object.keys(mockFile).filter(k => !k.startsWith("__"));
        throw new Error(
          `Mock variant "${mockInfo.variant}" not found for "${mockInfo.mockFileName}". ` +
          `Available variants: ${availableVariants.join(", ")}`
        );
      }

      this.assertMockVariant(
        mockVariant,
        mockInfo.variant,
        mockInfo.mockFileName,
        mockInfo.fieldPath
      );

      // Merge data at the field's path
      this.setValueAtPath(
        mergedData,
        mockInfo.path,
        this.cloneValue(mockVariant.data)
      );

      // Merge errors if present
      if (mockVariant.errors) {
        mergedErrors.push(...mockVariant.errors);
      }

      // Merge extensions if present
      if (mockVariant.extensions) {
        Object.assign(mergedExtensions, mockVariant.extensions);
      }
    }

    return {
      data: mergedData,
      errors: mergedErrors.length > 0 ? mergedErrors : undefined,
      extensions: Object.keys(mergedExtensions).length > 0 ? mergedExtensions : undefined,
    };
  }

  private assertMockVariant(
    mockVariant: MockVariant,
    variant: string,
    mockFileName: string,
    expectedPath: string
  ): void {
    const allowedKeys = new Set([
      "data",
      "errors",
      "extensions",
      "__path__",
      "__description__",
      "__metadata__",
    ]);

    for (const key of Object.keys(mockVariant)) {
      if (!allowedKeys.has(key)) {
        throw new Error(
          `Mock variant "${variant}" in "${mockFileName}" contains unsupported key "${key}".`
        );
      }
    }

    if (!Object.prototype.hasOwnProperty.call(mockVariant, "data")) {
      throw new Error(
        `Mock variant "${variant}" in "${mockFileName}" must include a "data" key.`
      );
    }

    if (!mockVariant.__path__) {
      throw new Error(
        `Mock variant "${variant}" in "${mockFileName}" must include a "__path__" key.`
      );
    }

    if (mockVariant.__path__ !== expectedPath) {
      throw new Error(
        `Mock variant "${variant}" in "${mockFileName}" has __path__ "${mockVariant.__path__}", but the @mock directive is at "${expectedPath}".`
      );
    }
  }

  private cloneValue<T>(value: T): T {
    if (Array.isArray(value)) {
      return value.map((item) => this.cloneValue(item)) as T;
    }

    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, nestedValue]) => [
          key,
          this.cloneValue(nestedValue),
        ])
      ) as T;
    }

    return value;
  }

  /**
   * Set a value at a nested path in an object
   */
  private setValueAtPath(obj: any, path: string[], value: any): void {
    if (path.length === 0) return;

    if (Array.isArray(obj)) {
      for (const item of obj) {
        if (item != null) {
          this.setValueAtPath(item, path, this.cloneValue(value));
        }
      }
      return;
    }

    if (obj == null || typeof obj !== "object") return;

    const [key, ...rest] = path;

    if (rest.length === 0) {
      obj[key] = value;
      return;
    }

    if (obj[key] == null) {
      obj[key] = {};
    }

    this.setValueAtPath(obj[key], rest, value);
  }
}
