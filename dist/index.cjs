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

// src/operation.ts
var import_graphql = require("graphql");
function validateMockedOperation(document, operationName) {
  const fragments = getFragmentMap(document);
  const operations = getOperationsToValidate(document, operationName);
  for (const operation of operations) {
    validateOperationMockDirective(operation);
    validateMockDirectiveArgumentsInSelectionSet(
      operation.selectionSet,
      operation.name?.value,
      fragments,
      /* @__PURE__ */ new Set()
    );
    validateNoNestedMocks(operation.selectionSet, fragments, false, /* @__PURE__ */ new Set());
    validateNonEmptyOperationRoot(document, operation);
  }
}
function extractMockDirectives(document, operationName) {
  const operation = getExecutableOperation(document, operationName);
  const fragments = getFragmentMap(document);
  const operationFileName = getOperationFileName(operation);
  const operationMockDirective = getMockDirective(operation);
  const operationMock = operationMockDirective ? {
    variant: getMockArguments(operationMockDirective).variant ?? "",
    path: [],
    fieldName: operation.operation,
    fieldPath: getRootOperationType(operation),
    mockFileName: operationFileName
  } : null;
  if (operationMock) {
    return { operationMock, fieldMocks: [] };
  }
  const fieldMocks = [];
  const seenMocks = /* @__PURE__ */ new Set();
  collectFieldMocksFromSelectionSet({
    selectionSet: operation.selectionSet,
    fragments,
    responsePath: [],
    ownerPath: [],
    mockFileName: operationFileName,
    fieldMocks,
    seenMocks,
    spreadStack: /* @__PURE__ */ new Set()
  });
  return { operationMock: null, fieldMocks };
}
function transformMockedOperation(document) {
  let transformed = (0, import_graphql.visit)(document, {
    Field(node) {
      if (getMockDirective(node)) {
        return null;
      }
      return void 0;
    }
  });
  let previous = "";
  while (previous !== (0, import_graphql.print)(transformed)) {
    previous = (0, import_graphql.print)(transformed);
    transformed = pruneEmptySelectionSets(transformed);
    transformed = removeSpreadsToMissingFragments(transformed);
    transformed = removeUnusedFragments(transformed);
    transformed = removeUnusedVariables(transformed);
  }
  return transformed;
}
function coerceInlineValue(value) {
  if (value === "null") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (isJsonNumber(value)) return Number(value);
  return value;
}
function getRootOperationType(operation) {
  if (operation.operation === "mutation") return "Mutation";
  if (operation.operation === "subscription") return "Subscription";
  return "Query";
}
function getOperationsToValidate(document, operationName) {
  if (operationName) {
    return [getExecutableOperation(document, operationName)];
  }
  return document.definitions.filter(
    (definition) => definition.kind === import_graphql.Kind.OPERATION_DEFINITION
  );
}
function getExecutableOperation(document, operationName) {
  const operations = document.definitions.filter(
    (definition) => definition.kind === import_graphql.Kind.OPERATION_DEFINITION
  );
  if (operationName) {
    const operation = operations.find((op) => op.name?.value === operationName);
    if (!operation) {
      throw new Error(`Operation "${operationName}" was not found.`);
    }
    return operation;
  }
  if (operations.length === 1) {
    return operations[0];
  }
  if (operations.length === 0) {
    throw new Error("Document does not contain an operation definition.");
  }
  throw new Error(
    "Operation name is required when a document contains multiple operations."
  );
}
function getOperationFileName(operation) {
  return operation.name?.value ?? "UnnamedOperation";
}
function validateOperationMockDirective(operation) {
  const mockDirective = getMockDirective(operation);
  if (!mockDirective) return;
  const args = getMockArguments(mockDirective);
  validateMockDirectiveArguments(args, `operation "${getOperationFileName(operation)}"`);
  if (args.valueArgument) {
    throw new Error("@mock(value:) cannot be applied to an operation root.");
  }
  if (!operation.name?.value) {
    throw new Error(
      "Operations that use @mock(variant:) must be named so their mock file can be resolved."
    );
  }
}
function validateMockDirectiveArgumentsInSelectionSet(selectionSet, operationOrFragmentName, fragments, spreadStack) {
  for (const selection of selectionSet.selections) {
    if (selection.kind === import_graphql.Kind.FIELD) {
      const mockDirective = getMockDirective(selection);
      if (mockDirective) {
        const args = getMockArguments(mockDirective);
        validateMockDirectiveArguments(
          args,
          `field "${getResponseKey(selection)}"`
        );
        if (args.valueArgument && selection.selectionSet) {
          throw new Error(
            `@mock(value:) cannot be applied to field "${getResponseKey(
              selection
            )}" because it has a selection set. Inline values are only valid for leaf fields.`
          );
        }
        if (args.variantArgument && !operationOrFragmentName) {
          throw new Error(
            `Field "${getResponseKey(
              selection
            )}" uses @mock(variant:) but its operation or fragment is unnamed.`
          );
        }
      }
      if (selection.selectionSet) {
        validateMockDirectiveArgumentsInSelectionSet(
          selection.selectionSet,
          operationOrFragmentName,
          fragments,
          spreadStack
        );
      }
    } else if (selection.kind === import_graphql.Kind.INLINE_FRAGMENT) {
      validateMockDirectiveArgumentsInSelectionSet(
        selection.selectionSet,
        operationOrFragmentName,
        fragments,
        spreadStack
      );
    } else if (selection.kind === import_graphql.Kind.FRAGMENT_SPREAD) {
      const fragmentName = selection.name.value;
      if (spreadStack.has(fragmentName)) continue;
      const fragment = fragments.get(fragmentName);
      if (!fragment) continue;
      validateMockDirectiveArgumentsInSelectionSet(
        fragment.selectionSet,
        fragment.name.value,
        fragments,
        /* @__PURE__ */ new Set([...spreadStack, fragmentName])
      );
    }
  }
}
function validateMockDirectiveArguments(args, location) {
  const hasVariant = args.variantArgument != null;
  const hasValue = args.valueArgument != null;
  if (hasVariant === hasValue) {
    throw new Error(
      `@mock on ${location} must provide exactly one of "variant" or "value".`
    );
  }
  if (args.variantArgument) {
    if (args.variantArgument.value.kind !== import_graphql.Kind.STRING) {
      throw new Error(
        `@mock(variant:) on ${location} must be a string literal. Variable-backed variants are not supported by this MockLink.`
      );
    }
    if (args.variantArgument.value.value.startsWith("__")) {
      throw new Error(
        `@mock(variant:) on ${location} must not start with "__"; that prefix is reserved.`
      );
    }
  }
  if (args.valueArgument && args.valueArgument.value.kind !== import_graphql.Kind.STRING) {
    throw new Error(`@mock(value:) on ${location} must be a string literal.`);
  }
}
function validateNoNestedMocks(selectionSet, fragments, isMockedByParent, spreadStack) {
  for (const selection of selectionSet.selections) {
    if (selection.kind === import_graphql.Kind.FIELD) {
      const fieldUsesMock = getMockDirective(selection) != null;
      if (isMockedByParent && fieldUsesMock) {
        throw new Error(
          `Nested @mock directives are not allowed. Field "${getResponseKey(
            selection
          )}" is inside another mocked field.`
        );
      }
      if (selection.selectionSet) {
        validateNoNestedMocks(
          selection.selectionSet,
          fragments,
          isMockedByParent || fieldUsesMock,
          spreadStack
        );
      }
    } else if (selection.kind === import_graphql.Kind.INLINE_FRAGMENT) {
      validateNoNestedMocks(
        selection.selectionSet,
        fragments,
        isMockedByParent,
        spreadStack
      );
    } else if (selection.kind === import_graphql.Kind.FRAGMENT_SPREAD) {
      const fragmentName = selection.name.value;
      if (spreadStack.has(fragmentName)) continue;
      const fragment = fragments.get(fragmentName);
      if (!fragment) continue;
      validateNoNestedMocks(
        fragment.selectionSet,
        fragments,
        isMockedByParent,
        /* @__PURE__ */ new Set([...spreadStack, fragmentName])
      );
    }
  }
}
function validateNonEmptyOperationRoot(document, operation) {
  if (getMockDirective(operation)) return;
  const transformed = transformMockedOperation(document);
  const transformedOperation = transformed.definitions.find(
    (definition) => definition.kind === import_graphql.Kind.OPERATION_DEFINITION && definition.name?.value === operation.name?.value && definition.operation === operation.operation
  );
  if (!transformedOperation?.selectionSet.selections.length) {
    throw new Error(
      `Operation "${getOperationFileName(
        operation
      )}" would have an empty root selection set after removing mocked selections. Add at least one unmocked root selection or use operation-level @mock.`
    );
  }
}
function collectFieldMocksFromSelectionSet({
  selectionSet,
  fragments,
  responsePath,
  ownerPath,
  mockFileName,
  fieldMocks,
  seenMocks,
  spreadStack
}) {
  for (const selection of selectionSet.selections) {
    if (selection.kind === import_graphql.Kind.FIELD) {
      const responseKey = getResponseKey(selection);
      const nextResponsePath = [...responsePath, responseKey];
      const nextOwnerPath = [...ownerPath, responseKey];
      const mockDirective = getMockDirective(selection);
      if (mockDirective) {
        const args = getMockArguments(mockDirective);
        const mockKey = `${mockFileName}:${nextOwnerPath.join(
          "."
        )}:${nextResponsePath.join(".")}`;
        if (!seenMocks.has(mockKey)) {
          seenMocks.add(mockKey);
          fieldMocks.push({
            variant: args.variant ?? "",
            ...args.value != null ? { value: args.value } : {},
            path: nextResponsePath,
            fieldName: selection.name.value,
            fieldPath: nextOwnerPath.join("."),
            mockFileName
          });
        }
        continue;
      }
      if (selection.selectionSet) {
        collectFieldMocksFromSelectionSet({
          selectionSet: selection.selectionSet,
          fragments,
          responsePath: nextResponsePath,
          ownerPath: nextOwnerPath,
          mockFileName,
          fieldMocks,
          seenMocks,
          spreadStack
        });
      }
    } else if (selection.kind === import_graphql.Kind.INLINE_FRAGMENT) {
      collectFieldMocksFromSelectionSet({
        selectionSet: selection.selectionSet,
        fragments,
        responsePath,
        ownerPath,
        mockFileName,
        fieldMocks,
        seenMocks,
        spreadStack
      });
    } else if (selection.kind === import_graphql.Kind.FRAGMENT_SPREAD) {
      const fragmentName = selection.name.value;
      if (spreadStack.has(fragmentName)) continue;
      const fragment = fragments.get(fragmentName);
      if (!fragment) continue;
      collectFieldMocksFromSelectionSet({
        selectionSet: fragment.selectionSet,
        fragments,
        responsePath,
        ownerPath: [],
        mockFileName: fragment.name.value,
        fieldMocks,
        seenMocks,
        spreadStack: /* @__PURE__ */ new Set([...spreadStack, fragmentName])
      });
    }
  }
}
function pruneEmptySelectionSets(document) {
  return (0, import_graphql.visit)(document, {
    Field: {
      leave(node) {
        if (node.selectionSet && node.selectionSet.selections.length === 0) {
          return null;
        }
        return void 0;
      }
    },
    InlineFragment: {
      leave(node) {
        if (node.selectionSet.selections.length === 0) {
          return null;
        }
        return void 0;
      }
    },
    FragmentDefinition: {
      leave(node) {
        if (node.selectionSet.selections.length === 0) {
          return null;
        }
        return void 0;
      }
    }
  });
}
function removeSpreadsToMissingFragments(document) {
  const fragmentNames = new Set(
    document.definitions.filter(
      (definition) => definition.kind === import_graphql.Kind.FRAGMENT_DEFINITION
    ).map((definition) => definition.name.value)
  );
  return (0, import_graphql.visit)(document, {
    FragmentSpread(node) {
      if (!fragmentNames.has(node.name.value)) {
        return null;
      }
      return void 0;
    }
  });
}
function removeUnusedFragments(document) {
  const fragments = getFragmentMap(document);
  const usedFragments = /* @__PURE__ */ new Set();
  for (const definition of document.definitions) {
    if (definition.kind === import_graphql.Kind.OPERATION_DEFINITION) {
      collectReachableFragments(definition.selectionSet, fragments, usedFragments);
    }
  }
  return (0, import_graphql.visit)(document, {
    FragmentDefinition(node) {
      if (!usedFragments.has(node.name.value)) {
        return null;
      }
      return void 0;
    }
  });
}
function collectReachableFragments(selectionSet, fragments, usedFragments) {
  for (const selection of selectionSet.selections) {
    if (selection.kind === import_graphql.Kind.FRAGMENT_SPREAD) {
      const fragmentName = selection.name.value;
      if (usedFragments.has(fragmentName)) continue;
      usedFragments.add(fragmentName);
      const fragment = fragments.get(fragmentName);
      if (fragment) {
        collectReachableFragments(fragment.selectionSet, fragments, usedFragments);
      }
    } else if ("selectionSet" in selection && selection.selectionSet) {
      collectReachableFragments(selection.selectionSet, fragments, usedFragments);
    }
  }
}
function removeUnusedVariables(document) {
  const fragments = getFragmentMap(document);
  return (0, import_graphql.visit)(document, {
    OperationDefinition(node) {
      if (!node.variableDefinitions?.length) {
        return void 0;
      }
      const usedVariables = collectUsedVariablesForOperation(node, fragments);
      const variableDefinitions = node.variableDefinitions.filter(
        (definition) => usedVariables.has(definition.variable.name.value)
      );
      if (variableDefinitions.length === node.variableDefinitions.length) {
        return void 0;
      }
      return {
        ...node,
        variableDefinitions
      };
    }
  });
}
function collectUsedVariablesForOperation(operation, fragments) {
  const reachableFragments = /* @__PURE__ */ new Set();
  collectReachableFragments(operation.selectionSet, fragments, reachableFragments);
  const definitions = [
    operation,
    ...[...reachableFragments].map((fragmentName) => fragments.get(fragmentName)).filter((fragment) => fragment != null)
  ];
  const usedVariables = /* @__PURE__ */ new Set();
  (0, import_graphql.visit)({ kind: import_graphql.Kind.DOCUMENT, definitions }, {
    VariableDefinition() {
      return false;
    },
    Variable(node) {
      usedVariables.add(node.name.value);
      return void 0;
    }
  });
  return usedVariables;
}
function getFragmentMap(document) {
  const fragments = /* @__PURE__ */ new Map();
  for (const definition of document.definitions) {
    if (definition.kind === import_graphql.Kind.FRAGMENT_DEFINITION) {
      fragments.set(definition.name.value, definition);
    }
  }
  return fragments;
}
function getMockDirective(node) {
  return node.directives?.find((directive) => directive.name.value === "mock");
}
function getMockArguments(directive) {
  const variantArgument = directive.arguments?.find(
    (argument) => argument.name.value === "variant"
  );
  const valueArgument = directive.arguments?.find(
    (argument) => argument.name.value === "value"
  );
  return {
    variantArgument,
    valueArgument,
    ...variantArgument?.value.kind === import_graphql.Kind.STRING ? { variant: variantArgument.value.value } : {},
    ...valueArgument?.value.kind === import_graphql.Kind.STRING ? { value: valueArgument.value.value } : {}
  };
}
function getResponseKey(selection) {
  if (selection.kind !== import_graphql.Kind.FIELD) {
    return "";
  }
  return selection.alias?.value ?? selection.name.value;
}
function isJsonNumber(value) {
  return /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value);
}

// src/MockLink.ts
var MockLink = class extends import_client.ApolloLink {
  mockRegistry;
  constructor(options) {
    super();
    this.mockRegistry = options.mockRegistry;
  }
  request(operation, forward) {
    const { query, operationName } = operation;
    validateMockedOperation(query, operationName);
    const mockInfo = extractMockDirectives(query, operationName);
    if (mockInfo.operationMock) {
      return new import_client.Observable((observer) => {
        try {
          const response = this.getMockedOperationResponse(
            mockInfo.operationMock.mockFileName,
            mockInfo.operationMock.variant,
            mockInfo.operationMock.fieldPath
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
    const transformedQuery = transformMockedOperation(query);
    operation.query = transformedQuery;
    return new import_client.Observable((observer) => {
      const subscription = forward(operation).subscribe({
        next: (result) => {
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
        error: (error) => observer.error(error),
        complete: () => observer.complete()
      });
      return () => subscription.unsubscribe();
    });
  }
  /**
   * Get fully mocked operation response
   */
  getMockedOperationResponse(operationName, variant, expectedPath) {
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
    this.assertMockVariant(mockVariant, variant, operationName, expectedPath);
    return {
      data: this.cloneValue(mockVariant.data),
      errors: mockVariant.errors,
      extensions: mockVariant.extensions
    };
  }
  /**
   * Merge mock data into server response
   */
  mergeMockData(result, fieldMocks) {
    if (fieldMocks.length === 0) {
      return result;
    }
    const mergedData = result.data == null ? {} : this.cloneValue(result.data);
    const mergedErrors = result.errors ? [...result.errors] : [];
    const mergedExtensions = result.extensions ? { ...result.extensions } : {};
    for (const mockInfo of fieldMocks) {
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
          `No mock file found for "${mockInfo.mockFileName}". Expected a mock file at __graphql_mocks__/${mockInfo.mockFileName}.json`
        );
      }
      const mockVariant = mockFile[mockInfo.variant];
      if (!mockVariant) {
        const availableVariants = Object.keys(mockFile).filter((k) => !k.startsWith("__"));
        throw new Error(
          `Mock variant "${mockInfo.variant}" not found for "${mockInfo.mockFileName}". Available variants: ${availableVariants.join(", ")}`
        );
      }
      this.assertMockVariant(
        mockVariant,
        mockInfo.variant,
        mockInfo.mockFileName,
        mockInfo.fieldPath
      );
      this.setValueAtPath(
        mergedData,
        mockInfo.path,
        this.cloneValue(mockVariant.data)
      );
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
  assertMockVariant(mockVariant, variant, mockFileName, expectedPath) {
    const allowedKeys = /* @__PURE__ */ new Set([
      "data",
      "errors",
      "extensions",
      "__path__",
      "__description__",
      "__metadata__"
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
  cloneValue(value) {
    if (Array.isArray(value)) {
      return value.map((item) => this.cloneValue(item));
    }
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, nestedValue]) => [
          key,
          this.cloneValue(nestedValue)
        ])
      );
    }
    return value;
  }
  /**
   * Set a value at a nested path in an object
   */
  setValueAtPath(obj, path, value) {
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
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  MockLink
});
//# sourceMappingURL=index.cjs.map