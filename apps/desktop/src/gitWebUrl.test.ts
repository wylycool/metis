import { describe, expect, test } from "vitest";
import { parseGitWebUrl } from "./gitWebUrl";

describe("parseGitWebUrl", () => {
  test("parses GitHub tree URLs into git source fields", () => {
    expect(
      parseGitWebUrl("https://github.com/obra/superpowers/tree/main/skills/brainstorming"),
    ).toEqual({
      url: "https://github.com/obra/superpowers.git",
      ref_: "main",
      repo_path: "skills/brainstorming",
    });
  });

  test("parses GitLab tree URLs and ignores query strings", () => {
    expect(
      parseGitWebUrl(
        "https://gitlab.example.com/example-org/skills/-/tree/master/skills/shared-example-skill?ref_type=heads",
      ),
    ).toEqual({
      url: "https://gitlab.example.com/example-org/skills.git",
      ref_: "master",
      repo_path: "skills/shared-example-skill",
    });
  });

  test("parses Gitee tree URLs into git source fields", () => {
    expect(
      parseGitWebUrl("https://gitee.com/chubbyguan/chubbyskills/tree/main/bilibili-transcribe"),
    ).toEqual({
      url: "https://gitee.com/chubbyguan/chubbyskills.git",
      ref_: "main",
      repo_path: "bilibili-transcribe",
    });
  });

  test("parses repository homepage URLs without forcing a path or ref", () => {
    expect(parseGitWebUrl("https://gitee.com/JinGuYuan/jinguyuan-dumpling-skill")).toEqual({
      url: "https://gitee.com/JinGuYuan/jinguyuan-dumpling-skill.git",
      ref_: "",
      repo_path: "",
    });
  });

  test("uses the parent directory for SKILL.md blob URLs", () => {
    expect(
      parseGitWebUrl(
        "https://github.com/obra/superpowers/blob/main/skills/brainstorming/SKILL.md",
      ),
    ).toEqual({
      url: "https://github.com/obra/superpowers.git",
      ref_: "main",
      repo_path: "skills/brainstorming",
    });
  });

  test("keeps standard git URLs as repository URLs", () => {
    expect(parseGitWebUrl("https://github.com/obra/superpowers.git")).toEqual({
      url: "https://github.com/obra/superpowers.git",
      ref_: "",
      repo_path: "",
    });
  });
});
