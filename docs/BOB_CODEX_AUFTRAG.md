> Veröffentlichte Fassung: persönliche IDs und Rechnerpfade sind anonymisiert. Die Gruppen-ID ist ein synthetisches Beispiel.

# Auftrag: WhatsApp-Bob-Eingang systematisch reparieren

Arbeite in diesem bestehenden Projekt auf dem MacBook Air. Nutzer Christian Kundel verlangt die Fortsetzung in einem Codex-Fenster. Die Verbindung hat zwischenzeitlich funktioniert: deshalb zuerst Regression und Konfigurationsänderungen untersuchen. Weder lokalen Fehler noch Plattformfehler ohne Beleg behaupten. Keine separate Chatbot-API verwenden.

## Zuerst lesen und sichern
- Vorhandene AGENTS.md beachten, Git-Status und aktuelle uncommittete Änderungen nachvollziehen. Nichts pauschal zurücksetzen.
- docs/BOB_REPAIR_2026-10-12.md lesen: bestätigter Versandfehler und Live-Nachweise.
- Aktuelles Projekt /ABSOLUTER/PFAD/WhatsApp-Plugin; Online-Server online/private-mcp.mjs, online/bob-bridge.mjs, online/bob-group-io.mjs.
- Installierter Runtime-Pfad ~/Library/Application Support/WhatsApp Assistant/runtime; LaunchAgent de.local.codex-whatsapp-assistant.
- Aktuelle Zustände ~/.config/whatsapp-dot-tunnel/bob-group-state/{bob-state.json,events.jsonl,worker.json}; Ausgangsledger bob-group-outputs.
- Historischer Pfad ~/plugins/whatsapp-bob-bridge und alter Receiver sind überholt, keine zweite Brücke reaktivieren.
- Managed Tunnel whatsapp-dot-personal-managed. Nur diesen Dienst bei begründetem Bedarf ändern. Nylas und andere Dienste unangetastet lassen.
- Geheimnisse, Callback-URLs, Signaturschlüssel und Tokens nicht ausgeben.

## Strukturierte Untersuchung
1. Rekonstruiere aus Git, Backups und Protokollen den letzten nachweislich funktionierenden vollständigen Durchlauf. Unterscheide echte Bob-Antworten von lokalen Diagnosetests. Erstelle eine Zeitleiste aller relevanten Änderungen seit diesem Stand, inklusive ausführender Dateiversionen und Tunnel-/Worker-Prozesse.
2. Vergleiche einen damals erfolgreichen Ereignisdatensatz mit dem aktuellen fehlgeschlagenen: MCP-Version, Ereignisname, payloadSchema, envelope eventId/name/timestamp/data/cursor, Signaturbytes, Subscription-ID, Ablauf/Renewal, Filterargumente, Callback-Zuordnung. Prüfe die offizielle Dokumentation https://developers.openai.com/plugins/build/mcp-events . Keine erfundenen Endpunkte und keine ungeprüften Versionswechsel.
3. Prüfe die tatsächliche Implementierung von events/subscribe und Renewal: Werden Callback und Secret korrekt erneuert, hängt ein altes Ziel weiter am Worker, werden Filter korrekt persistiert und angewandt? Die bloße Annahme HTTP 200 oder passender Aufgaben-Prompt beweist keine passende aktive Zuordnung. Vergleiche Quelle, installierte Dateien und tatsächlich laufende Kommandos. Nicht anhand des Anzeigenamens entscheiden.
4. Prüfe vollständigen Callback-Aufbau und Transport: Wird exakt der signierte Body gesendet? Gelangen vollständige Daten in data? Werden Fehler/Antworten verschluckt? Prüfe interne Serialisierung, Warteschlangen, parallele Aufrufe, Debounce/Retry und dauerhafte Worker-Sperre. Nichts mit neuen IDs nochmals zustellen, um Deduplizierung zu umgehen.
5. Lokal behebbaren belegten Fehler gezielt korrigieren, Regressionstest erstellen, bestehende Schutzprüfungen ausführen. Nur notwendige gezielte Reloads; keine pauschalen Neustarts oder neue Verbindung. Bei verbleibender Prüflücke exakt angeben, welcher Abgleich nicht möglich ist, statt die Plattform pauschal verantwortlich zu machen.
6. Vollständigen neuen Live-Durchlauf mit echter eigener Nachricht messen: WhatsApp -> Queue -> vollständiger Callback -> bestehender Bob -> whatsapp_bob_reply -> exakt zitierte WhatsApp-Antwort -> Rücklesen -> Ungelesen-Markierung. Benutzer-Nachricht nicht künstlich fälschen. Falls hierfür eine neue Nachricht nötig ist, konkret darum bitten. Eindeutige IDs/Zeiten, Doppelzustellung und Prozessneustart prüfen. Nur Diagnose-/Abnahmetexte in der verifizierten Einpersonengruppe, keine Nachrichten an andere Personen.

## Aktueller Befund (12.10.2026, alle Zeiten MESZ)
Antworte mir: WhatsApp 14:56:06, Queue 14:56:07.940, Callback Start 14:56:07.943, HTTP 200 14:56:09.182. Bis zur Prüfung ca. 15:28 kein Bob-Antwortwerkzeugaufruf.
Event evt_bob_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
Request true_120363000000000000@g.us_ABCDEF00000000000000_10000000000000@lid
Subscription bob_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
Bob-Aufgabe cccccccccccccccccccccccccccccccc
Bob-Thread 00000000-0000-4000-8000-000000000000

Bob meldete um 15:30: Aufgabe aktiviert, last_run_time 14:50:55.634560. Allgemeiner Automationsaufruf 15:01 ohne zuordenbare Event-ID; vollständiger Datensatz fehlt. Technische Filter und Bündelungseinstellung nicht zugänglich. CONNECTED; ingress_held_for_unknown_send=false; pending_outputs_quarantined=1. Keine globale Sperre daraus ableiten.
Codex-App-Log 14:57:50.028: thread/read -32003 thread access denied, Hintergrund-Renderer 3; Request-ID 00000000-0000-4000-8000-000000000000. Andere frühere Reads im Hauptfenster erfolgreich. Das ist kein Beweis für die Ursache der Webhook-Verzögerung. Logs unter ~/Library/Logs/com.openai.codex/2026/10/12.

## Bereits nachgewiesen repariert, erhalten
OpenWA 4.76.0 rief bei zitierten Nachrichten die entfernte Methode obj.quotedMsgObj() auf. Browserstack WAPI._serializeMessageObj -> processMessageObj -> Collection-Event, native_commit scheiterte. runtime/openwa-message-compat.mjs korrigiert dies, local-patches.mjs installiert local-bootstrap-v3-quoted-message. 27 Tests bestanden. Temporäre diagnoseBobReply-Endpoints/Flags entfernt.
Zitierte Testantwort um 15:25:02 erfolgreich, exakt verknüpft und zurückgelesen, ungelesen 15:25:03.107; Ausgang true_120363000000000000@g.us_ABCDEF00000000000000_10000000000000@lid. Separater Prüfprozess liefert ALREADY_SENT mit identischer ID; eigene Ausgangs-IDs nicht in der Eingangsqueue. Dies ist noch kein neuer vollständiger Bob-Ereignisdurchlauf.

## Dauerhafte Grenzen
Feste Gruppe 120363000000000000@g.us, nur authentifizierter Kontoinhaber als einziges Mitglied, Mitgliedschaft vor Sendungen frisch prüfen. Eigene unzitierte neue Texte ohne Präfix; lokale Spracherkennung existiert, reale Voice-End-to-End-Abnahme fehlt. Kein Wechsel zurück zum alten Selbstchat trotz historischer Auftragstexte. Bestehender Bob-Kontext bleibt erhalten. Allgemeine Fremdempfängerfreigaben bleiben unverändert. Ausgangs-IDs dauerhaft gegen Schleifen; unklare Sendungen niemals erneut senden oder deren Ledger löschen. Ungelesen-Markierungsfehler niemals zum erneuten Versand verwenden. Keine zweite Ereignisaufgabe, keine dauerhafte Deaktivierung.

## Ergebnis
Liefere belegte Ursache oder exakt abgegrenzte Prüflücke, geänderte Dateien, tatsächlich getestete Versionen und komplette Zeitkette. Kein Erfolg ohne Rücklesen einer echten Bob-Antwort auf eine neue Benutzernachricht. Arbeit autorisiert fortsetzen, nicht nach bloßer Planung stoppen.
