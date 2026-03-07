"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  MockLink: () => MockLink
});
module.exports = __toCommonJS(index_exports);

// src/MockLink.ts
var import_client = require("@apollo/client");
var import_graphql = require("graphql");
var MockLink = class extends import_client.ApolloLink {
  mockRegistry;
  constructor(options) {
    super();
    this.mockRegistry = options.mockRegistry;
  }
  request(operation, forward) {
    const { query, operationName } = operation;
    const mockInfo = this.extractMockDirectives(query);
    if (mockInfo.operationMock) {
      return new import_client.Observable((observer) => {
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
    return new import_client.Observable((observer) => {
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
    (0, import_graphql.visit)(query, {
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
                schemaCoordinate: currentTypeName
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
            if (variant) {
              const schemaCoordinate = `${parentTypeName}.${fieldName}`;
              fieldMocks.push({
                variant,
                path: [...pathStack],
                fieldName,
                schemaCoordinate
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
    if (arg && arg.value.kind === import_graphql.Kind.STRING) {
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
    const transformedQuery = (0, import_graphql.visit)(query, {
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
    if (!mockFile) {
      console.warn(
        `No mock file found for operation "${operationName}". Expected a mock file at __graphql_mocks__/${operationName}.json`
      );
      return result;
    }
    const mergedData = { ...result.data };
    const mergedErrors = result.errors ? [...result.errors] : [];
    const mergedExtensions = result.extensions ? { ...result.extensions } : {};
    for (const mockInfo of fieldMocks) {
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  MockLink
});
//# sourceMappingURL=index.cjs.map