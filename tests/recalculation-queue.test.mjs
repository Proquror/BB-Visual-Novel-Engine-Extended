import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('../modules/recalculation-queue.js', import.meta.url), 'utf8');
const { createRecalculationQueue } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
function harness() {
    const context = { chat: [{ mes: 'Before', swipe_id: 0 }], chatMetadata: {}, chatId: 'a', characterId: 1 };
    let persona = 'a', id = 0, error = false;
    const timers = new Map(), calls = [];
    const queue = createRecalculationQueue({ getContext: () => context, getPersonaKey: () => persona,
        recalculate: isNew => { if (error) throw new Error('render failed'); calls.push({ isNew, text: context.chat[0]?.mes, swipe: context.chat[0]?.swipe_id }); },
        setTimer: (callback, delay) => { assert.equal(delay, 16); timers.set(++id, callback); return id; }, clearTimer: id => timers.delete(id) });
    return { queue, context, calls, timers, setPersona: value => { persona = value; }, fail: value => { error = value; },
        expire() { for (const [id, callback] of [...timers]) { timers.delete(id); callback(); } } };
}

test('received, rendered and ended notifications share one calculation with live toast eligibility', () => {
    const h = harness();
    h.queue.request(true); h.queue.request(false); h.queue.request(true);
    assert.equal(h.calls.length, 0); assert.equal(h.timers.size, 1);
    h.context.chat[0].mes = 'Final text'; h.expire();
    assert.deepEqual(h.calls, [{ isNew: true, text: 'Final text', swipe: 0 }]);
    h.queue.request(false); h.expire(); assert.equal(h.calls.length, 2);
    assert.equal(h.calls[1].isNew, false);
});

test('same-length text edits, swipe changes and appended messages are read at execution time', () => {
    const h = harness();
    for (const change of [() => { h.context.chat[0].mes = 'Edited'; }, () => { h.context.chat[0].swipe_id = 1; }, () => { h.context.chat.push({ mes: 'Next' }); }]) {
        h.queue.request(true); change(); h.expire();
    }
    assert.equal(h.calls.length, 3); assert.equal(h.calls[0].text, 'Edited'); assert.equal(h.calls[1].swipe, 1);
});

test('chat, metadata, character, group and persona switches discard stale scheduled work', () => {
    for (const change of [h => { h.context.chatId = 'b'; }, h => { h.context.chat = []; }, h => { h.context.chatMetadata = {}; }, h => { h.context.characterId = 2; }, h => { h.context.groupId = 'g'; }, h => h.setPersona('b')]) {
        const h = harness(); h.queue.request(true); change(h); h.expire(); assert.equal(h.calls.length, 0);
        h.queue.request(false); h.expire(); assert.equal(h.calls.length, 1); assert.equal(h.calls[0].isNew, false);
    }
});

test('prompt preparation flushes synchronously and immediate events can cancel pending work', () => {
    const h = harness(); h.queue.request(true);
    assert.equal(h.queue.flush(), true); assert.equal(h.calls.length, 1); assert.equal(h.timers.size, 0);
    assert.equal(h.queue.flush(), false);
    h.queue.request(); h.queue.cancel(); h.expire(); assert.equal(h.calls.length, 1);
});

test('a failed calculation clears the timer and does not block future updates', () => {
    const h = harness(); h.queue.request(); h.fail(true);
    assert.throws(() => h.queue.flush(), /render failed/); assert.equal(h.timers.size, 0);
    h.fail(false); h.queue.request(true); h.expire(); assert.equal(h.calls.length, 1);
});
