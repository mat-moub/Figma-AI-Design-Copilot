import { CustomAgentRegistry } from "../services/custom-agent-registry";
import type { CopilotConfig } from "../types/ui-types";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const validConfig: CopilotConfig = {
  version: "1",
  agents: [
    {
      id: "content-writer",
      name: "Content Writer",
      systemPrompt: "You specialise in content-heavy layouts.",
      skills: ["generate-screen", "apply-design-system"],
    },
  ],
  skills: [
    {
      id: "rtl-support",
      name: "RTL Support",
      promptModifier: "Always generate right-to-left layouts.",
    },
  ],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRegistry(): CustomAgentRegistry {
  return new CustomAgentRegistry();
}

function makeStorage(initial: Record<string, string> = {}): Storage {
  const store = { ...initial };
  return {
    length: 0,
    key: () => null,
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { for (const k in store) delete store[k]; },
  } as unknown as Storage;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("CustomAgentRegistry", () => {
  describe("load()", () => {
    it("registers agents from a valid config", () => {
      const reg = makeRegistry();
      reg.load(validConfig);

      expect(reg.getAgents()).toHaveLength(1);
      expect(reg.getAgent("content-writer")).toMatchObject({ name: "Content Writer" });
    });

    it("registers skills from a valid config", () => {
      const reg = makeRegistry();
      reg.load(validConfig);

      expect(reg.getSkills()).toHaveLength(1);
      expect(reg.getSkill("rtl-support")).toMatchObject({ name: "RTL Support" });
    });

    it("accepts a config with only agents", () => {
      const reg = makeRegistry();
      reg.load({ agents: [validConfig.agents![0]] });

      expect(reg.agentCount).toBe(1);
      expect(reg.skillCount).toBe(0);
    });

    it("accepts a config with only skills", () => {
      const reg = makeRegistry();
      reg.load({ skills: [validConfig.skills![0]] });

      expect(reg.agentCount).toBe(0);
      expect(reg.skillCount).toBe(1);
    });

    it("accepts an empty config", () => {
      const reg = makeRegistry();
      reg.load({});

      expect(reg.agentCount).toBe(0);
      expect(reg.skillCount).toBe(0);
    });

    it("overwrites existing entries with the same id", () => {
      const reg = makeRegistry();
      reg.load(validConfig);
      reg.load({
        agents: [{ ...validConfig.agents![0], name: "Updated Name" }],
      });

      expect(reg.agentCount).toBe(1);
      expect(reg.getAgent("content-writer")!.name).toBe("Updated Name");
    });

    it("throws on non-object input", () => {
      const reg = makeRegistry();
      expect(() => reg.load(null as unknown as CopilotConfig)).toThrow(
        "Invalid copilot config: must be a JSON object."
      );
    });

    it("throws when agents is not an array", () => {
      const reg = makeRegistry();
      expect(() => reg.load({ agents: "bad" } as unknown as CopilotConfig)).toThrow(
        '"agents" must be an array'
      );
    });

    it("throws when an agent lacks an id", () => {
      const reg = makeRegistry();
      expect(() =>
        reg.load({ agents: [{ name: "No ID", systemPrompt: "x", skills: [] }] } as unknown as CopilotConfig)
      ).toThrow('"id" must be a non-empty string');
    });

    it("throws when an agent lacks a name", () => {
      const reg = makeRegistry();
      expect(() =>
        reg.load({ agents: [{ id: "a", systemPrompt: "x", skills: [] }] } as unknown as CopilotConfig)
      ).toThrow('"name" must be a non-empty string');
    });

    it("throws when an agent lacks a systemPrompt", () => {
      const reg = makeRegistry();
      expect(() =>
        reg.load({ agents: [{ id: "a", name: "A", skills: [] }] } as unknown as CopilotConfig)
      ).toThrow('"systemPrompt" must be a non-empty string');
    });

    it("throws when a skill lacks a promptModifier", () => {
      const reg = makeRegistry();
      expect(() =>
        reg.load({ skills: [{ id: "s", name: "S" }] } as unknown as CopilotConfig)
      ).toThrow('"promptModifier" must be a string');
    });
  });

  describe("saveToStorage() / loadFromStorage()", () => {
    it("persists and restores agents and skills", () => {
      const storage = makeStorage();
      const reg1 = makeRegistry();
      reg1.load(validConfig);
      reg1.saveToStorage(storage);

      const reg2 = makeRegistry();
      reg2.loadFromStorage(storage);

      expect(reg2.getAgent("content-writer")!.name).toBe("Content Writer");
      expect(reg2.getSkill("rtl-support")!.name).toBe("RTL Support");
    });

    it("is a no-op when storage is empty", () => {
      const storage = makeStorage();
      const reg = makeRegistry();
      reg.loadFromStorage(storage);

      expect(reg.agentCount).toBe(0);
    });

    it("silently ignores corrupt stored data", () => {
      const storage = makeStorage({ copilot_custom_config: "not-json{{" });
      const reg = makeRegistry();
      expect(() => reg.loadFromStorage(storage)).not.toThrow();
      expect(reg.agentCount).toBe(0);
    });
  });

  describe("clear()", () => {
    it("removes all agents and skills", () => {
      const storage = makeStorage();
      const reg = makeRegistry();
      reg.load(validConfig);
      reg.clear(storage);

      expect(reg.agentCount).toBe(0);
      expect(reg.skillCount).toBe(0);
    });

    it("removes the storage entry", () => {
      const storage = makeStorage();
      const reg = makeRegistry();
      reg.load(validConfig);
      reg.saveToStorage(storage);
      reg.clear(storage);

      expect(storage.getItem("copilot_custom_config")).toBeNull();
    });
  });

  describe("getAgent() / getSkill()", () => {
    it("returns undefined for unknown ids", () => {
      const reg = makeRegistry();
      expect(reg.getAgent("nope")).toBeUndefined();
      expect(reg.getSkill("nope")).toBeUndefined();
    });
  });
});
