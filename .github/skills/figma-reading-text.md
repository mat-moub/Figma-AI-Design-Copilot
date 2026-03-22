# Skill: Lire et extraire du texte Figma via le Plugin API

> **Source :** https://developers.figma.com/docs/plugins/working-with-text/

## Vue d'ensemble

Les nœuds texte (`TextNode`, type `"TEXT"`) exposent leurs contenus via `.characters` et une série de propriétés qui peuvent retourner `figma.mixed` lorsque différents caractères ont des valeurs différentes. **Toujours considérer qu'une propriété texte peut être mixte.**

---

## 1. Accéder au contenu textuel brut

```ts
const textNodes = figma.currentPage.findAll(
  (node) => node.type === "TEXT"
) as TextNode[];

textNodes.forEach((node) => {
  console.log(node.name);        // nom du layer
  console.log(node.characters);  // contenu texte brut complet
});
```

---

## 2. Propriétés typographiques — valeur unique vs mixte

Une propriété comme `fontName` retourne `figma.mixed` si le nœud contient plusieurs styles :

```ts
const node: TextNode = ...;

// Peut retourner figma.mixed si le texte a des styles mélangés
const font = node.fontName;

if (font === figma.mixed) {
  console.log("Styles de police multiples dans ce nœud");
} else {
  console.log(font.family, font.style); // ex: "Inter", "Bold"
}

// Idem pour fontSize, letterSpacing, lineHeight, etc.
const size = node.fontSize;
if (size !== figma.mixed) {
  console.log("Taille unique :", size);
}
```

---

## 3. Lire les propriétés sur un segment (range)

Pour accéder aux propriétés d'une plage précise de caractères :

```ts
const node: TextNode = ...;
// Texte : "hello world" (0–4 = "hello" en Bold, 5–10 = "world" en Regular)

// Retourne { family: 'Inter', style: 'Bold' }
const boldFont = node.getRangeFontName(0, 5);

// Retourne { family: 'Inter', style: 'Regular' }
const regularFont = node.getRangeFontName(5, 11);

// Retourne figma.mixed si la plage couvre deux styles différents
const mixedFont = node.getRangeFontName(4, 6);
```

Méthodes `getRange*` disponibles :
- `getRangeFontName(start, end)`
- `getRangeFontSize(start, end)`
- `getRangeLetterSpacing(start, end)`
- `getRangeLineHeight(start, end)`
- `getRangeTextCase(start, end)`
- `getRangeTextDecoration(start, end)`

---

## 4. Obtenir tous les segments stylisés d'un nœud

`getStyledTextSegments` est la méthode la plus pratique pour extraire le texte avec ses styles associés :

```ts
const node: TextNode = ...;

// Segmente le texte par fontName
const segments = node.getStyledTextSegments(["fontName"]);
/*
[
  { characters: "hello", start: 0, end: 5, fontName: { family: "Inter", style: "Bold" } },
  { characters: " world", start: 5, end: 11, fontName: { family: "Inter", style: "Regular" } }
]
*/

// Segmenter sur plusieurs propriétés en même temps
const richSegments = node.getStyledTextSegments([
  "fontName",
  "fontSize",
  "textDecoration",
  "textCase",
]);
```

---

## 5. Lister toutes les polices utilisées dans un nœud

```ts
const node: TextNode = ...;

// Récupère toutes les FontName distinctes utilisées dans le nœud
const fonts = node.getRangeAllFontNames(0, node.characters.length);
// [ { family: "Inter", style: "Bold" }, { family: "Inter", style: "Regular" } ]
```

---

## 6. Vérifier les polices manquantes

Avant tout traitement, vérifier que le nœud n'a pas de police manquante :

```ts
if (node.hasMissingFont) {
  figma.notify(`Police manquante dans "${node.name}", traitement ignoré.`);
  return;
}
```

---

## 7. Charger les polices (nécessaire avant modification)

> ℹ️ La **lecture** de `.characters` et de `getStyledTextSegments` ne nécessite pas de charger les polices. Le chargement est requis uniquement pour **modifier** le contenu ou le style.

```ts
// Pour un nœud à police unique
await figma.loadFontAsync(node.fontName as FontName);

// Pour un nœud à polices multiples (recommandé)
await Promise.all(
  node.getRangeAllFontNames(0, node.characters.length).map(figma.loadFontAsync)
);

// Maintenant on peut modifier
node.characters = "Nouveau texte";
node.fontSize = 16;
```

---

## 8. Extraire tout le texte d'une page (contexte LLM)

Pattern utilisé dans ce projet pour collecter les contenus textuels :

```ts
interface TextContext {
  name: string;
  characters: string;
  fontSize: number | typeof figma.mixed;
  fontFamily: string | "mixed";
}

function extractTextContext(page: PageNode): TextContext[] {
  const textNodes = page.findAll(
    (n) => n.type === "TEXT"
  ) as TextNode[];

  return textNodes
    .filter((n) => !n.hasMissingFont && n.characters.trim() !== "")
    .map((n) => {
      const font = n.fontName;
      return {
        name: n.name,
        characters: n.characters,
        fontSize: n.fontSize,
        fontFamily: font === figma.mixed ? "mixed" : font.family,
      };
    });
}
```

---

## Bonnes pratiques

- **Toujours** tester `=== figma.mixed` avant d'utiliser une propriété typographique.
- **Toujours** appeler `hasMissingFont` avant de traiter ou modifier un nœud texte.
- Utiliser `getStyledTextSegments` pour une extraction riche (segments avec styles).
- La lecture de `.characters` et `getStyledTextSegments` **ne requiert pas** de `loadFontAsync`.
- `loadFontAsync` est uniquement nécessaire avant toute **modification** de contenu ou de mise en forme.
- Utiliser `figma.notify()` pour signaler à l'utilisateur les polices manquantes plutôt que de silencieusement ignorer les nœuds.
