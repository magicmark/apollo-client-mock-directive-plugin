import {
  Kind,
  print,
  visit,
  type ArgumentNode,
  type DirectiveNode,
  type DocumentNode,
  type FieldNode,
  type FragmentDefinitionNode,
  type OperationDefinitionNode,
  type SelectionNode,
  type SelectionSetNode,
} from "graphql";
import type { MockDirectiveInfo } from "./types";

type FragmentMap = Map<string, FragmentDefinitionNode>;

interface MockDirectiveArguments {
  variant?: string;
  value?: string;
  variantArgument?: ArgumentNode;
  valueArgument?: ArgumentNode;
}

export interface ExtractedMockDirectives {
  operationMock: MockDirectiveInfo | null;
  fieldMocks: MockDirectiveInfo[];
}

export function validateMockedOperation(
  document: DocumentNode,
  operationName?: string | null
): void {
  const fragments = getFragmentMap(document);
  const operations = getOperationsToValidate(document, operationName);

  for (const operation of operations) {
    validateOperationMockDirective(operation);
    validateMockDirectiveArgumentsInSelectionSet(
      operation.selectionSet,
      operation.name?.value,
      fragments,
      new Set()
    );
    validateNoNestedMocks(operation.selectionSet, fragments, false, new Set());
    validateNonEmptyOperationRoot(document, operation);
  }
}

export function extractMockDirectives(
  document: DocumentNode,
  operationName?: string | null
): ExtractedMockDirectives {
  const operation = getExecutableOperation(document, operationName);
  const fragments = getFragmentMap(document);
  const operationFileName = getOperationFileName(operation);
  const operationMockDirective = getMockDirective(operation);
  const operationMock = operationMockDirective
    ? {
        variant: getMockArguments(operationMockDirective).variant ?? "",
        path: [],
        fieldName: operation.operation,
        fieldPath: getRootOperationType(operation),
        mockFileName: operationFileName,
      }
    : null;

  if (operationMock) {
    return { operationMock, fieldMocks: [] };
  }

  const fieldMocks: MockDirectiveInfo[] = [];
  const seenMocks = new Set<string>();

  collectFieldMocksFromSelectionSet({
    selectionSet: operation.selectionSet,
    fragments,
    responsePath: [],
    ownerPath: [],
    mockFileName: operationFileName,
    fieldMocks,
    seenMocks,
    spreadStack: new Set(),
  });

  return { operationMock: null, fieldMocks };
}

export function transformMockedOperation(document: DocumentNode): DocumentNode {
  let transformed = visit(document, {
    Field(node) {
      if (getMockDirective(node)) {
        return null;
      }
      return undefined;
    },
  });

  let previous = "";
  while (previous !== print(transformed)) {
    previous = print(transformed);
    transformed = pruneEmptySelectionSets(transformed);
    transformed = removeSpreadsToMissingFragments(transformed);
    transformed = removeUnusedFragments(transformed);
    transformed = removeUnusedVariables(transformed);
  }

  return transformed;
}

export function coerceInlineValue(
  value: string
): string | number | boolean | null {
  if (value === "null") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (isJsonNumber(value)) return Number(value);
  return value;
}

export function getRootOperationType(
  operation: OperationDefinitionNode
): "Query" | "Mutation" | "Subscription" {
  if (operation.operation === "mutation") return "Mutation";
  if (operation.operation === "subscription") return "Subscription";
  return "Query";
}

function getOperationsToValidate(
  document: DocumentNode,
  operationName?: string | null
): OperationDefinitionNode[] {
  if (operationName) {
    return [getExecutableOperation(document, operationName)];
  }

  return document.definitions.filter(
    (definition): definition is OperationDefinitionNode =>
      definition.kind === Kind.OPERATION_DEFINITION
  );
}

function getExecutableOperation(
  document: DocumentNode,
  operationName?: string | null
): OperationDefinitionNode {
  const operations = document.definitions.filter(
    (definition): definition is OperationDefinitionNode =>
      definition.kind === Kind.OPERATION_DEFINITION
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

function getOperationFileName(operation: OperationDefinitionNode): string {
  return operation.name?.value ?? "UnnamedOperation";
}

function validateOperationMockDirective(operation: OperationDefinitionNode): void {
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

function validateMockDirectiveArgumentsInSelectionSet(
  selectionSet: SelectionSetNode,
  operationOrFragmentName: string | undefined,
  fragments: FragmentMap,
  spreadStack: Set<string>
): void {
  for (const selection of selectionSet.selections) {
    if (selection.kind === Kind.FIELD) {
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
    } else if (selection.kind === Kind.INLINE_FRAGMENT) {
      validateMockDirectiveArgumentsInSelectionSet(
        selection.selectionSet,
        operationOrFragmentName,
        fragments,
        spreadStack
      );
    } else if (selection.kind === Kind.FRAGMENT_SPREAD) {
      const fragmentName = selection.name.value;
      if (spreadStack.has(fragmentName)) continue;
      const fragment = fragments.get(fragmentName);
      if (!fragment) continue;

      validateMockDirectiveArgumentsInSelectionSet(
        fragment.selectionSet,
        fragment.name.value,
        fragments,
        new Set([...spreadStack, fragmentName])
      );
    }
  }
}

function validateMockDirectiveArguments(
  args: MockDirectiveArguments,
  location: string
): void {
  const hasVariant = args.variantArgument != null;
  const hasValue = args.valueArgument != null;

  if (hasVariant === hasValue) {
    throw new Error(
      `@mock on ${location} must provide exactly one of "variant" or "value".`
    );
  }

  if (args.variantArgument) {
    if (args.variantArgument.value.kind !== Kind.STRING) {
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

  if (args.valueArgument && args.valueArgument.value.kind !== Kind.STRING) {
    throw new Error(`@mock(value:) on ${location} must be a string literal.`);
  }
}

function validateNoNestedMocks(
  selectionSet: SelectionSetNode,
  fragments: FragmentMap,
  isMockedByParent: boolean,
  spreadStack: Set<string>
): void {
  for (const selection of selectionSet.selections) {
    if (selection.kind === Kind.FIELD) {
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
    } else if (selection.kind === Kind.INLINE_FRAGMENT) {
      validateNoNestedMocks(
        selection.selectionSet,
        fragments,
        isMockedByParent,
        spreadStack
      );
    } else if (selection.kind === Kind.FRAGMENT_SPREAD) {
      const fragmentName = selection.name.value;
      if (spreadStack.has(fragmentName)) continue;
      const fragment = fragments.get(fragmentName);
      if (!fragment) continue;

      validateNoNestedMocks(
        fragment.selectionSet,
        fragments,
        isMockedByParent,
        new Set([...spreadStack, fragmentName])
      );
    }
  }
}

function validateNonEmptyOperationRoot(
  document: DocumentNode,
  operation: OperationDefinitionNode
): void {
  if (getMockDirective(operation)) return;

  const transformed = transformMockedOperation(document);
  const transformedOperation = transformed.definitions.find(
    (definition): definition is OperationDefinitionNode =>
      definition.kind === Kind.OPERATION_DEFINITION &&
      definition.name?.value === operation.name?.value &&
      definition.operation === operation.operation
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
  spreadStack,
}: {
  selectionSet: SelectionSetNode;
  fragments: FragmentMap;
  responsePath: string[];
  ownerPath: string[];
  mockFileName: string;
  fieldMocks: MockDirectiveInfo[];
  seenMocks: Set<string>;
  spreadStack: Set<string>;
}): void {
  for (const selection of selectionSet.selections) {
    if (selection.kind === Kind.FIELD) {
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
            ...(args.value != null ? { value: args.value } : {}),
            path: nextResponsePath,
            fieldName: selection.name.value,
            fieldPath: nextOwnerPath.join("."),
            mockFileName,
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
          spreadStack,
        });
      }
    } else if (selection.kind === Kind.INLINE_FRAGMENT) {
      collectFieldMocksFromSelectionSet({
        selectionSet: selection.selectionSet,
        fragments,
        responsePath,
        ownerPath,
        mockFileName,
        fieldMocks,
        seenMocks,
        spreadStack,
      });
    } else if (selection.kind === Kind.FRAGMENT_SPREAD) {
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
        spreadStack: new Set([...spreadStack, fragmentName]),
      });
    }
  }
}

function pruneEmptySelectionSets(document: DocumentNode): DocumentNode {
  return visit(document, {
    Field: {
      leave(node) {
        if (node.selectionSet && node.selectionSet.selections.length === 0) {
          return null;
        }
        return undefined;
      },
    },
    InlineFragment: {
      leave(node) {
        if (node.selectionSet.selections.length === 0) {
          return null;
        }
        return undefined;
      },
    },
    FragmentDefinition: {
      leave(node) {
        if (node.selectionSet.selections.length === 0) {
          return null;
        }
        return undefined;
      },
    },
  });
}

function removeSpreadsToMissingFragments(document: DocumentNode): DocumentNode {
  const fragmentNames = new Set(
    document.definitions
      .filter(
        (definition): definition is FragmentDefinitionNode =>
          definition.kind === Kind.FRAGMENT_DEFINITION
      )
      .map((definition) => definition.name.value)
  );

  return visit(document, {
    FragmentSpread(node) {
      if (!fragmentNames.has(node.name.value)) {
        return null;
      }
      return undefined;
    },
  });
}

function removeUnusedFragments(document: DocumentNode): DocumentNode {
  const fragments = getFragmentMap(document);
  const usedFragments = new Set<string>();

  for (const definition of document.definitions) {
    if (definition.kind === Kind.OPERATION_DEFINITION) {
      collectReachableFragments(definition.selectionSet, fragments, usedFragments);
    }
  }

  return visit(document, {
    FragmentDefinition(node) {
      if (!usedFragments.has(node.name.value)) {
        return null;
      }
      return undefined;
    },
  });
}

function collectReachableFragments(
  selectionSet: SelectionSetNode,
  fragments: FragmentMap,
  usedFragments: Set<string>
): void {
  for (const selection of selectionSet.selections) {
    if (selection.kind === Kind.FRAGMENT_SPREAD) {
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

function removeUnusedVariables(document: DocumentNode): DocumentNode {
  const fragments = getFragmentMap(document);

  return visit(document, {
    OperationDefinition(node) {
      if (!node.variableDefinitions?.length) {
        return undefined;
      }

      const usedVariables = collectUsedVariablesForOperation(node, fragments);
      const variableDefinitions = node.variableDefinitions.filter((definition) =>
        usedVariables.has(definition.variable.name.value)
      );

      if (variableDefinitions.length === node.variableDefinitions.length) {
        return undefined;
      }

      return {
        ...node,
        variableDefinitions,
      };
    },
  });
}

function collectUsedVariablesForOperation(
  operation: OperationDefinitionNode,
  fragments: FragmentMap
): Set<string> {
  const reachableFragments = new Set<string>();
  collectReachableFragments(operation.selectionSet, fragments, reachableFragments);

  const definitions = [
    operation,
    ...[...reachableFragments]
      .map((fragmentName) => fragments.get(fragmentName))
      .filter((fragment): fragment is FragmentDefinitionNode => fragment != null),
  ];
  const usedVariables = new Set<string>();

  visit({ kind: Kind.DOCUMENT, definitions }, {
    VariableDefinition() {
      return false;
    },
    Variable(node) {
      usedVariables.add(node.name.value);
      return undefined;
    },
  });

  return usedVariables;
}

function getFragmentMap(document: DocumentNode): FragmentMap {
  const fragments = new Map<string, FragmentDefinitionNode>();

  for (const definition of document.definitions) {
    if (definition.kind === Kind.FRAGMENT_DEFINITION) {
      fragments.set(definition.name.value, definition);
    }
  }

  return fragments;
}

function getMockDirective(
  node: FieldNode | OperationDefinitionNode
): DirectiveNode | undefined {
  return node.directives?.find((directive) => directive.name.value === "mock");
}

function getMockArguments(directive: DirectiveNode): MockDirectiveArguments {
  const variantArgument = directive.arguments?.find(
    (argument) => argument.name.value === "variant"
  );
  const valueArgument = directive.arguments?.find(
    (argument) => argument.name.value === "value"
  );

  return {
    variantArgument,
    valueArgument,
    ...(variantArgument?.value.kind === Kind.STRING
      ? { variant: variantArgument.value.value }
      : {}),
    ...(valueArgument?.value.kind === Kind.STRING
      ? { value: valueArgument.value.value }
      : {}),
  };
}

function getResponseKey(selection: SelectionNode): string {
  if (selection.kind !== Kind.FIELD) {
    return "";
  }

  return selection.alias?.value ?? selection.name.value;
}

function isJsonNumber(value: string): boolean {
  return /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value);
}
