/**
 * Agent utilities for the index-js project
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../logger';
import { scaleB64Image } from '../browser/utils';
import { v4 as uuidv4 } from 'uuid';
import { getDirname } from '../utils';
/**
 * Load an image from the demo_images directory and return it as a base64 string.
 * 
 * @param imageName Name of the image file (including extension)
 * @returns Base64 encoded string of the image
 */
export const loadDemoImageAsB64 = async (imageName: string): Promise<string> => {
  try {
    // Standard path in the assets directory
    const standardPath = path.join(getDirname(), '..', 'assets', 'demo_images', imageName);

    // Fallback paths for different environments and tests
    const fallbackPaths = [
      path.join(getDirname(), '..', '..', 'assets', 'demo_images', imageName), // For tests
      path.join(process.cwd(), 'assets', 'demo_images', imageName), // Using cwd
      path.join(process.cwd(), 'index-js', 'assets', 'demo_images', imageName), // Absolute path
    ];

    // Try the standard path first
    try {
      const imgBuffer = await fs.promises.readFile(standardPath);
      const b64 = imgBuffer.toString('base64');
      return await scaleB64Image(b64, 0.75);
    } catch (e) {
      // If standard path fails, try fallbacks
      for (const fallbackPath of fallbackPaths) {
        try {
          const imgBuffer = await fs.promises.readFile(fallbackPath);
          const b64 = imgBuffer.toString('base64');
          return await scaleB64Image(b64, 0.75);
        } catch {
          // Continue to the next fallback
          continue;
        }
      }

      // If all paths fail, throw the original error
      throw e;
    }
  } catch (e) {
    logger.error(`Error loading demo image ${imageName}: ${e}`);
    throw e;
  }
}

/**
 * Custom JTD schema types
 */
export type JTDType = 'string'
  | 'int32' | 'float64' | 'boolean' | 'array' | 'object';

export interface JTDProperty {
  type: JTDType;
  enum?: string[];
  items?: JTDProperty;
  properties?: Record<string, JTDProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface JTDSchema {
  type: JTDType;
  properties: Record<string, JTDProperty>;
  required: string[];
  additionalProperties: boolean;
}

/**
 * Convert a TypeScript type to a custom JSON Typedef-like schema
 * with proper array and object handling.
 * 
 * @param modelClass The model class to convert
 * @returns A custom JTD schema
 */
export const typeToCustomJtd = (modelClass: any): JTDSchema => {
  /**
   * Convert a TypeScript type to a JTD type
   */
  const typeToJtdType = (annotation: any): JTDProperty => {
    // String type
    if (annotation === String) {
      return { type: 'string' };
    }
    // Number type
    else if (annotation === Number) {
      // In TypeScript, we don't differentiate between int32 and float64 at runtime
      return { type: 'float64' };
    }
    // Boolean type
    else if (annotation === Boolean) {
      return { type: 'boolean' };
    }
    // Enum type - this is more complex in TypeScript and would need runtime metadata
    else if (typeof annotation === 'object' && annotation.hasOwnProperty('enum')) {
      return {
        type: 'string',
        enum: Object.values(annotation).filter(v => typeof v === 'string')
      };
    }
    // Default to string for unknown types
    else {
      return { type: 'string' };
    }
  }

  /**
   * Process a model type recursively
   */
  const processModel = (model: any): JTDSchema => {
    const modelSchema: JTDSchema = {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false
    };

    // Get property metadata if available
    const properties = Object.getOwnPropertyDescriptors(model.prototype || model);

    // Process each property
    for (const [name, property] of Object.entries(properties)) {
      // Skip methods and internal properties
      if (typeof property.value === 'function' || name.startsWith('_')) {
        continue;
      }

      // Get property type information (this is simplified - TypeScript loses type info at runtime)
      const propertyType = property.value?.constructor || String;

      // Handle array types
      if (Array.isArray(propertyType)) {
        const itemType = propertyType[0]?.constructor || String;

        if (typeof itemType === 'object' && itemType.hasOwnProperty('enum')) {
          // Array of enums
          modelSchema.properties[name] = {
            type: 'array',
            items: {
              type: 'string',
              enum: Object.values(itemType).filter(v => typeof v === 'string')
            }
          };
        } else if (typeof itemType === 'object') {
          // Array of objects
          modelSchema.properties[name] = {
            type: 'array',
            items: processModel(itemType)
          };
        } else {
          // Array of primitives
          modelSchema.properties[name] = {
            type: 'array',
            items: typeToJtdType(itemType)
          };
        }
      }
      // Handle enum types
      else if (typeof propertyType === 'object' && propertyType.hasOwnProperty('enum')) {
        modelSchema.properties[name] = {
          type: 'string',
          enum: Object.values(propertyType).filter(v => typeof v === 'string')
        };
      }
      // Handle object types
      else if (typeof propertyType === 'object') {
        modelSchema.properties[name] = processModel(propertyType);
      }
      // Handle primitive types
      else {
        modelSchema.properties[name] = typeToJtdType(propertyType);
      }

      // Handle required fields (simplified - TypeScript doesn't maintain this at runtime)
      // In a real implementation, you'd need decorators or metadata
      if (property.value?.required) {
        modelSchema.required.push(name);
      }
    }

    return modelSchema;
  }

  return processModel(modelClass);
}

export type StringUUID = `${string}-${string}-${string}-${string}-${string}`;

export const isStringUUID = (id: string): id is StringUUID =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);

export const NIL_UUID: StringUUID = '00000000-0000-0000-0000-000000000000';

export const newUUID = (): StringUUID => {
  // crypto.randomUUID is available in most of the modern browsers and node,
  // but is not available in "insecure" contexts, e.g. not https, not localhost
  // so we fallback to uuidv4 in those cases, which is less secure, but works
  // just fine.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  } else {
    return uuidv4() as `${string}-${string}-${string}-${string}-${string}`;
  }
};

export const otelSpanIdToUUID = (spanId: string): string => {
  let id = spanId.toLowerCase();
  if (id.startsWith('0x')) {
    id = id.slice(2);
  }
  if (id.length !== 16) {
    logger.warn(`Span ID ${spanId} is not 16 hex chars long. ` +
      'This is not a valid OpenTelemetry span ID.');
  }

  if (!/^[0-9a-f]+$/.test(id)) {
    logger.error(`Span ID ${spanId} is not a valid hex string. ` +
      'Generating a random UUID instead.');
    return newUUID();
  }

  return id.padStart(32, '0').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
};

export const otelTraceIdToUUID = (traceId: string): string => {
  let id = traceId.toLowerCase();
  if (id.startsWith('0x')) {
    id = id.slice(2);
  }
  if (id.length !== 32) {
    logger.warn(`Trace ID ${traceId} is not 32 hex chars long. ` +
      'This is not a valid OpenTelemetry trace ID.');
  }
  if (!/^[0-9a-f]+$/.test(id)) {
    logger.error(`Trace ID ${traceId} is not a valid hex string. ` +
      'Generating a random UUID instead.');
    return newUUID();
  }

  return id.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
};