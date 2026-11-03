#!/usr/bin/env bash
# Webhafen OS – Einrichtung auf einem frischen Ubuntu-24.04-Server.
# Aufruf (als root, aus dem geklonten Repo):  bash /opt/webhafen-os/deploy/install.sh
# Kann gefahrlos mehrfach ausgeführt werden; vorhandene Einstellungen und Daten bleiben erhalten.
set -euo pipefail

DOMAIN="${DOMAIN:-os.web-hafen.de}"
EMAIL="${EMAIL:-info@web-hafen.de}"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR=/var/lib/webhafen-os
BACKUP_DIR=/var/backups/webhafen-os
ENV_FILE=/etc/webhafen-os.env
SERVICE_USER=webhafen
DEPLOY_KEY=/root/.ssh/webhafen_deploy
PORT=3000

step() { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✔ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m⚠ %s\033[0m\n' "$*"; }

[ "$(id -u)" -eq 0 ] || { echo "Bitte als root ausführen: sudo bash $0"; exit 1; }
case "$APP_DIR" in /root/*|/home/*) echo "Bitte das Repo nach /opt/webhafen-os klonen (nicht in $APP_DIR)."; exit 1;; esac
[ -f "$APP_DIR/server.js" ] || { echo "server.js nicht gefunden – liegt das Skript im Repo-Ordner deploy/?"; exit 1; }
. /etc/os-release
[ "${ID:-}" = ubuntu ] || warn "Getestet für Ubuntu 24.04 – gefunden: ${PRETTY_NAME:-unbekannt}"

step "Systempakete aktualisieren und installieren"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get -y -q upgrade
apt-get install -y -q git curl ca-certificates openssl sqlite3 ufw unattended-upgrades caddy

step "Node.js 22 installieren"
node_ok() { command -v node >/dev/null && node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)'; }
if ! node_ok; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -q nodejs
fi
node_ok || { echo "Node.js >= 22.13 wird benötigt, gefunden: $(node -v 2>/dev/null || echo keins)"; exit 1; }
ok "Node.js $(node -v)"

step "Benutzer und Verzeichnisse"
id -u "$SERVICE_USER" >/dev/null 2>&1 || useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 750 "$DATA_DIR"
install -d -o root -g root -m 700 "$BACKUP_DIR"
# Updates per Deploy-Key (falls beim Klonen verwendet)
if [ -f "$DEPLOY_KEY" ]; then git -C "$APP_DIR" config core.sshCommand "ssh -i $DEPLOY_KEY -o IdentitiesOnly=yes"; fi

step "Abhängigkeiten installieren"
cd "$APP_DIR"
npm install --omit=dev --no-audit --no-fund
chmod -R go-w "$APP_DIR"

step "Konfiguration"
NEW_PASS=""
if [ ! -f "$ENV_FILE" ]; then
  NEW_PASS="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-20)"
  cat > "$ENV_FILE" <<EOF
# Webhafen OS – Einstellungen. Nach Änderungen: systemctl restart webhafen-os
ADMIN_PASSWORD=$NEW_PASS
HOST=127.0.0.1
PORT=$PORT
HTTPS=1
TZ=Europe/Berlin
DB_FILE=$DATA_DIR/webhafen-os.db

# Optionale API-Schlüssel (Zeile einkommentieren und Schlüssel eintragen):
# GOOGLE_PLACES_API_KEY=
# PAGESPEED_API_KEY=
# ANTHROPIC_API_KEY=
EOF
  chown root:"$SERVICE_USER" "$ENV_FILE"; chmod 640 "$ENV_FILE"
  ok "Neue Konfiguration $ENV_FILE angelegt"
else
  ok "Vorhandene Konfiguration $ENV_FILE bleibt erhalten"
fi

step "Dienst einrichten (startet automatisch, auch nach Neustart)"
cat > /etc/systemd/system/webhafen-os.service <<EOF
[Unit]
Description=Webhafen OS
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$(command -v node) --disable-warning=ExperimentalWarning server.js
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$DATA_DIR

[Install]
WantedBy=multi-user.target
EOF

step "Tägliches Backup (03:15 Uhr, 14 Tage aufbewahrt)"
cat > /usr/local/bin/webhafen-os-backup <<EOF
#!/usr/bin/env bash
# Sichert die Datenbank konsistent (auch im laufenden Betrieb) nach $BACKUP_DIR
set -euo pipefail
DB=$DATA_DIR/webhafen-os.db
[ -f "\$DB" ] || { echo "Noch keine Datenbank vorhanden."; exit 0; }
F=$BACKUP_DIR/webhafen-os-\$(date +%F-%H%M).db
sqlite3 "\$DB" ".backup '\$F'"
gzip -f "\$F"
find $BACKUP_DIR -name 'webhafen-os-*.db.gz' -mtime +14 -delete
echo "Backup: \$F.gz"
EOF
chmod 755 /usr/local/bin/webhafen-os-backup
cat > /etc/systemd/system/webhafen-os-backup.service <<EOF
[Unit]
Description=Webhafen OS – Datenbank-Backup
[Service]
Type=oneshot
ExecStart=/usr/local/bin/webhafen-os-backup
EOF
cat > /etc/systemd/system/webhafen-os-backup.timer <<EOF
[Unit]
Description=Webhafen OS – tägliches Backup
[Timer]
OnCalendar=*-*-* 03:15:00
Persistent=true
[Install]
WantedBy=timers.target
EOF

step "Update-Befehl: webhafen-os-update"
cat > /usr/local/bin/webhafen-os-update <<EOF
#!/usr/bin/env bash
# Holt die neueste Version aus GitHub, sichert vorher die Datenbank und startet neu
set -euo pipefail
cd $APP_DIR
/usr/local/bin/webhafen-os-backup
git pull --ff-only
npm install --omit=dev --no-audit --no-fund
chmod -R go-w $APP_DIR
systemctl restart webhafen-os
sleep 3
if systemctl is-active --quiet webhafen-os; then echo "✔ Aktualisiert: \$(git log -1 --format='%h – %s')";
else journalctl -u webhafen-os -n 40 --no-pager; echo "✘ Start fehlgeschlagen – siehe oben"; exit 1; fi
EOF
chmod 755 /usr/local/bin/webhafen-os-update

step "Webserver Caddy mit automatischem HTTPS für $DOMAIN"
[ -f /etc/caddy/Caddyfile ] && [ ! -f /etc/caddy/Caddyfile.original ] && cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.original
cat > /etc/caddy/Caddyfile <<EOF
{
	email $EMAIL
}

$DOMAIN {
	encode zstd gzip
	reverse_proxy 127.0.0.1:$PORT
	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "strict-origin-when-cross-origin"
		-Server
	}
}
EOF
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null

step "Firewall: nur SSH, HTTP und HTTPS"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
ok "$(ufw status | head -1)"

step "Automatische Sicherheitsupdates"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<EOF
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF

step "Starten"
systemctl daemon-reload
systemctl enable --now webhafen-os >/dev/null
systemctl enable --now webhafen-os-backup.timer >/dev/null
systemctl restart webhafen-os
systemctl reload caddy || systemctl restart caddy
for _ in $(seq 1 15); do curl -fs "http://127.0.0.1:$PORT/api/session" >/dev/null && break; sleep 1; done
curl -fs "http://127.0.0.1:$PORT/api/session" >/dev/null || { journalctl -u webhafen-os -n 40 --no-pager; echo "✘ Webhafen OS startet nicht – siehe oben"; exit 1; }
ok "Webhafen OS läuft"

# Öffentliche Adresse in den Einstellungen hinterlegen (für Berichts-, Affiliate- und Kurzlinks)
PASS="$(grep -E '^ADMIN_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)"
JAR="$(mktemp)"
if curl -fs -c "$JAR" -H 'content-type: application/json' -d "{\"password\":\"$PASS\"}" "http://127.0.0.1:$PORT/api/login" >/dev/null; then
  curl -fs -b "$JAR" -X PUT -H 'content-type: application/json' -d "{\"public_url\":\"https://$DOMAIN\"}" "http://127.0.0.1:$PORT/api/settings" >/dev/null && ok "Öffentliche Adresse https://$DOMAIN gespeichert"
fi
rm -f "$JAR"

# Zeigt die Domain schon auf diesen Server?
MYIP="$(curl -fs4 https://api.ipify.org || true)"
DNSIP="$(getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}' || true)"
if [ -n "$MYIP" ] && [ "$MYIP" = "$DNSIP" ]; then
  ok "$DOMAIN zeigt auf diesen Server ($MYIP) – das HTTPS-Zertifikat wird automatisch geholt."
else
  warn "$DOMAIN zeigt noch nicht auf diesen Server (DNS: ${DNSIP:-kein Eintrag}, Server: ${MYIP:-unbekannt})."
  warn "A-Record mit Hostname ${DOMAIN%%.*} → $MYIP bei IONOS anlegen. Caddy holt das Zertifikat automatisch, sobald der Eintrag aktiv ist."
fi

cat <<EOF

────────────────────────────────────────────────────────────
  Webhafen OS ist eingerichtet:  https://$DOMAIN
EOF
if [ -n "$NEW_PASS" ]; then cat <<EOF

  Dein Passwort:  $NEW_PASS
  → Jetzt im Passwort-Manager speichern! Es steht auch in $ENV_FILE
EOF
fi
cat <<EOF

  Nützliche Befehle:
    webhafen-os-update              neue Version holen und neu starten
    webhafen-os-backup              Backup sofort erstellen ($BACKUP_DIR)
    journalctl -u webhafen-os -f    Protokoll live ansehen
    nano $ENV_FILE    Passwort / API-Schlüssel ändern
                                    (danach: systemctl restart webhafen-os)
────────────────────────────────────────────────────────────
EOF
