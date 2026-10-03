# Online-Grundlage: Entwicklungspilot

Diese erste Implementierung ergänzt die lokale Installation um einen separaten,
rein lesenden HTTP-MCP-Adapter und eine ausgehende Geräte-Bridge. Sie ist lokal
mit synthetischen Daten geprüft, aber **nicht öffentlich bereitgestellt**.
Der bestehende lokale Dienst und seine sechs Modellwerkzeuge bleiben unverändert.
[Nachweise und offene Abnahme](../docs/ONLINE_PILOT_ACCEPTANCE.md)

Für den eigenen persönlichen Dot wird inzwischen der kürzere offizielle
**Secure MCP Tunnel** vorbereitet: ein eigener stdio-Server ohne öffentliche
Domain oder eigenen OAuth-Anbieter. Er ist standardmäßig rein lesend; explizite
private Flags erlauben alle bestehenden Chats und den zweistufig bestätigten
Textversand. Ein dauerhaftes privates Ledger sperrt unklare Zustellungen auch
über Neustarts hinweg. Die öffentlichen HTTP-Werkzeuge bleiben rein lesend.
[Privaten Dot verbinden](../docs/PRIVATE_DOT_CONNECTION.md)
Die nachfolgende HTTP-/OAuth-Architektur bleibt der getrennte öffentliche Pilot.

## Sofort ausführbare Demonstration

```sh
npm ci --prefix online --ignore-scripts --no-audit --no-fund
npm run online:test
npm run online:demo
```

Die Demo baut einen echten HTTP-/WebSocket-Verbindungsweg mit dem offiziellen
MCP-Client-SDK auf. Schlüssel und Zugangstoken entstehen nur im Arbeitsspeicher.
Ein synthetischer WhatsApp-Dienst zeigt Status, einen freigegebenen Chat und
Textverlauf. Ein zweiter Chat wird ausgefiltert; Versand ist gesperrt. Danach
werden beide Adapter beendet. Die Demo liest keine echten WhatsApp-Daten,
verbindet kein Konto und sendet keine Nachricht.

Ein gesonderter, ausdrücklich gestarteter Statusnachweis kann die komplette
lokale Adapterkette mit dem bereits laufenden WhatsApp-Dienst prüfen:

```sh
npm run online:status-probe
```

Hier sind keine Chats freigegeben. Nur `status` wird an den echten Daemon
übergeben; Kontodaten werden vor der Ausgabe entfernt. Gateway und Bridge
laufen kurz auf Loopback und werden beendet. Das prüft keinen öffentlichen
OAuth-Anbieter und keinen tatsächlichen Dot.

## Implementierte Grenzen

- Nur `whatsapp_status`, `whatsapp_list_chats`, `whatsapp_read_messages`.
- JWT-Signatur mit RS256/ES256, fester Issuer/JWKS-Konfiguration, passender
  Audience, Zeitclaims und Scope `whatsapp:read`. Tokenlebensdauer maximal zehn
  Minuten. Keine eigenen Loginseiten, Passwortsammlung oder OAuth-Tokenausgabe.
- Nutzer wird über den verifizierten OAuth-Subject beim konfigurierten Issuer
  einer aktiven Gerätebindung zugeordnet. Kein Gerät oder Nutzer aus Tool-Parametern.
- Chat-Allowlist auf Gateway und Gerät. Listen und Zähler enthalten nur
  freigegebene Chats, keine Nachrichtenvorschau. Textlesen bleibt im bestehenden
  30-Tage-Fenster und meldet unvollständige Historie.
- Gerät ist zusätzlich an den Fingerabdruck des eingerichteten WhatsApp-Kontos
  gebunden. Vor und nach Lesezugriffen wird das Konto geprüft. Ein Wechsel
  verwirft Ergebnisse und erfordert neue lokale Einrichtung.
- Geräte-Credential ist vom Benutzer-Token getrennt. Nur sein Hash steht im
  Gateway-Register; Socket-Secret und WhatsApp-Sitzung verlassen den Rechner nicht.
- Strikte Host-/Origin-Prüfung, geschlossene Parameter, Größen-/Parallelitäts-
  und Zeitlimits. Keine CORS-Freigabe, kein generischer Socket-/Shell-Zugriff,
  keine automatische Wiederholung oder spätere Wiedergabe alter Anfragen.
- Status unterscheidet Gateway, Bridge und WhatsApp. Fehlertexte enthalten
  keine Daemon-Ausnahmen, Kontodaten oder Token. Nachrichten bleiben Textdaten.

Das Gateway bindet ausschließlich an `127.0.0.1`. Für späteren öffentlichen
Betrieb muss ein ausdrücklich eingerichteter HTTPS-Reverse-Proxy den ursprünglichen
Host korrekt weiterreichen und WebSocket-Upgrades unterstützen. Ungeprüfte
Forwarded-Header werden nicht zur Authentifizierung oder Hostprüfung verwendet.

## Vorbereitung für ein eigenes Gerät

Erst den etablierten OAuth-Anbieter konfigurieren: Discovery, Authorization Code
mit PKCE/S256, passender Resource-/Audience-Wert und Scope `whatsapp:read`.
Die OpenAI-Clientregistrierung beziehungsweise exakte Redirect-URI muss zu diesem
Anbieter passen. Dafür fehlen noch bestätigte Domain und Anbieterauswahl.
[Offizielle Authentifizierungsanforderungen](https://developers.openai.com/plugins/build/auth)

Der Pilot stellt nur den **Resource Server** bereit. Die vollständige OAuth-
Anmeldung ist deshalb noch kein abgenommener Nutzungsweg. Der Identitätsanbieter
muss kurze signierte Zugriffstoken für genau diesen Resource Server ausgeben.

Einrichtung derzeit über den lokalen Betreiber, keine öffentliche Pairing-API:
Eine private Eingabedatei mit Modus 0600 außerhalb des Veröffentlichungspakets
anlegen, zum Beispiel unter dem ignorierten Verzeichnis `.release-local/online-private/`.
Die Werte hier sind Beispiele und ersetzen keinen erreichbaren OAuth-Anbieter:

```json
{
  "publicUrl": "https://whatsapp.example.org",
  "issuer": "https://auth.example.org",
  "jwksUrl": "https://auth.example.org/jwks",
  "port": 8877,
  "subject": "EXACT_OAUTH_SUBJECT",
  "allowedChatIds": []
}
```

`publicUrl` ist der kanonische OAuth-Resource-Wert ohne `/mcp`. Für reine lokale
Entwicklung kann er `http://127.0.0.1:8877` lauten. Alle anderen HTTP-Adressen
werden abgewiesen. `issuer` und `jwksUrl` müssen echte HTTPS-Adressen sein.
Ein leeres Chat-Array erlaubt Status und eine leere Chatliste, keine Historie.

```sh
node online/provision.mjs PRIVATE_INPUT NEW_GATEWAY_CONFIG NEW_BRIDGE_CONFIG
node online/gateway.mjs --config NEW_GATEWAY_CONFIG
node online/bridge.mjs --config NEW_BRIDGE_CONFIG
```

Die Ausgabe-Dateien werden ausschließlich neu mit Modus 0600 erstellt. Bereits
vorhandene Dateien werden nicht überschrieben; schlägt die zweite Dateianlage
fehl, wird die in diesem Aufruf reservierte erste zurückgenommen. Keine Tokens
werden auf dem Terminal ausgegeben. Die Konfigurationen gehören nicht in Git,
Issues, Chats, Videos oder Release-Archive.

Für ausdrücklich ausgewählte technische Chat-IDs `allowedChatIds` lokal setzen
und bei der Provisionierung zusätzlich `--bind-existing-account` übergeben.
Dann wird nur das bereits verbundene Konto geprüft und sein Fingerabdruck lokal
gebunden. Der Befehl startet keinen WhatsApp-Dienst, liest keine Nachrichten und
verbindet kein neues Konto. Die Konfiguration gilt für genau dieses Gerät/Konto.
Für den ersten privaten Pilot nicht pauschal alle Chats freigeben.

Bei Änderung oder Widerruf: Bridge und Gateway ausdrücklich beenden, private
Register/Allowlist anpassen und neue Credential-Dateien erstellen; danach
bewusst neu starten. Es gibt in dieser Etappe noch keine Verwaltungsoberfläche
oder laufende Token-Introspektion. Bearer-Token werden spätestens nach ihrer
maximal zehnminütigen Laufzeit ungültig. Ein gestohlenes Geräte-Credential muss
zusätzlich durch Austausch des Hashes und Neustart widerrufen werden.

## Dots-Pilot

Dokumentiert ist, dass Dots unterstützte Plugins nutzen und lokale Work-/Codex-
Aufgaben auf einem verbundenen persönlichen Rechner starten können. Der Rechner
muss online und die ChatGPT-App geöffnet sein. Die lokale Codex-Verbindung
allein gewährt Dots keinen Zugriff.
[Computer und Apps](https://learn.chatgpt.com/docs/dots/computers-and-apps)

Prüffolge für einen tatsächlich verfügbaren Dot:

1. Im Dots-Profil den Rechnerzugriff selbst einrichten und Plugin-Berechtigungen
   prüfen. Keine WhatsApp-Schlüssel oder QR-Codes an Dot übergeben.
2. Zunächst nur den Verbindungsstatus durch eine lokale Aufgabe prüfen lassen.
3. Genau einen selbst gewählten Chat freigeben. Ein begrenzter Leseauftrag:
   „Lies höchstens zehn Textnachrichten aus dem ausgewählten Chat, fasse sie
   zusammen und entwirf eine Antwort. Versende nichts. Melde unvollständige Historie.“
4. Prüfen, dass das richtige Konto/Chat und die tatsächliche lokale Umgebung
   verwendet werden. Ergebnis und Entwurf im Dot prüfen; keine bloße Tool-Annahme.
5. Wiederholung nach Leerlauf; Offlinezustand und Wiederanlauf prüfen. Eine
   erreichbare lokale WhatsApp-Verbindung beweist noch keine Dots-Unterstützung.

Der neue Remote-Pilot ist bis zur HTTPS-/OAuth-Einrichtung kein Cloud-Plugin.
Die synthetische Demo beweist Transport und Isolation, keine Live-Dots-Abnahme.
Privater Handy-Dot-Status und private ChatGPT-Tunnelaufrufe für Suche, Lesen
und Vorbereitung sind geprüft. Offen bleiben **HANDY_DOT_READ_NOT_RUN**,
**PUBLIC_REMOTE_DOTS_NOT_RUN** und **REMOTE_OAUTH_LOGIN_NOT_RUN**.
Am 3. Oktober 2026 bestätigt der Nutzer erfolgreichen Versand im persönlichen
Betrieb. Der frühere Fehlversuch wurde nicht automatisch wiederholt; es gab
keinen zusätzlichen Versand-/Zustellungscheck durch den Agenten.
Siehe die [Pilot-Abnahme](../docs/ONLINE_PILOT_ACCEPTANCE.md).

## Weitere Etappen

Offen sind öffentliche Pairing-/Kontoeinrichtung, native MCP-App und angemeldete
Weboberfläche für den Remote-Pfad, dauerhafte Verwaltung und Widerruf,
Ereignisabonnements mit MCP 2.0 `2026-07-28`, menschliche Versandfreigabe,
Betrieb sowie öffentliche Einreichung. Der aktuelle Server bewirbt keine Events
oder native UI. Keine lokale Benutzer-Sitzung wird automatisch hochgeladen.

Gezielt gelesene Inhalte würden über Gateway und OpenAI verarbeitet. TLS schützt
die Transportstrecken; das Gateway kann angefragte Inhalte lesen. Die vorhandenen
Datenschutzunterlagen gelten deshalb noch nicht als finale Datenschutzinformation
für einen öffentlichen Online-Betrieb.
[Gesamter Plan](../docs/ONLINE_DOTS_PLAN.md)
