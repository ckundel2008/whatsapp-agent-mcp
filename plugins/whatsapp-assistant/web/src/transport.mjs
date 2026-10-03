import { App, applyDocumentTheme, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps";

export function unwrap(result) {
  if (result?.isError) throw new Error(result.content?.find((item) => item.type === "text")?.text || "Die Aktion konnte nicht abgeschlossen werden.");
  const data = result?._meta?.whatsapp;
  if (!data || typeof data !== "object") throw new Error("Die lokale Verbindung hat keine gültigen Anzeigedaten geliefert.");
  return data;
}

export async function connectTransport() {
  const csrf = document.querySelector('meta[name="whatsapp-csrf"]')?.content;
  if (csrf) {
    return {
      native: false,
      async call(name, args) {
        const response = await fetch("/api/call", {
          method: "POST", credentials: "same-origin",
          headers: { "content-type": "application/json", "x-whatsapp-csrf": csrf },
          body: JSON.stringify({ name, arguments: args }),
        });
        if (!response.ok) throw new Error(response.status === 401 || response.status === 403
          ? "Die lokale Sitzung ist abgelaufen. Bitte die Oberfläche neu öffnen."
          : "Der lokale Dienst ist nicht erreichbar. Bitte den Verbindungsstatus prüfen.");
        return unwrap(await response.json());
      },
      async share(text) { await navigator.clipboard.writeText(text); },
      close() {},
    };
  }
  const app = new App({ name: "WhatsApp Assistant", version: "0.3.0" });
  // Host tool-result metadata is deliberately never forwarded into model context.
  app.ontoolresult = () => {};
  const theme = (context) => {
    if (context?.theme) applyDocumentTheme(context.theme);
    if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables);
  };
  app.onhostcontextchanged = theme;
  await app.connect();
  theme(app.getHostContext());
  return {
    native: true,
    async call(name, args) { return unwrap(await app.callServerTool({ name, arguments: args })); },
    async download({ name, mime, bytes }) {
      if (!app.getHostCapabilities()?.downloadFile) throw new Error("Dieser Host unterstützt keine Datei-Downloads. Bitte das Browserpanel verwenden.");
      if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > 16 * 1024 * 1024) throw new Error("Die Datei konnte nicht bereitgestellt werden.");
      const safeName = String(name || "Anhang").replace(/[/\\\x00-\x1f\x7f]/g, "_").slice(0, 255);
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      const result = await app.downloadFile({ contents: [{ type: "resource", resource: {
        uri: `file:///${encodeURIComponent(safeName)}`, mimeType: mime || "application/octet-stream", blob: btoa(binary),
      } }] });
      if (result?.isError) throw new Error("Der Download wurde abgebrochen oder vom Host abgelehnt.");
    },
    async share(text) {
      const result = await app.sendMessage({ role: "user", content: [{ type: "text", text }] });
      if (result?.isError) throw new Error("Der Host konnte die Auswahl nicht übernehmen.");
    },
    close() { void app.close(); },
  };
}
