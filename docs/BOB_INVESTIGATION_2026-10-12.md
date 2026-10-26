> Veröffentlichte Fassung: persönliche IDs und Rechnerpfade sind anonymisiert. Die Gruppen-ID ist ein synthetisches Beispiel.

# WhatsApp-Bob: strukturierte Nachprüfung am 12.10.2026

Alle Uhrzeiten unten sind MESZ (Europe/Berlin). Untersuchung im bestehenden Codex-Projekt, ausgehend von `BOB_CODEX_AUFTRAG.md` und `BOB_REPAIR_2026-10-12.md`.

## Ergebnis

Ein neuer vollständiger **automatischer** Durchlauf ist jetzt live belegt: eigene neue WhatsApp-Nachricht → persistierte Queue → signierter Callback mit HTTP 200 → bestehender Bob → `whatsapp_bob_reply` → exakt zitierte Antwort → Rücklesen → Ungelesen-Markierung. Der Nutzer bestätigte ausdrücklich, dass die Antwort von selbst kam und Bob nicht zusätzlich zum Antworten aufgefordert wurde.

Die Antwort lautet `*[Bob] angekommen*`. Ein unabhängiger neuer `readBobGroupMessages`-Aufruf fand genau eine Nachricht mit der erwarteten Ausgangs-ID, authentifiziertem Autor und dem exakten ursprünglichen Zitatbezug.

Die Verzögerung zwischen Callback-Annahme und Antwortaufruf beträgt 5 Minuten 30,471 Sekunden. Der genaue Grund der Verzögerung ist nicht nachgewiesen. Insbesondere ist eine konkrete Bündelungszeit weiterhin nicht ausgelesen. Die ältere Anfrage „Antworte mir“ von 14:56 Uhr hatte zum Abschluss weiterhin keinen zugeordneten Antwortausgang; sie wurde nicht erneut zugestellt oder gesendet.

## Korrelierter Live-Durchlauf

| Stufe | Zeit |
| --- | --- |
| Neue eigene WhatsApp-Nachricht | 15:41:33,000 |
| Queue gespeichert (`queued_at`) | 15:41:38,642 |
| Queue-Trace nach Speicherung | 15:41:38,714 |
| Callback gestartet | 15:41:38,720 |
| Callback HTTP 200 | 15:41:39,872 |
| Bob-Antwortwerkzeug aufgerufen | 15:47:10,343 |
| Anfrage im Antwortwerkzeug zugeordnet | 15:47:10,346 |
| Ausgang reserviert | 15:47:10,390 |
| WhatsApp-Ausgang (Sekundenauflösung) | 15:47:10,000 |
| Exakte zitierte Antwort zurückgelesen | 15:47:10,780 |
| Ungelesen-Markierung bestätigt | 15:47:11,058 |
| Antwortergebnis gespeichert | 15:47:11,187 |

Die WhatsApp-Zeit hat Sekundenauflösung und ist deshalb kein Millisekundenbeleg für die Reihenfolge innerhalb dieser Sekunde.

- Ereignis: `evt_bob_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`
- Eingangs-ID: `true_120363000000000000@g.us_ABCDEF00000000000000_10000000000000@lid`
- Ausgangs-ID: `true_120363000000000000@g.us_ABCDEF00000000000000_10000000000000@lid`
- Subscription: `bob_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb`
- Persistierter Abschluss: `processing_confirmed=true`, `delivery_state=sent`, `completed=true`, `marking_status=marked_unread`.

Dieser Durchlauf fand **vor** dem unten beschriebenen neuen Brücken-Reload statt. Der Erfolg wird deshalb nicht der neuen Retry-Korrektur zugeschrieben. Er bestätigt erstmals die vollständige Strecke nach der bereits zuvor vorgenommenen OpenWA-Zitatreparatur.

## Vergleich mit dem funktionierenden Stand

- Letzte ältere, vollständig gespeicherte Antwort: Anfrage 07:20:59, Ausgang 07:23:46, Rücklesen 07:23:49,769, Ungelesen-Markierung 07:23:50,409. Auch weitere frühere Antworten sind im Ausgangsledger gespeichert.
- Backups von 08:23 und 10:20 enthalten denselben Stand der Brücke (`fc1ac645f46f5e27c920d592a52fc442087d410db42ce2b89a7e6d63a485d94c`). Ereignisname, Identitätsableitung, Signaturfunktion und Subscribe-/Challenge-Aufbau sind gegenüber dem Stand vor dieser Nachprüfung unverändert.
- Spätere Änderungen betrafen lokale Spracherkennung, priorisierte Kontoprüfung, Poll-Coalescing, Timeout/Retry und Diagnosespuren. Eigene Textnachrichten behalten dasselbe Payload-Feldset; zusätzliche Voice-Felder sind optional.
- Beim Untersuchungsbeginn liefen Tunnel-PID 4930 und MCP-PID 4932 seit 14:26:52 aus `private-ui-0.3.1/online/private-mcp.mjs`. Quelle und installierte Dateien von Brücke, privatem MCP, Gruppen-I/O, Benachrichtigungen und Voice stimmten per SHA-256 überein.
- Eine einzige Gruppen-Subscription war aktiv, gültig bis 13.10.2026, 06:21:16,935. Konto- und Gruppenbindung sind unverändert. Die lokale Subscription akzeptiert nur `whatsapp.bob_message` und genau die feste Gruppe; unzitierte eigene Texte brauchen kein Präfix.
- Antwortaufrufe für heute früher angenommene Callbacks lagen teilweise 17–39 Minuten später. Diese lokalen Zeiten allein belegen weder den Auslöser des jeweiligen Bob-Laufs noch eine feste Bündelungszeit.

## Protokollprüfung und gezielte Korrektur

Die [offizielle MCP-Events-Dokumentation](https://developers.openai.com/plugins/build/mcp-events) wurde geprüft. Ein `2xx` bestätigt die Webhook-Annahme; die anschließende Verarbeitung erfolgt asynchron. Das vorhandene Envelope und die Signaturberechnung entsprechen der beschriebenen Form. Nach HTTP 200 wird dasselbe Ereignis nicht erneut geschickt. Der neue Live-Durchlauf widerlegt eine dauerhafte Unterbrechung dieser Strecke.

Separat wurden zwei belegte lokale Fehler in der Retry-Verwaltung korrigiert:

1. Die Entfernung der früheren Fünf-Versuche-Grenze ließ innerhalb der bestehenden 24-Stunden-Anfragelaufzeit die Versuchszahl unbegrenzt anwachsen. Jetzt sind maximal 64 Versuche erlaubt; eine Erholung beim sechsten Versuch bleibt möglich.
2. Eine Erneuerung derselben Subscription verlor bisher deren `attempts`. Der Zähler bleibt jetzt bei Erneuerung und Neustart erhalten.

Neue sichere Traces protokollieren Subscription-ID, effektiven Ereignisnamen und Filter, Ablauf, Callback-/Schlüssel-Hashes sowie Bytezahl, SHA-256 und Feldnamen des tatsächlich konstruierten Callback-Payloads. Rohtexte, Callback-URL, Schlüssel und Challenge werden nicht protokolliert.

Geänderte Implementierungsdateien: `online/bob-bridge.mjs` und `online/tests/bob-bridge.test.mjs`. Alle vorbestehenden Änderungen, insbesondere `.github/workflows/ci.yml`, blieben erhalten. Die Retry-Korrektur erklärt weder das bereits angenommene alte Ereignis noch die gemessene Bob-Verzögerung.

## Prüfung und Aktivierung

- Node.js 24.20.0; OpenWA 4.76.0; privater MCP 0.3.1; vorhandener Tunnel-Client 0.0.15.
- 18 gezielte Brücken-/Gruppentests nach der abschließenden Änderung bestanden: exakte UTF-8-HMAC-Signatur, Envelope, Filter, Versuchslimit, Erneuerung/Neustart, Doppelversand, unklare Ausgänge, Zitat und Schleifenvermeidung.
- Breiter Lauf: 108 Tests bestanden; zwei Testdateien scheiterten vor ihrer Ausführung beim Lesen der lokalen `jose`-Abhängigkeit (`Resource deadlock avoided`, errno 11). Dieselbe Dateilesesperre trat bei Git auf. Mit bytegleichen Online-Quellen in einer temporären lokalen Kopie und den bereits installierten Abhängigkeiten derselben Versionen bestanden zusätzlich 8 Auth- und 11 Gateway-Tests. Insgesamt sind damit 127 unterschiedliche Prüfungen bestanden; kein vollständig grüner Einzellauf aus dem ursprünglichen Dateisystem behauptet.
- Nur `whatsapp-dot-personal-managed` wurde nach privatem Backup gezielt neu geladen. Backup: `~/.config/whatsapp-dot-tunnel/bob-codex-backup-20261012-155103`. Neuer Tunnel-PID 24054, MCP-PID 24055. WhatsApp-Daemon und andere Tunnel wurden nicht neu gestartet.
- Installierte Brücke und Quelle sind nach der Aktivierung bytegleich. Ereigniszustand und sämtliche 23 Ausgangsledger-Dateien blieben beim Reload unverändert. Der Status danach lautet `CONNECTED`; keine Eingangssperre. Keine neue Aufgabe, kein neues Callback-Ziel, keine erneut geschickten alten Ereignisse und kein zusätzlicher WhatsApp-Versand.

## Verbleibende Prüflücke

Die tatsächliche Bündelung und der spezifische Lauf der älteren 14:56-Anfrage sind weiterhin nicht zugänglich. Der Nutzer autorisierte einen Diagnoseauftrag an den bestehenden Bob-Chat; `send_message_to_thread` meldete mit und ohne expliziten Cloud-Host `thread not found`. `read_thread` liefert Metadaten, aber keine Turns. Die Planeransicht enthält nur fünf andere Cloud-Aufgaben; die Dot-Seite ist im Browser nicht zugänglich. Es wurde deshalb kein Diagnoseauftrag als zugestellt behauptet und kein Ersatzchat erstellt.

Der aktuelle automatische Textdurchlauf ist live abgenommen. Eine konkrete Erklärung oder Reduzierung der Ereignisverzögerung und die historische Zuordnung von „Antworte mir“ bleiben offen. Reale Voice-Abnahme war nicht Gegenstand dieses Texttests.

## Nachprüfung um 19:56 MESZ

Die jüngste erfasste eigene, unzitierte Nachricht stammt von 18:22:54. Ihr Ereignis `evt_bob_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` wurde um 18:22:56,152 mit HTTP 200 angenommen. Erst um 18:46:01,602 wurde der zugehörige Bob-Antwortaufruf lokal erkannt: 23 Minuten und 5,450 Sekunden nach der Annahme. Der Versand war um 18:46:02,026 abgeschlossen. Das unabhängige Rücklesen bestätigt eine Antwort von 18:46:01 mit nativem Zitat genau dieser Eingangsnachricht. Tunnel und MCP-Prozess laufen weiter. Im Rückleseergebnis und Ereigniszustand ist keine spätere Eingangsnachricht sichtbar.

Damit erklärt ein angenommenes festes Fünf-Minuten-Intervall die beobachteten Verzögerungen nicht vollständig. Die tatsächliche Bündelung wurde weiterhin weder ausgelesen noch geändert; der dafür erforderliche Zugriff auf die bestehende Cloud-Aufgabe fehlt.
