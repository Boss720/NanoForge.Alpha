// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { sanitizeMermaidSvg } from "../MermaidViewer";

describe("Mermaid SVG Sanitization & XSS Isolation", () => {
  it("strips malicious script tags from raw SVG", () => {
    const maliciousSvg = `
      <svg width="100" height="100">
        <rect width="50" height="50" fill="red" />
        <script>window.__pwned = true; alert("XSS");</script>
        <text x="10" y="20">Valid Label</text>
      </svg>
    `;

    const sanitized = sanitizeMermaidSvg(maliciousSvg);
    expect(sanitized).not.toContain("<script");
    expect(sanitized).not.toContain("window.__pwned");
    expect(sanitized).toContain("<rect");
    expect(sanitized).toContain("Valid Label");
  });

  it("strips inline event handlers such as onerror and onload", () => {
    const maliciousSvg = `
      <svg width="100" height="100" onload="alert('root_xss')">
        <image href="invalid.png" onerror="alert('image_xss')" />
        <circle cx="25" cy="25" r="20" onclick="alert('click_xss')" />
      </svg>
    `;

    const sanitized = sanitizeMermaidSvg(maliciousSvg);
    expect(sanitized).not.toContain("onload=");
    expect(sanitized).not.toContain("onerror=");
    expect(sanitized).not.toContain("onclick=");
    expect(sanitized).not.toContain("alert(");
  });

  it("strips dangerous tags like iframe, object, and foreignObject", () => {
    const maliciousSvg = `
      <svg width="100" height="100">
        <foreignObject width="100" height="100">
          <iframe src="javascript:alert(1)"></iframe>
        </foreignObject>
        <object data="malicious.swf"></object>
        <text>Safe SVG</text>
      </svg>
    `;

    const sanitized = sanitizeMermaidSvg(maliciousSvg);
    expect(sanitized).not.toContain("<foreignObject");
    expect(sanitized).not.toContain("<iframe");
    expect(sanitized).not.toContain("<object");
    expect(sanitized).toContain("Safe SVG");
  });

  it("preserves legitimate SVG structure, paths, and styles", () => {
    const validSvg = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
        <defs>
          <linearGradient id="grad1">
            <stop offset="0%" stop-color="#00bcd4" />
            <stop offset="100%" stop-color="#009688" />
          </linearGradient>
        </defs>
        <g id="flowchart-main" class="node">
          <rect x="10" y="10" width="180" height="60" rx="5" fill="url(#grad1)" stroke="#333" />
          <text x="100" y="40" text-anchor="middle" fill="#ffffff" font-family="sans-serif">Node A</text>
        </g>
      </svg>
    `;

    const sanitized = sanitizeMermaidSvg(validSvg);
    expect(sanitized).toContain("Node A");
    expect(sanitized).toContain("rect");
    expect(sanitized).toContain("linearGradient");
  });
});
