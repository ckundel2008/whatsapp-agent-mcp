import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { connectTransport } from "./transport.mjs";
import { WhatsAppController } from "./controller.mjs";
import "./style.css";

function Icon({ name, size = 20 }) {
  const paths = {
    search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.2 8a7 7 0 0 1 11.5-3L20 8M4 16l3.3 3A7 7 0 0 0 18.8 16"/></>,
    sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></>,
    back: <path d="m14 5-7 7 7 7"/>,
    pencil: <><path d="m16 3 5 5-12 12-6 1 1-6Z"/><path d="m14 5 5 5"/></>,
    list: <><path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.1M3 12h.1M3 18h.1"/></>,
    send: <><path d="m22 2-7 20-4-9-9-4Z"/><path d="m22 2-11 11"/></>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></>,
    plus: <path d="M12 4v16M4 12h16"/>,
    paperclip: <path d="m21.4 11.6-8.9 8.9a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/>,
    close: <><path d="m6 6 12 12M18 6 6 18"/></>,
    file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
function Mark() {
  return <svg viewBox="0 0 48 48" width="36" height="36" aria-hidden="true"><rect x="2" y="2" width="44" height="44" rx="14" fill="currentColor"/><path d="M13 14h22v16H22l-7 5v-5h-2Z" fill="none" stroke="white" strokeWidth="2.5" strokeLinejoin="round"/><circle cx="19" cy="22" r="1.5" fill="white"/><circle cx="25" cy="22" r="1.5" fill="white"/><circle cx="31" cy="22" r="1.5" fill="white"/></svg>;
}
const initials = (title) => title.trim().split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toLocaleUpperCase("de");
const time = (stamp) => stamp && Number.isFinite(Date.parse(stamp)) ? new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" }).format(new Date(stamp)) : "";
const date = (stamp) => stamp && Number.isFinite(Date.parse(stamp)) ? new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long" }).format(new Date(stamp)) : "";
const mediaLabel = (message) => ({ image: "Bild", video: "Video", audio: "Audio", ptt: "Sprachnachricht", sticker: "Sticker", document: "Dokument" })[message.type] || "Medium";
const fileSize = (size) => size < 1024 ? `${size} Bytes` : size < 1024 * 1024 ? `${(size / 1024).toLocaleString("de-DE", { maximumFractionDigits: 1 })} KiB` : `${(size / (1024 * 1024)).toLocaleString("de-DE", { maximumFractionDigits: 1 })} MiB`;
function Avatar({ title, url, className = "" }) { const [failed, setFailed] = useState(false); useEffect(() => setFailed(false), [url]); return url && !failed ? <img className={`avatar avatar-image ${className}`} src={url} alt="" onError={() => setFailed(true)}/> : <span className={`avatar ${className}`}>{initials(title)}</span>; }
function ChatAvatar({ chat, url, onVisible }) { const ref = useRef(null); useEffect(() => { const node = ref.current; if (!node || !window.IntersectionObserver) return undefined; const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) { onVisible(chat); observer.disconnect(); } }, { root: node.closest(".chat-list"), rootMargin: "120px" }); observer.observe(node); return () => observer.disconnect(); }, [chat, onVisible]); return <span ref={ref}><Avatar title={chat.title} url={url}/></span>; }

function Surface({ controller }) {
  const s = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [search, setSearch] = useState("");
  const [theme, setTheme] = useState(null);
  const [showChats, setShowChats] = useState(true);
  const fixture = Boolean(document.querySelector('meta[name="whatsapp-test-fixture"]'));
  const [fileError, setFileError] = useState("");
  useEffect(() => {
    void controller.status();
    const poll = setInterval(() => {
      controller.expire();
      if (document.visibilityState === "visible") { void controller.loadMessages(); void controller.status(); }
    }, 15_000);
    const expiry = setInterval(() => controller.expire(), 1000);
    const onVisible = () => { if (document.visibilityState === "visible") controller.refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(poll); clearInterval(expiry); document.removeEventListener("visibilitychange", onVisible); };
  }, [controller]);
  useEffect(() => {
    if (!s.listLoaded && !search) return;
    const timer = setTimeout(() => controller.filter(search, controller.state.unreadOnly), 250);
    return () => clearTimeout(timer);
  }, [search, controller]);
  const locked = s.sendBusy || s.prepareBusy || s.fileBusy;
  const readOnly = s.status?.read_only === true;
  const error = s.mediaError || s.error || s.statusError;
  const choose = (chat) => { controller.select(chat); setShowChats(false); };
  const mediaOpener = useRef(null);
  const profileVisible = useCallback((chat) => { void controller.loadProfile(chat); }, [controller]);
  useEffect(() => { if (s.chat) void controller.loadProfile(s.chat); }, [controller, s.chat?.chat_id]);
  useEffect(() => { if (!s.media && mediaOpener.current?.isConnected) { mediaOpener.current.focus(); mediaOpener.current = null; } }, [s.media]);
  const toggleTheme = () => {
    const dark = theme === "dark" || (theme === null && (document.documentElement.dataset.theme === "dark" || matchMedia("(prefers-color-scheme: dark)").matches));
    setTheme(dark ? "light" : "dark");
  };
  return <div className={`app ${showChats ? "show-chats" : "show-thread"}`} data-theme={theme || undefined}>
    <header className="app-header">
      <div className="brand"><span className="mark"><Mark/></span><h1>WhatsApp Assistant</h1></div>
      <div className="header-actions">
        {fixture && <span className="fixture-label">Synthetische Testdaten</span>}
        <span className={`connection ${s.status?.connected ? "connected" : ""}`} role="status"><i/>{s.statusBusy && !s.status ? "Verbinde …" : s.status?.connected ? "Verbunden" : "Nicht verbunden"}</span>
        <button className="icon-button" onClick={() => controller.refresh()} aria-label="Alles aktualisieren" title="Alles aktualisieren"><Icon name="refresh"/></button>
        <button className="icon-button" onClick={toggleTheme} aria-label="Darstellung wechseln" title="Darstellung wechseln"><Icon name="sun"/></button>
      </div>
    </header>
    <div className="workspace">
      <aside className="chat-rail" aria-label="Chats">
        <h2>Chats</h2>
        <label className="search"><Icon name="search"/><input aria-label="Chats suchen" placeholder="Chats suchen" maxLength={200} value={search} onChange={(e) => setSearch(e.target.value)}/></label>
        <label className="unread-filter"><input type="checkbox" checked={s.unreadOnly} onChange={(e) => controller.filter(search, e.target.checked)}/>Nur ungelesene</label>
        <div className="chat-list">
          {!s.listLoaded && !s.listBusy && <div className="rail-empty"><p>Wähle einen bestehenden Chat aus.</p><button className="secondary" onClick={() => controller.loadChats()}>Chats anzeigen</button></div>}
          {s.listLoaded && !s.chats.length && !s.listBusy && <p className="empty-note">Keine passenden Chats.</p>}
          {s.chats.map((chat) => <button key={chat.chat_id} className={`chat-row ${s.chat?.chat_id === chat.chat_id ? "active" : ""}`} onClick={() => choose(chat)} disabled={locked} aria-pressed={s.chat?.chat_id === chat.chat_id}>
            <ChatAvatar chat={chat} url={s.profiles?.[chat.chat_id]} onVisible={profileVisible} />
            <span className="chat-label"><strong>{chat.title}</strong><span>{chat.chat_type === "group" ? "Gruppe" : "Einzelchat"}</span></span>
            <span className="chat-meta"><time>{time(chat.last_activity)}</time>{chat.unread_count > 0 && <span className="unread-count" aria-label={`${chat.unread_count} ungelesene Nachrichten`}>{chat.unread_count}</span>}</span>
          </button>)}
          {s.listBusy && <p className="loading" role="status">Chats werden geladen …</p>}
        </div>
        {s.listCursor && <button className="more-chats" disabled={s.listBusy} onClick={() => controller.loadChats(true)}><Icon name="plus"/>Weitere Chats laden</button>}
        {error && showChats && <p className="rail-error" role="alert">{error}</p>}
      </aside>
      <main className="thread">
        {!s.chat ? <section className="welcome"><span className="welcome-mark"><Mark/></span><h2>Deine Chats. Dein Arbeitsbereich.</h2><p>Öffne einen Chat, lies den Verlauf und prüfe deine Antwort vor dem Senden.</p><p className="muted">Für die KI werden nur Nachrichten übernommen, die du ausdrücklich auswählst.</p></section> : <>
          <header className="thread-header">
            <button className="icon-button back" onClick={() => setShowChats(true)} aria-label="Zur Chatliste" disabled={locked}><Icon name="back"/></button>
            <Avatar title={s.chat.title} url={s.profiles?.[s.chat.chat_id]} className="thread-avatar" />
            <div className="thread-title"><h2>{s.chat.title}</h2><p>{s.chat.chat_type === "group" ? "Gruppe" : "Einzelchat"}</p></div>
            <button className="secondary refresh-chat" onClick={() => controller.loadMessages()} disabled={s.readBusy}><Icon name="refresh"/><span>Aktualisieren</span></button>
          </header>
          <section className="message-scroll" aria-label="Nachrichtenverlauf" aria-busy={s.readBusy}>
            {(s.messageCursor || !s.historyComplete) && <button className="load-history" onClick={() => controller.loadMessages(true)} disabled={s.readBusy}>{s.readBusy ? "Nachrichten werden geladen …" : "Ältere Nachrichten laden"}</button>}
            {!s.historyComplete && <p className="coverage" role="status">Der Verlauf ist noch unvollständig. Lade weitere Nachrichten, um fortzufahren.</p>}
            {!s.messages.length && <p className="empty-note">{s.readBusy ? "Nachrichten werden geladen …" : "Keine Nachrichten im verfügbaren Zeitraum."}</p>}
            {s.messages.map((message, index) => <React.Fragment key={message.message_id}>
              {(index === 0 || date(s.messages[index - 1].timestamp) !== date(message.timestamp)) && <div className="date-divider">{date(message.timestamp)}</div>}
              <article className={`message-row ${message.from_me ? "own" : ""}`} data-testid="message">
                <label className="message-selection"><input type="checkbox" aria-label={`Nachricht von ${message.from_me ? "mir" : message.sender} um ${time(message.timestamp)} auswählen`} checked={s.selected.includes(message.message_id)} onChange={() => controller.toggleMessage(message.message_id)}/></label>
                {!message.from_me && <span className="avatar sender-avatar">{initials(message.sender)}</span>}
                <div className="message-content">{!message.from_me && <span className="sender">{message.sender}</span>}<div className="bubble">{message.has_media && <button className="media-placeholder" onClick={(event) => { mediaOpener.current = event.currentTarget; void controller.openMedia(message); }} disabled={locked || s.mediaBusy} aria-label={`${message.filename || mediaLabel(message)} öffnen`}><Icon name="file"/><span>{message.filename || mediaLabel(message)}</span>{message.size ? <small>{fileSize(message.size)}</small> : null}</button>}{message.text && <span className="message-text">{message.text}</span>}{!message.has_media && !message.text && <span className="message-text">Nachricht ohne Text</span>}<time>{time(message.timestamp)}</time></div></div>
              </article>
            </React.Fragment>)}
          </section>
          <section className="composer" aria-label="Antwort schreiben">
            <div className="ai-actions">
              <button className="secondary" disabled={!s.selected.length} onClick={() => controller.share("summary")}><Icon name="list"/><span>{s.native ? "Auswahl zusammenfassen" : "Auswahl für Zusammenfassung kopieren"}</span></button>
              <button className="secondary" disabled={!s.selected.length} onClick={() => controller.share("reply")}><Icon name="pencil"/><span>{s.native ? "Antwort entwerfen" : "Auswahl für Antwort kopieren"}</span></button>
              {s.selected.length > 0 && <span className="selection-count">{s.selected.length} ausgewählt</span>}
            </div>
            {s.mediaBusy && <p className="feedback" role="status">Medium wird geladen …</p>}
            {error && <p className="feedback error" role="alert" data-media-diagnostic={s.mediaError ? s.mediaDiagnostic || undefined : undefined}>{error}</p>}
            {s.notice && <p className="feedback success" role="status">{s.notice}</p>}
            {readOnly && <p className="feedback" role="status" data-testid="read-only-notice">Nur lesen: Antworten und Anhänge sind für diese Verbindung deaktiviert.</p>}
            {s.attachment && <div className="attachment-card" data-testid="attachment-draft">
              {s.attachment.preview ? <img src={s.attachment.preview} alt="" className="attachment-preview"/> : <span className="attachment-file" aria-hidden="true"><Icon name="paperclip"/></span>}
              <span className="attachment-details"><strong>{s.attachment.name}</strong><small>{s.attachment.mime || "Datei"} · {(s.attachment.size / (1024 * 1024)).toFixed(2)} MiB</small></span>
              <button className="icon-button" aria-label="Anhang entfernen" title="Anhang entfernen" onClick={() => controller.removeAttachment()} disabled={locked}><Icon name="close"/></button>
            </div>}
            {fileError && <p className="feedback error" role="alert">{fileError}</p>}
            <textarea aria-label="Antwort" placeholder="Antwort schreiben …" maxLength={10000} value={s.draft} onChange={(e) => controller.setDraft(e.target.value)} disabled={locked || readOnly || s.chat.can_send === false}/>
            <div className="composer-footer"><p><Icon name="info" size={17}/><span>Nachrichten der letzten 30 Tage.{readOnly ? " Nur lesen." : s.chat.can_send === false ? " Dieser Chat erlaubt keinen Versand." : ""}</span></p>
              <div className="composer-buttons"><label className="secondary attach-button" title="Bild oder Datei anhängen"><Icon name="paperclip"/><span>Anhang</span><input data-testid="attachment-input" type="file" hidden disabled={locked || readOnly || s.chat.can_send === false} onChange={async (e) => { const file = e.target.files?.[0]; e.target.value = ""; if (!file) return; setFileError(""); try { await controller.setAttachment(file); } catch (error) { setFileError(error instanceof Error ? error.message : "Die Datei konnte nicht gelesen werden."); } }}/></label>
              <button className="primary" onClick={() => controller.prepare()} disabled={locked || readOnly || (!s.draft.trim() && !s.attachment) || s.sendUnknown || s.chat.can_send === false || !s.status?.connected}><Icon name="send"/>{s.prepareBusy ? "Wird vorbereitet …" : s.sendBusy ? "Wird gesendet …" : "Antwort prüfen"}</button></div>
            </div>
          </section>
        </>}
      </main>
    </div>
    {s.media && <div className="dialog-backdrop" onClick={(event) => { if (event.target === event.currentTarget) controller.closeMedia(); }}><section className="media-dialog" role="dialog" aria-modal="true" aria-labelledby="media-title" tabIndex="-1" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); controller.closeMedia(); } if (event.key === "Tab") { const controls = event.currentTarget.querySelectorAll("button,a,[controls]"); const first = controls[0], last = controls[controls.length - 1]; if (first && ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last))) { event.preventDefault(); (event.shiftKey ? last : first).focus(); } } }}>
      <div className="media-dialog-head"><h2 id="media-title">{s.media.name || "Medium"}</h2><button className="icon-button" aria-label="Medium schließen" autoFocus onClick={() => controller.closeMedia()}><Icon name="close"/></button></div>
      {s.media.kind === "image" && <img className="media-view" src={s.media.blobUrl} alt={s.media.name || "Bild"}/>} {s.media.kind === "audio" && <audio className="media-view" controls src={s.media.blobUrl}/>} {s.media.kind === "video" && <video className="media-view" controls src={s.media.blobUrl}/>} {s.media.kind === "file" && <>{s.native ? <button className="primary media-download" onClick={() => controller.downloadMedia()}><Icon name="file"/>Datei herunterladen</button> : <a className="primary media-download" href={s.media.blobUrl} download={s.media.name || "medium"}><Icon name="file"/>Datei herunterladen</a>}</>}
    </section></div>}
    {s.prepared && <div className="dialog-backdrop"><section className="confirmation" role="dialog" aria-modal="true" aria-labelledby="confirmation-title" onKeyDown={(e) => {
      if (e.key === "Escape") { e.preventDefault(); controller.cancelPrepared(); }
      if (e.key === "Tab") {
        const buttons = e.currentTarget.querySelectorAll("button");
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }}>
      <h2 id="confirmation-title">Antwort senden?</h2><p>Empfänger: <strong>{s.prepared.recipient}</strong></p><p className="recipient-kind">{s.prepared.chat_type === "group" ? "Gruppenchat" : "Einzelchat"}</p>{s.prepared.attachment && <div className="prepared-attachment"><strong>{s.prepared.attachment.name}</strong><span>{s.prepared.attachment.mime} · {s.prepared.attachment.size} Bytes</span>{s.attachment?.preview && <img src={s.attachment.preview} alt="Vorschau des Anhangs"/>}</div>}<div className="prepared-text">{s.prepared.text || "(ohne Text, nur Anhang)"}</div><p className="muted">Es wird genau dieser Text und Anhang an diesen Chat gesendet.</p>
      <div className="dialog-actions"><button className="secondary" onClick={() => controller.cancelPrepared()} autoFocus>Zurück zum Bearbeiten</button><button className="primary" onClick={() => controller.send()}><Icon name="send"/>Jetzt senden</button></div>
    </section></div>}
  </div>;
}

const root = createRoot(document.getElementById("root"));
root.render(<div className="boot" role="status">WhatsApp Assistant wird geöffnet …</div>);
connectTransport().then((transport) => {
  const controller = new WhatsAppController(transport);
  root.render(<Surface controller={controller}/>);
  window.addEventListener("pagehide", () => controller.dispose(), { once: true });
}).catch(() => root.render(<div className="boot" role="alert"><h1>WhatsApp Assistant</h1><p>Dieser Host hat die Plugin-Oberfläche nicht verbunden.</p><p>Öffne die lokale Oberfläche über den in der Installationsanleitung beschriebenen Startbefehl.</p></div>));
