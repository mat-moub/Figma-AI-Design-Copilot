// ─── Text Alternative ─────────────────────────────────────────────────────────

/**
 * A single AI-generated text alternative for a Figma text frame.
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
  | "gemini-flash-lite-latest"
  | "gemini-flash-latest"
  | "gemini-pro-latest";

/** Models available directly on the OpenAI API. */
export type OpenAIModel =
  | "gpt-5.4-nano"
  | "gpt-5.4-mini"
  | "gpt-5.4";

/** Models available directly on the Anthropic API. */
export type AnthropicModel =
  | "claude-haiku-4-5"
  | "claude-sonnet-4-6"
  | "claude-opus-4-6";

/** Models available directly on the Mistral AI API. */
export type MistralModel =
  | "mistral-small-latest"
  | "mistral-medium-latest"
  | "mistral-large-latest";

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
  /** Named functional contexts (replaces legacy single functionalContext). */
  contexts: FunctionalContext[];
  /** ID of the currently active context, or null for none. */
  activeContextId: string | null;
  /** @deprecated Legacy single context — kept for migration only. */
  functionalContext?: string;
  debugMode: boolean;
  theme: ThemeMode;
  animateBadge: boolean;
}

// ─── Document Context ────────────────────────────────────────────────────────

export interface DesignSystem {
  components: string[];
  colors: string[];
  textStyles: string[];
}

/** Inferred semantic role of a text frame based on its name and font properties. */
export type TextRole =
  | "heading"
  | "subheading"
  | "body"
  | "label"
  | "caption"
  | "button"
  | "unknown";

/**
 * A single text frame extracted from the current Figma page, enriched with
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
   * True when the text frame lives inside a component instance or component
   * master — gives the LLM context about its role (e.g. button label).
   */
  insideComponent: boolean;
  /**
   * Nesting depth of the text frame relative to its top-level screen frame.
   * 0 = direct child of the screen, 1 = one frame deep, etc.
   * Used to produce indented markdown that mirrors the Figma hierarchy.
   */
  depth: number;
  /**
   * Names of the intermediate container frames/groups between the screen root
   * and this text frame (not including the screen itself).
   * Ordered from outermost to innermost (e.g. ["Card", "Header"]).
   */
  parentPath: string[];
}

/** All text entries found within a single top-level screen frame. */
export interface ScreenTextContext {
  /** Name of the top-level FRAME node (screen). */
  screenName: string;
  /** Text entries within this screen, ordered by importance then document order. */
  texts: TextEntry[];
}

/**
 * The text frame currently selected by the designer in Figma.
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
  /** Name of the screen (top-level frame) that contains this text frame, if any. */
  screenName: string | null;
}

/**
 * A text entry found inside a selected component (INSTANCE or COMPONENT node).
 * Only the content and font information are included — sufficient for LLM context.
 */
export interface ComponentTextEntry {
  /** Raw text content of the node. */
  characters: string;
  /** Font family, or `"mixed"` when the node uses multiple families. */
  fontFamily: string;
  /** Font style (e.g. `"Bold"`, `"Regular"`), or `"mixed"`. */
  fontStyle: string;
  /** Font size in pixels, or `"mixed"` when multiple sizes are used. */
  fontSize: number | "mixed";
}

/**
 * A non-text frame (COMPONENT or INSTANCE) currently selected by the designer.
 * Carries the component name and all text frames it contains.
 */
export interface SelectedComponentContext {
  /** Figma layer name of the selected node (e.g. "Button / Primary / Large"). */
  componentName: string;
  /** Figma node type: `"COMPONENT"` or `"INSTANCE"`. */
  nodeType: "COMPONENT" | "INSTANCE" | "FRAME" | "GROUP" | "OTHER";
  /** All non-empty text entries found inside the component, in tree order. */
  texts: ComponentTextEntry[];
  /** Name of the screen (top-level frame) that contains this component, if any. */
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
  /** Currently selected text frame, if any. */
  selectedText: SelectedTextContext | null;
  /** Currently selected non-text frame (component/frame/group), if any. */
  selectedComponent: SelectedComponentContext | null;
  /** Metadata about how this context snapshot was loaded. */
  contextMeta?: ContextLoadMeta;
}

export interface ContextLoadMeta {
  /**
   * Strategy used to resolve which nodes were scanned.
   * - `root-node`: a direct page child was found as ancestor of the selection.
   * - `page-all`: no selection — all direct page children were scanned.
   */
  strategy: "root-node" | "page-all";
  /** Effective scope type used for extraction. */
  scopeType: "root-node" | "page";
  /** Effective scope node name, null for page scope. */
  scopeName: string | null;
  /** Path from the scope node back to the page root. */
  scopePath: string[];
  /** Total root nodes scanned for the final context. */
  totalFrames: number;
  /** Total non-empty text frames included in context. */
  totalTexts: number;
  /** Estimated token count for the serialized context. */
  estimatedTokens: number;
  /** True when extraction had to stop early due to token cap. */
  truncated: boolean;
  /** Hard upper token cap used for this snapshot. */
  maxTokens: number;
  /** @deprecated No longer used — kept for interface compatibility. */
  minTokensTarget: number;
  /** End-to-end extraction time in milliseconds. */
  durationMs: number;
}

// ─── Agent ───────────────────────────────────────────────────────────────────

export type AgentType = "ux-writer";

export interface AgentConfig {
  type: AgentType;
  systemPrompt: string;
}

// ─── Functional Contexts ─────────────────────────────────────────────────────

/**
 * A named functional context that describes a product, industry, tone of voice,
 * or any business context. The active context is injected into the AI system
 * prompt on every generation to produce more relevant copy.
 */
export interface FunctionalContext {
  /** Unique identifier (UUID v4). */
  id: string;
  /** Short human-readable title shown in dropdowns and cards. */
  title: string;
  /** Full context description injected into the AI prompt. */
  content: string;
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
  | "load-context"
  | "context-ready"
  | "context-load-progress"
  | "selection-changed"
  | "get-settings"
  | "save-settings"
  | "settings-loaded"
  | "get-onboarding-status"
  | "onboarding-status"
  | "set-onboarding-done"
  | "reset-onboarding"
  | "apply-text"
  | "text-applied"
  | "error"
  | "notify";

export interface GetContextMessage {
  type: "get-context";
}

export interface LoadContextMessage {
  type: "load-context";
}

export interface ContextReadyMessage {
  type: "context-ready";
  context: DocumentContext;
}

export interface ContextLoadProgressMessage {
  type: "context-load-progress";
  processedFrames: number;
  totalFrames: number;
  estimatedTokens: number;
  scopeLabel: string;
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

export interface ResetOnboardingMessage {
  type: "reset-onboarding";
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
  selectedComponent: SelectedComponentContext | null;
}

export type PluginToUIMessage =
  | ContextReadyMessage
  | ContextLoadProgressMessage
  | SelectionChangedMessage
  | SettingsLoadedMessage
  | OnboardingStatusMessage
  | TextAppliedMessage
  | ErrorMessage
  | NotifyMessage;

export type UIToPluginMessage =
  | GetContextMessage
  | LoadContextMessage
  | GetSettingsMessage
  | SaveSettingsMessage
  | GetOnboardingStatusMessage
  | SetOnboardingDoneMessage
  | ResetOnboardingMessage
  | ApplyTextMessage;
