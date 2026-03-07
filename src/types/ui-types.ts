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

export type AIModel =
  | "copilot-gpt-4"
  | "gpt-4o"
  | "claude-3-5-sonnet"
  | "custom";

export interface ModelConfig {
  model: AIModel;
  apiKey?: string;
  apiEndpoint?: string;
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
