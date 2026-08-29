import { describe, it, expect } from "vitest";
import {
  PromptComposer,
  DEFAULT_NANOFORGE_SYSTEM_PROMPT,
} from "../prompt/composer";
import {
  escapeXml,
  unescapeXml,
  formatXmlTag,
  extractXmlTag,
  extractAllXmlTags,
} from "../prompt/xmlFormatter";
import { createToolExecutionResult } from "@nanoforge/protocol";

describe("PromptComposer & XML Utilities Subsystem", () => {
  describe("xmlFormatter", () => {
    it("escapes and unescapes XML special characters correctly", () => {
      const raw = `<script>alert("hello" & 'world')</script>`;
      const escaped = escapeXml(raw);
      expect(escaped).toBe("&lt;script&gt;alert(&quot;hello&quot; &amp; &apos;world&apos;)&lt;/script&gt;");

      const unescaped = unescapeXml(escaped);
      expect(unescaped).toBe(raw);
    });

    it("formats XML tags with attributes", () => {
      const tag = formatXmlTag("test_node", "inner content", {
        id: "123",
        status: "active",
      });

      expect(tag).toContain('<test_node id="123" status="active">');
      expect(tag).toContain("inner content");
      expect(tag).toContain("</test_node>");
    });

    it("extracts XML tags and attributes", () => {
      const xml = `<root>\n  <item id="a">Content A</item>\n  <item id="b">Content B</item>\n</root>`;
      const single = extractXmlTag(xml, "item");
      expect(single).toBe("Content A");

      const all = extractAllXmlTags(xml, "item");
      expect(all.length).toBe(2);
      expect(all[0].attributes.id).toBe("a");
      expect(all[0].content).toBe("Content A");
      expect(all[1].attributes.id).toBe("b");
    });
  });

  describe("PromptComposer", () => {
    it("composes default system prompt with workspace and pinned context", () => {
      const composer = new PromptComposer({
        workspaceRoot: "C:\\projects\\nano-forge",
      });

      const prompt = composer.composeSystemPrompt({
        defaultRules: ["Always write clean tests", "Do not modify node_modules"],
        pinnedFiles: [
          { path: "packages/protocol/src/index.ts", content: "export * from './types';" },
        ],
        gitBranch: "feature/react-loop",
      });

      expect(prompt).toContain("<system>");
      expect(prompt).toContain(DEFAULT_NANOFORGE_SYSTEM_PROMPT);
      expect(prompt).toContain("<rules>");
      expect(prompt).toContain("<rule id=\"1\">Always write clean tests</rule>");
      expect(prompt).toContain("<workspace_context>");
      expect(prompt).toContain("<cwd>C:\\projects\\nano-forge</cwd>");
      expect(prompt).toContain("<git_branch>feature/react-loop</git_branch>");
      expect(prompt).toContain("<pinned_files>");
      expect(prompt).toContain('<file path="packages/protocol/src/index.ts">');
    });

    it("formats tool execution outputs into structured XML blocks", () => {
      const composer = new PromptComposer();
      const successResult = createToolExecutionResult(
        "call_1",
        "read_file",
        "SUCCESS",
        "File lines 1-10",
        { exitCode: 0 }
      );

      const xmlOutput = composer.formatToolOutput(successResult);
      expect(xmlOutput).toContain('<tool_output call_id="call_1" name="read_file" status="SUCCESS" exit_code="0">');
      expect(xmlOutput).toContain("File lines 1-10");

      const errorResult = createToolExecutionResult(
        "call_2",
        "run_command",
        "EXECUTION_ERROR",
        "Command failed",
        { exitCode: 1 },
        "Segmentation fault"
      );
      const errXml = composer.formatToolOutput(errorResult);
      expect(errXml).toContain('status="EXECUTION_ERROR"');
      expect(errXml).toContain("<error>Segmentation fault</error>");
    });

    it("assembles turn messages with ephemeral cache control markers", () => {
      const composer = new PromptComposer();
      const history = [{ role: "user" as const, content: "Implement feature" }];

      const assembled = composer.assembleTurnMessages(history);
      expect(assembled.length).toBe(2);
      expect(assembled[0].role).toBe("system");
      expect(assembled[0].cacheControl?.type).toBe("ephemeral");
      expect(assembled[1].content).toBe("Implement feature");
    });
  });
});
