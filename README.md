# Webhafen OS

*Das Betriebssystem für dein Business.*

Eigene Marketing- und Vertriebs-Software für Webhafen: CRM, Lead-Pipelines mit Prognose,
Social Planner, Affiliate-Manager, Trigger-Links und automatische Website-Checks für die
Kundenakquise – in **einer** App, ohne monatliche Lizenzkosten.

- **Keine Abhängigkeiten**: nur Node.js ≥ 22.13 (die Datenbank SQLite ist eingebaut)
- **Kein Build-Schritt**: `npm start` und fertig
- Alle Daten liegen in einer Datei: `data/webhafen-os.db` (zum Sichern einfach kopieren)

## Starten

```bash
cd webhafen-os
ADMIN_PASSWORD='ein-langes-passwort' npm start
# → http://localhost:3000
```

Ohne `ADMIN_PASSWORD` ist die App **ohne Login** erreichbar – nur lokal so betreiben.

| Umgebungsvariable | Wozu |
|---|---|
| `ADMIN_PASSWORD` | Passwort für den Login (Pflicht auf einem Server) |
| `PORT` | Port, Standard `3000` |
| `DB_FILE` | Pfad zur Datenbank, Standard `data/webhafen-os.db` |
| `TZ` | Zeitzone für geplante Beiträge, Standard `Europe/Berlin` |
| `HTTPS` | `1` setzen, wenn die App hinter HTTPS läuft (sichere Cookies) |
| `GOOGLE_PLACES_API_KEY` | optional: Google-Unternehmensprofil & Bewertungen im Website-Check |
| `PAGESPEED_API_KEY` | optional, praktisch nötig: eigenes Kontingent für Google PageSpeed (ohne Schlüssel kommt oft „429“) |
| `ANTHROPIC_API_KEY` | optional: Claude schreibt individuelle Anschreiben-Entwürfe (sonst Textvorlage) |
| `ANTHROPIC_MODEL` | optional: anderes Claude-Modell, Standard `claude-opus-5-5` |

Tests: `npm test`

Optional für KI-Anschreiben: `npm install` (installiert `@anthropic-ai/sdk`). Ohne das Paket läuft alles,
die Entwürfe kommen dann aus einer Textvorlage.

### Google-Schlüssel einrichten (für Lead-Finder, Google-Profil, Ranking, Heatmap)

1. In der [Google Cloud Console](https://console.cloud.google.com/) ein Projekt anlegen und ein Rechnungskonto hinterlegen.
2. Unter „APIs & Dienste → Bibliothek“ **Places API (New)** und **PageSpeed Insights API** aktivieren.
3. Unter „Anmeldedaten“ einen API-Schlüssel erstellen und auf diese beiden APIs **beschränken**.
4. Den Schlüssel als `GOOGLE_PLACES_API_KEY` und `PAGESPEED_API_KEY` setzen.

Google rechnet Places-Abfragen einzeln ab (es gibt ein monatliches Freikontingent – aktuelle Preise im
Cloud-Konto prüfen). Grob: eine Lead-Suche ≈ 4 Abfragen, ein Website-Check mit Google-Daten ≈ 3,
eine Heatmap 9 / 25 / 49 Abfragen (3×3 / 5×5 / 7×7).

## Was die App kann

### 👥 Kontakte
Kontakte anlegen, durchsuchen, taggen, per CSV importieren.

### 🎯 Leads (Pipelines)
- Kanban-Board mit Drag & Drop zwischen den Phasen
- „Neuen Lead hinzufügen“ mit Ansprechpartner (bestehend oder neu), Pipeline, Phase, Status
  (Offen/Gewonnen/Verloren/Aufgegeben), Wert, Verantwortlicher, Follower, Firma, Quelle,
  erwartetes Abschlussdatum, Tags, Notizen
- Listenansicht mit **Massenaktionen** (Status, Phase, Tag, Löschen) und CSV-Import
- Pipelines frei anlegen: Phasen, Reihenfolge, Farbe, Wahrscheinlichkeit je Phase oder je Lead

### 📊 Prognose
- Maximale potenzielle, erwartete (Wert × Wahrscheinlichkeit) und gewonnene Einnahmen
- **Gefährdete Leads**: Webhafen OS merkt sich, wenn ein Abschlussdatum nach hinten verschoben
  wird → hohes Risiko (2× oder 14+ Tage), mittleres (7+ Tage), geringes
- Datenqualität: fehlendes Abschlussdatum, fehlender Wert, überfällige Leads
- Gruppierung nach Status oder Phase, Zeitachse nach Abschlussmonat

### 📣 Social Planner
- Konten für Facebook, Instagram, LinkedIn, TikTok, YouTube, Pinterest, Threads, Bluesky,
  Google-Unternehmensprofil, X, Community
- Beiträge **einmalig planen**, **wiederkehrend** (z. B. Di + Do 9:00), als **Evergreen-Warteschlange**
  (Kategorien, die reihum ihre Beiträge recyceln) oder als Entwurf
- **Massenplanung per CSV**, **RSS-Feed → Beiträge** (als Entwurf oder automatisch)
- Kalenderansicht, Protokoll je Beitrag, „Jetzt posten“, Testbeitrag je Konto

**Wie wird veröffentlicht?** Facebook, Instagram, LinkedIn, TikTok & YouTube lassen automatisches
Posten nur über Entwickler-Apps zu, die die Plattform erst prüfen und freischalten muss.
Webhafen OS übergibt deshalb jeden fälligen Beitrag an einen **Webhook** – am einfachsten ein
Szenario in [Make](https://make.com), Zapier oder n8n, das dort mit dem jeweiligen Konto
verbunden ist und postet:

```json
POST <Webhook-URL>
{ "platform": "instagram", "account": "Webhafen Instagram", "post_id": 12,
  "content": "…", "media_url": "https://…", "link": "https://…", "sent_at": "2026-11-05T08:00:00.000Z" }
```

**Bluesky** ist direkt angebunden (Handle + App-Passwort). Konten ohne Webhook werden zur
fälligen Zeit als „Manuell posten“ markiert.

### 🤝 Affiliate-Manager
- Kampagnen mit Ziel (Funnel, Website, Shop, externe Seite, Formular, Umfrage, Kalender),
  Provision in % oder als Festbetrag, Cookie-Laufzeit
- Affiliates mit eigenem Tracking-Link `https://deine-app/go/CODE` → zählt Klicks und leitet auf
  `Ziel-URL?ref=CODE` weiter
- Verkäufe manuell erfassen oder automatisch melden lassen:
  ```bash
  curl -X POST https://deine-app/api/public/sale -H 'content-type: application/json' \
    -d '{"key":"API-SCHLÜSSEL","ref":"anna","amount":499,"customer_email":"kunde@example.de"}'
  ```
  (API-Schlüssel unter Einstellungen erzeugen; `ref` liest deine Website aus der URL.)
- Dashboard mit Zeitraum, Einnahmen, Konversion, Kunden, Top-Affiliates, geschuldet/ausgezahlt;
  Provisionen freigeben, auszahlen, stornieren; CSV-Export

### 🔗 Trigger-Links
Kurzlinks `https://deine-app/l/slug` mit Klickzählung – für Flyer, QR-Codes, E-Mails, Bios.

### 🔍 Akquise: Lead-Finder, Prospect-Agent, Widget, Analytics

- **Lead-Finder**: Suchbegriff + Standort + Radius → echte Unternehmen aus Google Maps auf einer Karte und
  in einer Tabelle, mit Bewertung, Website ja/nein, Entfernung und einem **Potenzial-Wert** (0–100: keine
  Website, wenige Bewertungen, kaum Fotos, keine Öffnungszeiten …). Filter „nur ohne Website“.
  Einzeln oder gesammelt übernehmen – auf Wunsch direkt mit Website-Check.
  Jede gefundene Website wird im Hintergrund kurz angeprüft (erreichbar, https, mobiloptimiert, Tracking,
  Chat, erkanntes System wie WordPress oder Homepage-Baukasten wie Jimdo/Wix). Daraus entsteht die
  **Lead-Bewertung** in % mit Stufe **Hoch / Mittel / Niedrig**; die Ergebnisse werden 7 Tage zwischengespeichert.
  Spalten ein-/ausblenden, nach jeder Spalte sortieren, filtern nach Stufe, „ohne Website“, „Bewertung unter 4,5“,
  „weniger als 20 Bewertungen“ und „noch nicht hinzugefügt“.
- **Interessenten-Konten**: alle gefundenen Unternehmen mit Status, Quelle, Check-Ergebnis und Berichtsaufrufen;
  mit einem Klick ins CRM (Kontakt + Lead in der ersten Pipeline).
- **Prospect-Agent**: sucht täglich oder wöchentlich automatisch („Dachdecker, 20 km um Haren, nur ohne
  Website“), legt nur *neue* Unternehmen an, prüft sie, übernimmt sie ins CRM und schreibt Anschreiben-Entwürfe.
- **Anschreiben-Entwürfe**: aus den Check-Ergebnissen – mit Claude (`ANTHROPIC_API_KEY`) oder als Vorlage.
  ⚖️ Werbe-E-Mails an Unternehmen ohne Einwilligung sind in Deutschland nach § 7 UWG in der Regel unzulässig.
  Die Entwürfe sind deshalb zum Kopieren gedacht (Brief, Gespräch, Kontakte mit Einwilligung) – es wird nichts automatisch verschickt.
- **Widget** für die eigene Website: `<div id="webhafen-check"></div><script src="https://deine-app/widget.js" async></script>`.
  Besucher prüfen ihre Website selbst; mit Einwilligungs-Häkchen entstehen Kontakt, Bericht und Lead.
  Schutz: Honeypot, max. 3 Checks pro Besucher/Stunde, 50 pro Tag.
- **Analytics**: erstellte Berichte (nach Quelle), Kontakte, neue Interessenten pro Woche, Berichtsaufrufe,
  meistgesehene Berichte, Widget-Einreichungen. Aufrufe zählen nur, wenn der geteilte Link geöffnet wird
  (nicht die Vorschau in Webhafen OS).

### 🔍 Website-Check (Bericht)
Firmenname + Website eingeben → nach wenigen Sekunden ein Bericht mit über 30 Prüfungen:

- **Unternehmensangaben**: Chat-Widget, klickbare & nachrichtenfähige Telefonnummer, E-Mail,
  Impressum, Datenschutz, Schema.org-Daten
- **Technologie-Stack**: Google Analytics, Tag Manager, Google-Ads-Conversion, Meta-Pixel, Cookie-Consent
- **SEO-Grundlagen**: Titel, Meta-Beschreibung, H1, Viewport, Alt-Texte, Canonical, Open Graph,
  robots.txt, Sitemap
- **Performance & Sicherheit**: HTTPS, Weiterleitung, Antwortzeit, Seitengröße, HSTS,
  gemischte Inhalte, Google-PageSpeed (mobil)
- **PageSpeed mobil + Desktop**: Lighthouse-Werte (Performance, SEO, Barrierefreiheit, Best Practices),
  Core Web Vitals (LCP, FCP, TBT, CLS), Anzahl fehlgeschlagener/zu prüfender/bestandener Tests
- **Google-Unternehmensprofil** (mit `GOOGLE_PLACES_API_KEY`): aktiv, Adresse, Website, Telefon, Öffnungszeiten, Fotos
- **Online-Ruf**: Durchschnitt, Anzahl, Aktualität, negative Bewertungen, Beispiel-Bewertungen
- **Lokale Sichtbarkeit**: Ranking-Tracker (Top 10 für die Branche rund um den Standort) und
  **SEO-Heatmap** (Raster 3×3 bis 7×7 um das Unternehmen, Position an jedem Punkt; Karte auf Klick)
- Unternehmen **ohne Website** werden auch geprüft – das ist meist der stärkste Verkaufsgrund.

Ranking und Heatmap sind eine Näherung über die Google Places API („Suche von diesem Punkt aus“) und
können leicht von dem abweichen, was eine einzelne Person in Google Maps sieht.

Der Bericht trägt dein Branding und einen „Jetzt Kontakt aufnehmen“-Button. Über
„Bericht teilen“ kopierst du den öffentlichen Link `https://deine-app/bericht/…` für den
Interessenten; über „Öffnen / PDF“ druckst du ihn als PDF. „Als Lead anlegen“ legt Kontakt und
Lead in der Pipeline an.

## Betrieb auf einem Server

Webhafen OS braucht einen Server, auf dem Node.js dauerhaft läuft (z. B. IONOS VPS Linux S+ mit
Ubuntu 24.04) – ein reines Webspace-Paket reicht nicht, weil Planer und Prospect-Agent im Hintergrund laufen.

**Schritt-für-Schritt-Anleitung: [deploy/ANLEITUNG-SERVER.md](deploy/ANLEITUNG-SERVER.md)**

Kurzfassung: Repo nach `/opt/webhafen-os` klonen und `bash /opt/webhafen-os/deploy/install.sh` ausführen.
Das Skript richtet Node.js 22, einen systemd-Dienst (läuft als eigener Benutzer, nur auf 127.0.0.1),
Caddy mit automatischem HTTPS für `os.web-hafen.de`, Firewall (22/80/443), automatische
Sicherheitsupdates, tägliche Backups (14 Tage) und den Befehl `webhafen-os-update` ein.
Domain und E-Mail lassen sich überschreiben: `DOMAIN=… EMAIL=… bash deploy/install.sh`.

## Was (noch) fehlt

- **Verzeichnis-Einträge** (Abgleich von Name/Adresse/Telefon in ~36 Branchenbüchern wie Meinestadt, Cylex,
  Hotfrog): braucht einen kostenpflichtigen Datenanbieter (z. B. Uberall, Yext, BrightLocal). Enthalten ist
  der Abgleich Website ↔ Google-Profil.
- **Antwortquote auf Bewertungen** und **Facebook-Bewertungen**: liefert die Google Places API nicht bzw.
  braucht eine freigeschaltete Meta-App.
- **Anzeigen-Manager** (Google/Meta/LinkedIn/TikTok Ads): braucht von jeder Plattform eine
  freigeschaltete Entwickler-App bzw. einen Google-Ads-Developer-Token – nicht enthalten.
- Direkte Social-Anbindung ohne Webhook für Meta, LinkedIn, TikTok, YouTube (gleicher Grund).
- Mehrere Benutzer / Kunden-Konten (aktuell ein gemeinsamer Login).
- E-Mail-Versand, Countdown-Timer, Marken-Boards.
