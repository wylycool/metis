import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const stylesheet = readFileSync("src/styles.css", "utf8");

function latestVariableValue(name: string, seen = new Set<string>()): string {
  if (seen.has(name)) {
    throw new Error(`Circular CSS variable reference for ${name}`);
  }
  seen.add(name);

  const matches = [
    ...stylesheet.matchAll(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6}|var\\((--[^)]+)\\))`, "g")),
  ];
  const latest = matches[matches.length - 1];

  if (!latest) {
    throw new Error(`Missing CSS variable ${name}`);
  }

  if (latest[2]) {
    return latestVariableValue(latest[2], seen);
  }

  return latest[1];
}

function hexFromDeclaration(block: string, property: string): string {
  const match = block.match(new RegExp(`${property}:\\s*(#[0-9a-fA-F]{6})`));

  if (!match) {
    throw new Error(`Missing ${property} hex declaration`);
  }

  return match[1];
}

function blockFor(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = stylesheet.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, "m"));

  if (!match) {
    throw new Error(`Missing CSS block for ${selector}`);
  }

  return match[1];
}

function latestBlockFor(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...stylesheet.matchAll(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, "gm"))];
  const latest = matches[matches.length - 1];

  if (!latest) {
    throw new Error(`Missing CSS block for ${selector}`);
  }

  return latest[1];
}

function declaredPx(block: string, property: string): number {
  const match = block.match(new RegExp(`${property}:\\s*(\\d+)px`));

  if (!match) {
    throw new Error(`Missing ${property} declaration`);
  }

  return Number(match[1]);
}

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((index) => {
    const value = parseInt(hex.slice(index, index + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });

  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);

  return (lighter + 0.05) / (darker + 0.05);
}

describe("Phase 6 light workspace contrast", () => {
  test("defines semantic light theme tokens for brand, surfaces, borders, text, and status", () => {
    const requiredTokens = [
      "--brand",
      "--brand-hover",
      "--brand-soft",
      "--brand-border",
      "--surface-canvas",
      "--surface-panel",
      "--surface-raised",
      "--surface-subtle",
      "--surface-selected",
      "--border-subtle",
      "--border-default",
      "--border-strong",
      "--text-primary",
      "--text-secondary",
      "--text-tertiary",
      "--text-placeholder",
      "--text-disabled",
      "--text-inverse",
      "--success-fg",
      "--success-bg",
      "--warning-fg",
      "--warning-bg",
      "--danger-fg",
      "--danger-bg",
      "--info-fg",
      "--info-bg",
    ];

    for (const token of requiredTokens) {
      expect(stylesheet).toContain(`${token}:`);
    }
  });

  test("uses distinct canvas, panel, subtle, and selected surfaces", () => {
    expect(latestVariableValue("--surface-canvas")).not.toBe(
      latestVariableValue("--surface-panel"),
    );
    expect(latestVariableValue("--surface-subtle")).not.toBe(
      latestVariableValue("--surface-panel"),
    );
    expect(latestVariableValue("--surface-selected")).not.toBe(
      latestVariableValue("--surface-panel"),
    );
  });

  test("uses a comfortably readable muted text color on white panels", () => {
    expect(
      contrastRatio(latestVariableValue("--muted"), latestVariableValue("--panel")),
    ).toBeGreaterThanOrEqual(6);
  });

  test("maps legacy theme aliases to semantic text and surface tokens", () => {
    expect(stylesheet).toContain("--bg: var(--surface-canvas);");
    expect(stylesheet).toContain("--panel: var(--surface-panel);");
    expect(stylesheet).toContain("--text: var(--text-primary);");
    expect(stylesheet).toContain("--muted: var(--text-secondary);");
    expect(stylesheet).toContain("--subtle: var(--text-tertiary);");
    expect(stylesheet).toContain("--primary: var(--brand);");
  });

  test("routes Governance and Settings description copy through the muted color token", () => {
    expect(stylesheet).toContain(".governance-audit-panel p,\n.settings-section p,");
    expect(stylesheet).toContain("color: var(--muted);");
  });

  test("keeps the topbar in normal flow so scrolling content is not covered", () => {
    expect(blockFor(".topbar")).not.toContain("position: sticky");
  });

  test("collapses settings editor sections to a single column at narrow desktop widths", () => {
    expect(stylesheet).toMatch(
      /@media\s*\(max-width:\s*860px\)\s*\{[\s\S]*\.settings-editor[\s\S]*grid-template-columns:\s*1fr;/,
    );
  });

  test("defines the refreshed light visual tokens for continuous shell, ink, purple brand, and accents", () => {
    const requiredTokens = [
      "--surface-window",
      "--ink",
      "--ink-hover",
      "--ink-soft",
      "--brand-purple-start",
      "--brand-purple-end",
      "--accent-mint-bg",
      "--accent-rose-bg",
      "--accent-sky-bg",
      "--accent-warm-bg",
    ];

    for (const token of requiredTokens) {
      expect(stylesheet).toContain(`${token}:`);
    }

    expect(latestVariableValue("--surface-window")).toBe("#fbfaf8");
    expect(latestVariableValue("--ink")).toBe("#111321");
    expect(latestVariableValue("--primary")).toBe(latestVariableValue("--ink"));
  });

  test("uses a continuous top action shell without the previous left rail", () => {
    expect(stylesheet).toContain(".metis-shell");
    expect(latestBlockFor(".metis-window")).toContain("padding: 0");
    expect(latestBlockFor(".metis-shell")).not.toContain("grid-template-columns");
    expect(latestBlockFor(".metis-brand-mark")).toContain("linear-gradient(135deg");
    expect(latestBlockFor(".workspace-rail")).toContain("display: none");
    expect(latestBlockFor(".workspace-tabs")).toContain("display: none");
  });

  test("keeps the refreshed desktop density compact", () => {
    expect(declaredPx(latestBlockFor(".skill-row"), "min-height")).toBeLessThanOrEqual(60);
    expect(declaredPx(latestBlockFor(".topbar"), "min-height")).toBeLessThanOrEqual(68);
    expect(declaredPx(latestBlockFor(".status-filter-button"), "min-height")).toBeLessThanOrEqual(42);
  });

  test("keeps agent category labels icon-first until the window is wide", () => {
    expect(stylesheet).toMatch(
      /@media\s*\(min-width:\s*1180px\)\s*\{[\s\S]*\.agent-filter-label[\s\S]*display:\s*inline;/,
    );
    expect(stylesheet).toMatch(
      /@media\s*\(max-width:\s*700px\)\s*\{[\s\S]*\.agent-detail-summary[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/,
    );
  });

  test("uses compact desktop typography instead of presentation-sized controls", () => {
    expect(declaredPx(latestBlockFor("h1"), "font-size")).toBeLessThanOrEqual(24);
    expect(declaredPx(latestBlockFor(".workspace-tab"), "font-size")).toBeLessThanOrEqual(15);
    expect(declaredPx(latestBlockFor(".metric strong"), "font-size")).toBeLessThanOrEqual(22);
    expect(declaredPx(latestBlockFor(".agent-filter-pill"), "font-size")).toBeLessThanOrEqual(13);
  });

  test("defines a soft shadow token for B direction detail cards", () => {
    expect(stylesheet).toContain("--shadow-soft:");
    expect(latestBlockFor(".skill-detail-card")).toContain("box-shadow: var(--shadow-soft);");
  });

  test("defines source drawer and three-line intro copy constraints", () => {
    expect(latestBlockFor(".source-drawer")).toContain("position: fixed");
    expect(latestBlockFor(".skill-intro-copy")).toContain("-webkit-line-clamp: 3");
  });

  test("keeps refreshed selected states light instead of ink-filled", () => {
    expect(latestVariableValue("--command-selected")).toBe("#eef6ff");
    expect(contrastRatio(latestVariableValue("--ink"), latestVariableValue("--command-selected")))
      .toBeGreaterThanOrEqual(10);
    expect(latestBlockFor(".status-filter-button.active")).toContain(
      "background: var(--command-selected);",
    );
    expect(latestBlockFor(".agent-filter-pill.active")).toContain(
      "background: var(--command-selected);",
    );
    expect(latestBlockFor(".source-chip-button span::before")).not.toContain("border:");
  });

  test("renders a Metis M mark and places the skill path inside the intro card", () => {
    expect(latestBlockFor(".metis-brand-mark")).toContain("display: inline-grid");
    expect(latestBlockFor(".metis-brand-mark")).toContain("color: #ffffff");
    expect(stylesheet).toContain(".skill-intro-path");
    expect(stylesheet).toContain(".local-operations-card .detail-card-heading code");
    expect(
      contrastRatio(
        hexFromDeclaration(latestBlockFor(".skill-intro-path"), "color"),
        latestVariableValue("--surface-panel"),
      ),
    ).toBeLessThan(5);
  });

  test("keeps detail back state readable and agent filter labels visible", () => {
    expect(latestBlockFor(".breadcrumb-button")).toContain("color: var(--ink);");
    expect(stylesheet).toContain(".breadcrumb-button:hover:not(:disabled),");
    expect(stylesheet).toContain(".breadcrumb-button:focus-visible");
    expect(stylesheet).toContain("background: var(--surface-selected);");
    expect(latestBlockFor(".agent-filter-label")).not.toContain("display: none");
    expect(latestBlockFor(".agent-filter-pill b")).toContain("width: 8px");
  });

  test("lays out skill intro facts with left labels and installed path rows", () => {
    expect(stylesheet).toContain(".skill-intro-facts");
    expect(latestBlockFor(".skill-intro-fact")).toContain(
      "grid-template-columns: 112px minmax(0, 1fr);",
    );
    expect(latestBlockFor(".skill-intro-label")).toContain("border-radius: 999px;");
    expect(stylesheet).toContain(".skill-installed-paths");
    expect(stylesheet).toContain(".skill-installed-path");
  });

  test("Command Sheet keeps top actions and selected states light", () => {
    expect(stylesheet).toContain("--command-surface:");
    expect(stylesheet).toContain("--command-accent:");
    expect(stylesheet).toContain("--command-purple-soft:");
    expect(latestBlockFor(".topbar-secondary-action")).toContain(
      "background: var(--command-surface);",
    );
    expect(latestBlockFor(".topbar-secondary-action:hover:not(:disabled)")).not.toContain(
      "background: var(--ink-hover);",
    );
    expect(latestBlockFor(".scan-button")).toContain("background: var(--command-purple-soft);");
    expect(latestBlockFor(".scan-button")).not.toContain("var(--command-accent-soft)");
    expect(latestBlockFor(".add-skill-button")).toContain("background: var(--command-surface);");
    expect(latestBlockFor(".status-filter-button.active")).toContain(
      "background: var(--command-selected);",
    );
    expect(latestBlockFor(".agent-filter-pill.active")).toContain(
      "background: var(--command-selected);",
    );
  });

  test("Command Sheet aligns Settings sections and normalizes form controls", () => {
    expect(latestBlockFor(".settings-editor")).toContain(
      "grid-template-columns: repeat(3, minmax(0, 1fr));",
    );
    expect(latestBlockFor(".settings-section")).toContain("grid-template-rows: auto 1fr auto;");
    expect(latestBlockFor(".settings-section")).toContain("min-height: 220px;");
    expect(latestBlockFor("input")).toContain("min-height: 36px;");
    expect(latestBlockFor(".network-field-grid")).toContain("grid-auto-rows: 36px;");
  });

  test("Command Sheet keeps list markers thin and subdued", () => {
    expect(stylesheet).toContain("--skill-marker-start: #c4b5fd;");
    expect(stylesheet).toContain("--skill-marker-end: #f0abfc;");
    expect(stylesheet).toContain(".skill-row-marker");
    expect(latestBlockFor(".skill-row")).toContain("grid-template-columns: 4px minmax(0, 1fr);");
    expect(latestBlockFor(".skill-row-marker")).toContain("width: 4px;");
    expect(latestBlockFor(".skill-row-marker")).toContain("height: 28px;");
    expect(latestBlockFor(".skill-row-marker")).toContain("border-radius: 999px;");
    expect(latestBlockFor(".skill-row-marker")).toContain(
      "background: linear-gradient(180deg, var(--skill-marker-start), var(--skill-marker-end));",
    );
  });
});
