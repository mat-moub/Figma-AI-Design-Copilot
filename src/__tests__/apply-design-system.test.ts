import { applyDesignSystem } from "../skills/apply-design-system";
import type { DesignSystem, UIScreen } from "../types/ui-types";

const mockDesignSystem: DesignSystem = {
  components: ["ButtonPrimary", "InputText", "CardAnalytics", "AvatarCircle", "NavHeader"],
  colors: ["PrimaryBlue", "SecondaryGray"],
  textStyles: ["Heading1", "Body"],
};

const mockScreens: UIScreen[] = [
  {
    name: "Dashboard",
    layout: "vertical",
    elements: [
      { type: "text", value: "Welcome" },
      { type: "button", value: "Get Started" },
      { type: "input", value: "Search…" },
      { type: "card" },
      { type: "avatar" },
      { type: "nav" },
    ],
  },
];

describe("applyDesignSystem", () => {
  it("maps button elements to design system component", () => {
    const result = applyDesignSystem({ screens: mockScreens, designSystem: mockDesignSystem });
    const buttonEl = result[0].elements.find((e) => e.type === "button");
    expect(buttonEl?.component).toBe("ButtonPrimary");
  });

  it("maps input elements to design system component", () => {
    const result = applyDesignSystem({ screens: mockScreens, designSystem: mockDesignSystem });
    const inputEl = result[0].elements.find((e) => e.type === "input");
    expect(inputEl?.component).toBe("InputText");
  });

  it("maps card elements to design system component", () => {
    const result = applyDesignSystem({ screens: mockScreens, designSystem: mockDesignSystem });
    const cardEl = result[0].elements.find((e) => e.type === "card");
    expect(cardEl?.component).toBe("CardAnalytics");
  });

  it("maps avatar elements to design system component", () => {
    const result = applyDesignSystem({ screens: mockScreens, designSystem: mockDesignSystem });
    const avatarEl = result[0].elements.find((e) => e.type === "avatar");
    expect(avatarEl?.component).toBe("AvatarCircle");
  });

  it("maps nav elements to design system component", () => {
    const result = applyDesignSystem({ screens: mockScreens, designSystem: mockDesignSystem });
    const navEl = result[0].elements.find((e) => e.type === "nav");
    expect(navEl?.component).toBe("NavHeader");
  });

  it("does not overwrite an already specified component", () => {
    const screensWithComponent: UIScreen[] = [
      {
        name: "Test",
        layout: "vertical",
        elements: [{ type: "button", value: "Submit", component: "CustomButton" }],
      },
    ];
    const result = applyDesignSystem({
      screens: screensWithComponent,
      designSystem: mockDesignSystem,
    });
    expect(result[0].elements[0].component).toBe("CustomButton");
  });

  it("returns original screens unchanged when design system has no components", () => {
    const emptyDS: DesignSystem = { components: [], colors: [], textStyles: [] };
    const result = applyDesignSystem({ screens: mockScreens, designSystem: emptyDS });
    expect(result[0].elements.find((e) => e.type === "button")?.component).toBeUndefined();
  });

  it("recursively applies to children elements", () => {
    const screensWithChildren: UIScreen[] = [
      {
        name: "Card Screen",
        layout: "vertical",
        elements: [
          {
            type: "card",
            children: [
              { type: "button", value: "Action" },
              { type: "input", value: "Field" },
            ],
          },
        ],
      },
    ];
    const result = applyDesignSystem({
      screens: screensWithChildren,
      designSystem: mockDesignSystem,
    });
    const card = result[0].elements[0];
    expect(card.children?.[0].component).toBe("ButtonPrimary");
    expect(card.children?.[1].component).toBe("InputText");
  });

  it("preserves screen structure and metadata", () => {
    const result = applyDesignSystem({ screens: mockScreens, designSystem: mockDesignSystem });
    expect(result[0].name).toBe("Dashboard");
    expect(result[0].layout).toBe("vertical");
    expect(result[0].elements).toHaveLength(mockScreens[0].elements.length);
  });
});
