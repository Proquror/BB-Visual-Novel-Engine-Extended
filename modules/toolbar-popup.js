/**
 * HUD toolbar with floating popup panels (ported from the Extended fork).
 *
 * The toolbar lives in the HUD header. Its buttons open popups that float in
 * the root stacking context (a direct child of <body>), anchored under the
 * button that opened them, clamped to the viewport, auto-flipping above the
 * button when there is no room below, and repositioning on resize/scroll or
 * content size changes.
 *
 * The settings/dev popups do not duplicate markup: they TRANSPLANT the live
 * settings sections out of the SillyTavern extension settings drawer into
 * the popup body and put them back on close (savePosition/restorePosition),
 * so every existing handler keeps working untouched.
 */
import { t, ui } from './i18n.js';
/* global SillyTavern, jQuery */
import { chat_metadata, saveChatDebounced } from '../../../../../script.js';
import { extension_settings } from '../../../../extensions.js';
import { MODULE_NAME } from './constants.js';
import { notifySuccess, notifyInfo } from './toasts.js';
import { setVnOptionsEnabled } from './generator.js';
import { bindActivePersonaState, recalculateAllStats, getTierInfo } from './social.js';
import { currentCalculatedStats } from './state.js';
import { wipeGlobalLog, wipeAllSocialData } from './settings.js';
import { escapeHtml } from './utils.js';
import { setHudPopupPriority } from './hud-priority.js';

let overlay = null;
let activeToolbarPopup = null;
let activeToolbarBtn = null;
const savedPositions = new Map();

function restoreTransplantedSections() {
    // Move the transplanted DOM sections back to their original positions.
    const popupBody = overlay?.querySelector('.bb-toolbar-popup-body');
    if (!popupBody) return;
    for (const child of [...popupBody.children]) {
        if (savedPositions.has(child)) restorePosition(child);
    }
}

function closeToolbarPopup() {
    if (!activeToolbarPopup) return;
    restoreTransplantedSections();
    // Drop anything that was not transplanted (hidden-character list, actions).
    const popupBody = overlay?.querySelector('.bb-toolbar-popup-body');
    if (popupBody) popupBody.innerHTML = '';

    overlay?.classList.remove('open');
    if (overlay) {
        overlay.style.top = '';
        overlay.style.left = '';
        overlay.style.bottom = '';
    }
    activeToolbarPopup = null;
    activeToolbarBtn = null;
    jQuery?.('.bb-toolbar-btn')?.removeClass('active');
    // Restore HUD/backdrop/toast stacking priority.
    setHudPopupPriority(false);
}

export function requestCloseToolbarPopup() {
    if (activeToolbarPopup) closeToolbarPopup();
}

// --- DOM transplant helpers -------------------------------------------------

function savePosition(el) {
    if (!savedPositions.has(el)) {
        savedPositions.set(el, { parent: el.parentElement, next: el.nextSibling });
    }
}

function restorePosition(el) {
    const pos = savedPositions.get(el);
    if (pos && pos.parent) {
        if (pos.next && pos.next.parentElement === pos.parent) {
            pos.parent.insertBefore(el, pos.next);
        } else {
            pos.parent.appendChild(el);
        }
    }
    savedPositions.delete(el);
}

// --- positioning --------------------------------------------------------------

function positionToolbarPopup(btn) {
    if (!btn || !overlay) return;
    const btnRect = btn.getBoundingClientRect();
    // If the button is off-screen (HUD closed: translateX(100%) pushes it past
    // the right edge) there is nothing to anchor to — the caller should open
    // the HUD first.
    if (btnRect.left > window.innerWidth - 4 || btnRect.right < 4
        || btnRect.top > window.innerHeight - 4 || btnRect.bottom < 4) {
        return;
    }
    overlay.style.bottom = 'auto';
    overlay.style.top = `${Math.max(8, btnRect.bottom + 4)}px`;
    overlay.style.left = `${Math.max(8, btnRect.left)}px`;
    // Clamp SYNCHRONOUSLY: getBoundingClientRect() below forces a layout with
    // the new content, so the real dimensions are already known in this very
    // task and the popup is never painted at the naive, unclamped spot (the
    // old next-frame clamp flashed one wrong frame on every open/switch).
    if (!overlay || activeToolbarPopup === null) return;
    const rect = overlay.getBoundingClientRect();
    const popupW = rect.width || 420;
    const popupH = rect.height || 0;
    if (rect.right > window.innerWidth - 8 || rect.width === 0) {
        overlay.style.left = `${Math.max(8, window.innerWidth - popupW - 8)}px`;
    }
    if (parseFloat(overlay.style.left || '0') < 8) {
        overlay.style.left = '8px';
    }
    if (popupH === 0) return;
    const spaceBelow = window.innerHeight - btnRect.bottom - 8;
    const spaceAbove = btnRect.top - 8;
    if (rect.bottom > window.innerHeight - 8) {
        if (spaceAbove >= popupH) {
            overlay.style.top = 'auto';
            overlay.style.bottom = `${window.innerHeight - btnRect.top + 4}px`;
        } else if (spaceAbove > spaceBelow) {
            overlay.style.top = '8px';
            overlay.style.bottom = 'auto';
        } else {
            overlay.style.top = 'auto';
            overlay.style.bottom = '8px';
        }
    }
}

function repositionActivePopup() {
    if (activeToolbarPopup && activeToolbarBtn) positionToolbarPopup(activeToolbarBtn);
}

// --- popup content -------------------------------------------------------------

function popupShell(title, bodyId) {
    return `<div class="bb-toolbar-popup">
        <div class="bb-toolbar-popup-header">
            <span class="bb-toolbar-popup-title">${escapeHtml(title)}</span>
            <button type="button" class="bb-toolbar-popup-close" aria-label="${t('Закрыть')}"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="bb-toolbar-popup-body" id="${bodyId}"></div>
    </div>`;
}

function forceShellVisibleWhileTransplanting(shell, run) {
    // ST hides inline-drawer-content with display:none when the parent drawer
    // is collapsed; moved elements inherit zero dimensions and the popup ends
    // up invisible (notably on mobile). Force the shell visible for the move.
    const prevDisplay = shell.style.display;
    shell.style.display = 'block';
    try {
        run();
    } finally {
        shell.style.display = prevDisplay;
    }
}

function openSectionPopup(sections, title, bodyId) {
    const shell = document.querySelector('.bb-vn-settings-shell');
    if (!shell) { notifyInfo(t('Панель настроек не найдена.')); return; }

    overlay.innerHTML = popupShell(title, bodyId);
    overlay.classList.add('open');
    const body = document.getElementById(bodyId);

    forceShellVisibleWhileTransplanting(shell, () => {
        for (const section of shell.querySelectorAll(sections)) {
            savePosition(section);
            body.appendChild(section);
        }
    });
}

function openHiddenCharactersPopup() {
    const ignoredChars = chat_metadata['bb_vn_ignored_chars'] || [];
    let listHtml = '';
    if (!Array.isArray(ignoredChars) || ignoredChars.length === 0) {
        listHtml = `<div class="bb-toolbar-hidden-empty">${t('Нет скрытых персонажей')}</div>`;
    } else {
        listHtml = '<div class="bb-toolbar-hidden-list">';
        ignoredChars.forEach(name => {
            const charStats = currentCalculatedStats[name];
            const tierLabel = charStats ? getTierInfo(charStats.affinity || 0).label : '—';
            listHtml += `<div class="bb-toolbar-hidden-item">
                <div class="bb-toolbar-hidden-info"><span class="bb-toolbar-hidden-name">${escapeHtml(name)}</span><span class="bb-toolbar-hidden-tier">${escapeHtml(tierLabel)}</span></div>
                <button type="button" class="menu_button bb-toolbar-restore-btn" data-char="${escapeHtml(name)}"><i class="fa-solid fa-arrow-up-from-bracket"></i></button>
            </div>`;
        });
        listHtml += '</div>';
        if (ignoredChars.length > 1) {
            listHtml += `<button type="button" class="menu_button bb-vn-settings-button" id="bb-toolbar-restore-all"><i class="fa-solid fa-arrows-rotate"></i>&ensp;${t('Вернуть всех')}</button>`;
        }
    }
    overlay.innerHTML = popupShell('👁️‍🗨️ ' + t('Скрытые персонажи'), 'bb-toolbar-hidden-body');
    overlay.querySelector('.bb-toolbar-popup-body').innerHTML = listHtml;
    overlay.classList.add('open');

    jQuery('.bb-toolbar-restore-btn').on('click', function(e) {
        // The list re-render below detaches this button mid-click; without
        // stopPropagation the click would keep bubbling to the document
        // handler, read as an outside click and close the popup.
        e.stopPropagation();
        const charName = jQuery(this).attr('data-char');
        const { scopeState } = bindActivePersonaState();
        const idx = scopeState.ignored_chars.indexOf(charName);
        if (idx !== -1) scopeState.ignored_chars.splice(idx, 1);
        chat_metadata['bb_vn_ignored_chars'] = scopeState.ignored_chars;
        saveChatDebounced();
        recalculateAllStats();
        notifySuccess(ui`${charName} восстановлен!`);
        // Refresh the list in place: keep the popup open and re-anchored to
        // the same toolbar button instead of dropping the anchor.
        openToolbarPopup('hidden', activeToolbarBtn, true);
    });
    jQuery('#bb-toolbar-restore-all').on('click', (e) => {
        e.stopPropagation();
        const { scopeState } = bindActivePersonaState();
        scopeState.ignored_chars = [];
        chat_metadata['bb_vn_ignored_chars'] = scopeState.ignored_chars;
        saveChatDebounced();
        recalculateAllStats();
        notifySuccess(t('Все скрытые персонажи восстановлены!'));
        openToolbarPopup('hidden', activeToolbarBtn, true);
    });
}

function toggleGeneratorFromToolbar() {
    closeToolbarPopup();
    const enabled = extension_settings[MODULE_NAME]?.vnOptionsEnabled !== false;
    // setVnOptionsEnabled keeps the settings checkbox, action bar visibility,
    // saved options and generation tokens in sync (upstream Zone-A engine).
    setVnOptionsEnabled(!enabled);
    notifyInfo(enabled
        ? t('Генератор вариантов действий отключён. Панель действий скрыта.')
        : t('Генератор вариантов действий включён. Кнопка «Действия VN» снова доступна.'));
}

function openToolbarPopup(type, btn, keepActiveState = false) {
    if (!keepActiveState && activeToolbarPopup === type) { closeToolbarPopup(); return; }
    // Switching between two popups (settings → dev → hidden …) HOT-SWAPS the
    // content: transplanted sections go home, the shell/overlay and its .open
    // state stay alive, and the new content lands in the same task. The old
    // close-then-reopen path dropped the overlay for a frame (and re-anchored
    // it a frame later), which read as flicker on every switch.
    const switching = !keepActiveState && activeToolbarPopup !== null && activeToolbarPopup !== type;
    if (switching) {
        restoreTransplantedSections();
        activeToolbarPopup = type;
        activeToolbarBtn = btn || null;
        jQuery?.('.bb-toolbar-btn')?.removeClass('active');
    } else {
        if (!keepActiveState) closeToolbarPopup();
        activeToolbarPopup = type;
        activeToolbarBtn = btn || null;
    }
    // Lower HUD/backdrop/toast z-index so the popup overlay renders above
    // them (the open mobile HUD sits at z-index 9999).
    setHudPopupPriority(true);

    switch (type) {
        case 'settings':
            openSectionPopup(
                '.bb-vn-settings-section[data-section="game"], .bb-vn-settings-section[data-section="answers"], .bb-vn-settings-section[data-section="connection"], .bb-vn-settings-section[data-section="relationships"], .bb-vn-settings-section[data-section="images"]',
                '⚙️ ' + t('Настройки'), 'bb-toolbar-settings-body');
            break;
        case 'dev': {
            openSectionPopup(
                '.bb-vn-settings-section[data-section="debug"], .bb-vn-settings-section[data-section="data"]',
                '🛠️ ' + t('Консоль разработчика'), 'bb-toolbar-dev-body');
            const body = document.getElementById('bb-toolbar-dev-body');
            if (body) {
                body.insertAdjacentHTML('beforeend', `<div class="bb-toolbar-dev-actions">
                    <button type="button" class="menu_button bb-vn-settings-button" id="bb-toolbar-clear-log"><i class="fa-solid fa-broom"></i>&ensp; ${t('Очистить журнал')}</button>
                    <button type="button" class="menu_button bb-vn-settings-button bb-vn-settings-button--danger" id="bb-toolbar-wipe-btn"><i class="fa-solid fa-skull-crossbones"></i>&ensp; ${t('Сбросить историю')}</button>
                </div>`);
                jQuery('#bb-toolbar-clear-log').on('click', () => { wipeGlobalLog(); });
                jQuery('#bb-toolbar-wipe-btn').on('click', () => { wipeAllSocialData(); });
            }
            break;
        }
        case 'export':
            jQuery('#bb-social-export-btn').trigger('click');
            activeToolbarPopup = null;
            setHudPopupPriority(false);
            return;
        case 'import':
            jQuery('#bb-social-import-btn').trigger('click');
            activeToolbarPopup = null;
            setHudPopupPriority(false);
            return;
        case 'hidden':
            openHiddenCharactersPopup();
            break;
    }

    overlay?.querySelector('.bb-toolbar-popup-close')?.addEventListener('click', closeToolbarPopup);
    if (btn) positionToolbarPopup(btn);
    if (!keepActiveState) jQuery?.(`.bb-toolbar-btn[data-toolbar="${type}"]`)?.addClass('active');
}

// --- toolbar ---------------------------------------------------------------------

export function buildToolbarHtml() {
    return `<div class="bb-toolbar">
        <button type="button" class="bb-toolbar-btn" data-toolbar="settings" title="${t('Настройки')}" aria-label="${t('Настройки')}"><i class="fa-solid fa-gear"></i></button>
        <button type="button" class="bb-toolbar-btn" data-toolbar="dev" title="${t('Консоль разработчика')}" aria-label="${t('Консоль разработчика')}"><i class="fa-solid fa-screwdriver-wrench"></i></button>
        <button type="button" class="bb-toolbar-btn" data-toolbar="export" title="${t('Экспорт')}" aria-label="${t('Экспорт')}"><i class="fa-solid fa-file-export"></i></button>
        <button type="button" class="bb-toolbar-btn" data-toolbar="import" title="${t('Импорт')}" aria-label="${t('Импорт')}"><i class="fa-solid fa-file-import"></i></button>
        <button type="button" class="bb-toolbar-btn" data-toolbar="hidden" title="${t('Скрытые персонажи')}" aria-label="${t('Скрытые персонажи')}"><i class="fa-solid fa-eye-slash"></i></button>
        <button type="button" class="bb-toolbar-btn bb-toolbar-btn--gen-toggle" id="bb-toolbar-btn-gen-toggle" data-toolbar="gen-toggle" title="${t('Генератор действий')}" aria-pressed="false"><i class="fa-solid fa-clapperboard"></i></button>
    </div>`;
}

export function updateGeneratorToolbarButton() {
    const btn = document.getElementById('bb-toolbar-btn-gen-toggle');
    if (!btn) return;
    const disabled = extension_settings[MODULE_NAME]?.vnOptionsEnabled === false;
    btn.classList.toggle('is-disabled', disabled);
    btn.title = disabled
        ? t('Генератор отключён — нажмите, чтобы включить')
        : t('Генератор действий — нажмите, чтобы отключить');
    btn.setAttribute('aria-pressed', disabled ? 'true' : 'false');
}

export function updateHiddenCharactersBadge() {
    const hiddenBtn = document.querySelector('.bb-toolbar-btn[data-toolbar="hidden"]');
    if (!hiddenBtn) return;
    const hiddenCount = (chat_metadata['bb_vn_ignored_chars'] || []).length;
    let badge = hiddenBtn.querySelector('.bb-toolbar-badge');
    if (hiddenCount > 0) {
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'bb-toolbar-badge';
            hiddenBtn.appendChild(badge);
        }
        badge.textContent = hiddenCount;
    } else if (badge) {
        badge.remove();
    }
}

export function ensureToolbarPopupSystem() {
    // The popup overlay is a direct child of <body>: the root stacking
    // context. Inside #bb-social-hud (z-index 890, and 9999 when open on
    // mobile) it would clip under the ST top bar (z-index 3005).
    if (!document.getElementById('bb-toolbar-popup-overlay')) {
        overlay = document.createElement('div');
        overlay.className = 'bb-toolbar-popup-overlay';
        overlay.id = 'bb-toolbar-popup-overlay';
        document.body.appendChild(overlay);
    } else {
        overlay = document.getElementById('bb-toolbar-popup-overlay');
    }

    jQuery('.bb-toolbar-btn').off('click.bbToolbar').on('click.bbToolbar', function(e) {
        e.stopPropagation();
        const type = jQuery(this).attr('data-toolbar');
        if (type === 'gen-toggle') {
            toggleGeneratorFromToolbar();
            return;
        }
        openToolbarPopup(type, this);
    });

    // Close when clicking outside: the overlay is transparent and
    // pointer-events:none, so the listener lives on the document.
    jQuery(document).off('click.bbToolbarPopup').on('click.bbToolbarPopup', function(e) {
        if (activeToolbarPopup === null) return;
        // A click whose target was just removed from the DOM (the hidden
        // list re-renders on restore) is not an outside click — ignore it.
        if (!e.target || e.target.isConnected === false) return;
        if (overlay.contains(e.target)) return;
        if (activeToolbarBtn && activeToolbarBtn.contains(e.target)) return;
        closeToolbarPopup();
    });

    jQuery(window).off('resize.bbToolbarPopup').on('resize.bbToolbarPopup', repositionActivePopup);
    document.removeEventListener('scroll', repositionActivePopup, true);
    document.addEventListener('scroll', repositionActivePopup, true);

    // Watch the popup body for size changes (inline drawers toggling inside
    // the popup) so it stays anchored to the button instead of drifting to a
    // stale corner.
    if (typeof ResizeObserver !== 'undefined' && !overlay.__bbVnResizeObserver) {
        overlay.__bbVnResizeObserver = new ResizeObserver(() => {
            if (activeToolbarPopup !== null && activeToolbarBtn && overlay.classList.contains('open')) {
                positionToolbarPopup(activeToolbarBtn);
            }
        });
        overlay.__bbVnResizeObserver.observe(overlay);
    }

    // Sync with the vnOptionsEnabled engine.
    window.addEventListener('bb-vn-options-enabled-changed', updateGeneratorToolbarButton);
    updateGeneratorToolbarButton();
    updateHiddenCharactersBadge();
}
