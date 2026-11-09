// Grundriss der WG (von oben). Jede Zeile = eine Reihe Kacheln.
//  #  Wand        .  Flur        h  Tür
//  k  Küche       b  Bad         w  Wohnzimmer
//  1/2/3  Zimmer der Mitbewohner (in der Reihenfolge members.sort)
export const MAP = [
  "#######################",
  "#kkkkkkk#bbbbb#wwwwwww#",
  "#kkkkkkk#bbbbb#wwwwwww#",
  "#kkkkkkk#bbbbb#wwwwwww#",
  "#kkkkkkk#bbbbb#wwwwwww#",
  "#kkkkkkk#bbbbb#wwwwwww#",
  "####h#######h####h#####",
  "#.....................#",
  "#.....................#",
  "####h######h######h####",
  "#111111#222222#3333333#",
  "#111111#222222#3333333#",
  "#111111#222222#3333333#",
  "#111111#222222#3333333#",
  "#111111#222222#3333333#",
  "#######################",
];

export const COLS = MAP[0].length;
export const ROWS = MAP.length;

export type Action = "start" | "putzplan" | "einkauf" | "kosten" | "kalender" | "todos" | "wg" | "watchlist" | "pinnwand" | "musik"
  | "schlafen" | "kleiderschrank" | "giessen" | "buecher" | "spuelmaschine" | "kite";

/** owner = Index des Mitbewohners (members.sort), dem der Gegenstand gehört */
export type GameObject = { x: number; y: number; icon: string; label: string; action: Action; hint: string; owner?: number };

export const OBJECTS: GameObject[] = [
  // Küche
  { x: 1, y: 1, icon: "🧊", label: "Kühlschrank", action: "einkauf", hint: "Was fehlt? Einkaufsliste öffnen" },
  { x: 3, y: 1, icon: "🍳", label: "Herd", action: "putzplan", hint: "Putzplan Küche ansehen" },
  { x: 5, y: 1, icon: "🚰", label: "Spüle", action: "putzplan", hint: "Putzplan ansehen" },
  { x: 6, y: 1, icon: "🫧", label: "Spülmaschine", action: "spuelmaschine", hint: "Minispiel: schnell einräumen!" },
  { x: 7, y: 1, icon: "🗑️", label: "Mülleimer", action: "putzplan", hint: "Putzplan ansehen" },
  { x: 4, y: 3, icon: "🍽️", label: "Esstisch", action: "kosten", hint: "Wer hat was bezahlt? Kosten öffnen" },
  // Bad
  { x: 9, y: 1, icon: "🛁", label: "Badewanne", action: "putzplan", hint: "Putzplan Bad ansehen" },
  { x: 11, y: 1, icon: "🪥", label: "Waschbecken", action: "putzplan", hint: "Putzplan ansehen" },
  { x: 13, y: 1, icon: "🚽", label: "Toilette", action: "putzplan", hint: "Putzplan ansehen" },
  { x: 13, y: 5, icon: "🧺", label: "Waschmaschine", action: "putzplan", hint: "Putzplan ansehen" },
  // Wohnzimmer
  { x: 16, y: 1, icon: "🛋️", label: "Sofa", action: "start", hint: "Hinsetzen und Überblick holen" },
  { x: 19, y: 1, icon: "📺", label: "Fernseher", action: "watchlist", hint: "Watchlist: Was schauen wir?" },
  { x: 21, y: 1, icon: "📻", label: "Musikanlage", action: "musik", hint: "Unsere Spotify-Playlisten" },
  { x: 21, y: 3, icon: "📌", label: "Pinnwand", action: "pinnwand", hint: "Zettel & Fotos ansehen" },
  { x: 18, y: 3, icon: "💰", label: "Haushaltskasse", action: "kosten", hint: "Kosten & Ausgleich" },
  { x: 15, y: 5, icon: "🪴", label: "Pflanze", action: "giessen", hint: "Gießen 💧" },
  // Flur (Kalender hängt an der Wand)
  { x: 8, y: 6, icon: "📅", label: "Kalender", action: "kalender", hint: "Termine ansehen & eintragen" },
  { x: 21, y: 8, icon: "🧹", label: "Besen", action: "putzplan", hint: "Putzplan ansehen" },
  { x: 0, y: 7, icon: "🚪", label: "Haustür", action: "wg", hint: "Mitbewohner einladen" },
  // Zimmer
  { x: 1, y: 10, icon: "🛏️", label: "Bett", action: "schlafen", hint: "Kurz hinlegen 💤" },
  { x: 8, y: 10, icon: "🛏️", label: "Bett", action: "schlafen", hint: "Kurz hinlegen 💤" },
  { x: 21, y: 10, icon: "🛏️", label: "Bett", action: "schlafen", hint: "Kurz hinlegen 💤" },
  // Verenas Dschungel 🌿 (Weg von der Tür zur Bettmitte bleibt frei)
  ...([
    [2, 10, "🌵"], [1, 12, "🪴"], [1, 13, "🌿"], [1, 14, "🌱"], [2, 14, "🌻"],
    [5, 14, "🌷"], [6, 14, "🪴"], [6, 13, "🌿"], [6, 12, "🎋"], [5, 12, "🍀"],
  ] as const).map(([x, y, icon]) => ({ x, y, icon, label: "Pflanze", action: "giessen" as const, hint: "Gießen 💧" })),
  { x: 6, y: 10, icon: "👚", label: "Kleiderschrank", action: "kleiderschrank", hint: "Verenas Schrank – ausleihen erlaubt", owner: 0 },
  { x: 13, y: 10, icon: "👚", label: "Kleiderschrank", action: "kleiderschrank", hint: "Stefans Schrank – ausleihen erlaubt", owner: 1 },
  // Stefans Kite-Ecke 🪁 → Windvorhersage
  { x: 13, y: 12, icon: "🪁", label: "Kite", action: "kite", hint: "Wie ist der Wind an Stefans Spots?", owner: 1 },
  { x: 13, y: 13, icon: "🏄", label: "Kiteboard", action: "kite", hint: "Wie ist der Wind an Stefans Spots?", owner: 1 },
  { x: 13, y: 14, icon: "🦺", label: "Trapez & Neopren", action: "kite", hint: "Wie ist der Wind an Stefans Spots?", owner: 1 },
  // Fabians Bücher 📚 (Weg von der Tür zur Zimmermitte bleibt frei)
  { x: 15, y: 12, icon: "📚", label: "Bücherregal", action: "buecher", hint: "Was liest Fabian gerade?", owner: 2 },
  { x: 15, y: 13, icon: "📚", label: "Bücherregal", action: "buecher", hint: "Was liest Fabian gerade?", owner: 2 },
  { x: 16, y: 14, icon: "📖", label: "Aufgeschlagenes Buch", action: "buecher", hint: "Was liest Fabian gerade?", owner: 2 },
  { x: 21, y: 14, icon: "📕", label: "Bücherstapel", action: "buecher", hint: "Was liest Fabian gerade?", owner: 2 },
  { x: 15, y: 10, icon: "👚", label: "Kleiderschrank", action: "kleiderschrank", hint: "Fabians Schrank – ausleihen erlaubt", owner: 2 },
];

/** Startplatz/Schlafplatz je Zimmer (Index = members.sort) */
export const HOME_SPOTS = [{ x: 3, y: 12 }, { x: 10, y: 12 }, { x: 18, y: 12 }];

export const ROOM_LABELS = [
  { x: 4, y: 4.6, text: "Küche" },
  { x: 11, y: 4.6, text: "Bad" },
  { x: 18, y: 4.6, text: "Wohnzimmer" },
  { x: 11, y: 7.5, text: "Flur" },
];
export const BEDROOM_LABELS = [{ x: 3.5, y: 14.1 }, { x: 10.5, y: 14.1 }, { x: 18, y: 14.1 }];

export const tileAt = (x: number, y: number) => MAP[y]?.[x] ?? "#";
export const objectAt = (x: number, y: number) => OBJECTS.find((o) => o.x === x && o.y === y);
export const isWalkable = (x: number, y: number) => tileAt(x, y) !== "#" && !objectAt(x, y);

export type Pos = { x: number; y: number };
const DIRS = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];
export const neighbors = (p: Pos) => DIRS.map((d) => ({ x: p.x + d.x, y: p.y + d.y }));
export const isAdjacent = (a: Pos, b: Pos) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;

/** Kürzester Weg (ohne Startfeld). Ist das Ziel blockiert, endet der Weg auf einem Nachbarfeld davon. */
export function findPath(from: Pos, to: Pos, blocked: (p: Pos) => boolean = () => false): Pos[] | null {
  const free = (p: Pos) => isWalkable(p.x, p.y) && !blocked(p);
  const goals = free(to) ? [to] : neighbors(to).filter(free);
  if (!goals.length) return null;
  const key = (p: Pos) => `${p.x},${p.y}`;
  const goalKeys = new Set(goals.map(key));
  const prev = new Map<string, Pos | null>([[key(from), null]]);
  const queue: Pos[] = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    if (goalKeys.has(key(cur))) {
      const path: Pos[] = [];
      for (let p: Pos | null = cur; p && key(p) !== key(from); p = prev.get(key(p)) ?? null) path.unshift(p);
      return path;
    }
    for (const n of neighbors(cur)) {
      if (!free(n) || prev.has(key(n))) continue;
      prev.set(key(n), cur);
      queue.push(n);
    }
  }
  return null;
}

/** Bodenfarbe je Kachel */
export function floorColor(ch: string, x: number, y: number, memberColors: string[]): string {
  const checker = (x + y) % 2 === 0;
  switch (ch) {
    case "#": return "#4b4453";
    case "k": return checker ? "#f4efe4" : "#e6dfcf";
    case "b": return checker ? "#dbeafe" : "#cfe3fb";
    case "w": return checker ? "#e2c49b" : "#dcbc90";
    case ".": case "h": return checker ? "#e9e3d9" : "#e2dbcf";
    case "1": case "2": case "3": {
      const c = memberColors[Number(ch) - 1] ?? "#999999";
      return `color-mix(in srgb, ${c} ${checker ? 16 : 20}%, #f3e6cf)`;
    }
    default: return "#e5e5e5";
  }
}
