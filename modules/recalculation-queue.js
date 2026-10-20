// Merge terminal notifications for one response without caching message contents.
// The calculation reads the latest state; immediate edits and scene changes cancel it.
export function createRecalculationQueue({ getContext, getPersonaKey, recalculate, setTimer = setTimeout, clearTimer = clearTimeout }) {
    let pending = null, timer = null;
    const scene = () => {
        const context = getContext();
        return [context.chat, context.chatMetadata, context.getCurrentChatId?.() ?? context.chatId,
            context.characterId, context.groupId, getPersonaKey()];
    };
    const sameScene = (left, right) => left.every((value, index) => value === right[index]);
    const cancel = () => {
        if (timer !== null) clearTimer(timer);
        timer = null;
        pending = null;
    };
    const flush = () => {
        if (!pending) return false;
        const task = pending;
        cancel();
        if (!sameScene(task.scene, scene())) return false;
        recalculate(task.isNewMessage);
        return true;
    };
    return {
        cancel, flush,
        request(isNewMessage = false) {
            const current = scene();
            if (pending && !sameScene(pending.scene, current)) cancel();
            if (pending) { pending.isNewMessage ||= isNewMessage; return; }
            pending = { scene: current, isNewMessage };
            // A short window joins received/rendered/ended bursts; prompt reads flush it.
            timer = setTimer(flush, 16);
        },
    };
}
