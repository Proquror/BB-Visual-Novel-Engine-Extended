import { withRequestDeadline } from './requests.js';

// Keep image bytes on the Tavern server; metadata and branch history hold paths.
// Existing chats are converted only through the explicit, backed-up settings action.
const ASSET_PATH = /^\/?user\/images\/bb_vne_assets\/vne_[a-zA-Z0-9_-]+\.(png|jpeg|webp|gif|bmp)$/;
const INLINE_IMAGE = /^data:image\/(png|jpeg|jpg|webp|gif|bmp);base64,([A-Za-z0-9+/=\s]+)$/;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const fail = () => { throw new Error('IMAGE_STORAGE_FAILED'); };

function parseImage(value) {
    const match = INLINE_IMAGE.exec(value);
    if (!match || match[2].length > MAX_IMAGE_BYTES * 1.4) fail();
    const base64 = match[2].replace(/\s/g, '');
    let bytes;
    try { bytes = atob(base64); } catch { fail(); }
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) fail();
    return { format: match[1] === 'jpg' ? 'jpeg' : match[1], base64, bytes };
}

export function captureImageContext(getContext, getPersonaKey) {
    const initial = getContext();
    const metadata = initial.chatMetadata, chat = initial.chat;
    const key = context => JSON.stringify([context.getCurrentChatId?.() ?? context.chatId, context.characterId, context.groupId]);
    const identity = key(initial), persona = getPersonaKey(), length = chat?.length;
    return () => {
        const current = getContext();
        if (!metadata || !chat || (initial.getCurrentChatId?.() ?? initial.chatId) == null
            || current.chatMetadata !== metadata || current.chat !== chat || current.chat?.length !== length
            || key(current) !== identity || getPersonaKey() !== persona) throw new Error('IMAGE_CONTEXT_CHANGED');
    };
}

// Only explicit profile image fields and the branch image pool are eligible.
// Never rewrite arbitrary strings in memories, descriptions, or other extensions.
export function collectInlineImages(root) {
    const slots = [], seen = new WeakSet();
    const visit = (value, branchPool = false) => {
        if (!value || typeof value !== 'object' || seen.has(value)) return;
        seen.add(value);
        for (const [key, child] of Object.entries(value)) {
            if ((key === 'avatar' || key === 'avatarSource' || (branchPool && Array.isArray(value)))
                && typeof child === 'string' && child.startsWith('data:image/')) slots.push({ parent: value, key, value: child });
            else if (child && typeof child === 'object') visit(child, key === 'assets');
        }
    };
    visit(root);
    return slots;
}

export function imageMetadataRoots(metadata) {
    return Object.fromEntries(Object.entries(metadata).filter(([key]) => key.startsWith('bb_vn_')));
}

export function createImageStore({ getRequestHeaders, assertCurrent = () => {}, fetchImpl = globalThis.fetch }) {
    const uploaded = new Map();
    return {
        async save(value) {
            assertCurrent();
            if (!String(value || '').startsWith('data:image/')) return value;
            if (uploaded.has(value)) return uploaded.get(value);
            const image = parseImage(value);
            const id = 'vne_' + Date.now() + '_' + (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2));
            const path = await withRequestDeadline(async signal => {
                const response = await fetchImpl('/api/images/upload', {
                    method: 'POST', headers: getRequestHeaders(), signal,
                    body: JSON.stringify({ image: image.base64, format: image.format, ch_name: 'bb_vne_assets', filename: id }),
                });
                if (!response.ok) fail();
                const result = await response.json();
                // Reject unexpected paths, including external URLs and other users' files.
                const expected = '/user/images/bb_vne_assets/' + id + '.' + image.format;
                if (result.path !== expected && result.path !== expected.slice(1)) fail();
                assertCurrent();
                const verification = await fetchImpl(expected, { signal, cache: 'no-store' });
                if (!verification.ok) fail();
                const bytes = new Uint8Array(await verification.arrayBuffer());
                if (bytes.length !== image.bytes.length || bytes.some((byte, index) => byte !== image.bytes.charCodeAt(index))) fail();
                return expected;
            }, { timeoutMs: 60000 }).catch(error => {
                if (error.message === 'IMAGE_CONTEXT_CHANGED') throw error;
                fail();
            });
            assertCurrent();
            uploaded.set(value, path);
            return path;
        },
    };
}

// Prepare all files first, then commit the references together. No partial rewrite
// if an upload fails, the scene changes, or image fields were edited meanwhile.
export async function externalizeImages(root, store, { assertCurrent = () => {}, getRoot = () => root } = {}) {
    const slots = collectInlineImages(root), replacements = new Map();
    for (const slot of slots) {
        if (!replacements.has(slot.value)) replacements.set(slot.value, await store.save(slot.value));
    }
    assertCurrent();
    const current = collectInlineImages(getRoot());
    if (current.length !== slots.length || current.some((slot, index) => slot.parent !== slots[index].parent || slot.key !== slots[index].key || slot.value !== slots[index].value)) {
        throw new Error('IMAGE_CONTEXT_CHANGED');
    }
    for (const slot of slots) slot.parent[slot.key] = replacements.get(slot.value);
    return { images: replacements.size, references: slots.length };
}

export async function readManagedImage(value, { fetchImpl = globalThis.fetch } = {}) {
    if (!ASSET_PATH.test(value)) return value;
    return withRequestDeadline(async signal => {
        const response = await fetchImpl(value.startsWith('/') ? value : '/' + value, { signal });
        if (!response.ok) fail();
        const blob = await response.blob();
        if (blob.size > MAX_IMAGE_BYTES) fail();
        const format = value.split('.').pop();
        const base64 = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).split(',')[1]);
            reader.onerror = () => reject(new Error('IMAGE_STORAGE_FAILED'));
            reader.readAsDataURL(blob);
        });
        const data = `data:image/${format};base64,${base64}`;
        parseImage(data);
        return data;
    }, { timeoutMs: 60000 });
}

// Preserve the portable v1 JSON format: embed managed files only in the export,
// never in live metadata. Import uploads them before applying the snapshot.
export async function embedSnapshotImages(snapshot, options) {
    const copy = JSON.parse(JSON.stringify(snapshot)), loaded = new Map();
    for (const entry of Object.values(copy.data?.char_registry || copy.char_registry || {})) {
        for (const field of ['avatar', 'avatarSource']) {
            const value = entry[field];
            if (!ASSET_PATH.test(value)) continue;
            if (!loaded.has(value)) loaded.set(value, await readManagedImage(value, options));
            entry[field] = loaded.get(value);
        }
    }
    return copy;
}
