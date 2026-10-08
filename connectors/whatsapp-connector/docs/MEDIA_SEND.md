# Medienversand

Der Connector kann Bilder, Audio, Videos und Dokumente bis zur konfigurierten Grenze (`MAX_MEDIA_BYTES`, standardmäßig 20 MB) senden.

## Ablauf

1. Der Client liest die lokale oder angehängte Datei und übergibt die Rohbytes als kanonisches Base64 ohne `data:`-Präfix an `prepare_send_media`.
2. Der Connector validiert Typ, MIME, Dateiname, Caption, Empfänger und Reply-Ziel. Dokumente benötigen einen Dateinamen; Audio unterstützt keine Caption.
3. Die Bytes werden mit AES-256-GCM verschlüsselt in SQLite gespeichert. Die Antwort enthält nur Metadaten, Größe und SHA-256, niemals die Bytes.
4. ChatGPT oder Codex zeigt Empfänger, Typ, MIME, Dateiname, Größe, Hash, Caption und Reply-Ziel an und fragt nach Bestätigung.
5. Erst nach einer Bestätigung in einem neuen Turn ruft der Client `send_prepared_media` auf. Der Token ist zehn Minuten gültig und idempotent.
6. Nach erfolgreichem Versand wird der verschlüsselte Medieninhalt sofort aus dem Datensatz entfernt; Audit-Logs enthalten keinen Inhalt oder Dateinamen.

Der Versand verwendet denselben Scope `whatsapp:send`, dasselbe Empfänger-Rate-Limit und dieselben Prompt-Injection-Regeln wie Textnachrichten. Die HTTP-JSON-Grenze beträgt 30 MB, damit 20 MB Binärdaten als Base64 transportiert werden können.
