# WG-App

Putzplan, Einkaufsliste, Kosten teilen, Kalender und To-dos für eure WG.
Next.js + Supabase, installierbar als App auf dem Handy (PWA). Alle Änderungen erscheinen live bei allen Mitbewohnern.

## Einrichten (ca. 10 Minuten)

### 1. Supabase-Projekt anlegen
1. Auf [supabase.com](https://supabase.com) kostenlos registrieren und ein neues Projekt anlegen (Region z. B. Frankfurt).
2. Im Projekt links **SQL Editor** öffnen, den Inhalt von `supabase/schema.sql` einfügen und **Run** klicken.
3. Unter **Project Settings → API** die *Project URL* und den *anon public key* kopieren.

### 2. Lokal starten
```bash
cp .env.example .env.local   # Werte aus Schritt 1.3 eintragen
npm install
npm run dev
```
Dann http://localhost:3000 öffnen, registrieren, WG gründen. Den Einladungscode (Avatar oben rechts) an die Mitbewohner schicken.

> Supabase verlangt standardmäßig eine E-Mail-Bestätigung. Für schnelles Testen lässt sie sich unter
> **Authentication → Sign In / Providers → Email → Confirm email** abschalten.

### 3. Online stellen mit Vercel
1. Projekt auf GitHub hochladen.
2. Auf [vercel.com](https://vercel.com) mit GitHub anmelden → **Add New Project** → Repo auswählen.
3. Unter *Environment Variables* `NEXT_PUBLIC_SUPABASE_URL` und `NEXT_PUBLIC_SUPABASE_ANON_KEY` eintragen → **Deploy**.
4. In Supabase unter **Authentication → URL Configuration** die Vercel-Adresse als *Site URL* eintragen (damit die Bestätigungslinks stimmen).

Jeder weitere `git push` wird automatisch veröffentlicht.

### 4. Aufs Handy
Seite im Browser öffnen → iPhone: Teilen → „Zum Home-Bildschirm“, Android: Menü → „App installieren“.

## Aufbau
| Pfad | Inhalt |
|---|---|
| `supabase/schema.sql` | Tabellen, Zugriffsrechte (jede WG sieht nur ihre Daten), Live-Updates |
| `src/lib/wg.tsx` | Login-Status, aktuelle WG, Hook `useRows()` zum Laden und Live-Aktualisieren |
| `src/lib/balances.ts` | Salden und minimale Ausgleichszahlungen |
| `src/components/Gate.tsx` | Anmelden, Registrieren, WG gründen/beitreten |
| `src/app/*/page.tsx` | Die einzelnen Bereiche |

## Ideen für später
- Push-Benachrichtigungen („Du bist mit Bad putzen dran“)
- Gekaufte Einkäufe direkt als Ausgabe eintragen
- Wiederkehrende Kosten (Miete, Internet)
- Putzplan-Statistik: wer hat wie oft geputzt
