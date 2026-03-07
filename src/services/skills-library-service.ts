/**
 * skills-library-service.ts
 *
 * Fetches the design/UX skills library from
 * https://github.com/flpbalada/my-opencode-config and filters out
 * code-related skills, returning only design, UX, psychology, and
 * product-management skills that are relevant in Figma.
 */

import type { ExternalSkillEntry } from "../types/ui-types";

const GITHUB_API_URL =
  "https://api.github.com/repos/flpbalada/my-opencode-config/contents/skills";

const STORAGE_KEY = "copilot_skills_library";

/**
 * Prefixes that identify code-related skills to be excluded.
 * Skills whose folder name starts with any of these are skipped.
 */
const CODE_PREFIXES: readonly string[] = [
  "code-",
  "react-",
  "typescript-",
  "css-",
  "nextjs-",
  "conventional-commit",
  "naming-cheatsheet",
  "project-structure",
];

/** Returns true when the skill folder name is code-related and should be excluded. */
export function isCodeSkill(id: string): boolean {
  return CODE_PREFIXES.some((prefix) => id.startsWith(prefix));
}

/** Known acronyms / abbreviations that should remain fully uppercase in display names. */
const KNOWN_ACRONYMS = new Set(["cta", "ux", "ui", "seo", "pm"]);

/** Convert a kebab-case folder name into a Title Case display name. */
export function skillIdToName(id: string): string {
  return id
    .split("-")
    .map((word) => {
      const lower = word.toLowerCase();
      if (KNOWN_ACRONYMS.has(lower)) return lower.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

/**
 * Fetch the list of non-code skills from the remote repository.
 *
 * Makes a single request to the GitHub Contents API to list the `skills`
 * directory, then filters and transforms the results.
 *
 * @throws {Error} When the network request fails or returns a non-2xx status.
 */
export async function fetchSkillsLibrary(): Promise<ExternalSkillEntry[]> {
  const response = await fetch(GITHUB_API_URL, {
    headers: { Accept: "application/vnd.github.v3+json" },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch skills library (HTTP ${response.status}).`);
  }

  const items = (await response.json()) as Array<{
    type: string;
    name: string;
  }>;

  return items
    .filter((item) => item.type === "dir" && !isCodeSkill(item.name))
    .map((item) => ({ id: item.name, name: skillIdToName(item.name) }));
}

/**
 * Persist a list of external skills to localStorage so they survive
 * plugin panel reloads.
 */
export function saveSkillsLibraryToStorage(
  skills: ExternalSkillEntry[],
  storage: Storage = localStorage
): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(skills));
}

/**
 * Restore previously saved external skills from localStorage.
 * Returns an empty array when storage is empty or the data is corrupt.
 */
export function loadSkillsLibraryFromStorage(
  storage: Storage = localStorage
): ExternalSkillEntry[] {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ExternalSkillEntry[];
  } catch {
    return [];
  }
}

/**
 * Remove the persisted skills library entry from localStorage.
 */
export function clearSkillsLibraryFromStorage(
  storage: Storage = localStorage
): void {
  storage.removeItem(STORAGE_KEY);
}
