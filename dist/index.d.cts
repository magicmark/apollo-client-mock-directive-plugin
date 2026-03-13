import { ApolloLink, Operation, Observable, FetchResult } from '@apollo/client';

/**
 * Structure of a single mock variant within a mock file.
 */
interface MockVariant {
    data: any;
    errors?: any[];
    extensions?: Record<string, any>;
    __appliesTo__: string;
    __description__?: string;
    __metadata__?: Record<string, any>;
}
/**
 * A mock file is a record of variant names to their mock data.
 */
type MockFile = Record<string, MockVariant>;
/**
 * A registry mapping operation names to their mock files.
 */
interface MockRegistry {
    [operationName: string]: MockFile;
}
/**
 * Internal representation of a detected @mock directive.
 */
interface MockDirectiveInfo {
    variant: string;
    value?: string;
    path: string[];
    fieldName: string;
    schemaCoordinate: string;
}

interface MockLinkOptions {
    mockRegistry: MockRegistry;
}
/**
 * MockLink implements the @mock directive specification for Apollo Client.
 *
 * It intercepts GraphQL operations, detects @mock directives, strips mocked
 * fields from server requests, and merges mock data into responses.
 */
declare class MockLink extends ApolloLink {
    private mockRegistry;
    constructor(options: MockLinkOptions);
    request(operation: Operation, forward: any): Observable<FetchResult>;
    /**
     * Extract @mock directives from the operation
     */
    private extractMockDirectives;
    /**
     * Get the value of a directive argument
     */
    private getDirectiveArgument;
    /**
     * Strip @mock directives and mocked fields from query
     *
     * Per the spec: "the client must transform the document to remove any
     * selections which have `@mock` applied before sending the request to the server"
     *
     * This implementation removes both the directive and the entire field selection.
     */
    private stripMockedFields;
    /**
     * Get fully mocked operation response
     */
    private getMockedOperationResponse;
    /**
     * Merge mock data into server response
     */
    private mergeMockData;
    /**
     * Coerce a string value to its appropriate scalar type.
     */
    private coerceValue;
    /**
     * Set a value at a nested path in an object
     */
    private setValueAtPath;
}

export { type MockDirectiveInfo, type MockFile, MockLink, type MockLinkOptions, type MockRegistry, type MockVariant };
