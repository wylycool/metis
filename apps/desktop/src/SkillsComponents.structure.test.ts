import { describe, expect, test } from "vitest";
import { AddSkillPage } from "./AddSkillPage";
import { CrossAgentTargetMatrix } from "./CrossAgentTargetMatrix";
import { SkillDetailPage } from "./SkillDetailPage";
import { SkillRow } from "./SkillRow";
import { SkillsWorkspace } from "./SkillsWorkspace";

describe("Phase 6 Skills component boundaries", () => {
  test("exports the split Skills workspace components", () => {
    expect(SkillsWorkspace).toBeTypeOf("function");
    expect(SkillRow).toBeTypeOf("function");
    expect(SkillDetailPage).toBeTypeOf("function");
    expect(AddSkillPage).toBeTypeOf("function");
    expect(CrossAgentTargetMatrix).toBeTypeOf("function");
  });
});
