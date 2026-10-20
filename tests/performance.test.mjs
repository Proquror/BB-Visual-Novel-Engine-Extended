import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';

const root = new URL('../modules/', import.meta.url);
async function harness() {
    let saves = 0;
    const audit = { scans: 0, pairs: 0, personaCandidates: 0, normalizations: 0, strips: 0 };
    const metadata = {};
    const context = { chat: [], chatId: 'test', name1: 'Player', user_avatar: 'player.png' };
    context.substituteParams = text => text.replaceAll('{{user}}', context.name1);
    const sandbox = createContext({ audit, Event, TextEncoder, console, setTimeout, clearTimeout,
        SillyTavern: { getContext: () => context }, window: {}, document: { querySelector: () => null }, jQuery: () => ({ val: () => null }) });
    const mocks = {
        '../../../../../script.js': { chat_metadata: metadata, saveChatDebounced: () => saves++, setExtensionPrompt() {}, extension_prompt_roles: { SYSTEM: 0 }, extension_prompt_types: { IN_CHAT: 0 }, callPopup: async () => false },
        '../../../../extensions.js': { extension_settings: { 'BB-Visual-Novel': {} } },
        './generator.js': { buildChoiceContextPrompt: () => '', getActiveChoiceContext: () => null, tryBindPendingChoiceContextToMessage: () => false },
        './toasts.js': { showStoryMomentToast() {}, notifySuccess() {}, notifyInfo() {}, notifyError() {}, pickToastMoment: (a, b) => b, getMomentToastPriority: () => 0 },
    };
    const cache = new Map();
    function load(name) {
        if (cache.has(name)) return cache.get(name);
        const values = mocks[name];
        // Count real full-history indexing calls without adding production telemetry.
        const source = values ? '' : readFileSync(new URL(name, root), 'utf8');
        const instrumented = name === './social.js' ? source
            .replace('function buildScopeOwnershipIndex(chat = []) {', 'function buildScopeOwnershipIndex(chat = []) { audit.scans++;')
            .replace('const score = scoreCharacterMatch(left.primary_name, right.primary_name);', 'audit.pairs++; const score = scoreCharacterMatch(left.primary_name, right.primary_name);')
            .replace('function getUserCharacterNameCandidates() {', 'function getUserCharacterNameCandidates() { audit.personaCandidates++;')
            .replace(/const normalized = source\r?\n/, 'audit.normalizations++; const normalized = source\n')
            .replace(/const stripped = source\r?\n/, 'audit.strips++; const stripped = source\n')
            + '\nexport const auditOperation = withScopeOwnershipCache; export const auditUserName = isUserPersonaCharacterName; export const auditReference = textContainsCharacterReference;'
            : source;
        const module = values
            ? new SyntheticModule(Object.keys(values), function() { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }, { context: sandbox })
            : new SourceTextModule(instrumented, { context: sandbox, identifier: name });
        cache.set(name, module); return module;
    }
    const social = load('./social.js'); await social.link(load); await social.evaluate();
    const queue = load('./recalculation-queue.js'); await queue.link(load); await queue.evaluate();
    return { api: social.namespace, createQueue: queue.namespace.createRecalculationQueue, metadata, context, audit, state: cache.get('./state.js').namespace, get saves() { return saves; } };
}

function fillChat(h, count = 100) {
    const scope = h.api.getCurrentPersonaScopeKey();
    for (let index = 0; index < count; index++) h.context.chat.push(index % 2 === 0
        ? { is_user: true, name: 'Player', force_avatar: 'player.png', mes: 'Hello' }
        : { name: 'Alex', mes: 'Alex replies.', swipe_id: 0, extra: { bb_social_swipes: { 0: [{ name: 'Alex', scope, friendship_impact: 'none', romance_impact: 'none', role_dynamic: 'Friend', reason: 'Contact' }] } } });
    return scope;
}

test('unchanged persona polling does not index a long chat or schedule saves', async () => {
    const h = await harness(); const scope = fillChat(h, 1000);
    const saves = h.saves; h.audit.scans = 0;
    for (let index = 0; index < 100; index++) assert.equal(h.api.getCurrentPersonaScopeKey(), scope);
    assert.equal(h.audit.scans, 0); assert.equal(h.saves, saves);
});

test('multi-persona recalculation shares one index and preserves neutral contact data', async () => {
    const h = await harness(); fillChat(h);
    h.metadata.bb_vn_persona_states.other = {};
    h.audit.scans = 0; h.api.recalculateAllStats(false);
    assert.equal(h.audit.scans, 1);
    assert.equal(h.state.currentCalculatedStats.Alex.affinity, 0);
    assert.equal(h.state.currentCalculatedStats.Alex.status, 'Friend');
    h.audit.scans = 0; h.api.getCombinedSocial();
    assert.equal(h.audit.scans, 1);
});

test('ownership is refreshed after same-length message edits and chat replacement', async () => {
    const h = await harness(); const scope = fillChat(h, 2);
    h.metadata.bb_vn_persona_states.discovered = {};
    h.api.recalculateAllStats(false);
    assert.equal(h.api.bindActivePersonaState().aliasSet.has('discovered'), false);
    h.context.chat[1].extra.bb_social_swipes[0][0].scope = 'discovered';
    h.audit.scans = 0; h.api.recalculateAllStats(false);
    assert.ok(h.audit.scans > 0);
    assert.equal(h.api.bindActivePersonaState().aliasSet.has('discovered'), true);
    assert.equal(h.state.currentCalculatedStats.Alex.status, 'Friend');
    const binding = h.metadata.bb_vn_persona_bindings;
    h.context.chat = []; h.context.chatId = 'other-chat';
    h.metadata.bb_vn_persona_states = {}; h.metadata.bb_vn_persona_bindings = {};
    h.api.getCurrentPersonaScopeKey();
    assert.notEqual(h.metadata.bb_vn_persona_bindings, binding);
    assert.ok(h.metadata.bb_vn_persona_states[scope]);
});

test('polling resolves switched personas and returns to the original binding', async () => {
    const h = await harness(); const scope = fillChat(h, 2);
    const originalRef = Object.keys(h.metadata.bb_vn_persona_bindings)[0];
    h.context.name1 = 'Other'; h.context.user_avatar = 'other.png';
    h.api.getCurrentPersonaScopeKey();
    assert.equal(Object.keys(h.metadata.bb_vn_persona_bindings).length, 2);
    h.context.name1 = 'Player'; h.context.user_avatar = 'player.png';
    h.audit.scans = 0;
    assert.equal(h.api.getCurrentPersonaScopeKey(), scope);
    assert.equal(h.metadata.bb_vn_persona_bindings[originalRef].scope_key, scope);
    assert.equal(h.audit.scans, 0);
});

test('persona polling preserves the latest user-message identity fallback', async () => {
    const h = await harness(); const scope = fillChat(h, 2);
    delete h.context.user_avatar;
    h.audit.scans = 0;
    assert.equal(h.api.getCurrentPersonaScopeKey(), scope);
    assert.equal(h.audit.scans, 0);
    h.context.chat[0].force_avatar = 'different.png';
    h.api.getCurrentPersonaScopeKey();
    assert.equal(Object.keys(h.metadata.bb_vn_persona_bindings).length, 2);
});

test('a failed render releases the operation cache before the next calculation', async () => {
    const h = await harness(); fillChat(h, 2);
    h.metadata.bb_vn_persona_states.discovered = {};
    h.api.setRenderHudCallback(() => { throw new Error('render failed'); });
    assert.throws(() => h.api.recalculateAllStats(false), /render failed/);
    h.context.chat[1].extra.bb_social_swipes[0][0].scope = 'discovered';
    h.api.setRenderHudCallback(() => {});
    h.audit.scans = 0; h.api.recalculateAllStats(false);
    assert.ok(h.audit.scans > 0);
    assert.equal(h.api.bindActivePersonaState().aliasSet.has('discovered'), true);
});

function fillRegistry(h) {
    const { scopeState } = h.api.bindActivePersonaState();
    scopeState.char_registry = Object.fromEntries(['Alex', 'Beatrice', 'Cyrus'].map((name, index) =>
        [String(index), { id: String(index), primary_name: name, aliases: [], created_at: index + 1 }]));
    return scopeState;
}

test('unchanged roster compares pairs once despite repeated profile reads and avatar edits', async () => {
    const h = await harness(), scope = fillRegistry(h);
    h.api.bindActivePersonaState(); assert.equal(h.audit.pairs, 3);
    h.audit.pairs = 0;
    for (let i = 0; i < 30; i++) { h.api.bindActivePersonaState(); h.api.getCharacterProfile('Alex'); }
    h.api.updateCharacterProfile('Alex', { description: 'New description', avatar: '/user/images/a.png' });
    h.api.bindActivePersonaState();
    assert.equal(h.audit.pairs, 0);
    assert.equal(scope.char_registry['0'].description, 'New description');
});

test('name, creation date, addition, deletion and suggestion edits invalidate pair comparisons', async () => {
    const h = await harness(), scope = fillRegistry(h);
    h.api.bindActivePersonaState();
    const check = (change, count) => {
        h.audit.pairs = 0; change(); h.api.bindActivePersonaState(); assert.equal(h.audit.pairs, count);
        h.audit.pairs = 0; h.api.bindActivePersonaState(); assert.equal(h.audit.pairs, 0);
    };
    check(() => { scope.char_registry['0'].primary_name = 'Alice'; }, 3);
    check(() => { scope.char_registry['0'].aliases.push('Alex'); }, 0);
    check(() => { scope.char_registry['0'].created_at = 99; }, 3);
    check(() => { scope.char_registry.extra = { id: 'extra', primary_name: 'Dorian', aliases: [] }; }, 6);
    check(() => { delete scope.char_registry.extra; }, 3);
    check(() => { scope.merge_suggestions.push({ source: 'Other', target: 'Someone' }); }, 3);
    check(() => { scope.merge_suggestions[0].source = 'Changed'; }, 3);
    check(() => { scope.merge_suggestions = []; }, 3);
    check(() => { scope.char_registry = { a: { id: 'a', primary_name: 'New' }, b: { id: 'b', primary_name: 'Roster' } }; }, 1);
});

test('registry coverage honors normalized aliases and picks up newly known names', async () => {
    const h = await harness(), scope = fillRegistry(h);
    scope.char_registry['0'].aliases = ['Alexander']; scope.char_bases['Alexander'] = 15;
    h.api.bindActivePersonaState(); assert.equal(Object.keys(scope.char_registry).length, 3);
    scope.char_bases['Dorothea'] = 5;
    h.api.bindActivePersonaState(); assert.equal(Object.keys(scope.char_registry).length, 4);
    assert.equal(h.api.getCharacterProfile('Alexander').description, '');
});

test('a replaced persona state has its own comparison cache', async () => {
    const h = await harness(); fillRegistry(h); h.api.bindActivePersonaState();
    const key = h.api.getCurrentPersonaScopeKey();
    h.metadata.bb_vn_persona_states[key] = JSON.parse(JSON.stringify(h.metadata.bb_vn_persona_states[key]));
    h.audit.pairs = 0; h.api.bindActivePersonaState(); assert.equal(h.audit.pairs, 3);
});

test('prompt reads flush pending work, while a calculation does not recursively flush itself', async () => {
    const h = await harness(); fillChat(h, 2);
    let flushes = 0;
    h.api.setSocialPromptFlushCallback(() => { flushes++; });
    h.api.getCombinedSocial(); assert.equal(flushes, 1);
    h.api.recalculateAllStats(false); assert.equal(flushes, 1);
    h.api.setRenderHudCallback(() => { throw new Error('render failed'); });
    assert.throws(() => h.api.recalculateAllStats(false), /render failed/);
    h.api.getCombinedSocial(); assert.equal(flushes, 2, 'failed calculations release the read guard');
});

test('coalesced real calculations preserve scores, memories and the full prompt after same-length edits', async () => {
    const direct = await harness(), queued = await harness();
    for (const h of [direct, queued]) {
        fillChat(h, 4);
        for (const index of [1, 3]) h.context.chat[index].extra.bb_social_swipes[0][0].friendship_impact = 'minor_positive';
    }
    const timers = new Map(); let id = 0, calculations = 0;
    const queue = queued.createQueue({ getContext: () => queued.context, getPersonaKey: queued.api.getCurrentPersonaScopeKey,
        recalculate: flag => { calculations++; queued.api.recalculateAllStats(flag); },
        setTimer: callback => { timers.set(++id, callback); return id; }, clearTimer: id => timers.delete(id) });
    queued.api.setSocialPromptFlushCallback(queue.flush);
    direct.api.recalculateAllStats(true);
    queue.request(true); queue.request(false); queue.request(true);
    assert.equal(timers.size, 1);
    assert.equal(queued.api.getCombinedSocial(), direct.api.getCombinedSocial());
    assert.equal(calculations, 1); assert.equal(timers.size, 0);
    for (const h of [direct, queued]) {
        const update = h.context.chat[3].extra.bb_social_swipes[0][0];
        update.friendship_impact = 'minor_negative'; update.reason = 'Changed reason';
    }
    direct.api.recalculateAllStats(false); queue.request(false);
    assert.equal(queued.api.getCombinedSocial(), direct.api.getCombinedSocial());
    assert.equal(calculations, 2);
    assert.equal(queued.state.currentCalculatedStats.Alex.affinity, direct.state.currentCalculatedStats.Alex.affinity);
    assert.equal(JSON.stringify(queued.state.currentCalculatedStats.Alex.memories), JSON.stringify(direct.state.currentCalculatedStats.Alex.memories));
});

test('scene scans reuse cleaned text across characters only inside the current operation', async () => {
    const h = await harness(), scope = fillRegistry(h);
    const text = '<div class="bb-vn-data">Cyrus</div>Alex greets Beatrice.';
    h.audit.strips = 0;
    h.api.auditOperation(() => {
        assert.equal(h.api.auditReference(text, 'Alex', scope), true);
        const normalizations = h.audit.normalizations;
        assert.equal(h.api.auditReference(text, 'Alex', scope), true);
        assert.equal(h.audit.normalizations, normalizations, 'repeated lookups reuse string normalization');
        assert.equal(h.api.auditReference(text, 'Beatrice', scope), true);
        assert.equal(h.api.auditReference(text, 'Cyrus', scope), false);
        assert.equal(h.audit.strips, 1);
        assert.equal(h.api.auditReference(text.replace('Alex', 'Dora'), 'Alex', scope), false);
        assert.equal(h.audit.strips, 2, 'same-length edits use the complete new text');
    });
    h.api.auditOperation(() => h.api.auditReference(text, 'Alex', scope));
    assert.equal(h.audit.strips, 3, 'a subsequent operation rebuilds the text cache');
});

test('persona candidate names are computed once per operation and refresh after persona edits', async () => {
    const h = await harness();
    let personaText = 'Name: Alice';
    h.context.substituteParams = text => text.replaceAll('{{user}}', h.context.name1).replaceAll('{{persona}}', personaText);
    h.audit.personaCandidates = 0;
    h.api.auditOperation(() => {
        for (let i = 0; i < 100; i++) {
            assert.equal(h.api.auditUserName('ＡＬＩＣＥ'), true);
            assert.equal(h.api.auditUserName('Cyrus'), false);
        }
    });
    assert.equal(h.audit.personaCandidates, 1);
    personaText = 'Name: Cyrus';
    h.api.auditOperation(() => {
        assert.equal(h.api.auditUserName('Alice'), false);
        assert.equal(h.api.auditUserName('Cyrus'), true);
    });
    assert.equal(h.audit.personaCandidates, 2);
    h.context.name1 = 'Other player';
    h.api.auditOperation(() => assert.equal(h.api.auditUserName('Other player'), true));
    assert.equal(h.audit.personaCandidates, 3);
});

test('failed operations release persona and normalized-text caches', async () => {
    const h = await harness(), scope = fillRegistry(h);
    const run = () => h.api.auditOperation(() => {
        h.api.auditUserName('Player'); h.api.auditReference('Alex speaks.', 'Alex', scope);
        throw new Error('operation failed');
    });
    h.audit.personaCandidates = 0; h.audit.strips = 0;
    assert.throws(run, /operation failed/); assert.throws(run, /operation failed/);
    assert.equal(h.audit.personaCandidates, 2); assert.equal(h.audit.strips, 2);
});
