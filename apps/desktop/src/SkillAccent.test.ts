import { describe, expect, test } from "vitest";
import { skillAccentStyle } from "./SkillRow";
import type { DesktopSkill } from "./types";

function testSkill(name: string): DesktopSkill {
  return {
    id: `skill-${name}`,
    agent_id: "codex",
    agent_name: "Codex",
    name,
    install_path: `/tmp/${name}`,
    metadata_status: "Valid",
    last_scanned_at: "2026-07-01T00:00:00Z",
  };
}

function accentKey(skill: DesktopSkill) {
  const style = skillAccentStyle(skill) as Record<string, string>;
  return `${style["--redesign-accent-start"]}->${style["--redesign-accent-end"]}`;
}

describe("skill accent palette", () => {
  test("offers 16 distinct accent pairs for large skill libraries", () => {
    const accents = new Set(
      Array.from({ length: 128 }, (_, index) => accentKey(testSkill(`skill-${index}`))),
    );

    expect(accents).toHaveLength(16);
  });
});
