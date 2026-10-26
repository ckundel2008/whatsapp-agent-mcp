> Veröffentlichte Fassung: persönliche IDs und Rechnerpfade sind anonymisiert. Die Gruppen-ID ist ein synthetisches Beispiel.

# Bob WhatsApp: Gruppenmigration

Ziel: 120363000000000000@g.us. Live-Mitgliedschaft: genau ein Mitglied, authentifiziertes Konto. Die Metadatensammlung wird direkt exportiert; vor jeder Pruefung werden veraltete Metadaten erneuert. Unvollstaendige Daten blockieren.

Der bestehende MCP-Server wurde auf bobMode=group umgestellt. Eigenstaendige Benachrichtigungen und Antworten sind fest auf diese Gruppe begrenzt. Allgemeiner Versand braucht weiterhin Einzelbestaetigung. Der alte Selbstchat-Receiver wurde ausgeladen, seine LaunchAgent-Plist reversibel gesichert; alte Warteschlangeneintraege bleiben unveraendert. Kein API-Ersatzmodell und keine neue Work-Automation wurden erstellt.

Neue Eingangsereignisse erfordern die passende Subscription im bestehenden Bob-Chat. Filter:

```json
{
  "connector_id": "cccccccccccccccccccccccccccccccc",
  "event": "whatsapp.bob_message",
  "params": {
    "chat_id": "120363000000000000@g.us"
  }
}
```

Bob braucht whatsapp_bob_reply(message_id,text), gebunden an die genaue Eingangs-ID, und whatsapp_bob_notify(notification_id,text). Kein Empfaengerargument. Autor und Gruppe werden serverseitig geprueft. Keine Praefixpflicht. Historische, fremde, zitierte oder Systemnachrichten werden verworfen. Ausgaenge werden dauerhaft per operation_id exklusiv reserviert und vor dem Versand fsync-gesichert. Ohne bekannte Ausgangs-ID haelt eine unklare Reservierung den Eingang auch nach Neustart zurueck; es gibt keinen automatischen Wiederholungsversand. Jeder bekannte Ausgang und Ruecklesekandidat wird vom Eingang ausgeschlossen. Abschluss erst nach bestaetigtem Ruecklesen. Webhook-Annahme ist kein Verarbeitungsabschluss.

Live-Test: genau eine Benachrichtigung gesendet und rueckgelesen, 2026-10-10 17:33:21 UTC (19:33:21 MESZ). notification_id: bob-group-acceptance-20261010-01. message_id: true_120363000000000000@g.us_ABCDEF00000000000000_10000000000000@lid. Wiederholung vor und nach Bridge-Neustart: ALREADY_SENT, Ruecklesezahl 1. 73 gezielte Tests bestanden, darunter Doppelereignis, Neustart, Antwortschleife, fremde Autoren/Chats, unklare Zustellung und allgemeiner Bestaetigungsschutz. Die Ereignis-/Antworttests sind synthetisch; kein Ende-zu-Ende-Erfolg mit bestehendem Bob behauptet.

Offen: Bestehende Bob-Verknuepfung im Bob-Chat umstellen und Ereignisfilter dort neu einlesen. Work besitzt keine verwaltbare Bob-Automation; seine Ereignisschema-Abfrage liefert noch den alten Selbstchatfilter. Das neu eingelesene Plugin zeigt bereits Gruppenwerkzeuge und Gruppen-Ereignisbeschreibung. Es existiert noch keine Gruppen-Subscription. Die neue eigene Nachricht Wie geht es dir? fehlt. Vollstaendige Abnahme erst nach Eingang beim bestehenden Bob und rueckgelesener Antwort.

Lokale Belege: ~/.config/whatsapp-dot-tunnel/bob-group-acceptance.json und bob-group-handoff.json. Konfiguration: private-mcp-all-confirmed.json. Gruppen-Ereigniszustand: bob-group-state; dauerhafte Ausgaenge: bob-group-outputs. Vorheriger Zustand und LaunchAgent-Plist wurden unter group-activation-* gesichert.

## Geaenderte Dateien dieser Gruppenmigration

- /ABSOLUTER/PFAD/WhatsApp-Plugin/online/bob-bridge.mjs
- /ABSOLUTER/PFAD/WhatsApp-Plugin/online/bob-group-io.mjs
- /ABSOLUTER/PFAD/WhatsApp-Plugin/online/bob-notify.mjs
- /ABSOLUTER/PFAD/WhatsApp-Plugin/online/private-mcp.mjs
- /ABSOLUTER/PFAD/WhatsApp-Plugin/plugins/whatsapp-assistant/runtime/service.mjs
- /ABSOLUTER/PFAD/WhatsApp-Plugin/plugins/whatsapp-assistant/runtime/bob-group-members.mjs
- /ABSOLUTER/PFAD/WhatsApp-Plugin/online/tests/bob-group-io.test.mjs
- /ABSOLUTER/PFAD/WhatsApp-Plugin/online/tests/bob-group-members.test.mjs
- ~/.config/whatsapp-dot-tunnel/private-mcp-all-confirmed.json

Die entsprechenden installierten MCP-/Daemon-Dateien wurden aktualisiert. Die obsolete LaunchAgent-Plist de.local.whatsapp-bob-receiver.plist wurde in das Aktivierungs-Backup verschoben. Die vorbestehende Aenderung an .github/workflows/ci.yml wurde nicht veraendert. Letzte Live-Pruefung nach Daemon-Neustart: 2026-10-10T17:39:49.673Z, genau eigenes Konto, bestaetigte Testkopie 1.
