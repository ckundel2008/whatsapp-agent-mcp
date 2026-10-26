export const groupMembersProjection = async ({chatId}) => {
        const root=globalThis.window||globalThis;
        let mod;try{mod=root.require?.('WAWebGroupMetadataCollection');}catch{throw new Error('BOB_MEMBERS_MODULE_UNAVAILABLE');}
        const collection=mod;
        if(typeof collection?.find!=='function') return null;
        const cached=collection.get?.(chatId);
        if(cached){try{cached.stale=true;}catch{throw new Error('BOB_MEMBERS_REFRESH_INVALID');}}
        let metadata;try{metadata=await collection.find(chatId);}catch{throw new Error('BOB_MEMBERS_REFRESH_FAILED');}
        if(!metadata || metadata.stale!==false || metadata.hasIncompleteParticipantInformation===true) return null;
        const participants=metadata?.participants?.getModelsArray?.() || metadata?.participants?.models || metadata?.participants?._models;
        if(!Array.isArray(participants) || !Number.isSafeInteger(metadata.size) || metadata.size!==participants.length) return null;
        return participants.map(p=>p?.id?._serialized || null);
      };
