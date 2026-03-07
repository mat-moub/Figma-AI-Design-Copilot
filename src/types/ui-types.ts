// ─── UI Element Types ────────────────────────────────────────────────────────

export type UIElementType =
  | "text"
  | "button"
  | "input"
  | "card"
  | "image"
  | "icon"
  | "divider"
  | "header"
  | "footer"
  | "nav"
  | "list"
  | "modal"
  | "tab"
  | "badge"
  | "avatar"
  | "container";

export interface UIElement {
  type: UIElementType;
  value?: string;
  /** Name of design system component to use (e.g. "ButtonPrimary") */
  component?: string;
  children?: UIElement[];
  style?: Record<string, string>;
}

// ─── Screen / Variant ────────────────────────────────────────────────────────

export type LayoutMode = "vertical" | "horizontal" | "none";

export interface UIScreen {
  name: string;
  layout: LayoutMode;
  elements: UIElement[];
  width?: number;
  height?: number;
}

// ─── Chat ────────────────────────────────────────────────────────────────────

export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessage {
  role: ChatRole;
  content: string;
  timestamp?: number;
}

// ─── Models ──────────────────────────────────────────────────────────────────

/**
 * Models available through the GitHub Copilot API.
 * All requests go to https://api.githubcopilot.com/chat/completions using a
 * GitHub Personal Access Token with the `copilot` scope.
 */
export type AIModel = "gpt-4o" | "claude-3.5-sonnet" | "o3-mini";

export interface ModelConfig {
  model: AIModel;
  /** GitHub Personal Access Token with the `copilot` scope. */
  githubToken?: string;
}

// ─── Document Context ────────────────────────────────────────────────────────

export interface DesignSystem {
  components: string[];
  colors: string[];
  textStyles: string[];
}

export interface DocumentContext {
  designSystem: DesignSystem;
  screens: string[];
  pages: string[];
}

// ─── Agent ───────────────────────────────────────────────────────────────────

export type AgentType = "ux-designer" | "design-system";

export interface AgentConfig {
  type: AgentType;
  systemPrompt: string;
  skills: SkillType[];
}

// ─── Skill ───────────────────────────────────────────────────────────────────

export type SkillType = "generate-screen" | "generate-variants" | "apply-design-system";

// ─── Custom Skills & Agents ──────────────────────────────────────────────────

/**
 * Definition of a user-provided custom skill loaded from a copilot config file.
 * A custom skill appends a `promptModifier` to the agent system prompt, letting
 * users extend generation behaviour without writing TypeScript.
 */
export interface CustomSkillConfig {
  /** Unique identifier used in CustomAgentConfig.skills */
  id: string;
  /** Human-readable name shown in the UI */
  name: string;
  /** Extra instructions appended to the agent system prompt */
  promptModifier: string;
}

/**
 * Definition of a user-provided custom agent loaded from a copilot config file.
 * Custom agents run the same built-in skills as built-in agents but with a
 * fully user-controlled system prompt and skill selection.
 */
export interface CustomAgentConfig {
  /** Unique identifier — used as the <option> value in the agent select */
  id: string;
  /** Human-readable name shown in the UI agent dropdown */
  name: string;
  /** System prompt sent to the AI model */
  systemPrompt: string;
  /**
   * Ordered list of built-in skill IDs to execute.
   * Supported values: "generate-screen", "generate-variants", "apply-design-system".
   */
  skills: SkillType[];
}

/**
 * A single skill entry from the external skills library
 * (https://github.com/flpbalada/my-opencode-config).
 * Code-related skills are excluded at fetch time.
 */
export interface ExternalSkillEntry {
  /** Folder name / unique identifier in the remote repository */
  id: string;
  /** Human-readable display name derived from the folder name */
  name: string;
}

/**
 * Schema for the copilot config file (e.g. `copilot.json` or
 * `.copilot/config.json`) that users can drop into the plugin panel to
 * register their own agents and skills — inspired by Claude Code's `.claude`
 * folder convention.
 */
export interface CopilotConfig {
  /** Optional schema version for future compatibility */
  version?: string;
  /** Custom agents to register */
  agents?: CustomAgentConfig[];
  /** Custom skills available to agents */
  skills?: CustomSkillConfig[];
}

export interface GenerateScreenInput {
  prompt: string;
  context: DocumentContext;
  modelConfig: ModelConfig;
  history: ChatMessage[];
}

export interface GenerateVariantsInput extends GenerateScreenInput {
  variants: number;
}

export interface ApplyDesignSystemInput {
  screens: UIScreen[];
  designSystem: DesignSystem;
}

// ─── Plugin Message Types ────────────────────────────────────────────────────

export type PluginMessageType =
  | "get-context"
  | "context-ready"
  | "build-screens"
  | "screens-built"
  | "error"
  | "notify";

export interface GetContextMessage {
  type: "get-context";
}

export interface ContextReadyMessage {
  type: "context-ready";
  context: DocumentContext;
}

export interface BuildScreensMessage {
  type: "build-screens";
  screens: UIScreen[];
}

export interface ScreensBuiltMessage {
  type: "screens-built";
  count: number;
}

export interface ErrorMessage {
  type: "error";
  message: string;
}

export interface NotifyMessage {
  type: "notify";
  message: string;
}

export type PluginToUIMessage =
  | ContextReadyMessage
  | ScreensBuiltMessage
  | ErrorMessage
  | NotifyMessage;

export type UIToPluginMessage =
  | GetContextMessage
  | BuildScreensMessage;
