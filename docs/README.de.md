# WhatsApp Assistant

Lokale WhatsApp-Werkzeuge fuer Codex, Claude Code und andere lokale MCP-Clients.
Die WhatsApp-Anbindung bleibt auf dem Mac; gelesene Inhalte gelangen dennoch
in den Kontext des gewaehlten KI-Clients und gegebenenfalls zu dessen Anbieter.

Vorhandene Chats gezielt suchen, Textnachrichten der letzten 30 Tage lesen,
zusammenfassen und Antworten entwerfen. Interaktiver Versand verlangt eine
neue ausdrueckliche Bestaetigung des angezeigten Empfaengers und exakten Texts.
Geplante Aufgaben benoetigen eine vorher autorisierte, eng begrenzte Regel
mit eigener geheimer Capability. Modellwerkzeuge bleiben auf Text begrenzt. Keine neuen Nummern, Massenversand
oder durch eingehende Nachrichten ausgeloeste Auto-Antworten.

Die Runtime benoetigt macOS, Google Chrome, Node.js 22.13+ und pnpm 11.19.0.
QR-Code und Sitzungsdaten nie in Aufgaben, GitHub-Issues oder Screenshots teilen.
OpenWA ist inoffiziell; Ausfaelle und Kontoeinschraenkungen sind moeglich.

[Installation](../plugins/whatsapp-assistant/README.md) ·
[Kompatibilitaet und Pruefstatus](COMPATIBILITY.md) ·
[Haeufige Fragen](FAQ.md) ·
[Datenschutz](../plugins/whatsapp-assistant/docs/PRIVACY.md) ·
[Support](../plugins/whatsapp-assistant/docs/SUPPORT.md) ·
[Veroeffentlichung und offene Schritte](RELEASING.md)

Der lokale 0.3.0-Preview-Kandidat (Quellupdate lokal vorbereitet, Stand
02.10.2026) enthaelt zusaetzlich eine grafische Oberflaeche:
Verbindungsstatus, Chatsuche, Ungelesen-Filter, begrenzten Text-/Medienverlauf,
Nachladen aelterer Seiten und zweistufige Antwortbestaetigung. Pro Nachricht kann
ein eigenes Bild oder eine Datei bis 16 MiB angehaengt werden, mit optionalem
Begleittext. Bilder zeigen eine Vorschau; andere Dateien Name und Groesse.
Empfaenger, Text und Anhang werden vor "Jetzt senden" gemeinsam geprueft.
Anhaenge bleiben im lokalen Arbeitsspeicher und werden nicht ans Modell uebergeben.
Empfangene Medien bis 16 MiB lassen sich ausdruecklich oeffnen: Bilder, Audio und
Video im Betrachter, andere Dateien als Download. Sichtbare Chats erhalten ein
verfuegbares Profilbild; andernfalls bleiben die Initialen sichtbar.
Native Codex-UI-Unterstuetzung ist **UNVERIFIZIERT**. Fuer das
Loopback-Browserpanel:

```sh
./plugins/whatsapp-assistant/scripts/run-ui.sh
```

Danach die ausgegebene Loopback-URL (standardmaessig
`http://127.0.0.1:8765/`) im Browserpanel oeffnen.

Die UI startet keinen Dienst und verknuepft kein Konto automatisch. Sie behaelt
Ansichtszustand nur im Speicher. Ausgewaehlte Nachrichten werden nur nach einer
expliziten Aktion an das Modell uebergeben; im Browserpanel steht dafuer Kopieren
bereit. Siehe [UI-Abnahme](UI_ACCEPTANCE.md) und [Nutzungsbedingungen](../plugins/whatsapp-assistant/docs/TERMS.md).

Fuer den persoenlichen Dot gibt es ausserdem den Betreiberweg ueber den
offiziellen [Secure MCP Tunnel](PRIVATE_DOT_CONNECTION.md). Die privaten
`online/private-*.mjs`-Skripte stellen standardmaessig drei Lese-Werkzeuge bereit;
zwei Text-Schreibwerkzeuge werden nur ausdruecklich aktiviert und verlangen eine
neue, separate Bestaetigung. Auch bei "alle Chats" bleibt der Zugang an das
konkrete WhatsApp-Konto gebunden; gelesen werden hoechstens die letzten 30 Tage.
Eine dauerhafte Sperre verhindert Wiederholungen nach unbekanntem oder
erfolgreichem Versand. Sichere Fehlercodes sind
`CONFIRMATION_REQUIRED`, `APPROVAL_INVALID`, `ACCOUNT_CHANGED`,
`CONNECTION_UNAVAILABLE` und `INVALID_ARGUMENTS`. Der Tunnel ist ein privater
Betreiberweg und ersetzt weder oeffentliches HTTPS-Hosting noch eine OpenAI-
Einreichung. Siehe auch [Online-Anleitung](../online/README.md).

Der historische Stand 0.2.0 war ein stabiler, Codex-fokussierter Community-Quellrelease auf
[GitHub](https://github.com/ckundel2008/whatsapp-agent-mcp). Der bestehende Codex-
Desktop-Pfad wurde mit Laufzeit 0.2.0 fuer Status, Chatsuche, Lesen und separat
bestaetigten Textversand getestet. Claude Code/Desktop, Cursor, VS Code und andere
MCP-Clients sind experimentell. Die lokale Plugininstallation und ein echter
Textverlauf im Codex-Browserpanel sind fuer 0.3.0 geprueft. Der private
ChatGPT-Weg wurde fuer Status, Suche, Lesen und reine Versandvorbereitung
geprueft. Ein vom Nutzer gemeldeter echter Versand schlug aus unbekannter
Ursache fehl und wurde nicht wiederholt; Versand und Zustellung bleiben daher
unverifiziert. Native Codex-MCP-App-Darstellung ist ebenfalls unverifiziert.
Recovery und echter UI-/geplanter Versand sind nicht abgenommen. Alte Automationsregeln
muessen fuer die neue Capability ausdruecklich widerrufen und neu autorisiert
werden. Fuer eine oeffentliche Aufnahme fehlen weiterhin HTTPS-Hosting und
OpenAI-Review; die vorhandene installierte Version wird nicht automatisch geaendert.

Wie beim Stream-Deck-Projekt: eigener Quellcode unter [MIT](../LICENSE),
Herausgeber `ckundel2008`, Repository `ckundel2008/whatsapp-agent-mcp`.
Eine GitHub-Veroeffentlichung aktualisiert installierte Laufzeiten nicht automatisch.
Die begrenzte lokale Abnahme steht in [CLIENT_ACCEPTANCE](CLIENT_ACCEPTANCE.md).
Fremde Abhaengigkeiten behalten ihre Lizenzen;
siehe [Drittanbieterhinweise](../THIRD_PARTY_NOTICES.md).

Geeignet fuer bewusst ausgewaehlte Chats, Zusammenfassungen und vor dem Versand
bestaetigte Textantworten aus einem lokalen KI-Workflow. Nicht geeignet fuer
offizielle WhatsApp-Business-Anbindungen, Massenwerbung, Offline-KI oder eine
geschaeftskritische Zustellgarantie. Die [Projektfakten](../project.json) und der
optionale [Leseindex](../llms.txt) beschreiben Anforderungen und Grenzen.

Ebenfalls von diesem Herausgeber:
[Codex Stream Deck](https://github.com/ckundel2008/codex-stream-deck) fuer
Codex-Aufgaben, Tastenkürzel und Wochenkontingent auf Elgato-Hardware am Mac.
Ein separates Projekt, keine Abhaengigkeit und keine Claude-Erweiterung.
