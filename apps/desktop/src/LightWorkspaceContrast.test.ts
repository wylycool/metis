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

function exactBlockFor(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = stylesheet.match(new RegExp(`(^|\\n)${escapedSelector}\\s*\\{([^}]*)\\}`, "m"));

  if (!match) {
    throw new Error(`Missing exact CSS block for ${selector}`);
  }

  return match[2];
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

  test("uses the formal reference sidebar shell without the previous narrow rail", () => {
    expect(stylesheet).toContain(".metis-shell");
    expect(stylesheet).toMatch(/\.metis-window\s*\{[\s\S]*padding:\s*18px;/);
    expect(stylesheet).toMatch(
      /\.metis-shell\s*\{[\s\S]*grid-template-columns:\s*220px minmax\(0,\s*1fr\);/,
    );
    expect(latestBlockFor(".metis-brand-mark")).toContain("linear-gradient(135deg");
    expect(latestBlockFor(".workspace-rail")).toContain("display: none");
    expect(latestBlockFor(".workspace-tabs")).toContain("display: none");
  });

  test("keeps the refreshed desktop chrome compact while allowing dashboard cards", () => {
    expect(stylesheet).toMatch(/\.skill-row\s*\{[\s\S]*min-height:\s*184px;/);
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

  test("uses the reference preview typography scale on the formal desktop", () => {
    expect(declaredPx(latestBlockFor("h1"), "font-size")).toBeLessThanOrEqual(30);
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

  test("Formal dashboard keeps list markers thin and polished", () => {
    expect(stylesheet).toContain("--skill-marker-start: #c4b5fd;");
    expect(stylesheet).toContain("--skill-marker-end: #f0abfc;");
    expect(stylesheet).toContain(".skill-row-marker");
    expect(latestBlockFor(".skill-row")).toContain("grid-template-columns: 4px minmax(0, 1fr);");
    expect(stylesheet).toMatch(/\.skill-row-marker,\s*\.skill-row:nth-child\(n\) \.skill-row-marker\s*\{[\s\S]*width:\s*4px;/);
    expect(stylesheet).toMatch(/\.skill-row-marker,\s*\.skill-row:nth-child\(n\) \.skill-row-marker\s*\{[\s\S]*height:\s*44px;/);
    expect(stylesheet).toMatch(/\.skill-row-marker,\s*\.skill-row:nth-child\(n\) \.skill-row-marker\s*\{[\s\S]*border-radius:\s*999px;/);
    expect(stylesheet).toMatch(/\.skill-row-marker,\s*\.skill-row:nth-child\(n\) \.skill-row-marker\s*\{[\s\S]*background:\s*linear-gradient\(180deg,\s*#6fd8ff,\s*#3e7bfa 48%,\s*#9857ff\);/);
  });

  test("renders cross-agent target statuses as colored badges with a spinner affordance", () => {
    expect(stylesheet).toContain(".target-status-badge");
    expect(stylesheet).toContain(".target-status-good");
    expect(stylesheet).toContain(".target-status-warning");
    expect(stylesheet).toContain(".target-status-danger");
    expect(stylesheet).toContain(".target-status-muted");
    expect(stylesheet).toContain(".target-matrix-spinner");
    expect(latestBlockFor(".target-status-badge")).toContain("border-radius: 999px;");
    expect(latestBlockFor(".target-matrix-spinner")).toContain("animation:");
  });

  test("defines the static UI redesign preview shell, orb, rows, and detail panels", () => {
    expect(stylesheet).toContain("--redesign-canvas: #f5f4f8;");
    expect(stylesheet).toContain("--redesign-text-primary: #3a3050;");
    expect(stylesheet).toContain("--redesign-violet-start: #8a68d8;");
    expect(stylesheet).toContain("@keyframes redesignRippleOut");
    expect(stylesheet).toContain("@keyframes redesignRingPulse");
    expect(blockFor(".redesign-preview-shell")).toContain("grid-template-columns: 1fr;");
    expect(blockFor(".redesign-rail")).toContain("width: 52px;");
    expect(latestBlockFor(".redesign-stage")).toContain("width: min(1180px, 100%);");
    expect(latestBlockFor(".redesign-home-grid")).toContain(
      "grid-template-columns: minmax(300px, 0.82fr) minmax(420px, 1fr);",
    );
    expect(latestBlockFor(".redesign-orb")).toContain("width: 168px;");
    expect(latestBlockFor(".redesign-orb")).toContain("height: 168px;");
    expect(latestBlockFor(".redesign-orb::before")).toContain(
      "animation: redesignRippleOut 3s ease-out infinite;",
    );
    expect(latestBlockFor(".redesign-skill-row")).toContain(
      "grid-template-columns: 6px minmax(0, 1fr) 18px;",
    );
    expect(latestBlockFor(".redesign-skill-accent")).toContain("height: 38px;");
    expect(latestBlockFor(".redesign-version-card")).toContain(
      "grid-template-columns: repeat(2, minmax(0, 1fr));",
    );
    expect(latestBlockFor(".redesign-install-matrix-row")).toContain(
      "grid-template-columns: 10px minmax(0, 1fr) auto;",
    );
    expect(latestBlockFor(".redesign-detail-hero")).toContain(
      "grid-template-columns: minmax(0, 1fr) auto;",
    );
  });

  test("defines non-purple selectable background themes for the static UI redesign preview", () => {
    expect(stylesheet).toContain(".redesign-preview-shell[data-theme=\"frost\"]");
    expect(stylesheet).toContain(".redesign-preview-shell[data-theme=\"sage\"]");
    expect(stylesheet).toContain(".redesign-preview-shell[data-theme=\"dawn\"]");
    expect(stylesheet).toContain(".redesign-preview-shell[data-theme=\"graphite\"]");
    expect(stylesheet).toContain("--redesign-frost-canvas: #eef3f7;");
    expect(stylesheet).toContain("--redesign-sage-canvas: #eef4ee;");
    expect(stylesheet).toContain("--redesign-dawn-canvas: #f6f0e7;");
    expect(stylesheet).toContain("--redesign-graphite-canvas: #e9edf0;");
    expect(latestBlockFor(".redesign-theme-switcher")).toContain(
      "grid-template-columns: repeat(4, minmax(0, 1fr));",
    );
    expect(latestBlockFor(".redesign-theme-swatch")).toContain("border-radius: 999px;");
    expect(exactBlockFor(".redesign-preview-shell")).toContain(
      "background: var(--redesign-canvas);",
    );
  });

  test("defines the reference dashboard preview layout, drawer, diff, and settings table", () => {
    expect(stylesheet).toMatch(
      /\.redesign-preview-shell\s*\{[\s\S]*place-items:\s*center;/,
    );
    expect(stylesheet).toMatch(
      /\.redesign-preview-shell\s*\{[\s\S]*grid-template-columns:\s*1fr;/,
    );
    expect(stylesheet).toMatch(
      /\.redesign-app-window\s*\{[\s\S]*grid-template-columns:\s*188px minmax\(0,\s*1fr\);/,
    );
    expect(stylesheet).toMatch(
      /\.redesign-sidebar\s*\{[\s\S]*border-radius:\s*28px 0 0 28px;/,
    );
    expect(latestBlockFor(".redesign-logo-mark")).toContain("overflow: visible");
    expect(latestBlockFor(".redesign-logo-mark img")).toContain("width: 50px;");
    expect(latestBlockFor(".redesign-logo-mark span")).toContain("display: none;");
    expect(stylesheet).toMatch(
      /\.redesign-home-stats\s*\{[\s\S]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\);/,
    );
    expect(stylesheet).toMatch(
      /\.redesign-skill-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/,
    );
    expect(latestBlockFor(".redesign-skill-card")).toContain("-webkit-line-clamp: 2;");
    expect(latestBlockFor(".redesign-agent-stack")).toContain("margin-left: -7px;");
    expect(latestBlockFor(".redesign-github-link")).toContain("width: 42px;");
    expect(latestBlockFor(".redesign-github-link")).toContain("height: 42px;");
    expect(latestBlockFor(".redesign-github-link")).toContain("border-radius: 14px;");
    expect(latestBlockFor(".redesign-github-link svg")).toContain("width: 20px;");
    expect(latestBlockFor(".redesign-source-drawer")).toContain("position: fixed");
    expect(latestBlockFor(".redesign-source-drawer")).toContain("right: 0");
    expect(stylesheet).toMatch(/\.redesign-diff-viewer\s*\{[\s\S]*font-family:/);
    expect(latestBlockFor(".redesign-diff-line.added")).toContain("background:");
    expect(stylesheet).toMatch(/\.redesign-agent-path-table\s*\{[\s\S]*display:\s*grid;/);
    expect(latestBlockFor(".redesign-detail-agent-panel")).toContain("display: grid;");
    expect(latestBlockFor(".redesign-detail-agent-panel")).toContain("background: rgba(255, 255, 255, 0.82);");
    expect(latestBlockFor(".redesign-detail-agent-toggle")).toContain("grid-template-columns: minmax(0, 1fr) auto;");
    expect(latestBlockFor(".redesign-detail-agent-toggle")).toContain("min-height: 56px;");
    expect(latestBlockFor("button.redesign-detail-agent-toggle:hover:not(:disabled)")).toContain("color: #172033;");
    expect(latestBlockFor("button.redesign-detail-agent-toggle:hover:not(:disabled)")).toContain("background:");
    expect(latestBlockFor(".redesign-detail-agent-paths")).toContain("display: grid;");
    expect(latestBlockFor(".redesign-detail-agent-paths")).toContain("gap: 8px;");
    expect(latestBlockFor(".redesign-detail-agent-path-row")).toContain("background: rgba(248, 250, 252, 0.72);");
    expect(latestBlockFor(".redesign-detail-agent-path-row")).toContain("grid-template-columns: auto minmax(96px, 0.28fr) minmax(0, 1fr);");
    expect(latestBlockFor(".redesign-detail-agent-path-row .agent-badge")).toContain("margin-left: 0;");
    expect(latestBlockFor(".redesign-detail-agent-path-row code")).toContain("color: #64748b;");
    expect(latestBlockFor(".redesign-top-actions button:hover:not(:disabled)")).toContain("background: #f8fafc;");
    expect(latestBlockFor(".redesign-top-actions button:hover:not(:disabled)")).toContain("color: #2f4b77;");
    expect(latestBlockFor(".redesign-source-summary button:hover:not(:disabled)")).toContain("background: linear-gradient(135deg, #2749cf, #416fed);");
    expect(latestBlockFor(".redesign-source-summary button:hover:not(:disabled)")).toContain("color: #ffffff;");
    expect(latestBlockFor(".redesign-toast")).toContain("position: fixed");
  });

  test("brands overlapping agent letter badges by agent identity", () => {
    expect(latestBlockFor(".skill-agent-stack > .agent-badge")).toContain(
      "background: var(--agent-badge-background, linear-gradient(135deg, #3e7bfa, #2dd4bf));",
    );
    expect(latestBlockFor(".redesign-agent-stack > .agent-badge")).toContain(
      "background: var(--agent-badge-background, linear-gradient(135deg, #3154df, #46bfa4));",
    );
    expect(latestBlockFor(".agent-badge-logo")).toContain("width: 16px;");
    expect(latestBlockFor(".agent-badge-logo")).toContain("stroke: currentColor;");
    expect(latestBlockFor(".agent-badge")).toContain("color: var(--agent-badge-foreground, #ffffff);");
    expect(latestBlockFor(".agent-logo-fill")).toContain("fill: currentColor;");
    expect(latestBlockFor(".agent-logo-codex-cloud")).toContain("fill: var(--agent-logo-surface, currentColor);");
    expect(latestBlockFor(".agent-logo-codex-terminal")).toContain("stroke: var(--agent-logo-primary, currentColor);");
    expect(latestBlockFor(".agent-badge-letter")).toContain("font-weight: 850;");
    expect(latestBlockFor(".agent-badge-codex")).toContain(
      "--agent-badge-background: linear-gradient(135deg, #6f8df2 0%, #8b7cf2 100%);",
    );
    expect(latestBlockFor(".agent-badge-codex")).toContain("--agent-badge-foreground: #ffffff;");
    expect(latestBlockFor(".agent-badge-codex")).toContain("--agent-logo-surface: #ffffff;");
    expect(latestBlockFor(".agent-badge-codex")).toContain("--agent-logo-primary: #3867f4;");
    expect(latestBlockFor(".agent-badge-claude-code")).toContain("--agent-badge-background: #f4d7ca;");
    expect(latestBlockFor(".agent-badge-claude-code")).toContain("--agent-badge-foreground: #a9664d;");
    expect(latestBlockFor(".agent-badge-cursor")).toContain("--agent-badge-background: #e7eaf0;");
    expect(latestBlockFor(".agent-badge-cursor")).toContain("--agent-badge-foreground: #343a46;");
    expect(latestBlockFor(".agent-badge-opencode")).toContain("--agent-badge-background: #e3e8ef;");
    expect(latestBlockFor(".agent-badge-opencode")).toContain("--agent-badge-foreground: #334155;");
    expect(latestBlockFor(".agent-badge-openclaw")).toContain(
      "--agent-badge-background: #f7cccc;",
    );
    expect(latestBlockFor(".agent-badge-openclaw")).toContain("--agent-badge-foreground: #b94a4a;");
    expect(latestBlockFor(".agent-badge-hermes")).toContain(
      "--agent-badge-background: #f8fafc;",
    );
    expect(latestBlockFor(".agent-badge-hermes")).toContain("--agent-badge-foreground: #334155;");
    expect(latestBlockFor(".agent-badge-generic,\n.agent-badge-default")).toContain("--agent-badge-background: #eef2f7;");
    expect(latestBlockFor(".agent-badge-generic,\n.agent-badge-default")).toContain("--agent-badge-foreground: #64748b;");
  });

  test("defines the formal reference dashboard shell, skill cards, detail drawer, and settings table", () => {
    expect(stylesheet).toMatch(
      /\.metis-shell\s*\{[\s\S]*grid-template-columns:\s*188px minmax\(0,\s*1fr\);/,
    );
    expect(stylesheet).toMatch(
      /\.metis-sidebar\s*\{[\s\S]*border-radius:\s*28px 0 0 28px;/,
    );
    expect(stylesheet).toMatch(
      /\.skill-dashboard-stats\s*\{[\s\S]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\);/,
    );
    expect(stylesheet).toMatch(
      /\.skill-list\s*\{[\s\S]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/,
    );
    expect(stylesheet).toMatch(/\.skill-row\s*\{[\s\S]*grid-template-rows:/);
    expect(stylesheet).toMatch(/\.skill-agent-stack\s*\{[\s\S]*margin-left:\s*-7px;/);
    expect(stylesheet).toMatch(/\.source-drawer\s*\{[\s\S]*position:\s*fixed;/);
    expect(stylesheet).toMatch(/\.diff-panel\s*\{[\s\S]*grid-template-columns:/);
    expect(stylesheet).toMatch(/\.settings-agent-path-table\s*\{[\s\S]*display:\s*grid;/);
  });

  test("maps the formal desktop UI onto the same redesign visual system as the preview", () => {
    expect(stylesheet).toMatch(
      /\.metis-window\.redesign-preview-shell\s*\{[\s\S]*padding:\s*0;/,
    );
    expect(stylesheet).toMatch(
      /\.metis-window\.redesign-preview-shell\s*\{[\s\S]*background:\s*#ffffff;/,
    );
    expect(stylesheet).toMatch(
      /\.metis-shell\.redesign-app-window\s*\{[\s\S]*grid-template-columns:\s*188px minmax\(0,\s*1fr\);/,
    );
    expect(stylesheet).toMatch(
      /\.metis-shell\.redesign-app-window\s*\{[\s\S]*border-radius:\s*0;/,
    );
    expect(stylesheet).toMatch(
      /\.metis-shell\.redesign-app-window\s*\{[\s\S]*box-shadow:\s*none;/,
    );
    expect(stylesheet).toMatch(
      /\.metis-sidebar\.redesign-sidebar\s*\{[\s\S]*padding:\s*28px 16px;/,
    );
    expect(latestBlockFor(".metis-sidebar-brand-row")).toContain(
      "grid-template-columns: minmax(0, 1fr);",
    );
    expect(latestBlockFor(".metis-sidebar-footer")).toContain("align-self: end;");
    expect(latestBlockFor(".metis-sidebar-footer")).toContain("display: flex;");
    expect(latestBlockFor(".metis-sidebar-github")).toContain("width: 42px;");
    expect(latestBlockFor(".metis-sidebar-github")).toContain("height: 42px;");
    expect(latestBlockFor(".metis-sidebar-github")).toContain("border-radius: 14px;");
    expect(latestBlockFor(".metis-sidebar-github")).toContain("border: 0;");
    expect(latestBlockFor(".metis-sidebar-github")).toContain("box-shadow: none;");
    expect(latestBlockFor(".metis-sidebar-github")).toContain("align-self: center;");
    expect(latestBlockFor(".metis-sidebar-github")).toContain("justify-self: start;");
    expect(latestBlockFor(".metis-sidebar-github svg")).toContain("width: 20px;");
    expect(stylesheet).toMatch(/\.app-shell\.redesign-main\s*\{[\s\S]*padding:\s*24px;/);
    expect(stylesheet).toMatch(
      /\.topbar\.redesign-page-topbar\s*\{[\s\S]*grid-template-columns:\s*minmax\(120px,\s*0\.42fr\) minmax\(0,\s*1fr\) auto;/,
    );
    expect(stylesheet).toMatch(
      /\.topbar\.redesign-page-topbar \.topbar-actions\s*\{[\s\S]*display:\s*grid;[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\) auto;/,
    );
    expect(stylesheet).toMatch(
      /\.topbar-middle-slot\s*\{[\s\S]*min-width:\s*0;/,
    );
    expect(stylesheet).toMatch(
      /\.topbar-middle-slot\.is-empty\s*\{[\s\S]*min-height:\s*52px;/,
    );
    expect(stylesheet).toMatch(
      /\.redesign-top-actions\s*\{[\s\S]*display:\s*grid;[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(104px,\s*auto\)\);/,
    );
    expect(stylesheet).toMatch(
      /\.redesign-top-actions button\s*\{[\s\S]*min-width:\s*104px;[\s\S]*white-space:\s*nowrap;/,
    );
    expect(latestBlockFor(".metis-sidebar-nav.redesign-side-nav button")).toContain(
      "font-weight: 680;",
    );
    expect(latestBlockFor(".metis-sidebar-nav.redesign-side-nav button:hover:not(:disabled),\n.metis-sidebar-nav.redesign-side-nav button.active")).toContain(
      "color: #3154df;",
    );
    expect(latestBlockFor(".metis-sidebar-nav.redesign-side-nav button:hover:not(:disabled),\n.metis-sidebar-nav.redesign-side-nav button.active")).toContain(
      "box-shadow: none;",
    );
    expect(stylesheet).toMatch(
      /\.topbar-search\.redesign-search-field\s*\{[\s\S]*grid-template-columns:\s*22px minmax\(0,\s*1fr\);/,
    );
    expect(stylesheet).toMatch(
      /\.topbar-search\.redesign-search-field svg\s*\{[\s\S]*width:\s*22px;/,
    );
    expect(stylesheet).toMatch(
      /\.topbar-search\.redesign-search-field span::before,\s*\.topbar-search\.redesign-search-field span::after\s*\{[\s\S]*content:\s*none;/,
    );
    expect(stylesheet).toMatch(
      /\.topbar-search\.redesign-search-field input\s*\{[\s\S]*padding-left:\s*0;/,
    );
    expect(stylesheet).toMatch(
      /\.topbar-search\.redesign-search-field input:focus\s*\{[\s\S]*border-color:\s*transparent;[\s\S]*box-shadow:\s*none;/,
    );
    expect(stylesheet).toMatch(
      /\.skill-panel\.redesign-home\s*\{[\s\S]*gap:\s*12px;/,
    );
    expect(stylesheet).toMatch(
      /\.skill-dashboard-stats\.redesign-home-stats\s*\{[\s\S]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\);/,
    );
    expect(stylesheet).toMatch(
      /\.skill-list\.redesign-skill-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/,
    );
    expect(stylesheet).toMatch(
      /\.dashboard-stat-card\.redesign-stat-card\s*\{[\s\S]*min-height:\s*88px;/,
    );
    expect(latestBlockFor(".dashboard-stat-card.redesign-stat-card strong")).toContain(
      "font-weight: 720;",
    );
    expect(latestBlockFor(".dashboard-stat-card.redesign-stat-card span,\n.dashboard-stat-card.redesign-stat-card small")).toContain(
      "font-weight: 620;",
    );
    expect(stylesheet).toMatch(
      /\.skill-row\.redesign-skill-card\s*\{[\s\S]*min-height:\s*144px;/,
    );
    expect(stylesheet).toMatch(
      /\.skill-row\.redesign-skill-card\s*\{[\s\S]*grid-template-rows:\s*auto auto minmax\(30px,\s*1fr\) auto;/,
    );
    expect(stylesheet).toMatch(
      /\.skill-row\.redesign-skill-card\s*\{[\s\S]*transition:[\s\S]*transform 220ms cubic-bezier\(0\.22,\s*1,\s*0\.36,\s*1\);/,
    );
    expect(stylesheet).toMatch(
      /\.skill-row\.redesign-skill-card:hover\s*\{[\s\S]*transform:\s*translateY\(-2px\);/,
    );
    expect(latestBlockFor(".skill-row.redesign-skill-card:hover")).toContain(
      "box-shadow: 0 12px 24px rgba(30, 48, 78, 0.08);",
    );
    expect(latestBlockFor(".skill-row.redesign-skill-card .skill-main p")).toContain(
      "font-weight: 450;",
    );
    expect(latestBlockFor(".skill-row.redesign-skill-card > strong")).toContain(
      "font-weight: 680;",
    );
    expect(latestBlockFor(".redesign-show-more")).toContain("font-weight: 680;");
    expect(stylesheet).toMatch(
      /\.skill-row\.redesign-skill-card > small\s*\{[\s\S]*display:\s*none;/,
    );
    expect(stylesheet).toMatch(
      /\.skill-detail-card\.redesign-detail-summary\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\) minmax\(320px,\s*0\.48fr\);/,
    );
    expect(latestBlockFor(".skill-detail-card.redesign-detail-summary")).toContain(
      "var(--redesign-accent-start, #3154df)",
    );
    expect(latestBlockFor(".skill-detail-card.redesign-detail-summary")).toContain(
      "var(--redesign-accent-end, #4b7df0)",
    );
    expect(stylesheet).toMatch(
      /\.local-operations-card\.redesign-update-workbench\s*\{[\s\S]*padding:\s*20px;/,
    );
    expect(latestBlockFor(".skill-detail-page .redesign-detail-agent-panel")).toContain(
      "margin-top: -4px;",
    );
    expect(stylesheet).toMatch(
      /\.source-drawer\.redesign-source-drawer\s*\{[\s\S]*width:\s*min\(440px,\s*100vw\);/,
    );
    expect(stylesheet).toMatch(
      /\.settings-agent-path-table\.redesign-agent-path-table\s*\{[\s\S]*border-radius:\s*20px;/,
    );
  });

  test("keeps the formal detail summary compact and source action preview-aligned", () => {
    const introCopyBlock = latestBlockFor(
      ".skill-detail-card.redesign-detail-summary .skill-intro-heading p",
    );
    expect(introCopyBlock).toContain("display: -webkit-box;");
    expect(introCopyBlock).toContain("-webkit-line-clamp: 2;");
    expect(introCopyBlock).toContain("overflow: hidden;");
    expect(introCopyBlock).toContain("max-height: 48px;");

    const sourceSummaryBlock = latestBlockFor(
      ".skill-detail-card.redesign-detail-summary .redesign-source-summary",
    );
    expect(sourceSummaryBlock).toContain("grid-template-columns: minmax(0, 1fr);");
    expect(sourceSummaryBlock).toContain("justify-content: stretch;");
    expect(sourceSummaryBlock).toContain("justify-items: start;");
    expect(sourceSummaryBlock).toContain("text-align: left;");

    const sourceButtonBlock = latestBlockFor(
      ".skill-detail-card.redesign-detail-summary .redesign-source-summary button",
    );
    expect(sourceButtonBlock).toContain("min-width: 116px;");
    expect(sourceButtonBlock).toContain("min-height: 44px;");
    expect(sourceButtonBlock).toContain("padding: 0 18px;");
    expect(sourceButtonBlock).toContain("background: linear-gradient(135deg, #3154df, #4b7df0);");
    expect(sourceButtonBlock).toContain("color: #ffffff;");
  });
});
