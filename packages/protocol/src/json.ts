import { z } from "zod";

/**
 * Standard JSON Primitive schema (string, number, boolean, null).
 */
export const jsonPrimitiveSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);
export type JsonPrimitive = z.infer<typeof jsonPrimitiveSchema>;

/**
 * Recursive JSON Value type and schema.
 */
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    jsonPrimitiveSchema,
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ])
);

/**
 * Standard JSON Object / Record schema.
 */
export const jsonRecordSchema = z.record(z.string(), jsonValueSchema);
export type JsonRecord = z.infer<typeof jsonRecordSchema>;
