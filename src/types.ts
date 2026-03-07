/**
 * Structure of a single mock variant within a mock file.
 */
export interface MockVariant {
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
export type MockFile = Record<string, MockVariant>;

/**
 * A registry mapping operation names to their mock files.
 */
export interface MockRegistry {
  [operationName: string]: MockFile;
}

/**
 * Internal representation of a detected @mock directive.
 */
export interface MockDirectiveInfo {
  variant: string;
  path: string[];
  fieldName: string;
  schemaCoordinate: string;
}
