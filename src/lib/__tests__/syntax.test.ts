import { describe, expect, it } from "vitest";
import { detectLang, tokenize, type Token } from "@/lib/syntax";

function kinds(tokens: Token[]): string {
  return tokens.map((t) => `${t.kind}:${JSON.stringify(t.text)}`).join(" | ");
}

describe("detectLang", () => {
  it("maps common labels", () => {
    expect(detectLang("typescript")).toBe("ts");
    expect(detectLang("tsx")).toBe("ts");
    expect(detectLang("js")).toBe("ts");
    expect(detectLang("json")).toBe("json");
    expect(detectLang("markdown")).toBe("md");
    expect(detectLang("diff")).toBe("text");
    expect(detectLang(undefined)).toBe("text");
    expect(detectLang("")).toBe("text");
  });
});

describe("tokenize — ts", () => {
  it("classifies keywords, strings, and comments", () => {
    const tokens = tokenize(`const a = "hi"; // done`, "ts");
    expect(kinds(tokens)).toBe(
      `keyword:"const" | plain:" a = " | string:"\\"hi\\"" | plain:"; " | comment:"// done"`,
    );
  });

  it("does not treat identifiers as keywords", () => {
    const tokens = tokenize(`constant return`, "ts");
    expect(kinds(tokens)).toBe(`plain:"constant " | keyword:"return"`);
  });

  it("ignores comment markers inside strings", () => {
    const tokens = tokenize(`const url = "http://x";`, "ts");
    expect(tokens.some((t) => t.kind === "comment")).toBe(false);
    expect(tokens.find((t) => t.kind === "string")?.text).toBe(`"http://x"`);
  });

  it("ignores quotes inside line comments", () => {
    const tokens = tokenize(`// say "hi"\nlet x`, "ts");
    expect(kinds(tokens)).toBe(`comment:"// say \\"hi\\"" | plain:"\\n" | keyword:"let" | plain:" x"`);
  });

  it("handles block comments and template literals", () => {
    const tokens = tokenize(`/* a\nb */ const s = \`tpl\`;`, "ts");
    expect(tokens[0]).toEqual({ text: "/* a\nb */", kind: "comment" });
    expect(tokens.some((t) => t.kind === "string" && t.text === "`tpl`")).toBe(true);
  });
});

describe("tokenize — json", () => {
  it("marks keys as keywords and values as strings", () => {
    const tokens = tokenize(`{"name": "forge", "on": true}`, "json");
    const keyTok = tokens.find((t) => t.text === `"name"`);
    const valTok = tokens.find((t) => t.text === `"forge"`);
    expect(keyTok?.kind).toBe("keyword");
    expect(valTok?.kind).toBe("string");
    expect(tokens.find((t) => t.text === "true")?.kind).toBe("keyword");
  });
});

describe("tokenize — md", () => {
  it("marks headings and inline code", () => {
    const tokens = tokenize(`# Title\ntext with \`code\` span`, "md");
    expect(tokens[0]).toEqual({ text: "# Title", kind: "keyword" });
    expect(tokens.find((t) => t.text === "`code`")?.kind).toBe("string");
  });
});

describe("tokenize — invariants", () => {
  const samples: Array<[string, Parameters<typeof tokenize>[1]]> = [
    ["const a = 1;\n// c\n\"s\"", "ts"],
    [`{"a": [1, true, null]}`, "json"],
    ["# h\n**bold** and `code`", "md"],
    ["anything at all", "text"],
  ];
  it.each(samples)("reproduces the input exactly (%s)", (code, lang) => {
    expect(tokenize(code, lang).map((t) => t.text).join("")).toBe(code);
  });

  it("returns [] for empty input and a single plain token for unknown langs", () => {
    expect(tokenize("", "ts")).toEqual([]);
    expect(tokenize("plain text", "text")).toEqual([{ text: "plain text", kind: "plain" }]);
  });
});
