import { ApolloLink, Observable } from "@apollo/client";
import type { Operation, FetchResult } from "@apollo/client";
import { visit, Kind } from "graphql";
import type {
  DirectiveNode,
  FieldNode,
  OperationDefinitionNode,
  DocumentNode,
} from "graphql";
import type { MockDirectiveInfo, MockRegistry } from "./types";

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

    // Check if operation has any @mock directives
    const mockInfo = this.extractMockDirectives(query);

    // If operation-level mock exists, return fully mocked response
    if (mockInfo.operationMock) {
      return new Observable((observer) => {
        try {
          const response = this.getMockedOperationResponse(
            operationName || "UnnamedOperation",
            mockInfo.operationMock!.variant
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
    const transformedQuery = this.stripMockedFields(query, mockInfo.fieldMocks);

    // Update the operation's query
    operation.query = transformedQuery;

    // Forward operation and merge mock data into response
    return new Observable((observer) => {
      const subscription = forward(operation).subscribe({
        next: (result: FetchResult) => {
          try {
            const mergedResult = this.mergeMockData(
              result,
              operationName || "UnnamedOperation",
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
   * Extract @mock directives from the operation
   */
  private extractMockDirectives(query: DocumentNode): {
    operationMock: MockDirectiveInfo | null;
    fieldMocks: MockDirectiveInfo[];
  } {
    let operationMock: MockDirectiveInfo | null = null;
    const fieldMocks: MockDirectiveInfo[] = [];
    const pathStack: string[] = [];
    let currentTypeName = "";
    let parentTypeName = "";
    const getDirectiveArg = this.getDirectiveArgument.bind(this);

    visit(query, {
      OperationDefinition: {
        enter(node: OperationDefinitionNode) {
          currentTypeName = node.operation === "query" ? "Query" :
                            node.operation === "mutation" ? "Mutation" :
                            "Subscription";
          parentTypeName = currentTypeName;

          // Check for operation-level @mock
          const mockDirective = node.directives?.find(
            (d) => d.name.value === "mock"
          );

          if (mockDirective) {
            const variant = getDirectiveArg(mockDirective, "variant");
            if (variant) {
              operationMock = {
                variant,
                path: [],
                fieldName: node.operation,
                fieldPath: currentTypeName,
              };
            }
          }
        },
        leave() {
          currentTypeName = "";
          parentTypeName = "";
        },
      },
      Field: {
        enter(node: FieldNode) {
          const fieldName = node.name.value;
          pathStack.push(fieldName);

          // Check for field-level @mock
          const mockDirective = node.directives?.find(
            (d) => d.name.value === "mock"
          );

          if (mockDirective && !operationMock) {
            const variant = getDirectiveArg(mockDirective, "variant");
            const value = getDirectiveArg(mockDirective, "value");

            if (variant && value) {
              throw new Error(
                `@mock on field "${fieldName}" has both "variant" and "value" arguments. ` +
                `These are mutually exclusive — provide one or the other.`
              );
            }

            if (variant || value) {
              const fieldPath = pathStack.join(".");

              fieldMocks.push({
                variant: variant || "",
                ...(value != null ? { value } : {}),
                path: [...pathStack],
                fieldName,
                fieldPath,
              });
            }
          }
        },
        leave() {
          pathStack.pop();
        },
      },
    });

    return { operationMock, fieldMocks };
  }

  /**
   * Get the value of a directive argument
   */
  private getDirectiveArgument(directive: DirectiveNode, argName: string): string | null {
    const arg = directive.arguments?.find((a) => a.name.value === argName);
    if (arg && arg.value.kind === Kind.STRING) {
      return arg.value.value;
    }
    return null;
  }

  /**
   * Strip @mock directives and mocked fields from query
   *
   * Per the spec: "the client must transform the document to remove any
   * selections which have `@mock` applied before sending the request to the server"
   *
   * This implementation removes both the directive and the entire field selection.
   */
  private stripMockedFields(
    query: DocumentNode,
    _fieldMocks: MockDirectiveInfo[]
  ): DocumentNode {
    const transformedQuery = visit(query, {
      Field(node) {
        // Remove fields that have @mock directives
        const hasMockDirective = node.directives?.some(
          (d) => d.name.value === "mock"
        );
        if (hasMockDirective) {
          return null;
        }
      },
    });

    return transformedQuery;
  }

  /**
   * Get fully mocked operation response
   */
  private getMockedOperationResponse(
    operationName: string,
    variant: string
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

    return {
      data: mockVariant.data,
      errors: mockVariant.errors,
      extensions: mockVariant.extensions,
    };
  }

  /**
   * Merge mock data into server response
   */
  private mergeMockData(
    result: FetchResult,
    operationName: string,
    fieldMocks: MockDirectiveInfo[]
  ): FetchResult {
    if (!result.data || fieldMocks.length === 0) {
      return result;
    }

    const mockFile = this.mockRegistry[operationName];

    const mergedData = { ...result.data };
    const mergedErrors = result.errors ? [...result.errors] : [];
    const mergedExtensions = result.extensions ? { ...result.extensions } : {};

    // Apply each mock
    for (const mockInfo of fieldMocks) {
      // Inline value: use directly without consulting mock file
      if (mockInfo.value != null) {
        this.setValueAtPath(mergedData, mockInfo.path, this.coerceValue(mockInfo.value));
        continue;
      }

      if (!mockFile) {
        throw new Error(
          `No mock file found for operation "${operationName}". ` +
          `Expected a mock file at __graphql_mocks__/${operationName}.json`
        );
      }

      const mockVariant = mockFile[mockInfo.variant];

      if (!mockVariant) {
        const availableVariants = Object.keys(mockFile).filter(k => !k.startsWith("__"));
        throw new Error(
          `Mock variant "${mockInfo.variant}" not found for operation "${operationName}". ` +
          `Available variants: ${availableVariants.join(", ")}`
        );
      }

      // Merge data at the field's path
      this.setValueAtPath(mergedData, mockInfo.path, mockVariant.data);

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

  /**
   * Coerce a string value to its appropriate scalar type.
   */
  private coerceValue(value: string): string | number | boolean | null {
    if (value === "null") return null;
    if (value === "true") return true;
    if (value === "false") return false;
    const num = Number(value);
    if (!isNaN(num) && value.trim() !== "") return num;
    return value;
  }

  /**
   * Set a value at a nested path in an object
   */
  private setValueAtPath(obj: any, path: string[], value: any): void {
    if (path.length === 0) return;

    let current = obj;
    for (let i = 0; i < path.length - 1; i++) {
      const key = path[i];
      if (!current[key]) {
        current[key] = {};
      }
      current = current[key];
    }

    const lastKey = path[path.length - 1];
    current[lastKey] = value;
  }
}
