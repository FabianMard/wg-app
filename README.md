# WG-App

Putzplan, Einkaufsliste, Kosten teilen, Kalender und To-dos für eure WG.
Next.js + Supabase, installierbar als App auf dem Handy (PWA). Alle Änderungen erscheinen live bei allen Mitbewohnern.

## Einrichten (ca. 10 Minuten)

### 1. Supabase-Projekt anlegen
1. Auf [supabase.com](https://supabase.com) kostenlos registrieren und ein neues Projekt anlegen (Region z. B. Frankfurt).
2. **Authentication → Sign In / Providers → „Allow anonymous sign-ins“** aktivieren und speichern.
3. Links **SQL Editor** öffnen, den Inhalt von `supabase/schema.sql` einfügen und **Run** klicken.
   Das legt alles an: die WG, die Mitbewohner Verena, Stefan und Fabian und den Putzplan.
   Unten im Ergebnis steht der **Einladungscode** (`invite_code`).
   ⚠️ Das Skript löscht vorher alle bestehenden WG-Daten. Nur beim Einrichten ausführen!
   Wer schon eine ältere Version eingerichtet hat: nur die fehlenden Zusatz-Skripte ausführen
   (`003_avatare.sql`, `004_einkauf_favoriten.sql` – Daten bleiben erhalten).
   **Zum Ausprobieren:** danach `supabase/demo_data.sql` ausführen. Das füllt die App mit Beispieldaten.
   Für den echten Start `schema.sql` einfach nochmal ausführen, dann ist alles wieder leer.
4. Unter **Project Settings → API** die *Project URL* und den *publishable/anon key* kopieren.

### 2. Lokal starten
```bash
cp .env.example .env.local   # Werte aus Schritt 1.3 eintragen
npm install
npm run dev
```
Dann `http://localhost:3000/?code=EINLADUNGSCODE` öffnen und auf den eigenen Namen tippen.
Unter dem Avatar oben rechts gibt es den Einladungslink zum Teilen.

## Anmeldung ohne E-Mail
- Jedes Gerät bekommt automatisch ein anonymes Konto. Beim ersten Öffnen tippt man auf seinen Namen.
- **Neues Handy oder Browserdaten gelöscht?** Einfach wieder Link öffnen und auf den eigenen Namen tippen.
- Wer den Link hat, kommt in die WG. Den Link also nur in der WG-Gruppe teilen.

### 3. Online stellen mit Vercel
1. Projekt auf GitHub hochladen.
2. Auf [vercel.com](https://vercel.com) mit GitHub anmelden → **Add New Project** → Repo auswählen.
3. Unter *Environment Variables* `NEXT_PUBLIC_SUPABASE_URL` und `NEXT_PUBLIC_SUPABASE_ANON_KEY` eintragen → **Deploy**.

Jeder weitere `git push` wird automatisch veröffentlicht.

### 4. Aufs Handy
Seite im Browser öffnen → iPhone: Teilen → „Zum Home-Bildschirm“, Android: Menü → „App installieren“.

## Putzplan
- Drei Bereiche (Küche, Bad, Sonstiges), alle haben gleichzeitig Dienst.
- **Woche 1 = Putzwoche** (fällig am Sonntag), **Woche 2 = frei**, danach wechseln die Bereiche reihum.
- Nicht in der Putzwoche fertig geworden? Dann ist der Bereich in der freien Woche **überfällig**
  und wird rot hervorgehoben (Putzplan, Startseite, Kalender, Spiel).
- Jeder Bereich hat eine Checkliste. Erst wenn alles abgehakt ist, ist er erledigt.
  Die Liste lässt sich in der App bearbeiten („Liste bearbeiten“).
- Erledigte Bereiche und To-dos können die anderen loben. Das gibt **fleißige Bienchen 🐝**.

## WG-Spiel 🎮
- Mit eigenem Avatar durch die Wohnung laufen (Pfeiltasten/WASD, Hinklicken oder Steuerkreuz).
- Gegenstände öffnen die App (Kühlschrank → Einkauf, Kalender, Pinnwand → To-dos, Kasse → Kosten …).
- Am eigenen **Kleiderschrank** Frisur, Kleidung und Accessoires ändern.
- Mitbewohner ansprechen, loben, Sprechblasen und Emotes (live über Supabase Realtime).

## Märkte & Logos
Die Märkte stehen in `src/lib/stores.ts`. Statt der farbigen Kürzel können echte Logos
angezeigt werden: Bild nach `public/maerkte/` legen (z. B. `rewe.png`) und bei `logo: "/maerkte/rewe.png"` eintragen.

## Aufbau
| Pfad | Inhalt |
|---|---|
| `supabase/schema.sql` | Tabellen, Zugriffsrechte (jede WG sieht nur ihre Daten), Live-Updates |
| `src/lib/wg.tsx` | Login-Status, aktuelle WG, Hook `useRows()` zum Laden und Live-Aktualisieren |
| `src/lib/balances.ts` | Salden und minimale Ausgleichszahlungen |
| `src/lib/cleaning.ts` | Putzrunden: Wer ist wann mit welchem Bereich dran |
| `src/components/Gate.tsx` | Anmelden, Registrieren, WG gründen/beitreten |
| `src/app/*/page.tsx` | Die einzelnen Bereiche |

## Ideen für später
- Push-Benachrichtigungen („Du bist mit dem Bad dran“)
- Gekaufte Einkäufe direkt als Ausgabe eintragen
- Wiederkehrende Kosten (Miete, Internet)
- Putzplan-Statistik: wer hat wie oft geputzt
