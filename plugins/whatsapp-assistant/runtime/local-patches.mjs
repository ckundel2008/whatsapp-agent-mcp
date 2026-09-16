export const LOCAL_OPENWA_PATCH_TAG = "local-bootstrap-v1";

export const LOCAL_OPENWA_PATCHES = Object.freeze([
  `(() => {
    const collectionSize = (collection) => {
      if (Array.isArray(collection)) return collection.length;
      if (Array.isArray(collection?._models)) return collection._models.length;
      if (typeof collection?.length === "number") return collection.length;
      return 0;
    };
    window.moi = () => {
      const ownId = window.Store?.Me?.getMaybeMePnUser?.()
        || window.Store?.Me?.getMaybeMeLidUser?.()
        || window.Store?.Me?.me
        || window.Store?.Me?.wid
        || window.Store?.User?.getMaybeMeUser?.()
        || window.Store?.User?.getMeUser?.()
        || window.Store?.Conn?.wid
        || "";
      return ownId?._serialized || String(ownId || "");
    };
    window.o = () => "";
    window.WAPI = window.WAPI || {};
    window.WAPI.launchMetrics = () => {
      const chats = window.Store?.Chat;
      const contacts = window.Store?.Contact;
      const messages = Array.isArray(chats?._models)
        ? chats._models.reduce((total, chat) => total + collectionSize(chat?.msgs), 0)
        : 0;
      return {
        isBiz: Boolean(window.Store?.Conn?.isBusiness),
        isMd: true,
        contacts: collectionSize(contacts),
        chats: collectionSize(chats),
        messages,
        purged: {},
      };
    };
    window.WAPI.getMe = () => {
      const rawMe = window.Store?.Me?.getMaybeMePnUser?.()
        || window.Store?.Me?.getMaybeMeLidUser?.()
        || window.Store?.Me?.me
        || window.Store?.Me?.wid
        || window.Store?.User?.getMaybeMeUser?.()
        || window.Store?.User?.getMeUser?.()
        || window.Store?.Conn?.wid
        || "";
      const serialized = rawMe?._serialized || String(rawMe || "");
      const [user = "", server = ""] = serialized.split("@");
      const me = { _serialized: serialized, user, server };
      const contact = window.Store?.Contact?.get?.(rawMe);
      const attributes = contact?.attributes || contact || {};
      const cleaned = typeof window.WAPI.quickClean === "function"
        ? window.WAPI.quickClean(attributes)
        : attributes;
      return { ...cleaned, me };
    };
    window.WAPI.getState = () => window.Store?.State?.Socket?.state
      || window.Store?.State?.default?.state
      || "UNAVAILABLE";
  })()`,
]);
