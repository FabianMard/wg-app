# WG-App

Putzplan, Einkaufsliste, Kosten teilen, Kalender und To-dos für eure WG.
Next.js + Supabase, installierbar als App auf dem Handy (PWA). Alle Änderungen erscheinen live bei allen Mitbewohnern.

## Einrichten (ca. 10 Minuten)

### 1. Supabase-Projekt anlegen
1. Auf [supabase.com](https://supabase.com) kostenlos registrieren und ein neues Projekt anlegen (Region z. B. Frankfurt).
2. Im Projekt links **SQL Editor** öffnen, den Inhalt von `supabase/schema.sql` einfügen und **Run** klicken.
   (Wer `schema.sql` schon früher ausgeführt hat: nur noch `supabase/002_link_join.sql` ausführen.)
3. **Authentication → Sign In / Providers → „Allow anonymous sign-ins“** aktivieren und speichern.
   Damit braucht niemand eine E-Mail-Adresse: Wer den Einladungslink öffnet, gibt nur seinen Namen ein.
4. Unter **Project Settings → API** die *Project URL* und den *anon public key* kopieren.

### 2. Lokal starten
```bash
cp .env.example .env.local   # Werte aus Schritt 1.3 eintragen
npm install
npm run dev
```
Dann http://localhost:3000 öffnen und eine WG gründen. Unter dem Avatar oben rechts gibt es den
Einladungslink zum Teilen.

## Anmeldung ohne E-Mail
- Jedes Gerät bekommt automatisch ein anonymes Konto. Der Name wird beim Beitritt eingegeben.
- **Neues Handy oder Browserdaten gelöscht?** Einladungslink öffnen und auf den eigenen Namen tippen.
  Das Gerät übernimmt dann Aufgaben, Ausgaben und Kontostand.
- Wer den Link hat, kommt in die WG. Den Link also nur in der WG-Gruppe teilen.

### 3. Online stellen mit Vercel
1. Projekt auf GitHub hochladen.
2. Auf [vercel.com](https://vercel.com) mit GitHub anmelden → **Add New Project** → Repo auswählen.
3. Unter *Environment Variables* `NEXT_PUBLIC_SUPABASE_URL` und `NEXT_PUBLIC_SUPABASE_ANON_KEY` eintragen → **Deploy**.

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
