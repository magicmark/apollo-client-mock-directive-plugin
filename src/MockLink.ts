import { ApolloLink, Observable } from "@apollo/client";
import type { FetchResult, NextLink, Operation } from "@apollo/client";
import { Kind, visit } from "graphql";
import type {
  DirectiveNode,
  DocumentNode,
  OperationDefinitionNode,
} from "graphql";
import type { MockDirectiveInfo, MockRegistry, MockVariant } from "./types";

export interface MockLinkOptions {
  mockRegistry: MockRegistry;
}

interface ParsedMocks {
  operationVariant: string | null;
  fieldMocks: MockDirectiveInfo[];
}

export class MockLink extends ApolloLink {
  private readonly mockRegistry: MockRegistry;

  constructor(options: MockLinkOptions) {
    super();
    this.mockRegistry = options.mockRegistry;
  }

  request(
    operation: Operation,
    forward?: NextLink
  ): Observable<FetchResult> | null {
    const operationName =
      operation.operationName || this.getOperationName(operation.query);
    const mocks = this.parseMocks(operation.query, operationName);

    if (mocks.operationVariant) {
      return new Observable((observer) => {
        try {
          observer.next(
            this.toFetchResult(
              this.getMockVariant(operationName, mocks.operationVariant)
            )
          );
          observer.complete();
        } catch (error) {
          observer.error(error);
        }
      });
    }

    if (!forward) {
      return null;
    }

    if (mocks.fieldMocks.length === 0) {
      return forward(operation);
    }

    operation.query = this.stripMockedFields(operation.query);

    return new Observable((observer) => {
      const subscription = forward(operation).subscribe({
        next: (result) => {
          try {
            observer.next(this.mergeFieldMocks(result, operationName, mocks.fieldMocks));
          } catch (error) {
            observer.error(error);
          }
        },
        error: (error) => observer.error(error),
        complete: () => observer.complete(),
      });

      return () => subscription.unsubscribe();
    });
  }

  private getOperationName(query: DocumentNode): string {
    for (const definition of query.definitions) {
      if (definition.kind === Kind.OPERATION_DEFINITION) {
        return definition.name?.value || "UnnamedOperation";
      }
    }

    return "UnnamedOperation";
  }

  private parseMocks(query: DocumentNode, targetOperationName: string): ParsedMocks {
    let operationVariant: string | null = null;
    const fieldMocks: MockDirectiveInfo[] = [];
    const pathStack: string[] = [];
    let inTargetOperation = false;

    visit(query, {
      OperationDefinition: {
        enter: (node: OperationDefinitionNode) => {
          const isTargetOperation =
            !node.name || node.name.value === targetOperationName;

          if (!isTargetOperation) {
            return false;
          }

          inTargetOperation = true;
          operationVariant = this.getDirectiveArgument(node.directives, "variant");

          if (!operationVariant) {
            operationVariant = this.getDirectiveArgument(node.directives, "name");
          }

          return undefined;
        },
        leave: () => {
          inTargetOperation = false;
          pathStack.length = 0;
        },
      },
      Field: {
        enter: (node) => {
          if (!inTargetOperation) {
            return;
          }

          const responseFieldName = node.alias?.value || node.name.value;
          pathStack.push(responseFieldName);

          if (operationVariant) {
            return;
          }

          let variant = this.getDirectiveArgument(node.directives, "variant");
          if (!variant) {
            variant = this.getDirectiveArgument(node.directives, "name");
          }

          if (!variant) {
            return;
          }

          fieldMocks.push({
            variant,
            path: [...pathStack],
          });
        },
        leave: () => {
          if (inTargetOperation) {
            pathStack.pop();
          }
        },
      },
    });

    return { operationVariant, fieldMocks };
  }

  private getDirectiveArgument(
    directives: ReadonlyArray<DirectiveNode> | undefined,
    name: string
  ): string | null {
    const directive = directives?.find((item) => item.name.value === "mock");
    const argument = directive?.arguments?.find((item) => item.name.value === name);

    if (!argument || argument.value.kind !== Kind.STRING) {
      return null;
    }

    return argument.value.value;
  }

  private stripMockedFields(query: DocumentNode): DocumentNode {
    return visit(query, {
      Field(node) {
        if (node.directives?.some((directive) => directive.name.value === "mock")) {
          return null;
        }
      },
    });
  }

  private getMockVariant(operationName: string, variantName: string): MockVariant {
    const mockFile = this.mockRegistry[operationName];

    if (!mockFile) {
      throw new Error(
        `No mock file found for operation "${operationName}". ` +
          `Expected __graphql_mocks__/${operationName}.json`
      );
    }

    const variant = mockFile[variantName];

    if (!variant) {
      const availableVariants = Object.keys(mockFile).join(", ") || "(none)";
      throw new Error(
        `Mock variant "${variantName}" not found for operation "${operationName}". ` +
          `Available variants: ${availableVariants}`
      );
    }

    return variant;
  }

  private toFetchResult(mock: MockVariant): FetchResult {
    return {
      data: mock.data,
      errors: mock.errors,
      extensions: mock.extensions,
    };
  }

  private mergeFieldMocks(
    result: FetchResult,
    operationName: string,
    fieldMocks: MockDirectiveInfo[]
  ): FetchResult {
    if (!result.data || typeof result.data !== "object") {
      return result;
    }

    const data = { ...(result.data as Record<string, unknown>) };
    const errors: NonNullable<FetchResult["errors"]> = result.errors
      ? [...result.errors]
      : [];
    const extensions: NonNullable<FetchResult["extensions"]> = result.extensions
      ? { ...result.extensions }
      : {};

    for (const fieldMock of fieldMocks) {
      const variant = this.getMockVariant(operationName, fieldMock.variant);

      this.setValueAtPath(data, fieldMock.path, variant.data);

      if (variant.errors) {
        errors.push(...variant.errors);
      }

      if (variant.extensions) {
        Object.assign(extensions, variant.extensions);
      }
    }

    return {
      ...result,
      data,
      errors: errors.length > 0 ? errors : undefined,
      extensions: Object.keys(extensions).length > 0 ? extensions : undefined,
    };
  }

  private setValueAtPath(
    root: Record<string, unknown>,
    path: string[],
    value: unknown
  ): void {
    if (path.length === 0) {
      return;
    }

    let current: Record<string, unknown> = root;

    for (let index = 0; index < path.length - 1; index += 1) {
      const segment = path[index];
      const existing = current[segment];

      if (existing && typeof existing === "object" && !Array.isArray(existing)) {
        current = existing as Record<string, unknown>;
        continue;
      }

      const next: Record<string, unknown> = {};
      current[segment] = next;
      current = next;
    }

    current[path[path.length - 1]] = value;
  }
}
