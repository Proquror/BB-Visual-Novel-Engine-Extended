import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';

const source = readFileSync(new URL('../modules/hud.js', import.meta.url), 'utf8');
function harness() {
    const audit = { descriptions: 0, previews: 0 }, bindings = [];
    const profile = { avatar: '', avatarSource: 'data:image/png;base64,SOURCE_SENTINEL', description: '<script>Story</script>', avatarCrop: { x: 30, y: 60, zoom: 120 } };
    const metadata = { bb_vn_char_bases: { Alex: 12 }, bb_vn_char_bases_romance: { Alex: 3 }, bb_vn_platonic_chars: ['Alex'] };
    const sandbox = createContext({
        currentCalculatedStats: { Alex: { affinity: 12, romance: 0, history: [], memories: { soft: [], deep: [], archive: [] }, core_traits: [] } }, chat_metadata: metadata,
        getCharacterProfile: () => profile, t: text => text,
        ui: (parts, ...values) => parts.reduce((text, part, index) => text + part + (values[index] ?? ''), ''),
        escapeHtml: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'),
        getTierInfo: () => ({ color: '#fff', class: '' }), getUnforgettableImpact: () => ({}),
        getLatestRelationshipDeltas: () => ({ affinity: 0, romance: 0 }), renderScoreDeltaBadge: () => '',
        renderCharacterAvatar: () => '<span class="avatar"></span>', relationshipBreakdownHtml: () => '', getTrendNarrative: () => '',
        buildAvatarStyle: () => '', getCharacterInitials: () => 'A',
        buildCharacterDescriptionTemplateStructured: () => { audit.descriptions++; return 'Generated template'; },
        queueCharacterEditorAvatarPreview: () => { audit.previews++; },
        jQuery: container => ({ off: (events, selector) => { bindings.push({ kind: 'off', container, events, selector }); return { on: (events, selector, handler) => bindings.push({ kind: 'on', container, events, selector, handler }) }; } }),
    });
    const builders = source.slice(source.indexOf('function buildCharacterEditorHtml'), source.indexOf('export function renderSocialHud'));
    const toggles = source.slice(source.indexOf('function setCharacterCardExpanded'), source.indexOf('function buildCharacterDescriptionTemplate('));
    runInContext(builders + '\n' + toggles, sandbox);
    const card = () => {
        const classes = new Set(), editor = { length: 0, draft: '' };
        return { classes, editor, html: '', appends: 0,
            children: () => editor, attr: () => 'Alex',
            append(html) { this.html += html; this.appends++; editor.length = 1; },
            toggleClass(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
            addClass: name => classes.add(name), removeClass: name => classes.delete(name) };
    };
    return { sandbox, audit, profile, metadata, card, bindings };
}

test('closed cards skip editor markup, original image strings and description templates', () => {
    const h = harness(), html = h.sandbox.buildCharacterCardHtml('Alex');
    assert.match(html, /bb-char-edit-btn/);
    assert.doesNotMatch(html, /bb-char-editor|SOURCE_SENTINEL|<input|<textarea/);
    assert.equal(h.audit.descriptions, 0);
});

test('opening creates the current editor once; closing and reopening preserve its draft', () => {
    const h = harness(), card = h.card();
    h.sandbox.setCharacterEditorOpen(card, true);
    assert.equal(card.appends, 1); assert.equal(h.audit.descriptions, 1); assert.equal(h.audit.previews, 1);
    assert.match(card.html, /bb-edit-base-input" value="12"/);
    assert.match(card.html, /bb-edit-romance-input" value="3"/);
    assert.match(card.html, /bb-edit-platonic-cb" checked/);
    assert.match(card.html, /&lt;script&gt;Story&lt;\/script&gt;/); assert.doesNotMatch(card.html, /<script>/);
    assert.match(card.html, /SOURCE_SENTINEL/);
    card.editor.draft = 'Unsaved changes';
    h.sandbox.setCharacterEditorOpen(card, false); h.sandbox.setCharacterEditorOpen(card, true);
    assert.equal(card.appends, 1); assert.equal(card.editor.draft, 'Unsaved changes'); assert.equal(h.audit.descriptions, 1);
    h.profile.description = 'New profile'; const fresh = h.card(); h.sandbox.setCharacterEditorOpen(fresh, true);
    assert.match(fresh.html, /New profile/);
});

test('delegated bindings are scoped and replaced without removing unrelated handlers', () => {
    const h = harness(), container = {}, handler = () => {};
    h.sandbox.bindCharacterEditorEvent(container, '.bb-btn-save-char', 'click', handler);
    h.sandbox.bindCharacterEditorEvent(container, '.bb-avatar-focus-x', 'input change', handler);
    assert.equal(h.bindings[0].events, 'click.bbVneEditor'); assert.equal(h.bindings[0].selector, '.bb-btn-save-char');
    assert.equal(h.bindings[1].container, container); assert.equal(h.bindings[1].handler, handler);
    assert.equal(h.bindings[2].events, 'input.bbVneEditor change.bbVneEditor');
});
