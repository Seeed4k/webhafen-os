# Webhafen OS auf dem IONOS-VPS einrichten

Dauer: ca. 15 Minuten. Du brauchst den Server (VPS Linux S+, Ubuntu 24.04), Zugriff auf die
IONOS-Domainverwaltung und dein GitHub-Konto.

## 1. Server-Daten und Firewall im IONOS Cloud Panel

1. Im IONOS-Konto unter **Server & Cloud** den neuen Server öffnen.
2. **IP-Adresse** (IPv4) und **Root-Passwort** notieren.
3. Unter **Netzwerk → Firewall-Richtlinien** prüfen, dass diese Ports offen sind:
   **22** (SSH), **80** (HTTP) und **443** (HTTPS). Alles andere darf zu bleiben.

## 2. Subdomain auf den Server zeigen lassen

1. IONOS → **Domains & SSL** → `web-hafen.de` → **DNS**.
2. **Record hinzufügen** → Typ **A**
   - Hostname: `os`
   - Zeigt auf: *die IP-Adresse des Servers*
   - TTL: 1 Stunde
3. Speichern. Bis der Eintrag weltweit aktiv ist, dauert es meist nur Minuten (selten bis zu einer Stunde).
   Du kannst trotzdem schon weitermachen.

## 3. Mit dem Server verbinden

- **Mac / Linux:** Programm *Terminal* öffnen
- **Windows:** *PowerShell* öffnen
- **iPhone / iPad:** App *Termius* (kostenlos)

```bash
ssh root@DEINE-SERVER-IP
```

Beim ersten Mal mit `yes` bestätigen und das Root-Passwort eingeben.

## 4. Zugang zum privaten GitHub-Repo (Deploy-Key)

Der Server bekommt einen eigenen Schlüssel, mit dem er den Code **nur lesen** darf:

```bash
ssh-keygen -t ed25519 -f /root/.ssh/webhafen_deploy -N "" -C "webhafen-os-server"
cat /root/.ssh/webhafen_deploy.pub
```

Die ausgegebene Zeile (beginnt mit `ssh-ed25519 …`) kopieren und in GitHub eintragen:
**Repo `webhafen-os` → Settings → Deploy keys → Add deploy key**
- Title: `IONOS-Server`
- Key: einfügen
- *Allow write access* **nicht** anhaken → **Add key**

## 5. Code holen und installieren

```bash
apt-get update && apt-get install -y git
GIT_SSH_COMMAND="ssh -i /root/.ssh/webhafen_deploy -o StrictHostKeyChecking=accept-new" \
  git clone git@github.com:Seeed4k/webhafen-os.git /opt/webhafen-os
bash /opt/webhafen-os/deploy/install.sh
```

Das Skript läuft ein paar Minuten und richtet alles ein: Node.js, den Dienst, HTTPS, Firewall,
automatische Sicherheitsupdates und das tägliche Backup.

**Am Ende zeigt es dein Passwort an – sofort im Passwort-Manager speichern.**

## 6. Fertig

**https://os.web-hafen.de** öffnen und anmelden. Danach unter *Einstellungen* deine Agentur-Daten prüfen.

Falls die Seite noch nicht lädt: Der DNS-Eintrag ist noch nicht aktiv. Caddy holt das
HTTPS-Zertifikat automatisch, sobald er es ist – nichts weiter zu tun.

---

## Im Alltag

| Was | Befehl (nach `ssh root@IP`) |
|---|---|
| Neue Version einspielen | `webhafen-os-update` |
| Backup sofort erstellen | `webhafen-os-backup` |
| Protokoll ansehen | `journalctl -u webhafen-os -f` (Beenden mit Strg+C) |
| Passwort oder API-Schlüssel ändern | `nano /etc/webhafen-os.env`, danach `systemctl restart webhafen-os` |
| Status prüfen | `systemctl status webhafen-os` |

### API-Schlüssel eintragen (Google, Claude)

```bash
nano /etc/webhafen-os.env
```

Bei `# GOOGLE_PLACES_API_KEY=` das `#` entfernen und den Schlüssel dahinter einfügen.
Speichern mit **Strg+O**, Enter, Beenden mit **Strg+X**. Dann:

```bash
systemctl restart webhafen-os
```

### Backups

Jede Nacht um 03:15 Uhr landet eine Sicherung in `/var/backups/webhafen-os/` (14 Tage aufbewahrt).
Vor jedem Update wird zusätzlich gesichert. Eine Kopie auf deinen Rechner holen
(auf deinem Rechner ausführen, nicht auf dem Server):

```bash
scp "root@DEINE-SERVER-IP:/var/backups/webhafen-os/*.gz" .
```

**Wiederherstellen:**

```bash
systemctl stop webhafen-os
gunzip -c /var/backups/webhafen-os/webhafen-os-DATUM.db.gz > /var/lib/webhafen-os/webhafen-os.db
rm -f /var/lib/webhafen-os/webhafen-os.db-wal /var/lib/webhafen-os/webhafen-os.db-shm
chown webhafen:webhafen /var/lib/webhafen-os/webhafen-os.db
systemctl start webhafen-os
```

### Empfohlen: Anmeldung nur noch per SSH-Schlüssel

Sicherer als ein Passwort. Auf **deinem Rechner** einmalig:

```bash
ssh-keygen -t ed25519            # nur falls du noch keinen Schlüssel hast
ssh-copy-id root@DEINE-SERVER-IP
```

Wenn die Anmeldung danach ohne Passwort klappt, auf dem **Server**:

```bash
echo "PasswordAuthentication no" > /etc/ssh/sshd_config.d/00-webhafen.conf
sshd -t && systemctl restart ssh
```
