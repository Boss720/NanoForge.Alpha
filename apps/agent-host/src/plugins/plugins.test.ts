import { describe, it, expect } from "vitest";
import { pluginManifestSchema } from "./pluginSchema";

describe("pluginManifestSchema", () => {
  it("validates a correct manifest", () => {
    const manifest = {
      name: "my-plugin-123",
      version: "1.0.0",
      description: "A test plugin",
      author: "Test Author",
      components: {
        skills: ["test-skill"],
      },
    };
    const result = pluginManifestSchema.safeParse(manifest);
    expect(result.success).toBe(true);
  });

  it("rejects invalid name", () => {
    const manifest = {
      name: "My_Plugin", // not kebab-case
      version: "1.0.0",
      description: "Test",
    };
    const result = pluginManifestSchema.safeParse(manifest);
    expect(result.success).toBe(false);
  });
});
