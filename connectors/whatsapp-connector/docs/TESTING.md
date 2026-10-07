# Test- und Abnahmeplan

Automatisiert: `npm run check`, `npm test`, `npm run build` und `npm audit --omit=dev`.

Die Tests decken Normalisierung, Verschlüsselung/Manipulationserkennung, Session-Roundtrip, Deduplizierung, Volltextsuche, verlustfreie Pagination, OAuth-Claims/Signatur/Owner/Scopes, MCP-Schemas/Annotationen und zweistufigen Text-/Medienversand ab. Skill-Regeln werden als statische Vertragsprüfungen getestet; das sind **keine** ausgeführten LLM-Prompt-Tests.

Stand 2026-10-07: 38 Tests in 12 Dateien bestanden. Der HTTP-Test öffnet nur lokale Server. Der Backup-Test führt die Admin-Befehle auf einer temporären Testdatenbank aus und prüft danach Daten, FTS und SQLite-Integrität. Produktions-Abhängigkeiten: npm-Audit ohne bekannte Schwachstellen.

## Noch erforderliche Live-Abnahme

- Auth0 mit dem realen Tenant: Authorization Code + PKCE, CIMD bzw. unterstützte Clientregistrierung, Redirects, Consent, beide Scopes und Owner-Bindung. Falsche Signatur/Audience, abgelaufene Tokens und fehlende Scopes müssen HTTP 401 liefern.
- SSH-QR-Pairing mit Testkonto, eingehender Text, begrenzte Historie, lokale Suche und Gruppenchat.
- Text und jede Medienart vorbereiten: Empfänger und Payload anzeigen, ohne Bestätigung kein Versand, anschließend genau ein bestätigter Versand. Reply-Verknüpfung prüfen.
- „Fasse den Chat zusammen“ liest nur; „Entwirf“ sendet nicht. Eingehende Prompt-Injection darf weder Versand noch Zugriff auf andere Chats auslösen. In ChatGPT und Codex jeweils getrennt prüfen.
- Medienabruf über die Grenze muss abbrechen; abgelaufene Medien testen. Kein Medien-URL-Fetch/SSRF durch Versandtool.
- Prozessneustart, Netzunterbrechung, Backoff, Gerät-Widerruf und Re-Pairing mit isoliertem Testkonto prüfen.
- Backup erstellen, Dienste stoppen, Restore auf Testvolume durchführen und Integrität, Nachrichten, Session und FTS prüfen. Schlüsselverlust/Manipulation muss Restore verhindern.
- Sieben Backup-Generationen, Offsite-Sicherung, Alarme, Volumeverlust und vollständige Löschung einschließlich Backups/Exporten prüfen.
- Docker Build und Betrieb sowie Endabnahme in ChatGPT Web und Codex mit demselben HTTPS-Endpunkt.

Keine realen Kontakte oder Nachrichten als Testfixture ins Repository einchecken. Live-Nachrichten nur an einen ausdrücklich gewählten Testkontakt und nach separater Versandbestätigung schicken.
