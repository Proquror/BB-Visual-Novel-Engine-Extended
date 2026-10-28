// Pins for HUD rebuild side effects:
//
// 1. The system-log («Система») and diary («Дневник») tabs keep their scroll
//    position across the renderSocialHud rebuild — the same contract the
//    characters panel already had. A recalculation-triggered re-render
//    (message received, event edited, etc.) must not yank the reading
//    position back to the top.
//
// 2. The moment-stamp animation cycle stops on detached stamps. A HUD rebuild
//    discards old .bb-moment-stamp-deletable nodes while their self-
//    rescheduling timer chain is pending; without a guard every render leaked
//    another immortal chain firing every ~6s on dead DOM nodes.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';

const source = readFileSync(new URL('../modules/hud.js', import.meta.url), 'utf8');

test('log and diary tabs preserve their scroll position across the HUD rebuild', () => {
    // System log: save before the innerHTML rebuild, restore after it.
    const logStart = source.indexOf("const logBox = document.getElementById('bb-hud-log')");
    const logEnd = source.indexOf('const copyBtn = logBox.querySelector');
    assert.ok(logStart >= 0 && logEnd > logStart, 'log block found');
    const logBlock = source.slice(logStart, logEnd);
    const logSave = logBlock.indexOf('const savedLogScrollTop = logBox.scrollTop');
    const logRebuild = logBlock.indexOf('logBox.innerHTML =');
    const logRestore = logBlock.lastIndexOf('logBox.scrollTop = savedLogScrollTop');
    assert.ok(logSave >= 0, 'log scroll is saved');
    assert.ok(logRebuild > logSave, 'log rebuild happens after the save');
    assert.ok(logRestore > logRebuild, 'log scroll is restored after the rebuild');

    // Diary: same contract.
    const momentsStart = source.indexOf("const momentsBox = document.getElementById('bb-hud-moments')");
    const momentsEnd = source.indexOf('syncToastContainerWithHud();', momentsStart);
    assert.ok(momentsStart >= 0 && momentsEnd > momentsStart, 'moments block found');
    const momentsBlock = source.slice(momentsStart, momentsEnd);
    const momentsSave = momentsBlock.indexOf('const savedMomentsScrollTop = momentsBox.scrollTop');
    const momentsRebuild = momentsBlock.indexOf('momentsBox.innerHTML =');
    const momentsRestore = momentsBlock.lastIndexOf('momentsBox.scrollTop = savedMomentsScrollTop');
    assert.ok(momentsSave >= 0, 'diary scroll is saved');
    assert.ok(momentsRebuild > momentsSave, 'diary rebuild happens after the save');
    assert.ok(momentsRestore > momentsRebuild, 'diary scroll is restored after the rebuild');
});

test('stamp animation cycle stops on detached stamps instead of rescheduling forever', () => {
    const cycleSource = source.slice(
        source.indexOf('function startStampCycle'),
        source.indexOf('function bindRelationshipEventButtons'),
    );
    assert.ok(cycleSource.includes('function startStampCycle'), 'cycle source sliced');

    const makeStamp = connected => {
        const classes = new Set();
        return {
            isConnected: connected,
            _bbStampTimers: null,
            classList: {
                add: name => classes.add(name),
                remove: name => classes.delete(name),
                contains: name => classes.has(name),
            },
            listeners: {},
            addEventListener(type, handler) { this.listeners[type] = handler; },
        };
    };

    const pending = [];
    const fakeSetTimeout = (fn, ms) => { pending.push({ fn, ms }); return pending.length; };
    const cleared = [];
    const sandbox = createContext({
        setTimeout: fakeSetTimeout,
        clearTimeout: id => cleared.push(id),
    });
    const root = { querySelectorAll: selector => selector.includes('bb-moment-stamp-deletable') ? [makeStamp(false), makeStamp(true)] : [] };
    sandbox.__run = null;
    runInContext(`${cycleSource}\n__run = startStampCycle;`, sandbox);
    sandbox.__run(root);

    // Two stamps armed: one already detached (rebuilt away), one live.
    assert.equal(pending.length, 2, 'one label timer per stamp');

    // Fire both label timers.
    const [detachedTimer, liveTimer] = pending.splice(0);
    detachedTimer.fn();
    liveTimer.fn();

    // The detached stamp must not schedule anything new: its chain is dead.
    // Only the live stamp proceeds to the 2s delete-hold stage.
    assert.equal(pending.filter(t => t.ms === 2000).length, 1, 'only the live stamp schedules the delete hold');
    const holdTimer = pending.splice(0)[0];
    assert.equal(holdTimer.ms, 2000);
    holdTimer.fn();
    assert.equal(pending.filter(t => t.ms === 1000).length, 1, 'live stamp schedules the cycle restart');
    const restartTimer = pending.splice(0)[0];
    restartTimer.fn();
    // The live chain re-arms the 3s label timer; nothing else was scheduled
    // on behalf of the detached stamp at any stage.
    assert.equal(pending.length, 1);
    assert.equal(pending[0].ms, 3000, 'live stamp re-arms the label timer');
});

// 3. Revealed memory pills («ещё N» pagination) survive the rebuild. Editing
//    or undoing a deep trace from a pill triggers recalculateAllStats → a
//    full charsBox re-render; before this fix the fresh markup collapsed
//    every section back to the 4-pill default, hiding the very entry the user
//    was working on. The save/restore pair now round-trips the shown count
//    per section (identity = section title, since the traits section comes
//    and goes), clamps to a shorter list and skips collapsed cards.
test('revealed memory pills survive the HUD rebuild triggered by a pill edit or undo', () => {
    const saveSource = source.slice(
        source.indexOf('function saveCardExpansionStates'),
        source.indexOf('function restoreCardExpansionStates'),
    );
    const restoreSource = source.slice(
        source.indexOf('function restoreCardExpansionStates'),
        source.indexOf('function detectNameOverflow'),
    );
    assert.ok(saveSource.includes('function saveCardExpansionStates'), 'save source sliced');
    assert.ok(restoreSource.includes('function restoreCardExpansionStates'), 'restore source sliced');
    // The restore must run on the fresh markup: after the innerHTML rebuild.
    const rebuildIdx = source.indexOf('charsBox.innerHTML =');
    const restoreCallIdx = source.indexOf('restoreCardExpansionStates(savedStates);');
    assert.ok(rebuildIdx > 0 && restoreCallIdx > rebuildIdx, 'card states are restored after the rebuild');

    const makeClassList = (initial = []) => {
        const set = new Set(initial);
        return { add: n => set.add(n), remove: n => set.delete(n), contains: n => set.has(n) };
    };
    const makeSection = (title, total, shown) => {
        const pills = Array.from({ length: total }, (_, i) => ({
            classList: makeClassList(i >= 4 ? ['bb-memory-hidden'] : []),
        }));
        const btn = {
            attrs: { 'data-shown': String(shown), 'data-total': String(total), 'data-step': '4' },
            classList: makeClassList(shown >= total ? ['bb-memory-show-more-done'] : []),
            html: 'stale',
            getAttribute(key) { return this.attrs[key] ?? null; },
            setAttribute(key, value) { this.attrs[key] = String(value); },
            set innerHTML(value) { this.html = value; },
            get innerHTML() { return this.html; },
        };
        return {
            querySelector(sel) {
                if (sel === '.bb-memory-show-more') return btn;
                if (sel === '.bb-memory-title') return { textContent: ` ${title} ` };
                return null;
            },
            querySelectorAll(sel) { return sel === '.bb-memory-pill' ? pills : []; },
            pills, btn,
        };
    };
    const makeCard = (name, expanded, sections) => ({
        classList: makeClassList(expanded ? ['expanded'] : []),
        getAttribute(key) { return key === 'data-char' ? name : null; },
        querySelectorAll(sel) { return sel === '.bb-memory-section' ? sections : []; },
        name, sections,
    });

    const sandbox = createContext({
        CSS: { escape: value => value },
        t: value => value,
    });
    runInContext(
        `const MEMORY_SHOW_LIMIT = 4;\nconst MEMORY_SHOW_MORE = 4;\n${saveSource}\n${restoreSource}\n__save = saveCardExpansionStates; __restore = restoreCardExpansionStates;`,
        sandbox,
    );
    const { __save, __restore } = sandbox;

    // --- Save side: Alex fully unfolded (12 deep), soft partly (6 of 6);
    // Sam collapsed at the default limit. ---
    const alexBefore = makeCard('Alex', true, [
        makeSection('Незабываемые события', 12, 12),
        makeSection('Мягкие следы', 6, 6),
    ]);
    const samBefore = makeCard('Sam', false, [makeSection('Незабываемые события', 8, 4)]);
    const states = __save({ querySelectorAll: sel => sel === '.bb-char-card' ? [alexBefore, samBefore] : [] });
    assert.deepEqual([...states.expanded], ['Alex'], 'only the expanded card is recorded as expanded');
    assert.deepEqual([...states.memoryShown].map(entry => ({ ...entry })), [
        { name: 'Alex', key: 'Незабываемые события', shown: 12 },
        { name: 'Alex', key: 'Мягкие следы', shown: 6 },
    ], 'unfolded counts are captured per section title, default/collapsed states skipped');

    // --- Rebuild simulation: fresh markup, pagination back at the default. ---
    const freshAlex = makeCard('Alex', false, [
        makeSection('Незабываемые события', 12, 4),
        makeSection('Мягкие следы', 6, 4),
    ]);
    const freshSam = makeCard('Sam', false, [makeSection('Незабываемые события', 8, 4)]);
    const bySel = sel => {
        const match = /\[data-char="(.+)"\]$/.exec(sel);
        const card = [freshAlex, freshSam].find(node => node.name === match?.[1]);
        return card || null;
    };
    const document = { querySelector: bySel };
    sandbox.document = document;
    __restore(states);

    assert.equal(freshAlex.classList.contains('expanded'), true, 'expansion is restored');
    const [deep, soft] = freshAlex.sections;
    deep.pills.forEach((pill, idx) => assert.ok(!pill.classList.contains('bb-memory-hidden'), `deep pill ${idx} re-revealed`));
    assert.equal(deep.btn.attrs['data-shown'], '12', 'deep button count restored');
    assert.equal(deep.btn.classList.contains('bb-memory-show-more-done'), true, 'deep button back in the done state');
    assert.ok(deep.btn.html.includes('fa-chevron-up') && deep.btn.html.includes('свернуть'), 'done label re-rendered');
    soft.pills.forEach((pill, idx) => assert.ok(!pill.classList.contains('bb-memory-hidden'), `soft pill ${idx} re-revealed`));
    assert.equal(soft.btn.attrs['data-shown'], '6', 'soft button count restored');

    // --- Clamp: the list shrank (an entry was deleted mid-session) → 5 left. ---
    const shrunkAlex = makeCard('Alex', true, [makeSection('Незабываемые события', 5, 4)]);
    sandbox.document = { querySelector: sel => sel.endsWith('"Alex"]') ? shrunkAlex : null };
    __restore(states);
    shrunkAlex.sections[0].pills.forEach((pill, idx) => assert.ok(!pill.classList.contains('bb-memory-hidden'), `shrunk pill ${idx} visible`));
    assert.equal(shrunkAlex.sections[0].btn.attrs['data-shown'], '5', 'shown clamps to the new total');

    // --- Partial unfold (8 of 12): pills 8..11 stay hidden, «ещё 4» label. ---
    const partial = { expanded: ['Alex'], editorOpen: [], memoryShown: [{ name: 'Alex', key: 'Незабываемые события', shown: 8 }] };
    const partialAlex = makeCard('Alex', false, [makeSection('Незабываемые события', 12, 4)]);
    sandbox.document = { querySelector: sel => sel.endsWith('"Alex"]') ? partialAlex : null };
    __restore(partial);
    partialAlex.sections[0].pills.forEach((pill, idx) => {
        assert.equal(pill.classList.contains('bb-memory-hidden'), idx >= 8, `partial pill ${idx} visibility`);
    });
    assert.equal(partialAlex.sections[0].btn.attrs['data-shown'], '8', 'partial count restored');
    assert.ok(partialAlex.sections[0].btn.html.includes('ещё 4'), 'remaining count is reflected in the label');
    assert.equal(partialAlex.sections[0].btn.classList.contains('bb-memory-show-more-done'), false, 'partial unfold is not the done state');

    // --- Collapsed cards are never over-revealed by a stale entry. ---
    const guard = { expanded: [], editorOpen: [], memoryShown: [{ name: 'Sam', key: 'Незабываемые события', shown: 8 }] };
    const guardSam = makeCard('Sam', false, [makeSection('Незабываемые события', 8, 4)]);
    sandbox.document = { querySelector: sel => sel.endsWith('"Sam"]') ? guardSam : null };
    __restore(guard);
    guardSam.sections[0].pills.forEach((pill, idx) => {
        assert.equal(pill.classList.contains('bb-memory-hidden'), idx >= 4, `collapsed card pill ${idx} stays at the default limit`);
    });
    assert.equal(guardSam.sections[0].btn.attrs['data-shown'], '4', 'collapsed card button untouched');
});
