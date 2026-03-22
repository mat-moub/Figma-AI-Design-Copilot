/**
 * custom-agent-registry.ts
 *
 * Manages the registry of user-defined custom skills that are loaded from a
 * dropped copilot config file (e.g. `copilot.json`).
 *
 * Custom skills are persisted to `localStorage` so they survive plugin panel
 * reloads.
 */

import type { CopilotConfig, CustomSkillConfig } from "../types/ui-types";

const STORAGE_KEY = "copilot_custom_config";

function getDefaultStorage(): Storage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export class CustomAgentRegistry {
  private skills: Map<string, CustomSkillConfig> = new Map();

  // ── Load ──────────────────────────────────────────────────────────────────

  /**
   * Parse and register skills from a `CopilotConfig` object.
   * Existing entries with the same `id` are overwritten.
   */
  load(config: CopilotConfig): void {
    this.validateConfig(config);

    for (const skill of config.skills ?? []) {
      this.skills.set(skill.id, skill);
    }
  }

  /**
   * Restore a previously saved registry from `localStorage`.
   * Safe to call in a browser environment; silently ignored if storage is
   * unavailable or the stored data is malformed.
   */
  loadFromStorage(storage?: Storage): void {
    try {
      const targetStorage = storage ?? getDefaultStorage();
      if (!targetStorage) return;
      const raw = targetStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const config = JSON.parse(raw) as CopilotConfig;
      this.load(config);
    } catch {
      // Corrupt stored data — ignore and start fresh.
    }
  }

  /**
   * Persist the current registry to `localStorage` so it survives reloads.
   */
  saveToStorage(storage?: Storage): void {
    const targetStorage = storage ?? getDefaultStorage();
    if (!targetStorage) return;

    const config: CopilotConfig = {
      version: "1",
      skills: Array.from(this.skills.values()),
    };
    targetStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }

  // ── Clear ─────────────────────────────────────────────────────────────────

  /**
   * Remove all custom skills from the registry and from storage.
   */
  clear(storage?: Storage): void {
    const targetStorage = storage ?? getDefaultStorage();
    this.skills.clear();
    targetStorage?.removeItem(STORAGE_KEY);
  }

  // ── Read ──────────────────────────────────────────────────────────────────

  getSkills(): CustomSkillConfig[] {
    return Array.from(this.skills.values());
  }

  getSkill(id: string): CustomSkillConfig | undefined {
    return this.skills.get(id);
  }

  get skillCount(): number {
    return this.skills.size;
  }

  // ── Validation ────────────────────────────────────────────────────────────

  private validateConfig(config: unknown): asserts config is CopilotConfig {
    if (typeof config !== "object" || config === null) {
      throw new Error("Invalid copilot config: must be a JSON object.");
    }

    const c = config as Record<string, unknown>;

    if (c["skills"] !== undefined) {
      if (!Array.isArray(c["skills"])) {
        throw new Error('Invalid copilot config: "skills" must be an array.');
      }
      for (const skill of c["skills"] as unknown[]) {
        this.validateSkill(skill);
      }
    }
  }

  private validateSkill(skill: unknown): asserts skill is CustomSkillConfig {
    if (typeof skill !== "object" || skill === null) {
      throw new Error("Invalid skill definition: must be an object.");
    }
    const s = skill as Record<string, unknown>;
    if (typeof s["id"] !== "string" || s["id"].trim() === "") {
      throw new Error('Invalid skill definition: "id" must be a non-empty string.');
    }
    if (typeof s["name"] !== "string" || s["name"].trim() === "") {
      throw new Error(`Invalid skill "${String(s["id"])}": "name" must be a non-empty string.`);
    }
    if (typeof s["promptModifier"] !== "string" || s["promptModifier"].trim() === "") {
      throw new Error(
        `Invalid skill "${String(s["id"])}": "promptModifier" must be a non-empty string.`
      );
    }
  }
}
