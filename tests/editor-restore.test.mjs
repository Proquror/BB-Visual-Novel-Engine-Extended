// Regression test for the bb-char-edit-btn editor restore bug:
// after a HUD rebuild (e.g. editing/deleting relationship events triggers
// recalculateAllStats -> renderSocialHud -> charsBox.innerHTML = ...),
// restoreCardExpansionStates used to re-add only the `editor-open` class
// without re-creating the on-demand editor markup, leaving the button
// highlighted as expanded with no visible editor (first click then closed
// the ghost state instead of opening the editor).
//
// The fix routes the restore through setCharacterEditorOpen so the editor
// markup is re-appended with fresh values, while skipping the auto-scroll
// so the saved panel scroll position wins.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';

const source = readFileSync(new URL('../modules/hud.js', import.meta.url), 'utf8');

function harness() {
    const audit = { previews: 0, scrolls: 0, descriptions: 0 };
    const profile = { avatar: '', avatarSource: '', avatarCrop: { x: 30, y: 60, zoom: 120 }, description: 'Story', relationshipStatus: 'друг' };
    const metadata = { bb_vn_char_bases: { Alex: 12 }, bb_vn_char_bases_romance: { Alex: 3 }, bb_vn_platonic_chars: [] };
    // Card mock: raw DOM element (returned by document.querySelector) plus the
    // jQuery wrapper (returned by jQuery(el)) sharing one class/editor state.
    const state = { classes: new Set(), hasEditor: false, html: '', appends: 0 };
    const domEl = { classList: {
        add: name => state.classes.add(name),
        remove: name => state.classes.delete(name),
        contains: name => state.classes.has(name),
    } };
    const findResult = { each: () => {}, length: 0 };
    const wrapper = {
        children: () => ({ length: state.hasEditor ? 1 : 0 }),
        attr: () => 'Alex',
        append: html => { state.hasEditor = true; state.appends++; state.html += html; },
        addClass: name => state.classes.add(name),
        removeClass: name => state.classes.delete(name),
        toggleClass: (name, enabled) => { if (enabled) state.classes.add(name); else state.classes.delete(name); },
        hasClass: name => state.classes.has(name),
        find: () => findResult,
    };
    const sandbox = createContext({
        currentCalculatedStats: { Alex: { affinity: 12, romance: 3, history: [], memories: { soft: [], deep: [], archive: [] }, core_traits: [] } },
        chat_metadata: metadata,
        getCharacterProfile: () => profile,
        t: text => text,
        ui: (parts, ...values) => parts.reduce((text, part, index) => text + part + (values[index] ?? ''), ''),
        escapeHtml: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'),
        getCharacterInitials: () => 'A',
        buildAvatarStyle: () => '',
        buildCharacterDescriptionTemplateStructured: () => { audit.descriptions++; return 'Generated template'; },
        queueCharacterEditorAvatarPreview: () => { audit.previews++; },
        document: { querySelector: selector => String(selector).includes('Alex') ? domEl : null },
        CSS: { escape: name => String(name) },
        jQuery: () => wrapper,
    });
    const toggles = source.slice(source.indexOf('function setCharacterCardExpanded'), source.indexOf('function bindCharacterEditorEvent('));
    const editor = source.slice(source.indexOf('function buildCharacterEditorHtml'), source.indexOf('function buildCharacterCardHtml('));
    const restore = source.slice(source.indexOf('function restoreCardExpansionStates'), source.indexOf('function detectNameOverflow'));
    runInContext(toggles + '\n' + editor + '\n' + restore, sandbox);
    // The toggles slice declares the real scrollAfterTransition; rebind it
    // after evaluation so scroll invocations can be counted per call site.
    sandbox.scrollAfterTransition = () => { audit.scrolls++; };
    return { sandbox, audit, state, domEl, wrapper, metadata };
}

test('HUD rebuild restore re-creates the open editor markup, not just the class', () => {
    const h = harness();
    // Simulate renderSocialHud: innerHTML wiped (fresh card, no editor), then
    // restoreCardExpansionStates runs with the saved pre-rebuild states.
    h.sandbox.restoreCardExpansionStates({ expanded: ['Alex'], editorOpen: ['Alex'] });

    // The on-demand editor markup must exist again after the rebuild.
    assert.equal(h.state.hasEditor, true, 'editor markup is re-appended');
    assert.equal(h.state.appends, 1, 'exactly one append');
    assert.match(h.state.html, /bb-char-editor/);
    assert.match(h.state.html, /bb-edit-base-input[^"]*" value="12"/, 'fresh friendship base from metadata');
    assert.match(h.state.html, /bb-edit-romance-input[^"]*" value="3"/, 'fresh romance base from metadata');
    // Card state mirrors the pre-rebuild expansion.
    assert.equal(h.state.classes.has('expanded'), true);
    assert.equal(h.state.classes.has('editor-open'), true);
    assert.equal(h.state.classes.has('log-collapsed'), false);
    // Avatar preview re-synced, but no per-card auto-scroll during restore.
    assert.equal(h.audit.previews, 1);
    assert.equal(h.audit.scrolls, 0, 'restore must not override the saved panel scroll');
});

test('restoring twice does not duplicate the editor', () => {
    const h = harness();
    h.sandbox.restoreCardExpansionStates({ expanded: [], editorOpen: ['Alex'] });
    h.sandbox.restoreCardExpansionStates({ expanded: [], editorOpen: ['Alex'] });
    assert.equal(h.state.appends, 1);
    assert.equal(h.state.classes.has('editor-open'), true);
});

test('plain click-to-open keeps the auto-scroll behavior', () => {
    const h = harness();
    h.sandbox.setCharacterEditorOpen(h.wrapper, true);
    assert.equal(h.state.hasEditor, true);
    assert.equal(h.audit.scrolls, 1, 'click path still scrolls to the editor');
    h.sandbox.setCharacterEditorOpen(h.wrapper, false);
    assert.equal(h.state.classes.has('editor-open'), false);
    assert.equal(h.state.hasEditor, true, 'closing only removes the class (editor DOM is reused)');
});
