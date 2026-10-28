import { syncOptionsVisibility } from './options-visibility.js';
import { t, ui } from './i18n.js';
/* global SillyTavern */
import { callPopup, chat_metadata, saveChatDebounced } from '../../../../../script.js';
import { extension_settings } from '../../../../extensions.js';
import { MODULE_NAME } from './constants.js';
import {
    escapeHtml,
    normalizeOptionData,
    getToneClass,
} from './utils.js';
import {
    bbVnGenerateOptionsFlow,
    clearSavedVNOptions,
    invalidateVnOptionsGeneration,
    setVnOptionsEnabled,
} from './generator.js';
import { injectCombinedSocialPrompt } from './social.js';
import { notifyInfo } from './toasts.js';
import {
    hasRenderedVnOptions,
    hideVnGenerateButton,
    resetVnOptionsContainer,
    setVnGenerateButtonIdle,
    showVnGenerateButton,
} from './vn-ui.js';

const VN_PANEL_CLOSE_MS = 220;

function buildUtilityRow({ hasOptions = false, hasSavedOptions = false } = {}) {
    const primaryButtonId = hasOptions ? 'bb-vn-btn-reroll' : 'bb-vn-btn-generate-now';
    const primaryButtonTitle = hasOptions ? t('Обычный реролл') : t('Сгенерировать варианты');
    const primaryButtonIcon = hasOptions ? 'fa-rotate-right' : 'fa-clapperboard';
    const primaryButtonLabel = hasOptions ? t('Реролл') : t('Генерация');
    const clearDisabledAttr = hasSavedOptions ? '' : ' disabled';

    return ui`
        <div class="bb-vn-utility-row">
            <button type="button" class="bb-vn-utility-panel" id="${primaryButtonId}" title="${primaryButtonTitle}">
                <i class="fa-solid ${primaryButtonIcon}"></i>
                <span>${primaryButtonLabel}</span>
            </button>
            <button type="button" class="bb-vn-utility-panel" id="bb-vn-btn-reroll-smart" title="Короткое пожелание к следующим вариантам">
                <i class="fa-solid fa-wand-magic-sparkles"></i>
                <span>Запрос</span>
            </button>
            <button type="button" class="bb-vn-utility-panel" id="bb-vn-btn-clear" title="Очистить сохранённые варианты"${clearDisabledAttr}>
                <i class="fa-solid fa-trash-can"></i>
                <span>Сброс</span>
            </button>
            <button type="button" class="bb-vn-utility-panel" id="bb-vn-btn-cancel" title="Свернуть">
                <i class="fa-solid fa-chevron-up"></i>
                <span>Скрыть</span>
            </button>
            <button type="button" class="bb-vn-utility-panel" id="bb-vn-btn-disable" title="Выключить варианты VN. Кнопка VN останется для включения.">
                <i class="fa-solid fa-power-off"></i><span>Выключить</span>
            </button>
        </div>
    `;
}

function buildEmptyPanelHtml() {
    return ui`
        <div class="bb-vn-empty-state">
            <div class="bb-vn-empty-state-title">
                <i class="fa-solid fa-film"></i>
                <span>Панель готова</span>
            </div>
            <div class="bb-vn-empty-state-text">
                Можно сразу запустить первую генерацию или сначала задать пожелание через «Запрос», чтобы получить более точные варианты.
            </div>
        </div>
    `;
}

function stopVnPanelAnimation(container) {
    const scopedContainer = container instanceof jQuery ? container : jQuery(container);
    if (!scopedContainer.length) return;

    const closeTimerId = Number(scopedContainer.data('bbVnCloseTimer') || 0);
    if (closeTimerId) {
        window.clearTimeout(closeTimerId);
        scopedContainer.removeData('bbVnCloseTimer');
    }
}

function openVnPanel(container) {
    const scopedContainer = container instanceof jQuery ? container : jQuery(container);
    if (!scopedContainer.length) return;

    stopVnPanelAnimation(scopedContainer);
    scopedContainer.removeClass('is-closing');
    scopedContainer.addClass('active is-opening');

    // Hide the generator on/off toggle while the panel is open — it sits next
    // to the main button and would overlap the expanded options panel.
    jQuery('#bb-vn-btn-toggle-generator').hide();

    window.requestAnimationFrame(() => {
        scopedContainer.removeClass('is-opening');
    });
}

function closeVnPanel(container, onClosed = null) {
    const scopedContainer = container instanceof jQuery ? container : jQuery(container);
    if (!scopedContainer.length) {
        if (typeof onClosed === 'function') onClosed();
        return;
    }

    if (!scopedContainer.hasClass('active')) {
        scopedContainer.removeClass('is-closing is-opening');
        // Restore the toggle even if the panel wasn't active (defensive).
        if (extension_settings[MODULE_NAME]?.vnOptionsEnabled !== false) jQuery('#bb-vn-btn-toggle-generator').show();
        if (typeof onClosed === 'function') onClosed();
        return;
    }

    stopVnPanelAnimation(scopedContainer);
    scopedContainer.removeClass('is-opening').addClass('is-closing');

    const timerId = window.setTimeout(() => {
        scopedContainer.removeData('bbVnCloseTimer');
        scopedContainer.removeClass('active is-closing is-opening');
        // Restore the toggle now that the panel is closed.
        if (extension_settings[MODULE_NAME]?.vnOptionsEnabled !== false) jQuery('#bb-vn-btn-toggle-generator').show();
        if (typeof onClosed === 'function') onClosed();
    }, VN_PANEL_CLOSE_MS);

    scopedContainer.data('bbVnCloseTimer', timerId);
}

function getCurrentRerollState() {
    const cards = jQuery('#bb-vn-options-container .bb-vn-option[data-intent]');
    const intents = cards.map(function() {
        return String(jQuery(this).attr('data-intent') || '').trim();
    }).get().filter(Boolean);
    const tones = cards.map(function() {
        return String(jQuery(this).attr('data-tone') || '').trim();
    }).get().filter(Boolean);

    return {
        intents: [...new Set(intents)],
        tones: [...new Set(tones)],
    };
}

async function requestGuidedGeneration({ hasOptions = false } = {}) {
    const rerollState = hasOptions ? getCurrentRerollState() : { intents: [], tones: [] };
    const popupTitle = hasOptions ? t('Запрос к новым вариантам') : t('Запрос к первой генерации');
    const popupCopy = hasOptions
        ? t('Напиши короткое пожелание к следующим вариантам.<br>Примеры: <code>больше нежности</code>, <code>резче двигай конфликт</code>, <code>меньше повторов по тону</code>, <code>больше инициативы</code>.')
        : t('Напиши короткое пожелание к первой подборке вариантов.<br>Примеры: <code>больше нежности</code>, <code>резче двигай конфликт</code>, <code>меньше повторов по тону</code>, <code>больше инициативы</code>.');

    const guidanceResult = await callPopup(
        `<h3>${popupTitle}</h3><p>${popupCopy}</p>`,
        'input',
        '',
        { okButton: t('Сгенерировать'), rows: 3, wide: true },
    );

    if (guidanceResult === false || guidanceResult === null || guidanceResult === undefined) {
        return;
    }

    const guidance = String(guidanceResult || '').trim();
    if (!guidance) {
        notifyInfo(hasOptions
            ? t('Пожелание пустое, запрос к новым вариантам не запущен.')
            : t('Пожелание пустое, запрос к первой генерации не запущен.'));
        return;
    }

    await bbVnGenerateOptionsFlow({
        excludedIntents: hasOptions ? rerollState.intents : [],
        excludedTones: hasOptions ? rerollState.tones : [],
        guidance,
        mode: hasOptions ? 'smart-reroll' : 'guided',
    });
}

function bindVnUtilityActions({ hasOptions = false } = {}) {
    jQuery('#bb-vn-btn-disable').off('click').on('click', () => setVnOptionsEnabled(false));
    const optionsContainer = jQuery('#bb-vn-options-container');

    jQuery('#bb-vn-btn-cancel').off('click').on('click', () => {
        closeVnPanel(optionsContainer, () => {
            showVnGenerateButton();
            setVnGenerateButtonIdle({ hasSaved: hasRenderedVnOptions() });
        });
    });

    jQuery('#bb-vn-btn-generate-now').off('click').on('click', async () => {
        await bbVnGenerateOptionsFlow();
    });

    jQuery('#bb-vn-btn-reroll').off('click').on('click', async () => {
        const rerollState = getCurrentRerollState();
        await bbVnGenerateOptionsFlow({
            excludedIntents: rerollState.intents,
            excludedTones: rerollState.tones,
            mode: 'reroll',
        });
    });

    jQuery('#bb-vn-btn-reroll-smart').off('click').on('click', async () => {
        await requestGuidedGeneration({ hasOptions });
    });

    jQuery('#bb-vn-btn-clear').off('click').on('click', () => {
        clearSavedVNOptions();
    });
}

export function renderVnActionPanel(autoOpen = true) {
    if (extension_settings[MODULE_NAME]?.vnOptionsEnabled === false) return;
    const optionsContainer = resetVnOptionsContainer();
    optionsContainer.html(`${buildEmptyPanelHtml()}${buildUtilityRow({ hasOptions: false, hasSavedOptions: false })}`);
    bindVnUtilityActions({ hasOptions: false });

    if (autoOpen) {
        setVnGenerateButtonIdle({ hasSaved: false });
        openVnPanel(optionsContainer);
        hideVnGenerateButton();
    } else {
        setVnGenerateButtonIdle({ hasSaved: false });
        showVnGenerateButton();
    }
}

export function renderVNOptionsFromData(parsedOptions, autoOpen = false) {
    if (extension_settings[MODULE_NAME]?.vnOptionsEnabled === false) return;
    let optionsHtml = '';
    const useEmotionalChoiceFraming = !!extension_settings[MODULE_NAME].emotionalChoiceFraming;

    parsedOptions.forEach(rawOption => {
        const opt = normalizeOptionData(rawOption);
        let riskClass = 'risk-med';
        const riskValue = (opt.risk || '').toLowerCase();
        if (riskValue.includes('низкий') || riskValue.includes('low')) riskClass = 'risk-low';
        if (riskValue.includes('высокий') || riskValue.includes('high')) riskClass = 'risk-high';
        const toneClass = getToneClass(opt.tone);
        const metaLabel = useEmotionalChoiceFraming
            ? (opt.tone || opt.risk || t('Нейтрально'))
            : (opt.risk || opt.tone || t('Средний'));
        const targetsText = opt.targets.length > 0
            ? opt.targets.map(target => `<span class="bb-vn-target">${escapeHtml(target)}</span>`).join('')
            : t('<span class="bb-vn-target muted">Сцена в целом</span>');

        const forecastHtml = useEmotionalChoiceFraming && opt.forecast
            ? ui`<div class="bb-vn-forecast-hover" title="${escapeHtml(opt.forecast)}"><div class="bb-vn-forecast-title">Прогноз</div><div class="bb-vn-forecast-text">${escapeHtml(opt.forecast)}</div></div>`
            : '';

        optionsHtml += ui`
            <div class="bb-vn-option ${riskClass} ${toneClass}" data-intent="${escapeHtml(opt.intent)}" data-message="${encodeURIComponent(opt.message || '')}" data-tone="${escapeHtml(opt.tone || '')}" data-forecast="${escapeHtml(opt.forecast || '')}" data-targets="${encodeURIComponent(JSON.stringify(opt.targets || []))}">
                <div class="bb-vn-op-topline">
                    <div class="bb-vn-op-badges">
                        <span class="bb-vn-op-index">Сцена</span>
                        <div class="bb-vn-op-risk">${useEmotionalChoiceFraming ? t('Тон') : t('Риск')}: ${escapeHtml(metaLabel)}</div>
                    </div>
                    <div class="bb-vn-op-info-btn" title="${escapeHtml(opt.forecast || t('Подробнее'))}"><i class="fa-solid fa-info"></i></div>
                </div>
                <div class="bb-vn-op-head" title="${escapeHtml(opt.intent)}">${escapeHtml(opt.intent)}</div>
                ${useEmotionalChoiceFraming ? `<div class="bb-vn-targets">${targetsText}</div>` : ''}
                ${forecastHtml}
            </div>
        `;
    });

    optionsHtml += buildUtilityRow({ hasOptions: true, hasSavedOptions: true });

    const optionsContainer = resetVnOptionsContainer();
    stopVnPanelAnimation(optionsContainer);
    optionsContainer.html(optionsHtml);

    if (autoOpen) {
        setVnGenerateButtonIdle({ hasSaved: true });
        openVnPanel(optionsContainer);
        hideVnGenerateButton();
    } else {
        setVnGenerateButtonIdle({ hasSaved: true });
        showVnGenerateButton();
    }

    jQuery('.bb-vn-option[data-intent]').off('click').on('click', function(e) {
        if (jQuery(e.target).closest('.bb-vn-op-info-btn').length > 0) return;
        const message = decodeURIComponent(jQuery(this).attr('data-message') || '');
        const targetsRaw = decodeURIComponent(jQuery(this).attr('data-targets') || '[]');
        let parsedTargets = [];
        try {
            parsedTargets = JSON.parse(targetsRaw);
        } catch (err) {
            void err;
        }
        const choiceContext = {
            intent: jQuery(this).attr('data-intent') || '',
            tone: jQuery(this).attr('data-tone') || '',
            forecast: jQuery(this).attr('data-forecast') || '',
            targets: Array.isArray(parsedTargets) ? parsedTargets : [],
            at: Date.now(),
            messagePreview: message.slice(0, 140),
        };
        chat_metadata['bb_vn_choice_context'] = choiceContext;
        chat_metadata['bb_vn_pending_choice_context'] = choiceContext;
        saveChatDebounced();
        if (extension_settings[MODULE_NAME]?.disableRelationshipTracker !== true) {
            injectCombinedSocialPrompt();
        }

        const textarea = document.querySelector('#send_textarea');
        if (textarea instanceof HTMLTextAreaElement && message) {
            textarea.value = message;
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            if (extension_settings[MODULE_NAME].autoSend) {
                closeVnPanel(optionsContainer, () => {
                    showVnGenerateButton();
                    setVnGenerateButtonIdle({ hasSaved: true });
                });
                document.getElementById('send_but')?.click();
            }
        }
    });

    jQuery('.bb-vn-op-info-btn').off('click').on('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        const card = jQuery(this).closest('.bb-vn-option');
        const wasExpanded = card.hasClass('info-expanded');
        jQuery('.bb-vn-option').removeClass('info-expanded');
        if (!wasExpanded) card.addClass('info-expanded');
    });

    bindVnUtilityActions({ hasOptions: true });
}

window['renderVNOptionsFromData'] = renderVNOptionsFromData;

function isVnOptionsDisabled() {
    return extension_settings[MODULE_NAME]?.vnOptionsEnabled === false;
}

/**
 * Inline generator toggle content (Extended fork): a compact power-off icon
 * next to the main button while enabled; a labelled "turn on" button while
 * disabled (the re-enable affordance right where the main button lived).
 */
function buildGeneratorToggleContent() {
    const disabled = isVnOptionsDisabled();
    if (disabled) {
        return `
            <span class="bb-vn-gen-toggle__content">
                <i class="fa-solid fa-power-off"></i>
                <span class="bb-vn-gen-toggle__label">${t('Генератор выключен')}</span>
            </span>
        `;
    }
    return `
        <span class="bb-vn-gen-toggle__content">
            <i class="fa-solid fa-power-off"></i>
        </span>
    `;
}

/**
 * Synchronises the inline generator toggle (Extended fork) with the
 * vnOptionsEnabled engine: content, title, aria-pressed and the settings
 * checkbox. The action bar itself is shown/hidden by syncOptionsVisibility
 * (upstream), which hides the whole bar while the generator is off — the
 * re-enable affordances are the HUD toolbar button, the settings pill and
 * the "VN" restore button next to the options menu.
 */
export function updateVnGeneratorEnabledState() {
    const disabled = isVnOptionsDisabled();
    const toggle = jQuery('#bb-vn-btn-toggle-generator');

    if (toggle.length) {
        toggle
            .toggleClass('is-disabled', disabled)
            .attr('title', disabled
                ? t('Генератор действий отключён — нажми, чтобы включить')
                : t('Отключить генератор действий'))
            .attr('aria-pressed', disabled ? 'true' : 'false')
            .html(buildGeneratorToggleContent());
    }

    // Sync the settings panel checkbox if it exists.
    const checkbox = document.getElementById('bb-vn-cfg-options-enabled');
    if (checkbox) checkbox.checked = !disabled;
}

function toggleGeneratorEnabled() {
    const nextDisabled = !isVnOptionsDisabled();
    // setVnOptionsEnabled keeps the checkbox, action bar visibility, saved
    // options, generation tokens and the toolbar button in sync.
    setVnOptionsEnabled(!nextDisabled);
    notifyInfo(nextDisabled
        ? t('Генератор вариантов действий отключён. Кнопка «Действия VN» скрыта.')
        : t('Генератор вариантов действий включён. Кнопка «Действия VN» снова доступна.'));
}

export function injectVNActionsUI() {
    // Idempotent: sync the inline toggle whenever the engine state changes.
    if (!window.__bbVnToggleSync) {
        window.__bbVnToggleSync = true;
        window.addEventListener('bb-vn-options-enabled-changed', updateVnGeneratorEnabledState);
    }
    const existing = document.getElementById('bb-vn-action-bar');
    if (existing) {
        syncOptionsVisibility(extension_settings[MODULE_NAME]?.vnOptionsEnabled !== false);
        updateVnGeneratorEnabledState();
        return;
    }
    const barHtml = t('<div id="bb-vn-action-bar" style="display: flex;"><div class="bb-vn-action-row"><div id="bb-vn-btn-generate" class="bb-vn-main-btn" title="Открыть панель действий VN"></div><button type="button" id="bb-vn-btn-toggle-generator" class="bb-vn-gen-toggle" title="Отключить генератор действий" aria-pressed="false"></button></div><div id="bb-vn-options-container"></div></div>');
    jQuery('#send_form').prepend(barHtml);
    const restoreHost = document.getElementById('leftSendForm') || document.getElementById('send_form');
    const restoreButton = jQuery(ui`<button type="button" id="bb-vn-enable-options" title="Включить варианты VN" aria-label="Включить варианты VN" hidden>VN</button>`);
    const menuButton = document.getElementById('options_button');
    if (menuButton?.parentElement === restoreHost) jQuery(menuButton).before(restoreButton);
    else jQuery(restoreHost).prepend(restoreButton);
    jQuery('#bb-vn-enable-options').on('click', () => setVnOptionsEnabled(true));
    syncOptionsVisibility(extension_settings[MODULE_NAME]?.vnOptionsEnabled !== false);
    updateVnGeneratorEnabledState();
    setVnGenerateButtonIdle();

    const ta = document.querySelector('#send_textarea');
    if (ta instanceof HTMLTextAreaElement) {
        ta.addEventListener('input', () => {
            const btn = document.getElementById('bb-vn-btn-generate');
            const toggleBtn = document.getElementById('bb-vn-btn-toggle-generator');
            const opts = document.getElementById('bb-vn-options-container');
            if (ta.value.trim().length > 0) {
                // While typing, hide both the generate button and the generator
                // toggle so they don't crowd the input area (fork behavior).
                if (btn) btn.style.display = 'none';
                if (toggleBtn) toggleBtn.style.display = 'none';
            } else if (opts && !opts.classList.contains('active')) {
                if (btn) btn.style.display = 'block';
                if (toggleBtn) toggleBtn.style.display = '';
            }
        });
    }

    // Click-to-cancel: the loading tooltip promises it (vn-ui.js) and the flow's
    // own re-invocation branch implements it (generator.js) — route the click.
    jQuery('#bb-vn-btn-generate').on('click', function() {
        if (jQuery(this).hasClass('loading')) {
            invalidateVnOptionsGeneration();
            notifyInfo(t('Генерация вариантов отменена'));
            return;
        }
        const container = jQuery('#bb-vn-options-container');
        if (container.children('.bb-vn-option[data-intent]').length > 0) {
            openVnPanel(container);
            hideVnGenerateButton();
        } else {
            renderVnActionPanel(true);
        }
    });

    jQuery('#bb-vn-btn-toggle-generator').on('click', function(e) {
        e.stopPropagation();
        toggleGeneratorEnabled();
    });
}
