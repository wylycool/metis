import { existsSync, readFileSync } from "node:fs";
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

function mediaBlocksFor(query: string): string[] {
  const marker = `@media ${query}`;
  const blocks: string[] = [];
  let cursor = 0;

  while (cursor < stylesheet.length) {
    const start = stylesheet.indexOf(marker, cursor);
    if (start === -1) {
      break;
    }
    const openingBrace = stylesheet.indexOf("{", start + marker.length);
    let depth = 0;
    let end = openingBrace;
    for (; end < stylesheet.length; end += 1) {
      if (stylesheet[end] === "{") {
        depth += 1;
      } else if (stylesheet[end] === "}") {
        depth -= 1;
        if (depth === 0) {
          blocks.push(stylesheet.slice(start, end + 1));
          cursor = end + 1;
          break;
        }
      }
    }
    if (end >= stylesheet.length) {
      break;
    }
  }

  return blocks;
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
  test("does not ship the obsolete dark-gold global theme baseline", () => {
    const firstComponentRule = stylesheet.indexOf(".app-shell");
    const globalPrelude = stylesheet.slice(0, firstComponentRule);

    expect(firstComponentRule).toBeGreaterThan(0);
    expect(globalPrelude).not.toMatch(/:root\s*\{/);
    expect(globalPrelude).not.toContain("#111317");
    expect(globalPrelude).not.toContain("#191d23");
    expect(globalPrelude).not.toContain("#20262e");
    expect(globalPrelude).not.toContain("#d0a84f");
    expect(globalPrelude).not.toContain("#101216");
    expect(globalPrelude).not.toMatch(
      /^\s*(color|background|border-color|box-shadow|accent-color):/m,
    );
    expect(globalPrelude).toContain("box-sizing: border-box;");
    expect(globalPrelude).toContain("min-width: 320px;");
  });

  test("does not copy one-off static UI previews into production assets", () => {
    expect(existsSync("public/auto-update-remove-preview.html")).toBe(false);
    expect(existsSync("public/git-check-failures.html")).toBe(false);
  });

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
    expect(stylesheet).not.toContain(".workspace-tabs");
  });

  test("keeps the refreshed desktop chrome compact while allowing dashboard cards", () => {
    expect(stylesheet).toMatch(/\.skill-row\s*\{[\s\S]*min-height:\s*184px;/);
    expect(declaredPx(latestBlockFor(".topbar"), "min-height")).toBeLessThanOrEqual(68);
    expect(declaredPx(latestBlockFor(".status-filter-button"), "min-height")).toBeLessThanOrEqual(42);
  });

  test("keeps Add Skill surfaces in the light command sheet system", () => {
    expect(latestBlockFor(".add-skill-header")).toContain("background: var(--command-surface);");
    expect(latestBlockFor(".add-skill-header")).toContain("color: var(--ink);");
    expect(latestBlockFor(".add-skill-page .remote-sync-panel")).toContain(
      "background: var(--command-surface);",
    );
    expect(latestBlockFor(".add-skill-page .target-matrix")).toContain(
      "background: var(--command-surface);",
    );
    expect(latestBlockFor(".remote-target-loading")).toContain("position: relative;");
    expect(latestBlockFor(".remote-target-loading")).toContain("overflow: hidden;");
    expect(latestBlockFor(".remote-target-loading")).toContain("grid-template-columns: auto 1fr;");
    expect(latestBlockFor(".remote-target-loading")).toContain("background: linear-gradient(135deg");
    expect(latestBlockFor(".remote-target-loading::after")).toContain("content: \"\";");
    expect(latestBlockFor(".remote-target-loading::after")).toContain(
      "animation: remoteTargetLoadingSweep 1250ms ease-in-out infinite;",
    );
    expect(blockFor(".remote-target-loading-spinner")).toContain(
      "animation: remoteTargetLoadingSpin 820ms linear infinite;",
    );
    expect(stylesheet).toContain("@keyframes remoteTargetLoadingSweep");
    expect(stylesheet).toContain("@keyframes remoteTargetLoadingSpin");
    expect(latestBlockFor(".add-skill-page .remote-target-row")).toContain(
      "background: rgba(248, 250, 252, 0.72);",
    );
    expect(latestBlockFor(".add-skill-page .remote-target-row.failed")).toContain(
      "background: rgba(248, 250, 252, 0.72);",
    );
    expect(latestBlockFor(".add-skill-page .remote-target-row.failed")).toContain(
      "border-color: rgba(203, 213, 225, 0.86);",
    );
    expect(latestBlockFor(".add-skill-page .remote-target-row.failed")).not.toContain(
      "rgba(255, 247, 237",
    );
    expect(latestBlockFor(".add-skill-page .remote-target-row.failed:hover")).toContain(
      "background: rgba(241, 245, 249, 0.92);",
    );
    expect(latestBlockFor(".target-status-danger")).toContain("background: var(--danger-bg");
    expect(latestBlockFor(".remote-preview-card")).toContain("var(--redesign-accent-start");
    expect(latestBlockFor(".remote-preview-card")).toContain("var(--redesign-accent-end");
    expect(latestBlockFor(".remote-preview-card")).toContain("position: relative;");
    expect(latestBlockFor(".remote-preview-card")).toContain("overflow: hidden;");
    expect(stylesheet).not.toContain(".remote-preview-version");
    expect(stylesheet).not.toContain(".remote-preview-version-label");
    expect(stylesheet).not.toContain(".remote-preview-card::before");
    expect(stylesheet).not.toContain("remotePreviewSparkleBurst");
    expect(blockFor(".remote-preview-card::after")).toContain("content: \"\";");
    expect(blockFor(".remote-preview-card::after")).toContain("inset: -42% auto -42% -86%;");
    expect(blockFor(".remote-preview-card::after")).toContain("width: 72%;");
    expect(blockFor(".remote-preview-card::after")).toContain("linear-gradient(105deg");
    expect(blockFor(".remote-preview-card::after")).toContain("rgba(255, 255, 255, 0.9) 50%");
    expect(blockFor(".remote-preview-card::after")).toContain(
      "animation: remotePreviewSunSweep 1450ms ease-in-out 180ms both;",
    );
    expect(stylesheet).toContain("@keyframes remotePreviewSunSweep");
    expect(stylesheet).toContain("transform: translateX(315%) skewX(-16deg);");
    expect(stylesheet).toContain("@media (prefers-reduced-motion: reduce)");
    expect(stylesheet).toContain(".remote-preview-card::after");
    expect(stylesheet).toContain(".remote-target-loading::after");
    expect(stylesheet).toContain(".remote-target-loading-spinner");
    expect(latestBlockFor(".remote-preview-success-hint")).toContain("border: 0;");
    expect(latestBlockFor(".remote-preview-success-hint")).toContain("background: transparent;");
    expect(latestBlockFor(".remote-preview-success-hint")).not.toContain("linear-gradient");
    expect(latestBlockFor(".remote-preview-success-hint span")).toContain("color: #0f766e;");
    expect(latestBlockFor(".remote-preview-success-hint span")).toContain(
      "background: rgba(20, 160, 118, 0.1);",
    );
    expect(latestBlockFor(".remote-preview-success-hint strong")).toContain("color: #0f766e;");
    expect(latestBlockFor(".cross-agent-matrix .remote-target-checkbox")).toContain(
      "accent-color: var(--command-accent);",
    );
    expect(latestBlockFor(".cross-agent-matrix .target-install-button")).not.toContain(
      "background: var(--ink)",
    );
    expect(latestBlockFor(".cross-agent-matrix .target-install-button:hover:not(:disabled)")).toContain(
      "background: #ddf7ee;",
    );
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
    expect(
      declaredPx(latestBlockFor(".metis-sidebar-nav.redesign-side-nav button"), "font-size"),
    ).toBeLessThanOrEqual(15);
    expect(declaredPx(latestBlockFor(".metric strong"), "font-size")).toBeLessThanOrEqual(22);
    expect(declaredPx(latestBlockFor(".agent-filter-pill"), "font-size")).toBeLessThanOrEqual(13);
  });

  test("defines a soft shadow token for B direction detail cards", () => {
    expect(stylesheet).toContain("--shadow-soft:");
    expect(latestBlockFor(".skill-detail-card")).toContain("box-shadow: var(--shadow-soft);");
  });

  test("defines source drawer and three-line intro copy constraints", () => {
    expect(latestBlockFor(".source-drawer")).toContain("position: fixed");
    expect(latestBlockFor(".source-drawer.redesign-source-drawer")).toContain(
      "grid-template-rows: auto minmax(0, 1fr);",
    );
    expect(latestBlockFor(".source-drawer.redesign-source-drawer")).toContain("overflow: hidden;");
    expect(latestBlockFor(".source-form")).toContain("min-height: 0;");
    expect(latestBlockFor(".source-form")).toContain("grid-template-rows: minmax(0, 1fr) auto;");
    expect(latestBlockFor(".source-form-body")).toContain("overflow-y: auto;");
    expect(latestBlockFor(".source-form-body")).toContain("gap: 18px;");
    expect(latestBlockFor(".source-form-body")).toContain("user-select: text;");
    expect(latestBlockFor(".source-field-label-row")).toContain("grid-template-columns: minmax(0, 1fr) auto;");
    expect(exactBlockFor(".source-help-popover")).toContain("user-select: text;");
    expect(latestBlockFor(".source-help-button")).toContain(
      "background: var(--source-help-button-bg);",
    );
    expect(latestBlockFor(".source-help-button[aria-expanded=\"true\"]")).toContain(
      "background: var(--source-help-hover-bg);",
    );
    expect(latestBlockFor(".source-help-button:hover:not(:disabled)")).toContain(
      "background: var(--source-help-hover-bg);",
    );
    expect(latestBlockFor(".source-help-button:hover:not(:disabled)")).not.toContain(
      "var(--primary-hover)",
    );
    expect(latestBlockFor(".source-help-popover")).toContain("gap: 12px;");
    expect(latestBlockFor(".source-help-popover")).toContain("border-radius: 16px;");
    expect(latestBlockFor(".source-help-card")).toContain("display: grid;");
    expect(latestBlockFor(".source-help-card code")).toContain("user-select: text;");
    expect(exactBlockFor(".source-form-field input")).toContain("min-height: 48px;");
    expect(latestBlockFor(".git-source-fields--compact .source-field-stack")).toContain("gap: 10px;");
    expect(exactBlockFor(".git-source-fields--compact .source-secondary-fields")).toContain(
      "grid-template-columns: minmax(0, 1fr) minmax(120px, 0.42fr);",
    );
    expect(stylesheet).toMatch(
      /@media\s*\(max-width:\s*760px\)\s*\{[\s\S]*\.git-source-fields--compact \.source-secondary-fields\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\);/,
    );
    expect(latestBlockFor(".git-source-fields--compact .source-form-field input")).toContain(
      "min-height: 40px;",
    );
    expect(latestBlockFor(".source-form-field input::placeholder")).toContain("font-weight: 600;");
    expect(latestBlockFor(".source-settings-grid")).toContain("gap: 10px;");
    expect(latestBlockFor(".source-setting-row")).toContain(
      "grid-template-columns: 22px minmax(0, 1fr);",
    );
    expect(latestBlockFor(".source-verification-panel .source-connection-check")).toContain("display: flex;");
    expect(latestBlockFor(".source-verification-panel .source-connection-check")).toContain("align-items: center;");
    expect(latestBlockFor(".source-test-button")).toContain("display: inline-flex;");
    expect(latestBlockFor(".source-test-button")).toContain("white-space: nowrap;");
    expect(latestBlockFor(".source-test-button")).toContain("min-width: 104px;");
    expect(latestBlockFor(".source-test-button")).toContain("background: #2563eb;");
    expect(latestBlockFor(".source-test-button:hover:not(:disabled)")).toContain("background: #eff6ff;");
    expect(latestBlockFor(".source-test-button:disabled")).toContain("background: #dbeafe;");
    expect(latestBlockFor(".source-test-button:disabled")).toContain("cursor: default;");
    expect(latestBlockFor(".source-test-button:disabled")).not.toContain("cursor: wait;");
    expect(latestBlockFor(".source-test-button[data-busy=\"true\"]")).toContain("cursor: default;");
    expect(latestBlockFor(".source-save-button:disabled")).toContain("cursor: default;");
    expect(latestBlockFor(".source-save-button[data-busy=\"true\"]")).toContain("cursor: default;");
    expect(exactBlockFor("button:disabled")).toContain("cursor: default;");
    expect(exactBlockFor("button:disabled")).not.toContain("cursor: wait;");
    const previewDisabledBlock = latestBlockFor(".add-skill-preview-button:disabled");
    expect(previewDisabledBlock).toContain("cursor: default;");
    expect(previewDisabledBlock).not.toContain("cursor: wait;");
    expect(latestBlockFor(".settings-section.git-health-section")).toContain("min-height: auto;");
    expect(latestBlockFor(".settings-section.git-health-section")).toContain("grid-template-rows: auto auto;");
    expect(latestBlockFor(".settings-git-health-heading")).toContain("justify-content: space-between;");
    expect(latestBlockFor(".settings-git-health-card")).toContain("display: grid;");
    expect(latestBlockFor(".settings-git-health-card")).toContain("border: 0;");
    expect(latestBlockFor(".settings-git-health-card")).toContain("padding: 0;");
    expect(latestBlockFor(".settings-git-health-card:empty")).toContain("display: none;");
    expect(latestBlockFor(".settings-git-test-button")).toContain("min-width: 108px;");
    expect(exactBlockFor(".auto-update-run")).toContain("min-width: 108px;");
    expect(latestBlockFor(".settings-git-health-notice")).toContain("background: #fff7ed;");
    expect(latestBlockFor(".settings-git-health-notice")).toContain("border: 1px solid #fed7aa;");
    expect(latestBlockFor(".settings-git-health-notice")).not.toContain("danger");
    expect(latestBlockFor(".settings-git-health-notice")).not.toContain("#dc2626");
    expect(latestBlockFor(".custom-monitor-add")).toContain("justify-self: end;");
    expect(latestBlockFor(".custom-monitor-add")).toContain("min-width: 78px;");
    expect(exactBlockFor(".path-management-heading")).toContain("display: flex;");
    expect(exactBlockFor(".path-status-legend")).toContain("display: inline-flex;");
    expect(latestBlockFor(".path-status-legend-item")).toContain("white-space: nowrap;");
    expect(
      latestBlockFor(".settings-agent-path-row.redesign-agent-path-row input[readonly]"),
    ).toContain("background: #eef2f6;");
    expect(exactBlockFor(".agent-path-row-actions")).toContain("justify-self: end;");
    expect(latestBlockFor(".agent-path-pending-badge")).toContain("white-space: nowrap;");
    expect(latestBlockFor(".redesign-agent-path-row span.pending::before")).toContain(
      "background: #64748b;",
    );
    expect(
      mediaBlocksFor("(max-width: 760px)").some((block) =>
        /\.settings-agent-path-row\.redesign-agent-path-row\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/.test(
          block,
        ),
      ),
    ).toBe(true);
    expect(latestBlockFor(".settings-save-button")).toContain("min-width: 108px;");
    expect(latestBlockFor(".source-form .form-actions")).toContain("position: sticky;");
    expect(latestBlockFor(".source-form .form-actions")).toContain("bottom: 0;");
    expect(exactBlockFor(".settings-section.auto-update-section")).toContain("gap: 10px 20px;");
    expect(exactBlockFor(".settings-section.auto-update-section")).toContain("align-items: start;");
    expect(exactBlockFor(".settings-section.auto-update-section")).toContain("border: 1px solid #d9e1ee;");
    expect(exactBlockFor(".settings-section.auto-update-section")).toContain("border-radius: 14px;");
    expect(exactBlockFor(".settings-section.auto-update-section")).toContain("padding: 14px;");
    expect(exactBlockFor(".settings-section.auto-update-section")).toContain(
      "background: #ffffff;",
    );
    expect(exactBlockFor(".settings-section.auto-update-section")).toContain(
      "box-shadow: none;",
    );
    expect(exactBlockFor(".auto-update-run")).toContain("grid-column: 2;");
    expect(exactBlockFor(".auto-update-run")).toContain("justify-self: end;");
    expect(exactBlockFor(".auto-update-run")).toContain("min-width: 108px;");
    expect(latestBlockFor(".auto-update-source-list")).toContain("display: grid;");
    expect(latestBlockFor(".auto-update-source-list")).toContain("grid-column: 1 / -1;");
    expect(latestBlockFor(".auto-update-source-list")).toContain("gap: 10px;");
    expect(latestBlockFor(".auto-update-source-row")).toContain(
      "grid-template-columns: minmax(0, 1fr) auto;",
    );
    expect(exactBlockFor(".auto-update-source-row")).toContain("gap: 10px 16px;");
    expect(exactBlockFor(".auto-update-source-row")).toContain("border: 1px solid #dde6f2;");
    expect(exactBlockFor(".auto-update-source-row")).toContain("border-radius: 18px;");
    expect(exactBlockFor(".auto-update-source-row")).toContain("padding: 13px 14px;");
    expect(exactBlockFor(".auto-update-source-row")).toContain(
      "background: linear-gradient(180deg, #fbfdff, #f8fafc);",
    );
    expect(exactBlockFor(".auto-update-source-row.is-open")).toContain("border-color: #c9d9ec;");
    expect(exactBlockFor(".auto-update-trusted-chip")).toContain("color: #0f766e;");
    expect(exactBlockFor(".auto-update-trusted-chip")).toContain("background: #e8faf5;");
    expect(exactBlockFor(".auto-update-empty-state")).toContain("border: 1px dashed #cdd8e7;");
    expect(exactBlockFor(".auto-update-empty-state")).toContain("background: #f8fbff;");
    expect(exactBlockFor(".auto-update-remove-actions")).toContain("display: inline-flex;");
    expect(exactBlockFor(".auto-update-remove-actions")).toContain("justify-self: end;");
    expect(exactBlockFor(".auto-update-remove-actions")).not.toContain("grid-column: 1 / -1;");
    expect(exactBlockFor(".auto-update-remove")).toContain("justify-self: end;");
    expect(exactBlockFor(".auto-update-remove")).not.toContain("background:");
    expect(exactBlockFor(".auto-update-remove")).not.toContain("color:");
    expect(exactBlockFor(".auto-update-remove-confirm")).toContain("grid-column: 1 / -1;");
    expect(exactBlockFor(".auto-update-remove-confirm")).toContain(
      "linear-gradient(90deg, rgba(245, 158, 11, 0.1), transparent 42%),",
    );
    expect(exactBlockFor(".auto-update-remove-confirm")).toContain("#fff8eb;");
    expect(exactBlockFor(".auto-update-remove-confirm")).toContain("border: 1px solid #f3d59b;");
    expect(exactBlockFor(".auto-update-remove-confirm-actions")).toContain("display: inline-flex;");
    expect(exactBlockFor(".auto-update-cancel")).toContain("background: #ffffff;");
    expect(exactBlockFor(".auto-update-cancel")).toContain("border: 1px solid #c8d5e4;");
    expect(exactBlockFor(".auto-update-confirm")).toContain("color: #b42318;");
    expect(exactBlockFor(".auto-update-confirm")).toContain("background: #fff1ed;");
    expect(exactBlockFor(".auto-update-confirm")).toContain("border: 1px solid #ffc7bd;");
    expect(exactBlockFor(".auto-update-confirm")).toContain("min-width: 104px;");
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
    expect(exactBlockFor(".topbar-secondary-action")).toContain(
      "background: var(--command-surface);",
    );
    expect(exactBlockFor(".topbar-secondary-action:hover:not(:disabled)")).not.toContain(
      "background: var(--ink-hover);",
    );
    expect(stylesheet).not.toContain("--command-purple-soft:");
    expect(latestBlockFor(".add-skill-button")).toContain("background: var(--command-surface);");
    expect(latestBlockFor(".skill-sort-control")).toContain("background: var(--command-surface);");
    expect(latestBlockFor(".skill-sort-control")).toContain("border-radius: 8px;");
    expect(latestBlockFor(".skill-sort-control")).toContain("font-weight: 500;");
    expect(latestBlockFor(".skill-sort-control span")).toContain("font-weight: 500;");
    expect(latestBlockFor(".skill-sort-control select")).toContain("appearance: none;");
    expect(latestBlockFor(".skill-sort-control select")).toContain("font-weight: 500;");
    expect(latestBlockFor(".skill-sort-control select:focus")).toContain("outline: none;");
    expect(latestBlockFor(".skill-sort-control:hover")).toContain(
      "background: var(--command-selected);",
    );
    expect(latestBlockFor(".skill-sort-control:hover")).not.toContain(
      "background: var(--ink-hover);",
    );
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

  test("renders cross-agent target statuses as colored badges", () => {
    expect(stylesheet).toContain(".target-status-badge");
    expect(stylesheet).toContain(".target-status-good");
    expect(stylesheet).toContain(".target-status-warning");
    expect(stylesheet).toContain(".target-status-danger");
    expect(stylesheet).toContain(".target-status-muted");
    expect(exactBlockFor(".target-status-badge")).toContain("border-radius: 999px;");
    expect(latestBlockFor(".cross-agent-matrix .target-matrix-select-all")).not.toContain(
      "background: var(--ink)",
    );
    expect(latestBlockFor(".cross-agent-matrix .target-matrix-select-all")).toContain(
      "background: var(--command-surface);",
    );
    expect(
      latestBlockFor(".cross-agent-matrix .target-matrix-select-all:hover:not(:disabled)"),
    ).toContain("background: var(--command-selected);");
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
    expect(exactBlockFor(".redesign-detail-agent-header")).toContain(
      "grid-template-columns: minmax(0, 1fr);",
    );
    expect(stylesheet).not.toContain(".redesign-detail-agent-install-action");
    expect(latestBlockFor(".detail-install-targets")).toContain("display: grid;");
    expect(exactBlockFor(".detail-install-targets .remote-target-row.redesign-detail-agent-path-row")).toContain(
      "grid-template-columns: auto auto minmax(112px, max-content) minmax(0, 1fr) auto;",
    );
    expect(exactBlockFor(".detail-install-targets .remote-target-agent-name")).toContain(
      "min-width: 0;",
    );
    expect(exactBlockFor(".detail-install-targets .remote-target-agent-name")).toContain(
      "width: 100%;",
    );
    expect(exactBlockFor(".detail-install-targets .remote-target-row code")).toContain(
      "min-width: 0;",
    );
    expect(mediaBlocksFor("(max-width: 760px)").join("\n")).toMatch(
      /\.detail-install-targets \.remote-target-row\.redesign-detail-agent-path-row\s*\{[\s\S]*grid-template-columns:\s*auto auto minmax\(0, 1fr\) auto;/,
    );
    expect(mediaBlocksFor("(max-width: 760px)").join("\n")).toMatch(
      /\.detail-install-targets \.remote-target-row code\s*\{[\s\S]*grid-column:\s*3 \/ -1;[\s\S]*grid-row:\s*2;/,
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
    expect(exactBlockFor(".redesign-detail-agent-path-row")).toContain("background: rgba(248, 250, 252, 0.72);");
    expect(exactBlockFor(".redesign-detail-agent-path-row")).toContain("grid-template-columns: auto minmax(96px, 0.24fr) minmax(0, 1fr) auto auto;");
    expect(latestBlockFor(".redesign-detail-agent-path-row.update")).toContain("background: rgba(239, 246, 255, 0.88);");
    expect(latestBlockFor(".redesign-detail-agent-path-row.latest small")).toContain("color: #157a58;");
    expect(latestBlockFor(".redesign-detail-agent-path-row .agent-badge")).toContain("margin-left: 0;");
    expect(exactBlockFor(".redesign-detail-agent-path-row code")).toContain("color: #64748b;");
    expect(latestBlockFor(".redesign-detail-agent-row-action")).toContain("white-space: nowrap;");
    expect(latestBlockFor(".redesign-backup-panel .backup-row")).toContain("grid-template-columns: minmax(0, 1fr) auto;");
    expect(exactBlockFor(".redesign-side-nav button")).toContain("color: #526174;");
    expect(exactBlockFor(".redesign-side-nav button:hover:not(:disabled)")).toContain("background: #eef4ff;");
    expect(exactBlockFor(".redesign-side-nav button:hover:not(:disabled)")).toContain("box-shadow: none;");
    expect(latestBlockFor(".redesign-skill-card:hover:not(:disabled)")).toContain("transform: translateY(-2px);");
    expect(latestBlockFor(".redesign-skill-card:hover:not(:disabled)")).toContain(
      "box-shadow: 0 14px 28px rgba(30, 48, 78, 0.1);",
    );
    expect(latestBlockFor(".redesign-top-actions button:hover:not(:disabled)")).toContain("background: #f8fafc;");
    expect(latestBlockFor(".redesign-top-actions button:hover:not(:disabled)")).toContain("color: #2f4b77;");
    expect(latestBlockFor(".redesign-source-summary button:hover:not(:disabled)")).toContain("background: linear-gradient(135deg, #2749cf, #416fed);");
    expect(latestBlockFor(".redesign-source-summary button:hover:not(:disabled)")).toContain("color: #ffffff;");
    expect(latestBlockFor(".redesign-toast")).toContain("position: fixed");
    expect(latestBlockFor(".redesign-toast.success-toast")).toContain("background: linear-gradient(135deg, #ecfdf5 0%, #ffffff 72%);");
    expect(latestBlockFor(".redesign-toast.info-toast")).toContain("background: linear-gradient(135deg, #eff6ff 0%, #ffffff 72%);");
    expect(latestBlockFor(".redesign-toast.warning-toast")).toContain("background: linear-gradient(135deg, #fffaf0 0%, #ffffff 68%);");
    expect(latestBlockFor(".redesign-toast.warning-toast")).toContain("border-color: rgba(214, 139, 38, 0.28);");
    expect(latestBlockFor(".skill-dashboard-stats.is-check-complete .dashboard-stat-card")).toContain("animation: dashboardCheckPulse");
    expect(exactBlockFor(".skill-dashboard-check-complete")).toContain("position: absolute;");
    expect(exactBlockFor(".skill-dashboard-check-complete")).toContain("bottom: calc(100% + 4px);");
    expect(exactBlockFor(".skill-dashboard-check-complete")).not.toContain("top:");
    expect(exactBlockFor(".skill-dashboard-check-complete")).toContain("color: #ffffff;");
    expect(exactBlockFor(".skill-dashboard-check-complete")).toContain("background: #173b2d;");
    expect(latestBlockFor(".app-shell.redesign-main:has(.skill-dashboard-stats)")).toContain("gap: 30px;");
    expect(latestBlockFor(".source-required-toast")).toContain("grid-template-columns: auto minmax(0, 1fr) auto;");
    expect(latestBlockFor(".source-required-toast")).not.toContain("background:");
    expect(latestBlockFor(".source-required-toast")).not.toContain("box-shadow:");
    expect(latestBlockFor(".source-required-toast-icon")).toContain("background: #f5b84b;");
    expect(latestBlockFor(".source-required-toast-action")).toContain("background: #fff7ed;");
    expect(latestBlockFor(".source-required-toast-action")).not.toContain("background: var(--ink)");
    expect(latestBlockFor(".source-required-toast-action:hover")).toContain("background: #ffedd5;");
    expect(latestBlockFor(".source-required-toast-action:hover")).toContain("color: #8a4b0f;");
  });

  test("uses the native Metis i dot without a decorative overlay", () => {
    expect(latestBlockFor(".redesign-brand .metis-brand-wordmark")).toContain(
      "letter-spacing: -0.02em;",
    );
    expect(latestBlockFor(".metis-brand-wordmark-base")).toContain("color: #172033;");
    expect(latestBlockFor(".metis-brand-wordmark-i")).toContain("position: relative;");
    expect(latestBlockFor(".metis-brand-wordmark-i")).toContain("color: #3154df;");
    expect(latestBlockFor(".metis-brand-wordmark-i")).toContain("font-family: ui-rounded");
    expect(latestBlockFor(".metis-brand-wordmark-i")).toContain("font-weight: 800;");
    expect(stylesheet).not.toContain(".metis-brand-wordmark-i::after");
    expect(blockFor(".metis-brand-wordmark-s")).toContain("background: linear-gradient(");
    expect(blockFor(".metis-brand-wordmark-s")).toContain("color: #6a4bd8;");
    expect(blockFor(".metis-brand-wordmark-s")).toContain("font-family: ui-rounded");
    expect(blockFor(".metis-brand-wordmark-s")).toContain("font-weight: 800;");
    expect(blockFor(".metis-brand-wordmark-s")).toContain("display: inline-block;");
    expect(blockFor(".metis-brand-wordmark-s")).toContain("padding-right: 0.1em;");
    expect(blockFor(".metis-brand-wordmark-s")).toContain("margin-right: -0.1em;");
    expect(blockFor(".metis-brand-wordmark-s")).toContain("#6a4bd8 52%");
    expect(blockFor(".metis-brand-wordmark-s")).toContain("#0b7788 100%");
    expect(blockFor(".metis-brand-wordmark-s")).toContain(
      "-webkit-background-clip: text;",
    );
    expect(blockFor(".metis-brand-wordmark-s")).toContain(
      "-webkit-text-fill-color: transparent;",
    );
    expect(latestBlockFor(".redesign-logo-mark img")).toContain("width: 50px;");
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

  test("keeps detail operation buttons semantic and light across interaction states", () => {
    const base = latestBlockFor(".redesign-operation-tabs .operation-button");
    expect(base).toContain("display: inline-flex;");
    expect(base).toContain("height: 40px;");
    expect(base).toContain("background: var(--operation-surface);");
    expect(base).toContain("border-color: var(--operation-border);");
    expect(base).toContain("transition:");
    expect(base).toContain("transform: none;");

    const fixedShortButton = latestBlockFor(
      ".redesign-operation-tabs .operation-button:not(.operation-button--update)",
    );
    expect(fixedShortButton).toContain("width: 112px;");
    expect(fixedShortButton).toContain("flex: 0 0 112px;");

    const marker = latestBlockFor(".redesign-operation-tabs .operation-button::before");
    expect(marker).toContain("width: 15px;");
    expect(marker).toContain("height: 15px;");
    expect(marker).toContain("flex: 0 0 15px;");
    expect(marker).toContain("background: radial-gradient(");
    expect(marker).toContain("box-shadow: none;");

    expect(latestBlockFor(".redesign-operation-tabs .operation-button--check")).toContain(
      "--operation-accent: #2f6fd6;",
    );
    expect(latestBlockFor(".redesign-operation-tabs .operation-button--diff")).toContain(
      "--operation-accent: #6d5bd0;",
    );
    expect(latestBlockFor(".redesign-operation-tabs .operation-button--backup")).toContain(
      "--operation-accent: #b7791f;",
    );
    expect(latestBlockFor(".redesign-operation-tabs .operation-button--update")).toContain(
      "--operation-accent: #0f8a72;",
    );

    expect(
      latestBlockFor(".redesign-operation-tabs .operation-button:hover:not(:disabled)"),
    ).toContain("background: var(--operation-hover-surface);");
    expect(latestBlockFor(".redesign-operation-tabs .operation-button:focus-visible")).toContain(
      "box-shadow: 0 0 0 3px var(--operation-ring);",
    );
    expect(
      latestBlockFor(".redesign-operation-tabs .operation-button:active:not(:disabled)"),
    ).toContain("box-shadow: inset 0 1px 2px var(--operation-pressed-shadow);");

    const selected = latestBlockFor(
      '.redesign-operation-tabs .operation-button[aria-expanded="true"]',
    );
    expect(selected).toContain("color: var(--operation-selected-text);");
    expect(selected).toContain("background: var(--operation-selected-surface);");
    expect(selected).toContain("box-shadow:");
    expect(selected).toContain("var(--operation-rest-shadow)");
    expect(selected).not.toContain("0 5px 14px");
    expect(selected).not.toContain("linear-gradient");
    expect(selected).not.toContain("color: #ffffff");
    expect(
      latestBlockFor('.redesign-operation-tabs .operation-button[aria-expanded="true"]::before'),
    ).toContain("box-shadow: none;");
    expect(
      latestBlockFor(
        '.redesign-operation-tabs .operation-button[aria-expanded="true"]:active:not(:disabled)',
      ),
    ).toContain("background: var(--operation-pressed-surface);");

    const disabled = latestBlockFor(
      '.redesign-operation-tabs .operation-button:disabled:not([aria-busy="true"])',
    );
    expect(disabled).toContain("opacity: 1;");
    expect(disabled).toContain("background: #f8fafc;");
    const busyMarker = blockFor(
      '.redesign-operation-tabs .operation-button[aria-busy="true"]::before',
    );
    expect(busyMarker).toContain("width: 15px;");
    expect(busyMarker).toContain("height: 15px;");
    expect(busyMarker).toContain("box-sizing: border-box;");
    expect(busyMarker).toContain("animation: detailOperationSpin 760ms linear infinite;");
    expect(stylesheet).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*\.redesign-operation-tabs \.operation-button\[aria-busy="true"\]::before[\s\S]*animation:\s*none;/,
    );
    expect(stylesheet).not.toMatch(
      /\.redesign-operation-tabs button\.active\s*\{[^}]*linear-gradient/,
    );
    expect(stylesheet).not.toMatch(
      /\.detail-action-row\.redesign-operation-tabs button\.active\s*\{[^}]*linear-gradient/,
    );
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
      /\.dashboard-stat-card\.redesign-stat-card\s*\{[\s\S]*min-height:\s*80px;/,
    );
    expect(latestBlockFor(".dashboard-stat-card.redesign-stat-card")).not.toContain(
      "grid-template-columns:",
    );
    expect(stylesheet).not.toContain(".dashboard-stat-icon");
    expect(latestBlockFor(".dashboard-stat-card.redesign-stat-card strong")).toContain(
      "font-weight: 720;",
    );
    expect(latestBlockFor(".dashboard-stat-card.redesign-stat-card span")).toContain(
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
    expect(latestBlockFor(".redesign-show-more:hover:not(:disabled)")).toContain(
      "background: #e6f0ff;",
    );
    expect(latestBlockFor(".redesign-show-more:hover:not(:disabled)")).toContain(
      "color: #2749cf;",
    );
    expect(latestBlockFor(".redesign-show-more:focus-visible")).toContain(
      "background: #e6f0ff;",
    );
    expect(latestBlockFor(".redesign-show-more:active")).toContain("background: #dce9ff;");
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
    expect(latestBlockFor(".source-drawer.redesign-source-drawer.is-closing")).toContain(
      "animation: redesignDrawerOut 140ms ease-in forwards;",
    );
    expect(stylesheet).toContain("@keyframes redesignDrawerOut");
    expect(stylesheet).toMatch(
      /\.settings-agent-path-table\.redesign-agent-path-table\s*\{[\s\S]*border-radius:\s*14px;/,
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

  test("gives source help popovers distinct low-saturation field tones", () => {
    expect(blockFor(".source-help--url")).toContain("--source-help-accent:");
    expect(blockFor(".source-help--path")).toContain("--source-help-accent:");
    expect(blockFor(".source-help--ref")).toContain("--source-help-accent:");

    const urlAccent = latestVariableValue("--source-help-url-accent");
    const pathAccent = latestVariableValue("--source-help-path-accent");
    const refAccent = latestVariableValue("--source-help-ref-accent");

    expect(urlAccent).not.toBe(pathAccent);
    expect(urlAccent).not.toBe(refAccent);
    expect(pathAccent).not.toBe(refAccent);
    expect(latestBlockFor(".source-help-popover::before")).toContain(
      "background: var(--source-help-accent);",
    );
    expect(latestBlockFor(".source-help-card code")).toContain(
      "background: var(--source-help-code-bg);",
    );
  });

  test("keeps software update motion meaningful and removable", () => {
    expect(latestBlockFor(".software-update-progress > span")).toContain(
      "transform-origin: left center;",
    );
    expect(latestBlockFor(".software-update-progress > span")).toContain(
      "transition: transform 200ms ease-out;",
    );
    const reducedMotion = mediaBlocksFor("(prefers-reduced-motion: reduce)").join("\n");
    expect(reducedMotion).toContain(".software-update-notice");
    expect(reducedMotion).toContain(".software-update-dialog");
    expect(reducedMotion).toContain(".software-update-verifying > span");
    expect(reducedMotion).toContain("animation: none;");
    expect(reducedMotion).toContain("transition: none;");
    expect(exactBlockFor(".software-update-dialog")).toContain(
      "max-height: calc(100dvh - 32px);",
    );
    expect(exactBlockFor(".software-update-dialog")).toContain("overflow-y: auto;");
    expect(stylesheet).toContain(
      ".redesign-preview-shell:has(.software-update-notice) .redesign-toast",
    );
  });

  test("keeps software and Skill update settings compact and shadowless", () => {
    const softwareSection = exactBlockFor(".settings-section.software-update-settings-section");
    const autoUpdateSection = exactBlockFor(".settings-section.auto-update-section");
    const realWindow = exactBlockFor(".metis-window.redesign-preview-shell");
    const realShell = exactBlockFor(".metis-shell.redesign-app-window");
    const settingsMain = exactBlockFor(".app-shell.redesign-main.settings-workspace-main");
    const settingsHeadingSize = declaredPx(latestBlockFor(".settings-section h3"), "font-size");
    const compactViewport = mediaBlocksFor("(max-width: 760px)").join("\n");
    const narrowViewport = mediaBlocksFor("(max-width: 520px)").join("\n");

    expect(softwareSection).toContain("padding: 14px;");
    expect(softwareSection).toContain("border-radius: 14px;");
    expect(softwareSection).toContain("box-shadow: none;");
    expect(softwareSection).toContain('grid-template-areas: "copy controls" "feedback feedback";');
    expect(softwareSection).toContain("grid-template-rows: auto 32px;");
    expect(autoUpdateSection).toContain("padding: 14px;");
    expect(autoUpdateSection).toContain("border-radius: 14px;");
    expect(autoUpdateSection).toContain("box-shadow: none;");
    expect(declaredPx(latestBlockFor(".software-update-settings-copy h3"), "font-size")).toBe(
      settingsHeadingSize,
    );
    expect(declaredPx(latestBlockFor(".auto-update-copy h3"), "font-size")).toBe(
      settingsHeadingSize,
    );
    expect(exactBlockFor(".software-update-settings-controls")).toContain("display: flex;");
    expect(exactBlockFor(".software-update-settings-controls")).toContain(
      "border: 1px solid #e2e8f0;",
    );
    expect(exactBlockFor(".software-update-settings-controls")).toContain(
      "background: #f8fafc;",
    );
    expect(exactBlockFor(".software-update-settings-feedback")).toContain("min-height: 32px;");
    expect(latestBlockFor(".software-update-check-button")).toContain("min-width: 108px;");
    expect(realWindow).toContain("height: 100vh;");
    expect(realWindow).toContain("min-height: 0;");
    expect(realWindow).toContain("overflow: hidden;");
    expect(realShell).toContain("height: 100vh;");
    expect(realShell).toContain("min-height: 0;");
    expect(settingsMain).toContain("grid-template-rows: auto;");
    expect(settingsMain).toContain("grid-auto-rows: max-content;");
    expect(compactViewport).toMatch(
      /\.settings-section\.software-update-settings-section\s*\{[\s\S]*grid-template-columns:\s*1fr;/,
    );
    expect(narrowViewport).toMatch(
      /\.settings-section\.auto-update-section\s*\{[\s\S]*grid-template-columns:\s*1fr;/,
    );
  });

  test("uses one semantic action button system across Settings", () => {
    const base = exactBlockFor(".metis-shell.redesign-app-window button.metis-action-button");
    const primary = exactBlockFor(
      ".metis-shell.redesign-app-window button.metis-action-button.metis-action-button--primary",
    );
    const compact = exactBlockFor(
      ".metis-shell.redesign-app-window button.metis-action-button.metis-action-button--compact",
    );
    const neutral = exactBlockFor(
      ".metis-shell.redesign-app-window button.metis-action-button.metis-action-button--neutral",
    );
    const danger = exactBlockFor(
      ".metis-shell.redesign-app-window button.metis-action-button.metis-action-button--danger",
    );
    const busy = exactBlockFor(
      ".metis-shell.redesign-app-window button.metis-action-button.is-busy",
    );
    const spinner = exactBlockFor(".metis-action-spinner");
    const reducedMotion = mediaBlocksFor("(prefers-reduced-motion: reduce)").join("\n");

    expect(base).toContain("min-height: 36px;");
    expect(base).toContain("border: 1px solid #d8e7ff;");
    expect(base).toContain("color: #3154df;");
    expect(base).toContain("background: #eef4ff;");
    expect(base).toContain("box-shadow: none;");
    expect(primary).toContain("color: #ffffff;");
    expect(primary).toContain("background: #3154df;");
    expect(compact).toContain("min-height: 32px;");
    expect(neutral).toContain("background: #ffffff;");
    expect(danger).toContain("color: #b42318;");
    expect(busy).toContain("cursor: default;");
    expect(busy).not.toContain("cursor: wait;");
    expect(busy).toContain("opacity: 1;");
    expect(spinner).toContain("animation: metisActionSpin 820ms linear infinite;");
    expect(reducedMotion).toMatch(
      /\.metis-shell\.redesign-app-window button\.metis-action-button\.is-busy::after,[\s\S]*animation:\s*none;/,
    );
    expect(reducedMotion).toMatch(
      /\.metis-shell\.redesign-app-window button\.metis-action-button\s*\{[^}]*transition:\s*none;/,
    );
    expect(reducedMotion).toContain(".metis-action-spinner");
  });

  test("keeps asynchronous action button footprints stable across label changes", () => {
    expect(
      exactBlockFor(".metis-shell.redesign-app-window button.topbar-secondary-action"),
    ).toContain("min-width: 120px;");
    expect(exactBlockFor(".metis-shell.redesign-app-window button.scan-button")).toContain(
      "min-width: 108px;",
    );
    expect(latestBlockFor(".settings-git-test-button")).toContain("min-width: 108px;");
    expect(latestBlockFor(".software-update-check-button")).toContain("min-width: 108px;");
    expect(exactBlockFor(".auto-update-run")).toContain("min-width: 108px;");
    expect(latestBlockFor(".settings-save-button")).toContain("min-width: 108px;");
    expect(exactBlockFor(".auto-update-confirm")).toContain("min-width: 104px;");
  });
});
