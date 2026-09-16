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
[Datenschutz](../plugins/whatsapp-assistant/docs/PRIVACY.md) ·
[Veroeffentlichung und offene Schritte](RELEASING.md)

Version 0.2.0 ist auf [GitHub](https://github.com/ckundel2008/whatsapp-agent-mcp)
als Quellkandidat verfuegbar, nicht als stabiler Tag oder im authentifizierten
Betrieb aller Clients abgenommen. Alte Automationsregeln
muessen fuer die neue Capability ausdruecklich widerrufen und neu autorisiert
werden. Die vorhandene installierte Version wird dadurch nicht automatisch geaendert.

Wie beim Stream-Deck-Projekt: eigener Quellcode unter [MIT](../LICENSE),
Herausgeber `ckundel2008`, Repository `ckundel2008/whatsapp-agent-mcp`.
Die lokale installierte Version bleibt unveraendert. Fremde Abhaengigkeiten behalten ihre Lizenzen;
siehe [Drittanbieterhinweise](../THIRD_PARTY_NOTICES.md).
