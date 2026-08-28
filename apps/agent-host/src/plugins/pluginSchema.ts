import { z } from "zod";

export const pluginManifestSchema = z.object({
  name: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "name must be kebab-case"),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[\w.]+)?$/, "version must be valid semver"),
  description: z.string(),
  author: z.string().optional(),
  homepage: z.string().optional(),
  requires: z.record(z.string(), z.string()).optional(),
  components: z.object({
    skills: z.array(z.string()).optional(),
    rules: z.array(z.string()).optional(),
    mcp: z.array(z.string()).optional(),
  }).optional(),
});

export type PluginManifest = z.infer<typeof pluginManifestSchema>;

export type PluginStatus = "loaded" | "error" | "disabled";
