/**
 * Tool System Type Definitions & Zod Schema Converters.
 *
 * Defines tool contracts, execution contexts, and isomorphic JSON schema reflection.
 */

import { z } from "zod";
import type { ToolRiskTier } from "@nanoforge/protocol";
import type { CancellationToken } from "../cancellation/types";

export interface ToolExecutionContext {
  workspaceRoot: string;
  cancellationToken: CancellationToken;
  callId: string;
  turnIndex: number;
  sessionId: string;
  env?: Record<string, string>;
}

export interface Tool<TParams = any, TResult = any> {
  readonly name: string;
  readonly description: string;
  readonly schema: z.ZodType<TParams>;
  readonly riskTier: ToolRiskTier;
  execute(params: TParams, context: ToolExecutionContext): Promise<TResult>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/**
 * Pure isomorphic Zod to JSON Schema converter for tool function calling.
 */
export function zodToJsonSchemaShim(schema: z.ZodType): Record<string, unknown> {
  let jsonSchema: any;
  if (typeof (z as any).toJSONSchema === "function") {
    try {
      jsonSchema = (z as any).toJSONSchema(schema);
    } catch {
      // Fallback
    }
  }
  if (!jsonSchema) {
    jsonSchema = convertZodType(schema);
  }

  // Clean up required list so optional / default fields are not marked as required
  if (jsonSchema && jsonSchema.type === "object" && Array.isArray(jsonSchema.required)) {
    const shape =
      (schema as any)._def?.shape ||
      (typeof (schema as any).shape === "function" ? (schema as any).shape() : (schema as any).shape);

    if (shape && typeof shape === "object") {
      jsonSchema.required = jsonSchema.required.filter((key: string) => {
        const prop = shape[key];
        if (!prop) return true;
        const pDef = prop._def || prop.def;
        if (!pDef) return true;
        if (
          pDef.type === "optional" ||
          pDef.type === "default" ||
          pDef.typeName === "ZodOptional" ||
          pDef.typeName === "ZodDefault"
        ) {
          return false;
        }
        return true;
      });
    }
  }

  return jsonSchema;
}

export function convertZodType(type: any): Record<string, unknown> {
  if (!type) {
    return { type: "object" };
  }

  const def = type._def || type.def || type;
  const description = type.description || def.description;
  let result: Record<string, unknown> = {};

  const typeName = def.typeName || def.type || "";

  // Handle optional or default wrappers
  if (typeName === "ZodOptional" || typeName === "optional" || typeName === "ZodNullable" || typeName === "nullable") {
    return { ...convertZodType(def.innerType || def.element), ...(description ? { description } : {}) };
  }
  if (typeName === "ZodDefault" || typeName === "default") {
    const defaultVal = typeof def.defaultValue === "function" ? def.defaultValue() : def.defaultValue;
    return {
      ...convertZodType(def.innerType || def.element),
      default: defaultVal,
      ...(description ? { description } : {}),
    };
  }
  if (typeName === "ZodEffects" || typeName === "effects" || typeName === "pipe") {
    return { ...convertZodType(def.schema || def.innerType), ...(description ? { description } : {}) };
  }

  switch (typeName) {
    case "ZodString":
    case "string":
      result = { type: "string" };
      break;
    case "ZodNumber":
    case "number":
      result = { type: def.checks?.some((c: any) => c.kind === "int" || c.isInt) ? "integer" : "number" };
      break;
    case "ZodBoolean":
    case "boolean":
      result = { type: "boolean" };
      break;
    case "ZodEnum":
    case "enum": {
      const values = Array.isArray(def.values)
        ? def.values
        : Object.values(def.entries || {}).filter((v) => typeof v === "string");
      result = { type: "string", enum: values.length > 0 ? values : Object.keys(def.entries || {}) };
      break;
    }
    case "ZodNativeEnum":
    case "nativeEnum": {
      const values = Array.isArray(def.values)
        ? def.values
        : Object.values(def.entries || def.values || {}).filter((v) => typeof v === "string");
      result = { type: "string", enum: values.length > 0 ? values : Object.keys(def.entries || {}) };
      break;
    }
    case "ZodArray":
    case "array": {
      const elemType = def.element || (typeof def.type === "object" ? def.type : null);
      result = {
        type: "array",
        items: convertZodType(elemType),
      };
      break;
    }
    case "ZodObject":
    case "object": {
      const shape = typeof def.shape === "function" ? def.shape() : def.shape || {};
      const properties: Record<string, unknown> = {};
      const required: string[] = [];

      for (const [key, propType] of Object.entries(shape as Record<string, any>)) {
        properties[key] = convertZodType(propType);
        const propDef = propType._def || propType.def || propType;
        const pType = propDef?.typeName || propDef?.type || "";
        const isOptional =
          pType === "ZodOptional" ||
          pType === "optional" ||
          pType === "ZodDefault" ||
          pType === "default";
        if (!isOptional) {
          required.push(key);
        }
      }

      result = {
        type: "object",
        properties,
        ...(required.length > 0 ? { required } : {}),
      };
      break;
    }
    case "ZodRecord":
    case "record": {
      const valType = def.valueType || def.element || (typeof def.type === "object" ? def.type : null);
      result = {
        type: "object",
        additionalProperties: convertZodType(valType),
      };
      break;
    }
    case "ZodUnion":
    case "union":
    case "ZodDiscriminatedUnion":
    case "discriminatedUnion":
      result = {
        anyOf: def.options ? def.options.map((opt: any) => convertZodType(opt)) : [{ type: "object" }],
      };
      break;
    case "ZodLiteral":
    case "literal": {
      const literalVal = def.value !== undefined ? def.value : Array.isArray(def.values) ? def.values[0] : undefined;
      result = {
        type: typeof literalVal,
        const: literalVal,
      };
      break;
    }
    case "ZodUnknown":
    case "unknown":
    case "ZodAny":
    case "any":
      result = { type: "object" };
      break;
    default:
      result = { type: "object" };
      break;
  }

  if (description) {
    result.description = description;
  }

  return result;
}
