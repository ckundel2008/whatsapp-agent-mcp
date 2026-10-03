# Veröffentlichungsvorbereitung 0.3.0

Dieses Paket ist lokal vorbereitet. Es wurde weder gehostet noch bei GitHub
veröffentlicht oder bei OpenAI eingereicht. Ein lokales Installations-ZIP ist
kein öffentliches MCP-Einreichungspaket.

## Enthaltene Unterlagen

- Installierbares lokales Marketplace-ZIP mit Offline-Oberfläche und Prüfsummen.
- Quellarchiv mit Lizenzen, Build-Dateien und Release-Prüfung.
- Deutsche/englische Installation, Datenschutz, Support und Nutzungsinformationen.
- Listing, fünf positive/drei negative Szenarien in der offiziellen
  OpenAI-Review-Metadatenstruktur. Erwartete Werkzeuge sind Zeichenketten;
  Zugangsdaten gehören nicht in das Plugin.
- [Reviewer-Ablauf](REVIEWER_WALKTHROUGH.md) und Aufnahmeplan. Die automatische
  Aufnahme ist am 2026-09-30 an Chrome-/macOS-Aufzeichnungsfehlern hängen
  geblieben und wurde abgebrochen. Ein neuer Browserlauf ohne Aufnahme besteht
  am 2026-10-02 alle 16 Fälle. Eine abgenommene Aufnahme, zugängliche
  Video-Walkthrough-URL und finale Reviewer-Ausführung bleiben erforderlich.
- Unveröffentlichte statische Website-Vorlage mit Beschreibung, Datenschutz,
  Support, Nutzungsbedingungen, Lizenz und synthetischen Screenshots.
- [Englischer Anfrageentwurf](OPENAI_LOCAL_MCP_REQUEST.md) zum lokalen MCP-Pfad.

## Nächste Schritte mit konkreten Voraussetzungen

| Schritt | Vorbereitung | Offene Voraussetzung |
| --- | --- | --- |
| Herausgeber | Eingabevorlage in release/publisher-inputs.example.json | Bestätigter Name/Firma, Support-Adresse, Domain; Platform-Verifizierung und Apps Management Write |
| Lokaler MCP-Pfad | Anfrageentwurf fertig | Dokumentierte Unterstützung durch OpenAI; keine Zusage vorhanden |
| Öffentliche Website | Statische Entwürfe fertig | Herausgeberangaben prüfen, öffentliche HTTPS-Adressen festlegen und Hosting freigeben |
| Reviewer-Demo | Synthetische Fixtures und Ablauf vorhanden | Genehmigter Zugangsweg, eigenes nichtprivates Testkonto falls erforderlich, funktionierende Aufzeichnung und zugängliche Aufnahme |
| Native Codex-App | Ressourcen, Öffnungswerkzeug und SDK-Harness vorhanden | In einem frischen unterstützten Codex-Chat whatsapp_open_ui aufrufen und tatsächliches Rendering prüfen |
| Echte Lieferung | Zweistufiger Versand implementiert und synthetisch geprüft | Gesonderte Freigabe eines konkreten Testchats, exakten Textes/Anhangs und tatsächliche Zustellungsprüfung |
| Öffentliche Einreichung | Listing, Review-Felder und acht Szenarien vorbereitet | Alle Pflichtwerte und finale Prüfungen erfüllt; Upload/Review erst danach |

Am 2026-10-02 bestehen erneut 149 lokale Node-Tests, 83 Online-Tests und
16 synthetische Browserprüfungen auf macOS/Chrome. Der Browserlauf umfasst
Loopback und SDK-Harness, kein tatsächliches natives Codex-MCP-App-Rendering.
Die frühere Videoaufnahme konnte wegen Browser-/Seitenstartfehlern nicht
abgeschlossen werden. Eine abgenommene Aufnahme und erneute Ausführung aller
Reviewerfälle im finalen öffentlichen Umfeld bleiben erforderlich.

## Architekturentscheidung für öffentliche Aufnahme

Der vorgesehene Betrieb bleibt pro Nutzer auf dessen Mac. Der private
Secure-MCP-Tunnel ist inzwischen als separater Pilot vorbereitet und mit
ChatGPT für Status, Suche, Lesen und Vorbereitung geprüft; er ersetzt keine
öffentliche Einreichung. Dafür verlangt die aktuelle Dokumentation einen
stabilen öffentlichen HTTPS-MCP-Endpunkt mit Streamable HTTP. Ein lokaler
Loopback-Adapter, privater Secure-MCP-Tunnel oder temporärer Tunnel erfüllt das nicht.

Ein öffentlicher Remote-Pfad wäre eine eigene Architekturentscheidung: sichere
Zuordnung pro Nutzer, Authentifizierung/Autorisierung, Lebenszyklus und Schutz
der Verbindungen müssten neu umgesetzt und geprüft werden. Den bestehenden
Unix-Socket oder persönlichen WhatsApp-Dienst ins Internet zu stellen ist kein
geeigneter Veröffentlichungsweg. Ein synthetischer Demo-Endpunkt darf nicht als
funktionierender Produktionsdienst dargestellt werden.

## Reproduzierbarer Paketbau

```sh
node release/sync-review-metadata.mjs
node release/prepare-submission.mjs
npm run ui:test
npm run release:check
npm run release:package
npm run release:verify
node release/build-handoff.mjs
```

Der letzte Befehl erstellt einen neuen Ordner und ein Gesamt-ZIP unter
ignoriertem .release-local. Vorhandene Übergabepakete werden nicht überschrieben.
Für erneuten Bau einen neuen Ausgabeordner als Argument angeben. Kein Befehl
hostet Inhalte, verbindet ein Konto oder versendet WhatsApp-Nachrichten.

Optional kann `WHATSAPP_RECORD_REVIEW=1 npm run ui:test` in einer geeigneten
Aufzeichnungsumgebung synthetische Videos erzeugen. Auf diesem Mac wurde kein
vollständig bestandener Aufnahmelauf erzielt. Der Übergabebau übernimmt solche
Videos erst nach einer ausdrücklich geprüften RECORDING-ACCEPTANCE.json im
Aufnahmeordner mit status PASSED, synthetic_only true und den freigegebenen
relativen Dateipfaden. Fehlgeschlagene oder abgebrochene Aufnahmen fehlen im ZIP.

Nach Änderungen an release/submission.json aktualisiert
`node release/sync-review-metadata.mjs --write` die importierbaren Review-Felder.
Die fehlenden Felder bleiben null und werden im Preflight ausgewiesen. Eine
spätere öffentliche MCP-Konfiguration muss den tatsächlich freigegebenen
Endpunkt verwenden; die lokale stdio-Konfiguration bleibt im lokalen Paket.

Aktuelle Quellen: [Einreichung](https://developers.openai.com/plugins/deploy/submission),
[Plugin-Paket](https://developers.openai.com/plugins/build/plugins),
[HTTPS-MCP](https://developers.openai.com/plugins/build/mcp-server).
