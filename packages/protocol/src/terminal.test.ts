import { describe, expect, it } from "vitest";
import {
  terminalCreateSchema,
  terminalInputSchema,
  terminalResizeSchema,
  terminalKillSchema,
  terminalCreatedSchema,
  terminalDataSchema,
  terminalExitSchema,
  terminalClientMessageSchema,
  terminalServerMessageSchema,
  terminalMessageSchema,
  parseTerminalClientMessage,
  parseTerminalServerMessage,
  parseTerminalMessage,
  safeParseTerminalClientMessage,
  safeParseTerminalServerMessage,
  safeParseTerminalMessage,
  isTerminalClientMessage,
  isTerminalServerMessage,
  isTerminalMessage,
  type TerminalCreateMessage,
  type TerminalInputMessage,
  type TerminalResizeMessage,
  type TerminalKillMessage,
  type TerminalCreatedMessage,
  type TerminalDataMessage,
  type TerminalExitMessage,
} from "./terminal";

describe("Terminal Wire Protocol Schemas", () => {
  describe("Client Messages", () => {
    it("parses terminal.create with defaults", () => {
      const msg = {
        type: "terminal.create" as const,
      };
      const parsed = terminalCreateSchema.parse(msg);
      expect(parsed.type).toBe("terminal.create");
      expect(parsed.cols).toBe(80);
      expect(parsed.rows).toBe(24);
      expect(parsed.args).toEqual([]);
    });

    it("parses terminal.create with full configuration", () => {
      const msg: TerminalCreateMessage = {
        type: "terminal.create",
        id: "term-1",
        sessionId: "term-1",
        title: "Build Shell",
        cols: 120,
        rows: 40,
        cwd: "/workspace/project",
        env: { NODE_ENV: "development", TERM: "xterm-256color" },
        shell: "/bin/bash",
        executable: "/bin/bash",
        args: ["-l"],
      };
      const parsed = terminalCreateSchema.parse(msg);
      expect(parsed).toEqual(msg);
    });

    it("parses terminal.input correctly", () => {
      const msg: TerminalInputMessage = {
        type: "terminal.input",
        id: "term-1",
        data: "npm test\r",
      };
      const parsed = terminalInputSchema.parse(msg);
      expect(parsed.id).toBe("term-1");
      expect(parsed.data).toBe("npm test\r");
    });

    it("fails terminal.input when required fields are missing", () => {
      expect(() => terminalInputSchema.parse({ type: "terminal.input", id: "t1" })).toThrow();
      expect(() => terminalInputSchema.parse({ type: "terminal.input", data: "hi" })).toThrow();
    });

    it("parses terminal.resize with dimensions", () => {
      const msg: TerminalResizeMessage = {
        type: "terminal.resize",
        id: "term-1",
        cols: 100,
        rows: 30,
      };
      const parsed = terminalResizeSchema.parse(msg);
      expect(parsed.cols).toBe(100);
      expect(parsed.rows).toBe(30);
    });

    it("fails terminal.resize with non-positive dimensions", () => {
      expect(() =>
        terminalResizeSchema.parse({ type: "terminal.resize", id: "t1", cols: 0, rows: 24 }),
      ).toThrow();
      expect(() =>
        terminalResizeSchema.parse({ type: "terminal.resize", id: "t1", cols: 80, rows: -1 }),
      ).toThrow();
    });

    it("parses terminal.kill with and without signal", () => {
      const withSignal: TerminalKillMessage = {
        type: "terminal.kill",
        id: "term-1",
        signal: "SIGKILL",
      };
      expect(terminalKillSchema.parse(withSignal).signal).toBe("SIGKILL");

      const withoutSignal = {
        type: "terminal.kill" as const,
        id: "term-1",
      };
      expect(terminalKillSchema.parse(withoutSignal).signal).toBeUndefined();
    });

    it("validates client message discriminated union", () => {
      const create = terminalClientMessageSchema.parse({
        type: "terminal.create",
        id: "t1",
      });
      expect(create.type).toBe("terminal.create");

      const input = terminalClientMessageSchema.parse({
        type: "terminal.input",
        id: "t1",
        data: "ls\n",
      });
      expect(input.type).toBe("terminal.input");

      const resize = terminalClientMessageSchema.parse({
        type: "terminal.resize",
        id: "t1",
        cols: 80,
        rows: 24,
      });
      expect(resize.type).toBe("terminal.resize");

      const kill = terminalClientMessageSchema.parse({
        type: "terminal.kill",
        id: "t1",
        signal: "SIGINT",
      });
      expect(kill.type).toBe("terminal.kill");

      expect(() =>
        terminalClientMessageSchema.parse({ type: "terminal.unknown", id: "t1" }),
      ).toThrow();
    });
  });

  describe("Server Messages", () => {
    it("parses terminal.created correctly", () => {
      const msg: TerminalCreatedMessage = {
        type: "terminal.created",
        id: "term-1",
        sessionId: "term-1",
        title: "bash",
        pid: 12345,
        cols: 80,
        rows: 24,
      };
      const parsed = terminalCreatedSchema.parse(msg);
      expect(parsed.pid).toBe(12345);
      expect(parsed.cols).toBe(80);
      expect(parsed.rows).toBe(24);
    });

    it("parses terminal.data chunk with ANSI escape sequences", () => {
      const msg: TerminalDataMessage = {
        type: "terminal.data",
        id: "term-1",
        data: "\x1b[32mSuccess\x1b[0m\r\n",
      };
      const parsed = terminalDataSchema.parse(msg);
      expect(parsed.data).toBe("\x1b[32mSuccess\x1b[0m\r\n");
    });

    it("parses terminal.exit with exit code and signal", () => {
      const msg: TerminalExitMessage = {
        type: "terminal.exit",
        id: "term-1",
        exitCode: 0,
        signal: undefined,
      };
      const parsed = terminalExitSchema.parse(msg);
      expect(parsed.exitCode).toBe(0);

      const signaled: TerminalExitMessage = {
        type: "terminal.exit",
        id: "term-1",
        exitCode: 137,
        signal: "SIGKILL",
      };
      const parsedSignaled = terminalExitSchema.parse(signaled);
      expect(parsedSignaled.exitCode).toBe(137);
      expect(parsedSignaled.signal).toBe("SIGKILL");
    });

    it("validates server message discriminated union", () => {
      const created = terminalServerMessageSchema.parse({
        type: "terminal.created",
        id: "t1",
        pid: 42,
        cols: 80,
        rows: 24,
      });
      expect(created.type).toBe("terminal.created");

      const data = terminalServerMessageSchema.parse({
        type: "terminal.data",
        id: "t1",
        data: "hello",
      });
      expect(data.type).toBe("terminal.data");

      const exit = terminalServerMessageSchema.parse({
        type: "terminal.exit",
        id: "t1",
        exitCode: 1,
      });
      expect(exit.type).toBe("terminal.exit");

      expect(() =>
        terminalServerMessageSchema.parse({ type: "terminal.input", id: "t1", data: "x" }),
      ).toThrow();
    });
  });

  describe("Union and Helper Functions", () => {
    it("validates bidirectional terminal messages with terminalMessageSchema", () => {
      const clientMsg = { type: "terminal.input", id: "t1", data: "date\n" };
      const serverMsg = { type: "terminal.data", id: "t1", data: "Sat Aug 15\r\n" };

      expect(terminalMessageSchema.parse(clientMsg).type).toBe("terminal.input");
      expect(terminalMessageSchema.parse(serverMsg).type).toBe("terminal.data");
    });

    it("supports parsing helpers", () => {
      const clientPayload = { type: "terminal.resize", id: "t1", cols: 90, rows: 30 };
      expect(parseTerminalClientMessage(clientPayload)).toEqual(clientPayload);
      expect(safeParseTerminalClientMessage(clientPayload).success).toBe(true);

      const serverPayload = { type: "terminal.data", id: "t1", data: "output" };
      expect(parseTerminalServerMessage(serverPayload)).toEqual(serverPayload);
      expect(safeParseTerminalServerMessage(serverPayload).success).toBe(true);

      expect(parseTerminalMessage(clientPayload).type).toBe("terminal.resize");
      expect(parseTerminalMessage(serverPayload).type).toBe("terminal.data");
      expect(safeParseTerminalMessage(clientPayload).success).toBe(true);
    });

    it("correctly identifies client and server message types via predicates", () => {
      const clientMsg = { type: "terminal.create", cols: 80, rows: 24 };
      const serverMsg = { type: "terminal.created", id: "t1", pid: 100, cols: 80, rows: 24 };
      const invalidMsg = { type: "random.message", foo: "bar" };

      expect(isTerminalClientMessage(clientMsg)).toBe(true);
      expect(isTerminalClientMessage(serverMsg)).toBe(false);

      expect(isTerminalServerMessage(serverMsg)).toBe(true);
      expect(isTerminalServerMessage(clientMsg)).toBe(false);

      expect(isTerminalMessage(clientMsg)).toBe(true);
      expect(isTerminalMessage(serverMsg)).toBe(true);
      expect(isTerminalMessage(invalidMsg)).toBe(false);
    });

    it("preserves serialization / JSON roundtrip", () => {
      const original: TerminalCreateMessage = {
        type: "terminal.create",
        id: "sess-99",
        title: "Zsh Session",
        cols: 100,
        rows: 35,
        cwd: "/tmp",
        env: { PATH: "/usr/bin" },
        shell: "/bin/zsh",
        args: ["-i"],
      };

      const json = JSON.stringify(original);
      const parsed = parseTerminalClientMessage(JSON.parse(json));
      expect(parsed).toEqual(original);
    });
  });
});
