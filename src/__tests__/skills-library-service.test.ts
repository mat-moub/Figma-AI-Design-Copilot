import {
  isCodeSkill,
  skillIdToName,
  saveSkillsLibraryToStorage,
  loadSkillsLibraryFromStorage,
  clearSkillsLibraryFromStorage,
} from "../services/skills-library-service";
import { BUNDLED_SKILLS, buildSkillsKnowledgeBlock } from "../data/skills-library";
import type { ExternalSkillEntry } from "../types/ui-types";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const sampleSkills: ExternalSkillEntry[] = [
  { id: "fogg-behavior-model", name: "Fogg Behavior Model" },
  { id: "cognitive-biases", name: "Cognitive Biases" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeStorage(initial: Record<string, string> = {}): Storage {
  const store = { ...initial };
  return {
    length: 0,
    key: () => null,
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      for (const k in store) delete store[k];
    },
  } as unknown as Storage;
}

// ── isCodeSkill() ─────────────────────────────────────────────────────────────

describe("isCodeSkill()", () => {
  it("identifies code-prefixed skills as code skills", () => {
    expect(isCodeSkill("code-architecture-tailwind-v4-best-practices")).toBe(true);
    expect(isCodeSkill("code-architecture-wrong-abstraction")).toBe(true);
    expect(isCodeSkill("react-key-prop")).toBe(true);
    expect(isCodeSkill("react-use-callback")).toBe(true);
    expect(isCodeSkill("react-use-state")).toBe(true);
    expect(isCodeSkill("react-useeffect-avoid")).toBe(true);
    expect(isCodeSkill("typescript-advanced-types")).toBe(true);
    expect(isCodeSkill("typescript-best-practices")).toBe(true);
    expect(isCodeSkill("typescript-interface-vs-type")).toBe(true);
    expect(isCodeSkill("typescript-satisfies-operator")).toBe(true);
    expect(isCodeSkill("css-container-queries")).toBe(true);
    expect(isCodeSkill("nextjs-image-art-direction")).toBe(true);
    expect(isCodeSkill("conventional-commit")).toBe(true);
    expect(isCodeSkill("naming-cheatsheet")).toBe(true);
    expect(isCodeSkill("project-structure")).toBe(true);
  });

  it("allows design/UX/product skills through", () => {
    expect(isCodeSkill("fogg-behavior-model")).toBe(false);
    expect(isCodeSkill("cognitive-biases")).toBe(false);
    expect(isCodeSkill("cognitive-load")).toBe(false);
    expect(isCodeSkill("hicks-law")).toBe(false);
    expect(isCodeSkill("hooked-model")).toBe(false);
    expect(isCodeSkill("jobs-to-be-done")).toBe(false);
    expect(isCodeSkill("progressive-disclosure")).toBe(false);
    expect(isCodeSkill("trust-psychology")).toBe(false);
    expect(isCodeSkill("visual-cues-cta-psychology")).toBe(false);
    expect(isCodeSkill("business-model-canvas")).toBe(false);
  });
});

// ── skillIdToName() ───────────────────────────────────────────────────────────

describe("skillIdToName()", () => {
  it("converts kebab-case ids to Title Case names (with acronym handling)", () => {
    expect(skillIdToName("fogg-behavior-model")).toBe("Fogg Behavior Model");
    expect(skillIdToName("cognitive-biases")).toBe("Cognitive Biases");
    expect(skillIdToName("jobs-to-be-done")).toBe("Jobs To Be Done");
    expect(skillIdToName("hicks-law")).toBe("Hicks Law");
    expect(skillIdToName("visual-cues-cta-psychology")).toBe(
      "Visual Cues CTA Psychology"
    );
  });

  it("handles single-word ids", () => {
    expect(skillIdToName("kanban")).toBe("Kanban");
  });
});

// ── saveSkillsLibraryToStorage / loadSkillsLibraryFromStorage ─────────────────

describe("saveSkillsLibraryToStorage() / loadSkillsLibraryFromStorage()", () => {
  it("persists and restores skills", () => {
    const storage = makeStorage();
    saveSkillsLibraryToStorage(sampleSkills, storage);

    const restored = loadSkillsLibraryFromStorage(storage);
    expect(restored).toHaveLength(2);
    expect(restored[0]).toMatchObject({ id: "fogg-behavior-model" });
    expect(restored[1]).toMatchObject({ id: "cognitive-biases" });
  });

  it("returns an empty array when storage is empty", () => {
    const storage = makeStorage();
    expect(loadSkillsLibraryFromStorage(storage)).toEqual([]);
  });

  it("returns an empty array on corrupt data", () => {
    const storage = makeStorage({ copilot_skills_library: "not-valid-json{{" });
    expect(loadSkillsLibraryFromStorage(storage)).toEqual([]);
  });
});

// ── clearSkillsLibraryFromStorage() ──────────────────────────────────────────

describe("clearSkillsLibraryFromStorage()", () => {
  it("removes the stored entry", () => {
    const storage = makeStorage();
    saveSkillsLibraryToStorage(sampleSkills, storage);
    clearSkillsLibraryFromStorage(storage);
    expect(loadSkillsLibraryFromStorage(storage)).toEqual([]);
  });

  it("is a no-op when storage is already empty", () => {
    const storage = makeStorage();
    expect(() => clearSkillsLibraryFromStorage(storage)).not.toThrow();
  });
});

// ── BUNDLED_SKILLS ────────────────────────────────────────────────────────────

describe("BUNDLED_SKILLS", () => {
  it("contains 28 non-code skills", () => {
    expect(BUNDLED_SKILLS).toHaveLength(28);
  });

  it("every skill has a non-empty id, name, and description", () => {
    for (const skill of BUNDLED_SKILLS) {
      expect(skill.id.length).toBeGreaterThan(0);
      expect(skill.name.length).toBeGreaterThan(0);
      expect(skill.description.length).toBeGreaterThan(0);
    }
  });

  it("contains no code-related skills", () => {
    for (const skill of BUNDLED_SKILLS) {
      expect(isCodeSkill(skill.id)).toBe(false);
    }
  });

  it("includes key UX/design skills", () => {
    const ids = BUNDLED_SKILLS.map((s) => s.id);
    expect(ids).toContain("fogg-behavior-model");
    expect(ids).toContain("hicks-law");
    expect(ids).toContain("cognitive-load");
    expect(ids).toContain("progressive-disclosure");
    expect(ids).toContain("trust-psychology");
  });
});

// ── buildSkillsKnowledgeBlock() ───────────────────────────────────────────────

describe("buildSkillsKnowledgeBlock()", () => {
  it("returns a non-empty string", () => {
    const block = buildSkillsKnowledgeBlock();
    expect(typeof block).toBe("string");
    expect(block.length).toBeGreaterThan(0);
  });

  it("includes all skill names in bold markdown", () => {
    const block = buildSkillsKnowledgeBlock();
    for (const skill of BUNDLED_SKILLS) {
      expect(block).toContain(`**${skill.name}**`);
    }
  });

  it("has one line per skill", () => {
    const block = buildSkillsKnowledgeBlock();
    const lines = block.split("\n").filter((l) => l.trim().length > 0);
    expect(lines).toHaveLength(BUNDLED_SKILLS.length);
  });
});
