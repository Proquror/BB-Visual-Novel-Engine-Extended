import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { SourceTextModule, SyntheticModule, createContext, runInContext } from 'node:vm';

const image = bytes => 'data:image/png;base64,' + Buffer.from(bytes).toString('base64');
const first = image([0, 1, 2, 254]), second = image([30, 31, 32]);
async function harness({ failAt, corrupt, unexpectedPath, afterUpload, networkFailure } = {}) {
    const files = new Map(), calls = [];
    let uploads = 0, persona = 'a';
    const context = { chat: [{ mes: 'Scene' }], chatId: 'a', characterId: 1, chatMetadata: {}, getRequestHeaders: () => ({ 'Content-Type': 'application/json' }) };
    class Reader {
        readAsDataURL(blob) {
            blob.arrayBuffer().then(bytes => { this.result = 'data:' + blob.type + ';base64,' + Buffer.from(bytes).toString('base64'); this.onload(); }, () => this.onerror());
        }
    }
    const fetchImpl = async (url, init) => {
        calls.push({ url, init });
        if (url === '/api/images/upload') {
            if (networkFailure) throw new TypeError('Failed to fetch');
            const body = JSON.parse(init.body);
            const path = '/user/images/bb_vne_assets/' + body.filename + '.' + body.format;
            uploads++;
            files.set(path, Buffer.from(body.image, 'base64'));
            afterUpload?.(context);
            return { ok: uploads !== failAt, json: async () => ({ path: unexpectedPath || path }) };
        }
        const bytes = files.get(url);
        return { ok: !!bytes, arrayBuffer: async () => Uint8Array.from(corrupt ? [99] : bytes).buffer, blob: async () => new Blob([bytes], { type: 'image/png' }) };
    };
    const sandbox = createContext({ atob, Uint8Array, TextEncoder, console, setTimeout, clearTimeout, AbortController, FileReader: Reader, fetch: fetchImpl });
    const cache = new Map();
    const load = name => {
        if (cache.has(name)) return cache.get(name);
        const values = name === './i18n.js' ? { t: text => text } : name === './constants.js' ? { MODULE_NAME: 'BB-Visual-Novel' } : null;
        const module = values
            ? new SyntheticModule(Object.keys(values), function() { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }, { context: sandbox })
            : new SourceTextModule(readFileSync(new URL('../modules/' + name, import.meta.url), 'utf8'), { context: sandbox });
        cache.set(name, module); return module;
    };
    for (const name of ['./image-storage.js', './snapshot.js', './branch-state.js']) {
        const module = load(name); await module.link(load); await module.evaluate();
    }
    const api = cache.get('./image-storage.js').namespace;
    const guard = () => api.captureImageContext(() => context, () => persona);
    const store = assertCurrent => api.createImageStore({ getRequestHeaders: context.getRequestHeaders, assertCurrent, fetchImpl });
    return { api, context, files, calls, guard, store, sandbox, snapshot: cache.get('./snapshot.js').namespace, branches: cache.get('./branch-state.js').namespace, setPersona: value => { persona = value; }, get uploads() { return uploads; } };
}

// Execute the real registered HUD handler with only DOM/Tavern edges replaced.
async function cardHarness(options = {}) {
    let afterUpload = () => {};
    const h = await harness({ ...options, afterUpload: context => afterUpload(context) });
    const values = {
        '.bb-edit-display-name-input': { value: 'Alex' }, '.bb-edit-base-input': { value: '10' }, '.bb-edit-romance-input': { value: '2' },
        '.bb-edit-platonic-cb': { checked: false }, '.bb-edit-description-input': { value: 'Description' },
        '.bb-edit-avatar-source': { value: first }, '.bb-edit-avatar-data': { value: '' },
        '.bb-avatar-focus-x': { value: '50' }, '.bb-avatar-focus-y': { value: '50' }, '.bb-avatar-focus-zoom': { value: '100' },
    };
    const button = { disabled: false }, handlers = {}, saved = [], messages = [], audit = { cropped: 0, saves: 0, renames: 0 };
    const editor = { 0: { isConnected: true }, find: selector => ({ val: () => values[selector]?.value, is: () => values[selector]?.checked, toArray: () => Object.values(values) }) };
    Object.assign(h.sandbox, h.api, {
        charsBox: {}, bindCharacterEditorEvent: (_container, selector, _events, handler) => { handlers[selector] = handler; },
        SillyTavern: { getContext: () => h.context }, getCurrentPersonaScopeKey: () => 'a',
        chat_metadata: h.context.chatMetadata, bindActivePersonaState() {},
        getCharacterProfile: () => options.profile || { avatar: '', avatarSource: '', avatarCrop: { x: 50, y: 50, zoom: 100 } },
        createCroppedAvatarDataUrl: async () => { audit.cropped++; return second; }, AVATAR_OUTPUT_WIDTH: 432, AVATAR_OUTPUT_HEIGHT: 528,
        updateCharacterProfile: (name, profile) => saved.push({ name, profile }),
        renameCharacterRecord: () => { audit.renames++; return { ok: true }; },
        recalculateAllStats() {}, saveChatDebounced: () => { audit.saves++; },
        notifySuccess: message => messages.push(message), notifyInfo: message => messages.push(message), notifyError: message => messages.push(message),
        t: text => text, ui: (parts, ...values) => parts.reduce((s, p, i) => s + p + (values[i] ?? ''), ''),
        jQuery: selector => selector === button
            ? { attr: () => 'Alex', closest: () => editor }
            : { off() { return this; }, on: (_event, handler) => { handlers[selector] = handler; } },
    });
    const source = readFileSync(new URL('../modules/hud.js', import.meta.url), 'utf8');
    const start = source.indexOf("bindCharacterEditorEvent(charsBox, '.bb-btn-save-char'"), end = source.indexOf("jQuery('.bb-btn-crystallize-pos", start);
    assert.ok(start >= 0 && end > start);
    runInContext(source.slice(start, end), h.sandbox);
    return { ...h, values, button, saved, messages, audit, editor, click: () => handlers['.bb-btn-save-char'].call(button), afterUpload: callback => { afterUpload = callback; } };
}

test('real card Save stores file paths before applying profile or relationship changes', async () => {
    const h = await cardHarness();
    await h.click();
    assert.equal(h.saved.length, 1); assert.equal(h.audit.saves, 1); assert.equal(h.button.disabled, false);
    assert.match(h.saved[0].profile.avatar, /^\/user\/images\/bb_vne_assets\//);
    assert.match(h.saved[0].profile.avatarSource, /^\/user\/images\/bb_vne_assets\//);
    assert.equal(h.context.chatMetadata.bb_vn_char_bases.Alex, 10);
    assert.equal(h.context.chatMetadata.bb_vn_char_bases_romance.Alex, 2);
});

test('real card Save preserves name and scores when an upload fails or the editor changes', async () => {
    for (const scenario of ['failure', 'edit', 'chat']) {
        const h = await cardHarness(scenario === 'failure' ? { failAt: 2 } : {});
        h.values['.bb-edit-display-name-input'].value = 'Renamed';
        if (scenario === 'edit') h.afterUpload(() => { h.values['.bb-edit-description-input'].value = 'New edit'; });
        if (scenario === 'chat') h.afterUpload(context => { context.chatId = 'b'; });
        await h.click();
        assert.equal(h.saved.length, 0); assert.equal(h.audit.saves, 0); assert.equal(h.audit.renames, 0);
        assert.equal(JSON.stringify(h.context.chatMetadata), '{}'); assert.equal(h.button.disabled, false);
        assert.equal(h.messages.length, 1);
    }
});

test('editing description reuses a stored crop, while clearing the avatar clears both paths', async () => {
    const path = '/user/images/bb_vne_assets/vne_old.png';
    for (const clear of [false, true]) {
        const h = await cardHarness({ profile: { avatar: path, avatarSource: path, avatarCrop: { x: 50, y: 50, zoom: 100 } } });
        h.values['.bb-edit-avatar-source'].value = clear ? '' : path;
        await h.click();
        assert.equal(h.audit.cropped, 0); assert.equal(h.saved[0].profile.avatar, clear ? '' : path);
        assert.equal(h.saved[0].profile.avatarSource, clear ? '' : path);
        assert.equal(h.files.size, 0);
    }
});

async function settingsHarness(options = {}) {
    const h = await harness(options), handlers = {}, downloads = [], messages = [], audit = { saves: 0, applied: 0 };
    h.context.chatMetadata.bb_vn_char_registry = { a: { primary_name: 'Alex', avatar: first, avatarSource: second } };
    h.context.callPopup = async () => options.confirm !== false;
    h.context.substituteParams = value => value;
    const blobUrls = new Map();
    Object.assign(h.sandbox, h.api, {
        Blob, URL: { createObjectURL: blob => { const id = 'blob:' + blobUrls.size; blobUrls.set(id, blob); return id; }, revokeObjectURL() {} },
        document: { body: { appendChild() {} }, createElement: () => ({ click() { downloads.push({ filename: this.download, blob: blobUrls.get(this.href) }); }, remove() {} }) },
        window: { setTimeout: () => 0 },
        SillyTavern: { getContext: () => h.context }, getCurrentPersonaScopeKey: () => 'a',
        bindActivePersonaState: () => ({ scopeState: {} }), recalculateAllStats() {}, refreshSnapshotControls() {},
        saveChatDebounced: () => { audit.saves++; },
        confirmSnapshotFile: h.snapshot.confirmSnapshotFile, parseSnapshot: h.snapshot.parseSnapshot,
        importActivePersonaSnapshot: snapshot => { audit.applied++; return { characters: Object.keys(snapshot.data.characters).length }; },
        notifySuccess: message => messages.push(message), notifyInfo: message => messages.push(message), notifyError: message => messages.push(message),
        t: text => text, ui: (parts, ...values) => parts.reduce((s, p, i) => s + p + (values[i] ?? ''), ''), escapeHtml: value => value,
        jQuery: selector => ({ on: (event, handler) => { handlers[selector + ':' + event] = handler; }, val() { return this; }, trigger() {} }),
    });
    const source = readFileSync(new URL('../modules/settings.js', import.meta.url), 'utf8');
    const backupStart = source.indexOf('function downloadImageMigrationBackup'), backupEnd = source.indexOf('export function injectDebugData', backupStart);
    runInContext(source.slice(backupStart, backupEnd), h.sandbox);
    const start = source.indexOf("jQuery('#bb-social-store-images-btn').on"), end = source.indexOf("jQuery('#bb-social-clear-snapshot-btn').on", start);
    assert.ok(start >= 0 && end > start);
    runInContext(source.slice(start, end), h.sandbox);
    return { ...h, audit, downloads, messages, migrate: () => handlers['#bb-social-store-images-btn:click'].call({ disabled: false }),
        import: snapshot => handlers['#bb-social-snapshot-file:change'].call({ files: [{ name: 'test.json', size: 100, text: async () => JSON.stringify(snapshot) }] }) };
}

test('real migration button downloads the original full chat before saving file references', async () => {
    const h = await settingsHarness();
    const before = JSON.stringify(h.context.chatMetadata);
    await h.migrate();
    assert.equal(h.downloads.length, 1); assert.equal(h.audit.saves, 1);
    assert.match(h.downloads[0].filename, /before-image-storage.*\.jsonl$/);
    const rows = (await h.downloads[0].blob.text()).split('\n').map(row => JSON.parse(row));
    assert.equal(JSON.stringify(rows[0].chat_metadata), before);
    assert.equal(JSON.stringify(rows.slice(1)), JSON.stringify(h.context.chat));
    assert.equal(h.api.collectInlineImages(h.context.chatMetadata).length, 0);
    await h.migrate();
    assert.equal(h.downloads.length, 1, 'a repeated migration is a no-op');
});

test('cancelled migration does nothing; a failed migration retains images and its original backup', async () => {
    for (const options of [{ confirm: false }, { failAt: 2 }]) {
        const h = await settingsHarness(options), before = JSON.stringify(h.context.chatMetadata);
        await h.migrate();
        assert.equal(JSON.stringify(h.context.chatMetadata), before); assert.equal(h.audit.saves, 0);
        assert.equal(h.downloads.length, options.confirm === false ? 0 : 1);
        if (options.confirm === false) assert.equal(h.files.size, 0);
    }
});

test('real import button applies only after every image is stored, and preserves the old state on failure', async () => {
    const snapshot = { schema_version: 1, module: 'BB-Visual-Novel', data: { characters: { Alex: { affinity: 12 } }, char_registry: { a: { primary_name: 'Alex', avatar: first, avatarSource: second } } } };
    for (const options of [{}, { failAt: 2 }, { afterUpload: context => { context.chatId = 'b'; } }]) {
        const h = await settingsHarness(options), before = JSON.stringify(h.context.chatMetadata);
        await h.import(snapshot);
        assert.equal(h.audit.applied, Object.keys(options).length ? 0 : 1);
        assert.equal(h.audit.saves, h.audit.applied);
        assert.equal(JSON.stringify(h.context.chatMetadata), before);
    }
});

test('migration deduplicates live aliases, personas, baseline images and the historical image pool', async () => {
    const h = await harness(), registry = { a: { primary_name: 'Alex', avatar: first, avatarSource: second, description: first, relationshipStatus: 'Family' } };
    h.context.chatMetadata = {
        other_extension: { avatar: first },
        bb_vn_char_registry: registry,
        bb_vn_persona_states: { a: { char_registry: registry, snapshot_lineage: { assets: [first, second], revisions: [{ state: { char_registry: { a: { avatar: { __bb_vn_asset_ref: 0 } } } } }] } }, b: { char_registry: { b: { avatar: first } }, snapshot_restore_state: { char_registry: { a: { avatarSource: second } } } } },
    };
    const roots = () => h.api.imageMetadataRoots(h.context.chatMetadata), guard = h.guard();
    const result = await h.api.externalizeImages(roots(), h.store(guard), { assertCurrent: guard, getRoot: roots });
    assert.equal(result.images, 2); assert.equal(h.uploads, 2);
    const path = registry.a.avatar;
    assert.match(path, /^\/user\/images\/bb_vne_assets\/vne_/);
    assert.deepEqual([...h.files.get(path)], [0, 1, 2, 254]);
    assert.equal(registry.a.description, first); assert.equal(registry.a.relationshipStatus, 'Family');
    assert.equal(h.context.chatMetadata.other_extension.avatar, first);
    assert.equal(h.context.chatMetadata.bb_vn_persona_states.a.snapshot_lineage.assets[0], path);
    assert.equal(h.api.collectInlineImages(roots()).length, 0);
    await h.api.externalizeImages(roots(), h.store(guard), { assertCurrent: guard, getRoot: roots });
    assert.equal(h.uploads, 2, 'repeating migration does not re-upload files');
});

test('upload failure, corrupt bytes and unexpected paths leave every inline image intact', async () => {
    for (const options of [{ failAt: 2 }, { corrupt: true }, { networkFailure: true }, { unexpectedPath: 'https://elsewhere.example/image.png' }]) {
        const h = await harness(options), root = { a: { avatar: first }, b: { avatarSource: second } };
        const before = JSON.stringify(root);
        await assert.rejects(h.api.externalizeImages(root, h.store(h.guard())), /IMAGE_STORAGE_FAILED/);
        assert.equal(JSON.stringify(root), before);
    }
});

test('context guards reject chat, metadata, message count, persona and group changes', async () => {
    const changes = [h => { h.context.chatId = 'b'; }, h => { h.context.chatMetadata = {}; }, h => { h.context.chat = []; }, h => { h.context.chat.push({ mes: 'new' }); }, h => h.setPersona('b'), h => { h.context.groupId = 'group'; }];
    for (const change of changes) {
        const h = await harness(), assertCurrent = h.guard();
        change(h);
        assert.throws(assertCurrent, /IMAGE_CONTEXT_CHANGED/);
    }
    const h = await harness({ afterUpload: context => { context.chatId = 'b'; } });
    const root = { avatar: first };
    await assert.rejects(h.api.externalizeImages(root, h.store(h.guard())), /IMAGE_CONTEXT_CHANGED/);
    assert.equal(root.avatar, first);
});

test('concurrent edits or replacement of the registry abort the final commit', async () => {
    for (const replace of [false, true]) {
        const root = { registry: { avatar: first } };
        const h = await harness({ afterUpload: () => { if (replace) root.registry = { avatar: second }; else root.registry.avatar = second; } });
        const guard = h.guard();
        await assert.rejects(h.api.externalizeImages(root, h.store(guard), { assertCurrent: guard }), /IMAGE_CONTEXT_CHANGED/);
        assert.equal(root.registry.avatar, second);
    }
});

test('portable v1 export embeds files without touching live data and imports on another server', async () => {
    const source = await harness(), assertCurrent = source.guard();
    const snapshot = { schema_version: 1, module: 'BB-Visual-Novel', data: { characters: { Alex: { affinity: 12 } }, char_registry: { a: { primary_name: 'Alex', avatar: first, avatarSource: second, relationshipStatus: 'Family' } } } };
    await source.api.externalizeImages(snapshot, source.store(assertCurrent), { assertCurrent });
    const original = JSON.stringify(snapshot);
    const portable = await source.api.embedSnapshotImages(snapshot);
    assert.equal(JSON.stringify(snapshot), original);
    assert.equal(portable.data.char_registry.a.avatar, first);
    assert.equal(portable.data.char_registry.a.avatarSource, second);
    assert.equal(source.snapshot.parseSnapshot(portable).summary.format, 'v1');
    const destination = await harness(), guard = destination.guard();
    await destination.api.externalizeImages(portable, destination.store(guard), { assertCurrent: guard });
    assert.equal(destination.uploads, 2);
    assert.equal(portable.data.char_registry.a.relationshipStatus, 'Family');
    assert.deepEqual([...destination.files.get(portable.data.char_registry.a.avatar)], [0, 1, 2, 254]);
    await assert.rejects(destination.api.embedSnapshotImages(snapshot), /IMAGE_STORAGE_FAILED/, 'missing files must fail export rather than produce a broken backup');
});

test('branch revisions restore file paths after migration, preserving relationship data', async () => {
    const h = await harness(), large = image(Buffer.alloc(1600, 7));
    const scope = { char_bases: { Alex: 42 }, char_registry: { a: { primary_name: 'Alex', avatar: large } }, ignored_chars: [], platonic_chars: [] };
    h.branches.ensureBranchState(scope, { integrity: 'parent', chatLength: 1 });
    assert.equal(scope.snapshot_lineage.assets[0], large);
    await h.api.externalizeImages(scope, h.store(h.guard()));
    const path = scope.char_registry.a.avatar;
    const branch = JSON.parse(JSON.stringify(scope));
    h.branches.ensureBranchState(branch, { integrity: 'branch', chatLength: 1, isBranch: true });
    assert.equal(branch.char_registry.a.avatar, path);
    assert.equal(branch.char_bases.Alex, 42);
    assert.equal(h.api.collectInlineImages(branch).length, 0);
});

test('large legacy portable snapshots are accepted within the new bounded limit', async () => {
    const h = await harness();
    const snapshot = { characters: { Alex: { affinity: 4 } }, char_registry: { a: { primary_name: 'Alex', avatarSource: 'data:image/png;base64,' + 'A'.repeat(22 * 1024 * 1024) } } };
    // Parse validation remains separate from upload limits for each individual image.
    assert.equal(h.snapshot.parseSnapshot(snapshot).summary.characters, 1);
    await assert.rejects(h.store(h.guard()).save('data:image/png;base64,?'), /IMAGE_STORAGE_FAILED/);
    await assert.rejects(h.store(h.guard()).save(snapshot.char_registry.a.avatarSource), /IMAGE_STORAGE_FAILED/);
    assert.equal(h.uploads, 0);
});
