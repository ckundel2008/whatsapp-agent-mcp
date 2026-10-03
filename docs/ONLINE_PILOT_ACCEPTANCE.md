# Online-Pilot: Nachweise und offene Abnahme

Stand: 3. Oktober 2026; automatisierte Prüfungen vom 3. Oktober. Gilt für die separate Entwicklungsversion in `online/`,
nicht für ein öffentlich veröffentlichtes Plugin. Keine Bereitstellung oder
Verzeichnisaufnahme durchgeführt.

## Frisch geprüft

| Prüfung | Ergebnis | Geltungsbereich |
| --- | --- | --- |
| Online-Tests | 83/83 bestanden | Signierte synthetische Token, HTTP/WebSocket, privater stdio-Zugang, all-chat Suche/Pagination, bestätigter Textversand, persistente Sperre über Neustart/konkurrierende Instanzen, verlorene Erfolgsantwort, bestätigte Operator-Aufhebung und unterscheidbare Vorprüfungsfehler; kein echter Versand |
| Bestehende lokale Plugin-Tests | 157/157 bestanden | Bestehende lokale Oberfläche, sechs Modellwerkzeuge, Runtime-Grenzen und Chrome-Startkorrektur |
| Release-Quellprüfung | Bestanden | Lokaler Kandidat; keine öffentliche Freigabe |
| Audit der Online-Produktionsabhängigkeiten | 0 gemeldete Schwachstellen | Gepinnte Versionen von jose und ws zum Prüfzeitpunkt |
| `npm run online:demo` | Bestanden | Synthetischer Chat sichtbar, Textverlauf gelesen, fremder Chat ausgefiltert und Versand abgewiesen |
| `npm run online:status-probe` | Bestanden, CONNECTED | Tatsächlicher lokaler Dienststatus durch neuen HTTP-/WebSocket-Adapter; keine Chats freigegeben oder Nachrichten gelesen |
| Unabhängiger Änderungs-Gegencheck | Freigegeben für private Runtime-Aktivierung | Accountbindung, Default/Public read-only, bestätigter Textversand, persistente Sperre einschließlich verlorener Erfolgsantwort; nur synthetischer Versand |
| Privater stdio-Zugang mit offiziellem MCP-SDK | Bestanden, CONNECTED | Echtes lokales Konto, Status-only-Konfiguration; drei Tools entdeckt, Versandaufruf abgewiesen, keine Chats gelesen |
| Offizieller Tunnel-Client | Laufender privater Runtime bestätigt | Darwin arm64 0.0.15; eigene private Schlüsseldatei, dedizierter Status-Alias; offizieller `runtimes status` und `/readyz` bereit |
| Privates ChatGPT-Plugin | Erstellt und verbunden | Tatsächliches Chrome-Konto; drei Lesewerkzeuge sichtbar, nur Status lokal freigegeben |
| Echter ChatGPT-Statusaufruf | Bestanden, CONNECTED | Testchat „WhatsApp Status prüfen“: `connected: true`, `state: CONNECTED`, `read_only: true`; keine Chatliste, Nachrichten oder Versand angefordert |
| Persönlicher Handy-Dot: Status | Vom Nutzer mit Screenshot bestätigt | Tatsächlicher Dot antwortet `connected: true`, `state: CONNECTED`, `read_only: true`; anschließende Chatsuche blieb aufgrund der leeren Freigabeliste gesperrt |
| Neue private All-chat-Konfiguration | Lokal angelegt und an dasselbe Konto gebunden | Explizite Nutzerfreigabe für alle bestehenden Chats und bestätigten Textversand; Status-Datei erhalten |
| Lokaler All-chat-Leseaufruf | Bestanden | Sieben Suchtreffer; zehn echte Textnachrichten gelesen, nur Ergebniszähler ausgegeben |
| Offizielles MCP-SDK, neuer privater stdio-Server | Bestanden | Fünf Werkzeuge; CONNECTED, `read_only: false`, `send_requires_confirmation: true`; sieben Suchtreffer und eine Textnachricht gelesen, kein Send-Werkzeug aufgerufen |
| Neues persönliches Tunnelprofil | Aktiviert und bereit | Eigenes Statusprofil beendet; neuer Alias `whatsapp-dot-personal`, offizieller Status `process_running`, `healthy`, `ready`: wahr; keine fremde Integration geändert |
| Plugin-Name, Beschreibung und Werkzeuge | In ChatGPT gespeichert und sichtbar geprüft | „WhatsApp Dot“, ausdrücklich bestätigte Werkzeugaktualisierung; tatsächliche App-Ansicht zeigt `Read3` und `Write2`, genau die fünf vorgesehenen Werkzeuge |
| Echter ChatGPT-Leseaufruf über privaten Tunnel | Bestanden | Testchat „WhatsApp Verbindung prüfen“ meldet CONNECTED, sieben Suchtreffer, genau eine Textnachricht gelesen und vollständiges 30-Tage-Fenster; keine Nachricht vorbereitet oder versendet |
| Diagnose des gemeldeten Versandfehlers | Ursache weiterhin unbestimmt | Privates Ledger ohne Reservierungen; echter lokaler Vorbereitungstest erfolgreich, null Send-Dispatches; sichere Vorprüfungsfehler jetzt als MCP-Toolergebnisse statt pauschalem RPC-Fehler; Runtime wieder healthy/ready |
| Echter ChatGPT-Vorbereitungstest über privaten Tunnel | Bestanden | Testchat „WhatsApp Verbindung prüfen“ bestätigt Vorbereitung erfolgreich, kein Fehlercode; synthetischer Text in einem bestehenden Chat nur vorbereitet, Sendeaufruf ausdrücklich verboten, Ledger unverändert leer |
| Echter Textversand im persönlichen Betrieb und über den Dot | Am 3. Oktober vom Nutzer bestätigt | Nutzer meldet erfolgreichen Textversand, ausdrücklich auch über den persönlichen Dot nach dem Runtime-Update. Kein zusätzlicher Sendeaufruf oder unabhängiger Zustellungscheck durch den Agenten; kein Empfänger oder Nachrichtentext dokumentiert |

Ausgeführt auf Node.js 24.20.0 auf diesem Mac. CI-Prüfung für Node 22/24 ist
auf dem reparierten Code einschließlich Chrome-Startkorrektur erfolgreich
[bei GitHub ausgeführt](https://github.com/ckundel2008/whatsapp-agent-mcp/actions/runs/37098211435).
Die Online-Demo verwendet nur
kurzlebige lokale Schlüssel im Arbeitsspeicher und bewirkt keine externe
OAuth-Verbindung. Die Statusprobe beendet ihre temporären Adapter danach.

Die Tests prüfen unter anderem:

- falsche Signatur, Algorithmus, Issuer, Audience, Zeitclaims und Scope;
- private Konfigurationsrechte, Symlinks, Dateigrößen und fehlerhafte Provisionierung;
- zwei getrennte Nutzer, explizite Chatfreigaben, gesperrte Schreib-/Medienaktionen;
- fremde Origins/Hosts, fehlerhafte Protokollversion, Benachrichtigungen und Payloads;
- Kontoänderung nach Lesen: Inhalt wird verworfen, Status ACCOUNT_CHANGED;
- Verbindungsabbruch während Lesen: alte Ergebnisse werden nicht nachgeliefert;
- acht abgelaufene Leseanfragen: anschließende Bridge-Anfrage bleibt möglich;
- unvollständige Historie und Nachrichten mit enthaltenen Agentenanweisungen.

Im Gegencheck gefundene Fehler beim kontoabhängigen Status, partiellen Anlegen
von Credential-Dateien und Begrenzen abgelaufener Daemon-Anfragen sind behoben
und durch konkrete Regressionstests abgesichert.

Der neue private stdio-Pfad erzwingt vollständige Frame-Limits auch bei mehreren
Zeilen pro Eingabe und beim doppelten Ausgabeformat Text/structuredContent.
Der SDK-Test liest nur synthetische freigegebene Texte mit geteilten UTF-8-Zeichen.
Der erste reale SDK-Aufruf hat ausschließlich den Verbindungsstatus geprüft;
spätere ausdrücklich freigegebene SDK- und ChatGPT-Prüfungen decken Suche,
begrenztes Textlesen und Vorbereitung ohne Versand ab.
Der Last-/Deadline-Test ist über eine Startbarriere für alle acht Aufrufe
stabilisiert; die echte Ablauf- und Wiederverfügbarkeitsprüfung bleibt bestehen.

Für den persönlichen Handy-Dot ist der offizielle Secure MCP Tunnel jetzt der
vorgesehene private Nutzungsweg. Die folgenden öffentlichen OAuth-/HTTPS-
Voraussetzungen gelten für die getrennte öffentliche Variante, nicht für
diesen privaten Tunnel. [Privater Dot-Zugang](PRIVATE_DOT_CONNECTION.md)

## Noch nicht abgenommen

- **DOT_READ_NOT_RUN:** Der private Tunnel, das verbundene ChatGPT-Plugin und
  der Statusaufruf im tatsächlichen Handy-Dot sind bestätigt. Chatsuche und
  Textlesen über dasselbe Plugin funktionieren im echten ChatGPT-Testchat.
  Der neue Leseaufruf und eine Zusammenfassung im Handy-Dot bleiben offen;
  dafür ist keine allgemeine Rechnerfreigabe Bestandteil dieses Tunnelwegs.
- **INDEPENDENT_DELIVERY_NOT_RUN:** Der Nutzer bestätigt am 3. Oktober
  erfolgreichen Textversand im persönlichen Betrieb und über den persönlichen
  Dot nach dem Runtime-Update. Ein zusätzlicher unabhängiger
  Versand-/Zustellungscheck wurde nicht durchgeführt. Der frühere Fehlversuch
  wurde nicht automatisch wiederholt; seine genaue Fehlerursache bleibt offen.
- **REMOTE_OAUTH_LOGIN_NOT_RUN:** Etablierter Anbieter mit Discovery, PKCE,
  Clientregistrierung und korrekter Audience/Scope muss eingerichtet werden.
  Tokenprüfung ist implementiert, der vollständige Loginweg noch nicht.
- **PUBLIC_ENDPOINT_NOT_DEPLOYED:** Bestätigte Domain, Betreiber, Hosting und
  HTTPS-Konfiguration fehlen. Die Adapter binden bewusst nur an Loopback.
- Öffentliches Geräte-Pairing, Verwaltung/Widerruf, Remote-Oberfläche,
  Events mit MCP 2.0, menschlich bestätigter Remote-Versand und öffentliche
  Review-Abnahme sind spätere Etappen des Plans.
- Echter Text-/Medienversand wurde in diesem Arbeitsabschnitt nicht getestet.
  Die öffentliche OAuth-Bridge bleibt vollständig rein lesend; der optionale
  private Textversand hält Reservierungen auch nach Erfolg dauerhaft, damit
  verlorene Erfolgsantworten keinen Doppelversand ermöglichen. Absichtlich
  identische Texte brauchen deshalb eine bestätigte lokale Operator-Aufhebung.

Die erste praktische Dots-Abnahme prüft einen Leseauftrag innerhalb des vom
Nutzer ausdrücklich freigegebenen Chatumfangs. Kein automatischer Chat-Export
und keine WhatsApp-Testnachricht. Der private Versand benötigt eine neue
separate Bestätigung von konkretem Empfänger und vollständigem Text.

[Pilot ausführen](../online/README.md) · [Online-/Dots-Plan](ONLINE_DOTS_PLAN.md)
