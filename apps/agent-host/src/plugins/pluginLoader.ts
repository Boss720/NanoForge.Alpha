import { promises as fs } from "node:fs";
import * as path from "node:path";
import { pluginManifestSchema, type PluginManifest } from "./pluginSchema";

export interface LoadedPlugin {
  manifest: PluginManifest;
  dirPath: string;
}

export interface PluginLoadError {
  dirPath: string;
  message: string;
}

export async function loadPlugins(
  pluginsDir: string
): Promise<{ plugins: LoadedPlugin[]; errors: PluginLoadError[] }> {
  const plugins: LoadedPlugin[] = [];
  const errors: PluginLoadError[] = [];

  let entries;
  try {
    entries = await fs.readdir(pluginsDir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { plugins, errors }; // No plugins directory is fine
    }
    errors.push({ dirPath: pluginsDir, message: `Failed to read plugins directory: ${String(err)}` });
    return { plugins, errors };
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const dirPath = path.join(pluginsDir, entry.name);
    const pluginJsonPath = path.join(dirPath, "plugin.json");

    let rawJson: string;
    try {
      rawJson = await fs.readFile(pluginJsonPath, "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        errors.push({ dirPath, message: "Missing plugin.json" });
      } else {
        errors.push({ dirPath, message: `Failed to read plugin.json: ${String(err)}` });
      }
      continue;
    }

    let jsonParsed;
    try {
      jsonParsed = JSON.parse(rawJson);
    } catch (err) {
      errors.push({ dirPath, message: `Invalid JSON in plugin.json: ${String(err)}` });
      continue;
    }

    const validated = pluginManifestSchema.safeParse(jsonParsed);
    if (!validated.success) {
      const issueMsgs = validated.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ");
      errors.push({ dirPath, message: `Schema validation failed: ${issueMsgs}` });
      continue;
    }

    plugins.push({
      manifest: validated.data,
      dirPath,
    });
  }

  return { plugins, errors };
}
