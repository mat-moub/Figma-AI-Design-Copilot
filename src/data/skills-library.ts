/**
 * skills-library.ts
 *
 * Static bundle of non-code design/UX/product skills copied from
 * https://github.com/flpbalada/my-opencode-config (skills/ directory).
 *
 * Only skills relevant to UI/UX design and product thinking are included.
 * Code-related skills (React, TypeScript, CSS, Next.js, etc.) are excluded.
 *
 * Each entry contains the skill id (folder name), a human-readable name,
 * and a one-sentence description sourced from the skill's YAML frontmatter.
 */

export interface BundledSkill {
  /** Folder name / unique identifier in the remote repository */
  id: string;
  /** Human-readable display name */
  name: string;
  /** One-sentence description of what the skill helps with */
  description: string;
}

/**
 * The full list of bundled design/UX/product skills.
 * Source: https://github.com/flpbalada/my-opencode-config/tree/main/skills
 */
export const BUNDLED_SKILLS: readonly BundledSkill[] = [
  {
    id: "business-model-canvas",
    name: "Business Model Canvas",
    description:
      "Design and analyze business models using the Business Model Canvas framework. Use when evaluating startups, planning new products, pivoting existing businesses, or understanding how companies create and capture value.",
  },
  {
    id: "cognitive-biases",
    name: "Cognitive Biases",
    description:
      "Apply cognitive bias knowledge to product design and decision-making. Use when designing user experiences, analyzing user behavior, improving conversions, or ensuring ethical design practices.",
  },
  {
    id: "cognitive-fluency-psychology",
    name: "Cognitive Fluency Psychology",
    description:
      "Apply cognitive fluency principles to improve clarity, trust, and conversion. Use when designing landing pages, writing copy, creating interfaces, or optimizing any content for better user comprehension and engagement.",
  },
  {
    id: "cognitive-load",
    name: "Cognitive Load",
    description:
      "Design experiences that optimize mental resources using Cognitive Load Theory. Use when designing interfaces, creating onboarding flows, planning information architecture, or improving task completion rates.",
  },
  {
    id: "curiosity-gap",
    name: "Curiosity Gap",
    description:
      "Create engagement through strategic information gaps that drive user action. Use when designing notifications, writing headlines, planning onboarding flows, or creating content that needs to capture and hold attention.",
  },
  {
    id: "five-whys",
    name: "Five Whys",
    description:
      "Conduct root cause analysis using the Five Whys technique. Use when investigating problems, debugging issues, understanding failures, analyzing churn, or finding the underlying cause of any issue.",
  },
  {
    id: "fogg-behavior-model",
    name: "Fogg Behavior Model",
    description:
      "Design behavior change using the B=MAP framework. Use when designing onboarding flows, improving conversion, building habits, increasing feature adoption, or understanding why users don't take desired actions.",
  },
  {
    id: "game-theory-tit-for-tat",
    name: "Game Theory Tit For Tat",
    description:
      "Apply Tit for Tat strategy for negotiations, relationships, and repeated interactions. Use when navigating workplace dynamics, building partnerships, handling conflicts, or designing systems with reciprocal interactions.",
  },
  {
    id: "graph-thinking",
    name: "Graph Thinking",
    description:
      "Apply graph-based thinking to visualize complex relationships and solve problems non-linearly. Use when mapping dependencies, analyzing systems, exploring interconnected concepts, or designing architectures.",
  },
  {
    id: "halo-effect-psychology",
    name: "Halo Effect Psychology",
    description:
      "Apply the halo effect in product design and UX. Use when designing first impressions, brand perception, feature presentation, or understanding how one positive attribute influences perception of others.",
  },
  {
    id: "hicks-law",
    name: "Hick's Law",
    description:
      "Optimize decision-making speed by managing choice quantity. Use when designing navigation, menus, feature sets, onboarding flows, or any interface where users must choose between options.",
  },
  {
    id: "hooked-model",
    name: "Hooked Model",
    description:
      "Design habit-forming products using the Hook cycle. Use when building engagement loops, improving retention, designing notifications, or creating products users return to without external prompting.",
  },
  {
    id: "hypothesis-tree",
    name: "Hypothesis Tree",
    description:
      "Structure complex questions into testable hypotheses. Use when validating product ideas, debugging problems, planning experiments, or breaking down ambiguous challenges into actionable research.",
  },
  {
    id: "jobs-to-be-done",
    name: "Jobs To Be Done",
    description:
      "Understand customer motivations through job theory. Use when defining product strategy, conducting user research, identifying competitors, writing user stories, or reframing features around customer progress.",
  },
  {
    id: "kanban",
    name: "Kanban",
    description:
      "Visualize and optimize workflow with Kanban boards. Use when managing team work, identifying bottlenecks, improving delivery flow, or implementing continuous improvement in product development.",
  },
  {
    id: "loss-aversion-psychology",
    name: "Loss Aversion Psychology",
    description:
      "Leverage loss aversion in product design and messaging. Use when designing retention features, pricing strategies, onboarding flows, or any experience where framing around potential loss can drive behavior.",
  },
  {
    id: "making-product-decisions",
    name: "Making Product Decisions",
    description:
      "Framework for structured product decision-making. Use when facing complex tradeoffs, aligning stakeholders, documenting decisions, or choosing between multiple valid approaches.",
  },
  {
    id: "pest-analysis",
    name: "PEST Analysis",
    description:
      "Guides PEST (Political, Economic, Social, Technological) analysis for strategic planning. Use when analyzing external macro-environmental factors or evaluating business decisions.",
  },
  {
    id: "progressive-disclosure",
    name: "Progressive Disclosure",
    description:
      "Reduce complexity by revealing information progressively. Use when designing onboarding, complex forms, feature-rich interfaces, or any experience where showing everything at once would overwhelm users.",
  },
  {
    id: "self-initiated-triggers",
    name: "Self Initiated Triggers",
    description:
      "Design internal triggers for sustained user engagement. Use when building habit-forming features, improving retention without notifications, or transitioning users from external prompts to self-motivated engagement.",
  },
  {
    id: "social-proof-psychology",
    name: "Social Proof Psychology",
    description:
      "Leverage social proof principles to build trust and influence user behavior. Use when designing landing pages, adding testimonials, displaying user stats, or optimizing conversion elements with social validation.",
  },
  {
    id: "status-quo-bias",
    name: "Status Quo Bias",
    description:
      "Understand and design for users' preference for current state over change. Use when planning migrations, introducing new features, designing defaults, or overcoming resistance to product adoption.",
  },
  {
    id: "theme-epic-story",
    name: "Theme Epic Story",
    description:
      "Structure product work hierarchically using themes, epics, and stories. Use when organizing backlogs, planning releases, communicating with stakeholders, or breaking down large initiatives into manageable work.",
  },
  {
    id: "trust-psychology",
    name: "Trust Psychology",
    description:
      "Build trust signals that reduce perceived risk and enable user action. Use when designing landing pages, checkout flows, onboarding experiences, or any conversion point where user hesitation is a barrier.",
  },
  {
    id: "user-story-fundamentals",
    name: "User Story Fundamentals",
    description:
      "Capture requirements from user perspective with structured user stories. Use when writing backlog items, defining acceptance criteria, prioritizing features, or communicating requirements between product and development.",
  },
  {
    id: "value-realization",
    name: "Value Realization",
    description:
      "Analyze if end users discover clear value. Use when evaluating product concepts, analyzing adoption, or uncertain about direction.",
  },
  {
    id: "visual-cues-cta-psychology",
    name: "Visual Cues CTA Psychology",
    description:
      "Design effective CTAs using visual attention and gaze psychology principles. Use when designing landing pages, button hierarchies, conversion elements, or optimizing user attention flow through interfaces.",
  },
  {
    id: "what-not-to-do-as-product-manager",
    name: "What Not To Do As Product Manager",
    description:
      "Anti-patterns and mistakes to avoid as a product manager. Use when evaluating leadership behaviors, improving team dynamics, reflecting on management practices, or onboarding new product managers.",
  },
] as const;

/**
 * Build a concise "skills knowledge" block for inclusion in agent system
 * prompts. Lists all bundled skill names and descriptions.
 */
export function buildSkillsKnowledgeBlock(): string {
  const lines = BUNDLED_SKILLS.map(
    (s) => `- **${s.name}**: ${s.description}`
  );
  return lines.join("\n");
}
