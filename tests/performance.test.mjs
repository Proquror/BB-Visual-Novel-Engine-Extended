import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';

const root = new URL('../modules/', import.meta.url);
async function harness() {
    let saves = 0;
    const audit = { scans: 0 };
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
        const instrumented = name === './social.js' ? source.replace('function buildScopeOwnershipIndex(chat = []) {', 'function buildScopeOwnershipIndex(chat = []) { audit.scans++;') : source;
        const module = values
            ? new SyntheticModule(Object.keys(values), function() { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }, { context: sandbox })
            : new SourceTextModule(instrumented, { context: sandbox, identifier: name });
        cache.set(name, module); return module;
    }
    const social = load('./social.js'); await social.link(load); await social.evaluate();
    return { api: social.namespace, metadata, context, audit, state: cache.get('./state.js').namespace, get saves() { return saves; } };
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
