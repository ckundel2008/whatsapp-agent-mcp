# Abweichungsprüfung vor GitHub-Übergabe

Datum: 2026-10-07. Grundlage: vereinbarter 24/7-VPS-Connector plus nachträglicher Medienversand.

## Im Rahmen dieser Prüfung korrigiert

- Nachrichten mit gleichem Zeitstempel wurden durch reine Zeitpagination übersprungen. Ergänzt: stabiler Cursor aus Zeitstempel und WhatsApp-ID.
- Große JSON-/Base64-Anfragen wurden vor der Authentifizierung eingelesen. Die Body-Verarbeitung folgt jetzt erst nach der Bearer-Validierung.
- JWTs ohne Ablaufdatum wurden nicht explizit abgewiesen. `sub` und `exp` sind jetzt obligatorisch, abgelaufene Tokens werden ohne Toleranz zurückgewiesen.
- Auth-Deaktivierung war auf öffentlichen/produktiven Instanzen möglich. Jetzt nur nicht-produktive Loopback-Entwicklung.
- Fehlgeschlagene Versandversuche umgingen den Empfängerzähler. Sie zählen jetzt zum gemeinsamen Text-/Medien-Rate-Limit.
- Bereinigung konnte laufende Versanddatensätze löschen. In-flight-Tokens bleiben erhalten; abgeschlossene Tokens bieten sieben Tage idempotente Replay-Erkennung ohne Medienbytes.
- Der Cleanup-Timer wird beim Shutdown beendet und greift nicht auf geschlossene Datenbanken zu.
- Konfigurierbare Mediengrößen konnten die MCP-Grenze überschreiten. Maximal 20 MiB; kleinere Grenzen bleiben möglich.
- Die nach iCloud-Rekonstruktion fehlenden OAuth-/Sessiontests wurden wieder ergänzt. README und Testplan entsprechen wieder Text **und** Medien.
- macOS-Metadaten, Coverage und sämtliche iCloud-Platzhalter bleiben aus Git und Docker ausgeschlossen.
- Die Vorbereitung ist korrekt als lokal schreibend annotiert: Sie persistiert einen Token, versendet aber noch nichts.
- Docker enthält nach dem Build nur Produktionsabhängigkeiten; Admin-Befehle verwenden den kompilierten CLI statt des Entwicklungswerkzeugs `tsx`.
- GitHub Actions prüft Typen, Tests, Build, produktive Abhängigkeiten und das Docker-Image. Die GitHub-Laufresultate sind separat vom lokalen Ergebnis zu prüfen.

## Verifiziert

`npm run check`, `npm test` und `npm run build` erfolgreich: 12 Testdateien, 38 Tests. Darunter tatsächliche HTTP-401-/Scope-Prüfungen sowie ein verschlüsselter Backup-/Restore-Durchlauf mit Integritäts- und FTS-Prüfung. `npm audit --omit=dev` meldete am Prüftag keine bekannten Schwachstellen. Die HTTP-Tests liefen mit Freigabe für kurzzeitige Loopback-Server.

## Bewusste Erweiterung des ursprünglichen MVP

Medienversand für Bilder, Audio, Video und Dokumente bis 20 MiB über `prepare_send_media` / `send_prepared_media`. Keine automatische Antwort, kein Broadcast, keine Status- oder Gruppenverwaltung. Keine Audio-/Video-Transcodierung, keine Sprachaufzeichnung.

## Nicht abgeschlossen / verbleibende Grenzen

- VPS/TLS/Auth0/ChatGPT-App/Codex-Installation wurden nicht eingerichtet: keine Credentials oder Domain im Workspace. PKCE/CIMD werden vom Anbieter und Client erbracht, nicht vom Resource Server selbst. Live-Endabnahme fehlt.
- Medien werden als Base64-MCP-Argument übergeben. Eine generische Dateianhang- oder Uploadintegration von ChatGPT ist nicht implementiert; praktische Clientgrößen können deutlich unter 20 MiB liegen. Codex kann Dateien über einen passenden lokalen Adapter lesen. Kein Remote-URL-Download.
- Menschliche Bestätigung wird vom Skill und der Client-Werkzeugfreigabe verlangt. Der Server erzwingt Tokens und Scopes, aber keine separate kryptografisch nachgewiesene Benutzerbestätigung. Das muss vor Produktivbetrieb in beiden Clients konfiguriert und getestet werden.
- Automatische Tests ersetzen keine Live-Prompt-, Pairing-, Reconnect- oder Medienlieferungs-Abnahme. Backup/Restore wurde lokal mit einer Testdatenbank geprüft, noch nicht auf dem VPS. Ein Testplan liegt bei.
- Backups liegen zunächst im selben Volume; Offsite-Sicherung ist Betreiberaufgabe. Purge der Datenbank löscht keine älteren Backups/Exporte und garantiert kein forensisches Überschreiben.
- Nicht jeder WhatsApp-Ereignistyp wird gespiegelt: nachträgliche Edit-/Delivery-Statusänderungen sind nicht vollständig abgebildet. Neue Nachrichten und History werden dedupliziert gespeichert.
- Die ursprünglichen Dateien/Git-Daten waren als iCloud-`dataless`-Platzhalter nicht lesbar. Diese bleiben unverändert lokal erhalten. Der veröffentlichte Stand umfasst die tatsächlich vorhandenen rekonstruierten Quellen, nicht eine verifizierte Wiederherstellung sämtlicher alter Git-Historie.

Das Projekt ist damit ein prüfbarer Implementierungsstand, keine Behauptung eines bereits produktiv laufenden 24/7-Connectors.
