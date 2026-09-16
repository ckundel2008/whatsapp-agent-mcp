# WhatsApp Assistant

Lokale WhatsApp-Werkzeuge fuer Codex, Claude Code und andere lokale MCP-Clients.
Die WhatsApp-Anbindung bleibt auf dem Mac; gelesene Inhalte gelangen dennoch
in den Kontext des gewaehlten KI-Clients und gegebenenfalls zu dessen Anbieter.

Vorhandene Chats gezielt suchen, Textnachrichten der letzten 30 Tage lesen,
zusammenfassen und Antworten entwerfen. Interaktiver Versand verlangt eine
neue ausdrueckliche Bestaetigung des angezeigten Empfaengers und exakten Texts.
Geplante Aufgaben benoetigen eine vorher autorisierte, eng begrenzte Regel
mit eigener geheimer Capability. Keine neuen Nummern, Medien, Massenversand
oder durch eingehende Nachrichten ausgeloeste Auto-Antworten.

Die Runtime benoetigt macOS, Google Chrome, Node.js 22.13+ und pnpm 11.19.0.
QR-Code und Sitzungsdaten nie in Aufgaben, GitHub-Issues oder Screenshots teilen.
OpenWA ist inoffiziell; Ausfaelle und Kontoeinschraenkungen sind moeglich.

[Installation](../plugins/whatsapp-assistant/README.md) ·
[Kompatibilitaet und Pruefstatus](COMPATIBILITY.md) ·
[Haeufige Fragen](FAQ.md) ·
[Datenschutz](../plugins/whatsapp-assistant/docs/PRIVACY.md) ·
[Veroeffentlichung und offene Schritte](RELEASING.md)

Version 0.2.0 ist ein stabiler, Codex-fokussierter Community-Quellrelease auf
[GitHub](https://github.com/ckundel2008/whatsapp-agent-mcp). Der bestehende Codex-
Desktop-Pfad wurde mit Laufzeit 0.2.0 fuer Status, Chatsuche, Lesen und separat
bestaetigten Textversand getestet. Claude Code/Desktop, Cursor, VS Code und andere
MCP-Clients sind experimentell. Eine frische Plugininstallation, Recovery und
echter geplanter Versand sind nicht abgenommen. Alte Automationsregeln
muessen fuer die neue Capability ausdruecklich widerrufen und neu autorisiert
werden. Die vorhandene installierte Version wird dadurch nicht automatisch geaendert.

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
