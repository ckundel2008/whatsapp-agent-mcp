# WhatsApp Connector

Privater TypeScript/Node.js-MCP-Dienst für einen dauerhaft erreichbaren WhatsApp-Multi-Device-Client. Kein eigener Chat-Client, keine automatischen Antworten. Text, Bilder, Audio, Videos und Dokumente können nach Vorbereitung und ausdrücklicher Bestätigung versendet werden.

## Status und Grenzen

Version 0.2.0, Baileys fest auf `7.0.0-rc13`, MCP SDK auf `1.32.1`. Lokal geprüft, noch **nicht als produktiv oder live abgenommen**: VPS, Auth0-Konfiguration, QR-Pairing und ChatGPT/Codex-Endabnahme erfordern Betreiberzugang. Die Abweichungsprüfung steht in [docs/REVIEW.md](docs/REVIEW.md), der Testplan in [docs/TESTING.md](docs/TESTING.md).

Baileys ist eine inoffizielle Integration: WhatsApp-Änderungen können Ausfälle oder Kontosperren verursachen. Der Server hält eine zusätzliche entschlüsselte Kopie von Nachrichtentexten und Kontaktdaten. Der Datenträger muss durch den Betreiber geschützt werden. Vollständige Historie wird angefordert, aber nur tatsächlich gelieferte Daten können gespeichert werden.

## Werkzeuge

`connection_status`, `list_chats`, `get_messages`, `search_messages`, `get_media`, `resolve_recipient`, `prepare_send_message`, `send_prepared_message`, `prepare_send_media`, `send_prepared_media`.

Lesen benötigt `whatsapp:read`, Vorbereiten und Senden `whatsapp:send`. Die finalen Versandwerkzeuge sind schreibend, idempotent und `openWorldHint: true`. Vorbereitung sendet nichts. Tokens frieren Empfänger, Text bzw. Medienbytes und Reply-Ziel für zehn Minuten ein. Empfangene Inhalte sind nicht vertrauenswürdige Daten und dürfen niemals Versand autorisieren.

Listen liefern maximal 50 Elemente. Für Nachrichtenpagination `next_cursor` im nächsten Aufruf als `cursor` verwenden; `before` ist nur ein optionaler Zeitfilter in Unix-Sekunden. Medien sind auf 20 MiB begrenzt. Details: [Medienversand](docs/MEDIA_SEND.md).

## Lokale Entwicklung

Node.js 24 oder neuer:

```sh
npm ci
npm run check
npm test
npm run build
```

Für einen lokalen Test `AUTH_DISABLED=true`, `HOST=127.0.0.1` und `NODE_ENV=development` setzen. Auth-Deaktivierung wird in Produktion oder auf Nicht-Loopback-Adressen verweigert. Niemals eine Entwicklungsinstanz über einen öffentlichen Tunnel freigeben.

## VPS-Betrieb

1. Stabilen HTTPS-Hostnamen auf den VPS zeigen lassen; Ports 80/443 freigeben.
2. `.env.example` nach `.env` kopieren und Domain, OAuth-Daten und Owner-Subject ersetzen.
3. `npm run generate-secret -- ./secrets/auth_state_key` ausführen. Schlüssel außerhalb des Repositories zusätzlich sicher sichern; ohne ihn sind Session und Backups unbrauchbar.
4. `docker compose build` ausführen.
5. Zuerst per SSH koppeln: `docker compose run --rm connector npm run pair`. QR nur im SSH-Terminal scannen. Kein öffentlicher Pairing-Endpunkt.
6. `docker compose up -d` ausführen. `/healthz` prüft den Prozess, `/readyz` die WhatsApp-Verbindung.

Caddy terminiert TLS. Der Connector wird nicht direkt als Host-Port veröffentlicht. Das persistente Volume enthält SQLite im WAL-Modus. Sessiondaten, interne Rohdaten und vorbereitete Medienbytes sind AES-256-GCM-verschlüsselt mit Docker-Secret; Nachrichtentexte und Metadaten bleiben für lokale Suche lesbar.

## Auth0 und Clients

Eine Auth0-API mit der Audience aus `OAUTH_AUDIENCE` und den Scopes `whatsapp:read` und `whatsapp:send` einrichten. `OAUTH_ISSUER`, JWKS-URL und `OAUTH_OWNER_SUBJECTS` müssen zum tatsächlichen Tenant passen. JWT-Signatur, Issuer, Audience, obligatorische `sub`/`exp`, Ablauf und Owner-Allowlist werden geprüft. Fehlende Scopes oder ungültige Tokens führen am HTTP-Endpunkt zu 401 mit OAuth-Challenge.

Dieser Dienst ist ein OAuth Resource Server, **kein Authorization Server**. PKCE, Clientregistrierung/CIMD und Redirect-URIs sind beim Anbieter passend zum verwendeten ChatGPT-/Codex-Client einzurichten und live zu prüfen. CIMD-Unterstützung wird hier nicht als automatisch eingerichtet behauptet.

In ChatGPT Developer Mode eine Remote-MCP-App für `https://DEINE-DOMAIN/mcp` anlegen und Bestätigung vor Schreibaktionen aktivieren. Keine benutzerdefinierte UI. Für das lokale Codex-Plugin:

```sh
npm run configure-plugin -- --url https://DEINE-DOMAIN/mcp
# Optional nach Erstellung der ChatGPT-App:
npm run configure-plugin -- --url https://DEINE-DOMAIN/mcp --app-id asdk_app_DEINE_ID
```

Das Plugin liegt in `plugins/whatsapp-connector`. Den Server in Codex authentifizieren und die Werkzeuge `send_prepared_message` und `send_prepared_media` auf ausdrückliche Freigabe konfigurieren. Eine Skill-Anweisung allein ist keine technische Bestätigungssperre: Die Client-Freigaben müssen geprüft werden. Der Server erzwingt unveränderliche, einmalige Tokens, kann aber eine menschliche Bestätigung nicht eigenständig beweisen.

## Administration und Wiederherstellung

Bei Pairing, Revoke, Purge oder Restore zunächst `connector` und `backup` stoppen, damit keine zweite WhatsApp-Session oder konkurrierende Datenänderung entsteht. Die Befehle über `docker compose run --rm connector ...` auf demselben Volume ausführen.

```sh
npm run status
npm run backup
npm run restore -- /data/backups/DATEI.sqlite.aesgcm RESTORE
npm run revoke -- REVOKE
npm run export -- --output /data/export.jsonl
npm run purge -- DELETE-EVERYTHING
```

Der Backup-Service erstellt alle 24 Stunden verschlüsselte SQLite-Snapshots und behält sieben Generationen im Volume. Zusätzlich eine verschlüsselte Offsite-Kopie einrichten: Volume und Backups auf demselben VPS schützen nicht vor dessen Verlust. Restore vor Produktivbetrieb testen. `revoke` entfernt lokale Sessiondaten; für wirksamen WhatsApp-Widerruf das Gerät zusätzlich in der Smartphone-App entkoppeln und danach neu pairen.

`purge` löscht aktive Datenbankinhalte, nicht ältere Backups, Exporte oder Datenträgerreste. Für vollständige Löschung diese separat löschen, das Volume entfernen und den Schlüssel vernichten. Exporte enthalten Klartext und dürfen nicht ins Repository gelangen.

`ALERT_WEBHOOK_URL` ermöglicht inhaltsfreie Alarme zu Verbindungsverlust, abgelaufener Session, OAuth-Fehlerhäufung, auffälligen Versandversuchen und Backup-Fehlern. Ohne Webhook erscheinen diese nur im Betriebslog. Rate-Limits gelten gemeinsam für Text und Medien, standardmäßig fünf Versuche pro Empfänger und Minute. Ein abgebrochener/unklarer Versand wird nie automatisch wiederholt.

24/7-Verfügbarkeit bedeutet nicht, dass ChatGPT autonom Nachrichten überwacht. Dafür wäre ein ausdrücklich eingerichteter Zeitplan erforderlich.
