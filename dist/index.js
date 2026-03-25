// src/MockLink.ts
import { ApolloLink, Observable } from "@apollo/client";
import { visit, Kind } from "graphql";
var MockLink = class extends ApolloLink {
  mockRegistry;
  constructor(options) {
    super();
    this.mockRegistry = options.mockRegistry;
  }
  request(operation, forward) {
    const { query, operationName } = operation;
    const mockInfo = this.extractMockDirectives(query);
    if (mockInfo.operationMock) {
      return new Observable((observer) => {
        try {
          const response = this.getMockedOperationResponse(
            operationName || "UnnamedOperation",
            mockInfo.operationMock.variant
          );
          observer.next(response);
          observer.complete();
        } catch (error) {
          observer.error(error);
        }
      });
    }
    if (mockInfo.fieldMocks.length === 0) {
      return forward(operation);
    }
    const transformedQuery = this.stripMockedFields(query, mockInfo.fieldMocks);
    operation.query = transformedQuery;
    return new Observable((observer) => {
      const subscription = forward(operation).subscribe({
        next: (result) => {
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
        error: (error) => observer.error(error),
        complete: () => observer.complete()
      });
      return () => subscription.unsubscribe();
    });
  }
  /**
   * Extract @mock directives from the operation
   */
  extractMockDirectives(query) {
    let operationMock = null;
    const fieldMocks = [];
    const pathStack = [];
    let currentTypeName = "";
    let parentTypeName = "";
    const getDirectiveArg = this.getDirectiveArgument.bind(this);
    visit(query, {
      OperationDefinition: {
        enter(node) {
          currentTypeName = node.operation === "query" ? "Query" : node.operation === "mutation" ? "Mutation" : "Subscription";
          parentTypeName = currentTypeName;
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
                fieldPath: currentTypeName
              };
            }
          }
        },
        leave() {
          currentTypeName = "";
          parentTypeName = "";
        }
      },
      Field: {
        enter(node) {
          const fieldName = node.name.value;
          pathStack.push(fieldName);
          const mockDirective = node.directives?.find(
            (d) => d.name.value === "mock"
          );
          if (mockDirective && !operationMock) {
            const variant = getDirectiveArg(mockDirective, "variant");
            const value = getDirectiveArg(mockDirective, "value");
            if (variant && value) {
              throw new Error(
                `@mock on field "${fieldName}" has both "variant" and "value" arguments. These are mutually exclusive \u2014 provide one or the other.`
              );
            }
            if (variant || value) {
              const fieldPath = pathStack.join(".");
              fieldMocks.push({
                variant: variant || "",
                ...value != null ? { value } : {},
                path: [...pathStack],
                fieldName,
                fieldPath
              });
            }
          }
        },
        leave() {
          pathStack.pop();
        }
      }
    });
    return { operationMock, fieldMocks };
  }
  /**
   * Get the value of a directive argument
   */
  getDirectiveArgument(directive, argName) {
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
  stripMockedFields(query, _fieldMocks) {
    const transformedQuery = visit(query, {
      Field(node) {
        const hasMockDirective = node.directives?.some(
          (d) => d.name.value === "mock"
        );
        if (hasMockDirective) {
          return null;
        }
      }
    });
    return transformedQuery;
  }
  /**
   * Get fully mocked operation response
   */
  getMockedOperationResponse(operationName, variant) {
    const mockFile = this.mockRegistry[operationName];
    if (!mockFile) {
      throw new Error(
        `No mock file found for operation "${operationName}". Expected a mock file at __graphql_mocks__/${operationName}.json`
      );
    }
    const mockVariant = mockFile[variant];
    if (!mockVariant) {
      const availableVariants = Object.keys(mockFile).filter((k) => !k.startsWith("__"));
      throw new Error(
        `Mock variant "${variant}" not found for operation "${operationName}". Available variants: ${availableVariants.join(", ")}`
      );
    }
    return {
      data: mockVariant.data,
      errors: mockVariant.errors,
      extensions: mockVariant.extensions
    };
  }
  /**
   * Merge mock data into server response
   */
  mergeMockData(result, operationName, fieldMocks) {
    if (!result.data || fieldMocks.length === 0) {
      return result;
    }
    const mockFile = this.mockRegistry[operationName];
    const mergedData = { ...result.data };
    const mergedErrors = result.errors ? [...result.errors] : [];
    const mergedExtensions = result.extensions ? { ...result.extensions } : {};
    for (const mockInfo of fieldMocks) {
      if (mockInfo.value != null) {
        this.setValueAtPath(mergedData, mockInfo.path, this.coerceValue(mockInfo.value));
        continue;
      }
      if (!mockFile) {
        throw new Error(
          `No mock file found for operation "${operationName}". Expected a mock file at __graphql_mocks__/${operationName}.json`
        );
      }
      const mockVariant = mockFile[mockInfo.variant];
      if (!mockVariant) {
        const availableVariants = Object.keys(mockFile).filter((k) => !k.startsWith("__"));
        throw new Error(
          `Mock variant "${mockInfo.variant}" not found for operation "${operationName}". Available variants: ${availableVariants.join(", ")}`
        );
      }
      this.setValueAtPath(mergedData, mockInfo.path, mockVariant.data);
      if (mockVariant.errors) {
        mergedErrors.push(...mockVariant.errors);
      }
      if (mockVariant.extensions) {
        Object.assign(mergedExtensions, mockVariant.extensions);
      }
    }
    return {
      data: mergedData,
      errors: mergedErrors.length > 0 ? mergedErrors : void 0,
      extensions: Object.keys(mergedExtensions).length > 0 ? mergedExtensions : void 0
    };
  }
  /**
   * Coerce a string value to its appropriate scalar type.
   */
  coerceValue(value) {
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
  setValueAtPath(obj, path, value) {
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
};
export {
  MockLink
};
//# sourceMappingURL=index.js.map