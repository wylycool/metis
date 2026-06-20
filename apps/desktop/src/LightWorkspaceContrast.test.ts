import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const stylesheet = readFileSync("src/styles.css", "utf8");

function latestVariableValue(name: string): string {
  const matches = [...stylesheet.matchAll(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`, "g"))];
  const latest = matches[matches.length - 1];

  if (!latest) {
    throw new Error(`Missing CSS variable ${name}`);
  }

  return latest[1];
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
  test("uses a comfortably readable muted text color on white panels", () => {
    expect(
      contrastRatio(latestVariableValue("--muted"), latestVariableValue("--panel")),
    ).toBeGreaterThanOrEqual(6);
  });

  test("routes Governance and Settings description copy through the muted color token", () => {
    expect(stylesheet).toContain(".governance-audit-panel p,\n.settings-section p,");
    expect(stylesheet).toContain("color: var(--muted);");
  });
});
