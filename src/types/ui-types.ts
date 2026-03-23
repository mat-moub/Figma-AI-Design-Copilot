// ─── Text Alternative ─────────────────────────────────────────────────────────

/**
 * A single AI-generated text alternative for a Figma text node.
 * The plugin generates N alternatives and lets the designer apply one.
 */
export interface TextAlternative {
  /** The AI-proposed text copy. */
  text: string;
  /** Optional short rationale explaining the writing choice. */
  rationale?: string;
}

// ─── Chat ────────────────────────────────────────────────────────────────────

export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessage {
  role: ChatRole;
  content: string;
  timestamp?: number;
}

// ─── Providers ───────────────────────────────────────────────────────────────

/**
 * Supported LLM providers.
 * - `gemini`: Direct Google Gemini API (BYOK) — default provider.
 * - `openai`: Direct OpenAI Chat Completions API (BYOK).
 * - `anthropic`: Direct Anthropic Messages API (BYOK).
 * - `mistral`: Direct Mistral AI Chat Completions API (BYOK).
 */
export type LLMProvider = "gemini" | "openai" | "anthropic" | "mistral";

// ─── Models ──────────────────────────────────────────────────────────────────

/** Models available directly on the Google Gemini API. */
export type GeminiModel =
  | "gemini-3.1-flash-lite-preview"
  | "gemini-3-pro";

/** Models available directly on the OpenAI API. */
export type OpenAIModel =
  | "gpt-5-mini"
  | "gpt-5"
  | "gpt-5.2"
  | "gpt-5.3"
  | "codex";

/** Models available directly on the Anthropic API. */
export type AnthropicModel =
  | "claude-haiku-4-5"
  | "claude-sonnet-4-6"
  | "claude-opus-4-6";

/** Models available directly on the Mistral AI API. */
export type MistralModel =
  | "ministral-8b-2512"
  | "mistral-small-2603"
  | "mistral-large-2512";

/** Union of all model IDs supported across providers. */
export type AIModel = GeminiModel | OpenAIModel | AnthropicModel | MistralModel;

export interface ModelConfig {
  /** The LLM provider to use. Defaults to `"gemini"`. */
  provider: LLMProvider;
  /** Provider-specific model identifier. */
  model: AIModel;
  /** Google AI Studio API key (Gemini provider, BYOK). */
  geminiKey?: string;
  /** OpenAI API key (OpenAI provider, BYOK). */
  openaiKey?: string;
  /** Anthropic API key (Anthropic provider, BYOK). */
  anthropicKey?: string;
  /** Mistral AI API key (Mistral provider, BYOK). */
  mistralKey?: string;
  /** When true, log prompts, context, and AI responses to the browser console. */
  debug?: boolean;
}

/** Supported UI theme modes. */
export type ThemeMode = "light" | "dark";

export interface PersistedSettings {
  provider: LLMProvider;
  modelByProvider: Partial<Record<LLMProvider, AIModel>>;
  apiKeyByProvider: Partial<Record<LLMProvider, string>>;
  interactionMode: "generate" | "ask";
  functionalContext: string;
  debugMode: boolean;
  theme: ThemeMode;
}

// ─── Document Context ────────────────────────────────────────────────────────

export interface DesignSystem {
  components: string[];
  colors: string[];
  textStyles: string[];
}

/** Inferred semantic role of a text node based on its name and font properties. */
export type TextRole =
  | "heading"
  | "subheading"
  | "body"
  | "label"
  | "caption"
  | "button"
  | "unknown";

/**
 * A single text node extracted from the current Figma page, enriched with
 * metadata useful for LLM-based wording generation.
 */
export interface TextEntry {
  /** Figma layer name — often reflects the semantic role (e.g. "heading", "btn-label"). */
  layerName: string;
  /** Raw text content of the node. */
  characters: string;
  /** Approximate character count — useful as a length constraint hint for the LLM. */
  charCount: number;
  /** Inferred semantic role derived from layer name and font properties. */
  role: TextRole;
  /**
   * Importance level within its screen:
   * - `1` = primary (heading, CTA)
   * - `2` = secondary (subheading, body)
   * - `3` = tertiary (caption, footnote)
   */
  importance: 1 | 2 | 3;
  /** Font family name, or `"mixed"` when the node uses multiple families. */
  fontFamily: string;
  /** Font style (e.g. `"Bold"`, `"Regular"`), or `"mixed"`. */
  fontStyle: string;
  /** Font size in pixels, or `"mixed"` when multiple sizes are used. */
  fontSize: number | "mixed";
  /**
   * True when the text node lives inside a component instance or component
   * master — gives the LLM context about its role (e.g. button label).
   */
  insideComponent: boolean;
}

/** All text entries found within a single top-level screen frame. */
export interface ScreenTextContext {
  /** Name of the top-level FRAME node (screen). */
  screenName: string;
  /** Text entries within this screen, ordered by importance then document order. */
  texts: TextEntry[];
}

/**
 * The text node currently selected by the designer in Figma.
 * Sent to the AI as the primary input for wording generation.
 */
export interface SelectedTextContext {
  /** The raw text currently in the selected node. */
  characters: string;
  /** Inferred semantic role. */
  role: TextRole;
  /** Font size in px, or `"mixed"`. */
  fontSize: number | "mixed";
  /** Font family, or `"mixed"`. */
  fontFamily: string;
  /** Approximate character count. */
  charCount: number;
  /** True if the node is inside a component or instance. */
  insideComponent: boolean;
  /** Name of the screen (top-level frame) that contains this text node, if any. */
  screenName: string | null;
}

export interface DocumentContext {
  designSystem: DesignSystem;
  /** Top-level frame names on the current page. */
  screens: string[];
  /** All page names in the document. */
  pages: string[];
  /** Text content of the current page, grouped by screen, for wording context. */
  pageTextContext: ScreenTextContext[];
  /** Currently selected text node, if any. */
  selectedText: SelectedTextContext | null;
}

// ─── Agent ───────────────────────────────────────────────────────────────────

export type AgentType = "ux-writer";

export interface AgentConfig {
  type: AgentType;
  systemPrompt: string;
}

// ─── Custom Skills (prompt modifiers via copilot.json) ───────────────────────

/**
 * Definition of a user-provided custom skill loaded from a copilot config file.
 * A custom skill appends a `promptModifier` to the agent system prompt, letting
 * users extend wording generation behaviour without writing TypeScript.
 */
export interface CustomSkillConfig {
  /** Unique identifier */
  id: string;
  /** Human-readable name shown in the UI */
  name: string;
  /** Extra instructions appended to the agent system prompt */
  promptModifier: string;
}

/**
 * Schema for the copilot config file (e.g. `copilot.json`) that users can drop
 * into the plugin panel to register their own skills — inspired by Claude Code's
 * `.claude` folder convention.
 */
export interface CopilotConfig {
  /** Optional schema version for future compatibility */
  version?: string;
  /** Custom skills available to the UX writer agent */
  skills?: CustomSkillConfig[];
}

export interface GenerateAlternativesInput {
  prompt: string;
  count: number;
  context: DocumentContext;
  modelConfig: ModelConfig;
  history: ChatMessage[];
  functionalContext?: string;
}

// ─── Plugin Message Types ────────────────────────────────────────────────────

export type PluginMessageType =
  | "get-context"
  | "context-ready"
  | "selection-changed"
  | "get-settings"
  | "save-settings"
  | "settings-loaded"
  | "get-onboarding-status"
  | "onboarding-status"
  | "set-onboarding-done"
  | "apply-text"
  | "text-applied"
  | "error"
  | "notify";

export interface GetContextMessage {
  type: "get-context";
}

export interface ContextReadyMessage {
  type: "context-ready";
  context: DocumentContext;
}

export interface ApplyTextMessage {
  type: "apply-text";
  text: string;
}

export interface TextAppliedMessage {
  type: "text-applied";
}

export interface GetSettingsMessage {
  type: "get-settings";
}

export interface SaveSettingsMessage {
  type: "save-settings";
  settings: PersistedSettings;
}

export interface SettingsLoadedMessage {
  type: "settings-loaded";
  settings: PersistedSettings | null;
}

export interface GetOnboardingStatusMessage {
  type: "get-onboarding-status";
}

export interface OnboardingStatusMessage {
  type: "onboarding-status";
  done: boolean;
}

export interface SetOnboardingDoneMessage {
  type: "set-onboarding-done";
}

export interface ErrorMessage {
  type: "error";
  message: string;
}

export interface NotifyMessage {
  type: "notify";
  message: string;
}

export interface SelectionChangedMessage {
  type: "selection-changed";
  selectedText: SelectedTextContext | null;
}

export type PluginToUIMessage =
  | ContextReadyMessage
  | SelectionChangedMessage
  | SettingsLoadedMessage
  | OnboardingStatusMessage
  | TextAppliedMessage
  | ErrorMessage
  | NotifyMessage;

export type UIToPluginMessage =
  | GetContextMessage
  | GetSettingsMessage
  | SaveSettingsMessage
  | GetOnboardingStatusMessage
  | SetOnboardingDoneMessage
  | ApplyTextMessage;
