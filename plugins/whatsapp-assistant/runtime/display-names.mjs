/** Fixed, self-contained browser helper; reads local models only. No fetching,
 * contact enumeration or message bodies. Injected by the reviewed bootstrap. */
export function resolveAssistantName({ kind, chat, message } = {}) {
  const root = globalThis.window || globalThis;
  const read = (object, key) => {
    try { return object?.[key] ?? object?.attributes?.[key]; } catch { return undefined; }
  };
  const text = (value) => typeof value === "string" ? value.trim() : "";
  const widText = (wid) => typeof wid === "string" ? wid : text(read(wid, "_serialized"));
  const module = (name) => { try { return root.require?.(name); } catch { return undefined; } };
  const technical = (value) => /@(?:c\.us|s\.whatsapp\.net|lid|g\.us)$/i.test(value)
    || /^[+\d\s().-]{7,}$/.test(value) || /^(unknown|unbekannt)$/i.test(value);
  const choose = (values, fallback) => values.map(text).find((value) => value && !technical(value)) || fallback;
  const id = kind === "chat" ? read(chat, "id")
    : read(message, "author") || read(read(message, "id"), "participant") || read(message, "from");
  const serialized = widText(id);
  if (kind === "chat" && (read(chat, "isGroup") || serialized.endsWith("@g.us"))) {
    // A numeric group title can be intentional. Never replace it with a contact.
    return text(read(chat, "formattedTitle")) || text(read(chat, "name")) || serialized;
  }
  const contacts = root.Store?.Contact || module("WAWebCollections")?.Contact;
  const candidates = [];
  const add = (contact) => { if (contact && !candidates.includes(contact)) candidates.push(contact); };
  const lookup = (wid) => { if (!widText(wid)) return; try { add(contacts?.get?.(wid)); } catch { /* optional local compatibility data */ } };
  lookup(id);
  if (serialized && id !== serialized) lookup(serialized);
  try {
    const factory = root.Store?.WidFactory || module("WAWebWidFactory");
    const wid = typeof id === "object" ? id : factory?.createWid?.(serialized);
    const alternate = wid && module("WAWebApiContact")?.getAlternateUserWid?.(wid);
    if (alternate && widText(alternate) !== serialized) {
      lookup(alternate);
      const alternateId = widText(alternate);
      if (alternateId) lookup(alternateId);
    }
  } catch { /* An absent LID/phone mapping must not break reading. */ }
  add(kind === "chat" ? read(chat, "contact") : read(message, "senderObj"));
  if (kind === "sender") add(read(message, "sender"));
  const getters = module("WAWebContactGetters");
  const contactValue = (contact, getter, field) => {
    try { return text(getters?.[getter]?.(contact)) || text(read(contact, field)); }
    catch { return text(read(contact, field)); }
  };
  // Saved address-book names outrank profile names, including through PN/LID aliases.
  const saved = candidates.flatMap((contact) => [contactValue(contact, "getName", "name"), contactValue(contact, "getShortName", "shortName")]);
  const profile = candidates.flatMap((contact) => [contactValue(contact, "getPushname", "pushname"), contactValue(contact, "getVerifiedName", "verifiedName"), read(contact, "formattedName")]);
  const legacy = kind === "chat" ? [read(chat, "formattedTitle"), read(chat, "name")]
    : [read(message, "notifyName")];
  const fallback = legacy.map(text).find(Boolean) || profile.map(text).find(Boolean) || serialized || "Unbekannt";
  return choose([...saved, ...legacy, ...profile], fallback);
}
