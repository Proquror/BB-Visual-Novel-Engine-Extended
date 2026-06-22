/* global SillyTavern */
import { callPopup, chat_metadata, saveChatDebounced, saveSettingsDebounced } from '../../../../../script.js';
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
    restoreVNOptions,
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
    const primaryButtonTitle = hasOptions ? 'Обычный реролл' : 'Сгенерировать варианты';
    const primaryButtonIcon = hasOptions ? 'fa-rotate-right' : 'fa-clapperboard';
    const primaryButtonLabel = hasOptions ? 'Реролл' : 'Генерация';
    const clearDisabledAttr = hasSavedOptions ? '' : ' disabled';

    return `
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
        </div>
    `;
}

function buildEmptyPanelHtml() {
    return `
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
        jQuery('#bb-vn-btn-toggle-generator').show();
        if (typeof onClosed === 'function') onClosed();
        return;
    }

    stopVnPanelAnimation(scopedContainer);
    scopedContainer.removeClass('is-opening').addClass('is-closing');

    const timerId = window.setTimeout(() => {
        scopedContainer.removeData('bbVnCloseTimer');
        scopedContainer.removeClass('active is-closing is-opening');
        // Restore the toggle now that the panel is closed.
        jQuery('#bb-vn-btn-toggle-generator').show();
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
    const popupTitle = hasOptions ? 'Запрос к новым вариантам' : 'Запрос к первой генерации';
    const popupCopy = hasOptions
        ? 'Напиши короткое пожелание к следующим вариантам.<br>Примеры: <code>больше нежности</code>, <code>резче двигай конфликт</code>, <code>меньше повторов по тону</code>, <code>больше инициативы</code>.'
        : 'Напиши короткое пожелание к первой подборке вариантов.<br>Примеры: <code>больше нежности</code>, <code>резче двигай конфликт</code>, <code>меньше повторов по тону</code>, <code>больше инициативы</code>.';

    const guidanceResult = await callPopup(
        `<h3>${popupTitle}</h3><p>${popupCopy}</p>`,
        'input',
        '',
        { okButton: 'Сгенерировать', rows: 3, wide: true },
    );

    if (guidanceResult === false || guidanceResult === null || guidanceResult === undefined) {
        return;
    }

    const guidance = String(guidanceResult || '').trim();
    if (!guidance) {
        notifyInfo(hasOptions
            ? 'Пожелание пустое, запрос к новым вариантам не запущен.'
            : 'Пожелание пустое, запрос к первой генерации не запущен.');
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
            ? (opt.tone || opt.risk || 'Нейтрально')
            : (opt.risk || opt.tone || 'Средний');
        const targetsText = opt.targets.length > 0
            ? opt.targets.map(target => `<span class="bb-vn-target">${escapeHtml(target)}</span>`).join('')
            : '<span class="bb-vn-target muted">Сцена в целом</span>';

        const forecastHtml = useEmotionalChoiceFraming && opt.forecast
            ? `<div class="bb-vn-forecast-hover" title="${escapeHtml(opt.forecast)}"><div class="bb-vn-forecast-title">Прогноз</div><div class="bb-vn-forecast-text">${escapeHtml(opt.forecast)}</div></div>`
            : '';

        optionsHtml += `
            <div class="bb-vn-option ${riskClass} ${toneClass}" data-intent="${escapeHtml(opt.intent)}" data-message="${encodeURIComponent(opt.message || '')}" data-tone="${escapeHtml(opt.tone || '')}" data-forecast="${escapeHtml(opt.forecast || '')}" data-targets="${encodeURIComponent(JSON.stringify(opt.targets || []))}">
                <div class="bb-vn-op-topline">
                    <div class="bb-vn-op-badges">
                        <span class="bb-vn-op-index">Сцена</span>
                        <div class="bb-vn-op-risk">${useEmotionalChoiceFraming ? 'Тон' : 'Риск'}: ${escapeHtml(metaLabel)}</div>
                    </div>
                    <div class="bb-vn-op-info-btn" title="${escapeHtml(opt.forecast || 'Подробнее')}"><i class="fa-solid fa-info"></i></div>
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

function isGeneratorDisabled() {
    return extension_settings[MODULE_NAME]?.disableGenerator === true;
}

function buildGeneratorToggleContent() {
    // When disabled, the toggle expands into a labelled "turn on" button so the
    // user always has an obvious re-enable affordance right where the main
    // button used to live. When enabled, it stays a compact icon-only button.
    const disabled = isGeneratorDisabled();
    if (disabled) {
        return `
            <span class="bb-vn-gen-toggle__content">
                <i class="fa-solid fa-power-off"></i>
                <span class="bb-vn-gen-toggle__label">Генератор выключен</span>
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
 * Synchronises the VN generator enabled/disabled UI state.
 * - When the generator is disabled: hides the entire #bb-vn-action-bar
 *   (main button + inline toggle + options panel), and renders the HUD
 *   toolbar button in "off" state. The re-enable affordance lives in the
 *   HUD toolbar (and the settings pill as a backup).
 * - When enabled: shows the action bar with the main button + inline toggle.
 * Also keeps the settings checkbox and HUD toolbar button in sync.
 */
export function updateVnGeneratorEnabledState() {
    const disabled = isGeneratorDisabled();
    const toggle = jQuery('#bb-vn-btn-toggle-generator');
    const mainBtn = jQuery('#bb-vn-btn-generate');
    const optionsContainer = jQuery('#bb-vn-options-container');
    const actionBar = document.getElementById('bb-vn-action-bar');

    if (toggle.length) {
        toggle
            .toggleClass('is-disabled', disabled)
            .attr('title', disabled
                ? 'Генератор действий отключён — нажми, чтобы включить'
                : 'Отключить генератор действий')
            .attr('aria-pressed', disabled ? 'true' : 'false')
            .html(buildGeneratorToggleContent());
    }

    if (disabled) {
        // Close and clear any open VN options panel
        if (optionsContainer.length) {
            stopVnPanelAnimation(optionsContainer);
            optionsContainer.removeClass('active is-closing is-opening');
            optionsContainer.empty();
        }
        if (mainBtn.length) {
            mainBtn.removeClass('loading has-saved');
            mainBtn.hide();
        }
        // Hide the entire action bar — the re-enable affordance is the HUD
        // toolbar button (and the settings pill).
        if (actionBar) actionBar.style.display = 'none';
    } else {
        if (actionBar) actionBar.style.display = 'flex';
        if (mainBtn.length) {
            setVnGenerateButtonIdle({ hasSaved: hasRenderedVnOptions() });
            const ta = document.querySelector('#send_textarea');
            const textareaBusy = ta instanceof HTMLTextAreaElement && ta.value.trim().length > 0;
            const panelOpen = optionsContainer.length && optionsContainer.hasClass('active');
            if (!textareaBusy && !panelOpen) {
                mainBtn.show();
            }
        }
    }

    // Sync the settings panel checkbox if it exists
    const checkbox = document.getElementById('bb-vn-cfg-disable-generator');
    if (checkbox) checkbox.checked = disabled;

    // Sync the HUD toolbar generator toggle button
    if (typeof window.updateGeneratorToolbarButton === 'function') {
        window.updateGeneratorToolbarButton();
    }
}

function toggleGeneratorEnabled() {
    const nextDisabled = !isGeneratorDisabled();
    extension_settings[MODULE_NAME].disableGenerator = nextDisabled;
    if (typeof saveSettingsDebounced === 'function') saveSettingsDebounced();

    updateVnGeneratorEnabledState();

    // If we just re-enabled the generator, try to restore any saved options
    // for the current message (mirrors the tracker re-enable flow).
    if (!nextDisabled && typeof restoreVNOptions === 'function') {
        restoreVNOptions(false);
    }

    notifyInfo(nextDisabled
        ? 'Генератор вариантов действий отключён. Кнопка «Действия VN» скрыта.'
        : 'Генератор вариантов действий включён. Кнопка «Действия VN» снова доступна.');
}

export function injectVNActionsUI() {
    if (document.getElementById('bb-vn-action-bar')) {
        // Ensure the toggle reflects the current setting on re-injection.
        updateVnGeneratorEnabledState();
        return;
    }
    const barHtml = `
        <div id="bb-vn-action-bar" style="display: flex;">
            <div class="bb-vn-action-row">
                <div id="bb-vn-btn-generate" class="bb-vn-main-btn" title="Открыть панель действий VN"></div>
                <button type="button" id="bb-vn-btn-toggle-generator" class="bb-vn-gen-toggle" title="Отключить генератор действий" aria-pressed="false"></button>
            </div>
            <div id="bb-vn-options-container"></div>
        </div>
    `;
    jQuery('#send_form').prepend(barHtml);
    setVnGenerateButtonIdle();
    updateVnGeneratorEnabledState();

    const ta = document.querySelector('#send_textarea');
    if (ta instanceof HTMLTextAreaElement) {
        ta.addEventListener('input', () => {
            if (isGeneratorDisabled()) return;
            const btn = document.getElementById('bb-vn-btn-generate');
            const toggle = document.getElementById('bb-vn-btn-toggle-generator');
            const opts = document.getElementById('bb-vn-options-container');
            const hasText = ta.value.trim().length > 0;
            // When the user is typing, hide both the generate button and the
            // generator on/off toggle so they don't crowd the input area.
            // When the textarea is empty (and the options panel is closed),
            // show them back.
            if (hasText) {
                if (btn) btn.style.display = 'none';
                if (toggle) toggle.style.display = 'none';
            } else if (opts && !opts.classList.contains('active')) {
                if (btn) btn.style.display = 'block';
                if (toggle) toggle.style.display = '';
            }
        });
    }

    jQuery('#bb-vn-btn-generate').on('click', function() {
        if (isGeneratorDisabled()) return;
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
