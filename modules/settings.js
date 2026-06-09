 /* global SillyTavern */
import { chat_metadata, saveChatDebounced, saveSettingsDebounced } from '../../../../../script.js';
import { extension_settings } from '../../../../extensions.js';
import { MODULE_NAME, normalizeImpactSettings, normalizeImpactValue, normalizeVnReplyLength, resolveImpactScaleSettings } from './constants.js';
import { recalculateAllStats, injectCombinedSocialPrompt, addGlobalLog, bindActivePersonaState, getCurrentPersonaScopeKey, mergeCharacterRecords, resolveCharacterIdentity, exportActivePersonaSnapshot, importActivePersonaSnapshot, clearActivePersonaSnapshot, editSocialUpdate, getSocialUpdatesForMessage, deleteSocialUpdate } from './social.js';
import { notifySuccess, notifyInfo, notifyError, showHudToast } from './toasts.js';
import { restoreVNOptions, clearSavedVNOptions } from './generator.js';

const IMPACT_SETTING_FIELDS = [
    { key: 'unforgivable', token: 'unforgivable', title: 'Критический минус', hint: 'Тяжёлый удар по доверию или влечению' },
    { key: 'major_negative', token: 'major_negative', title: 'Сильный минус', hint: 'Заметное ухудшение за один ход' },
    { key: 'minor_negative', token: 'minor_negative', title: 'Слабый минус', hint: 'Небольшая негативная реакция' },
    { key: 'minor_positive', token: 'minor_positive', title: 'Слабый плюс', hint: 'Лёгкое улучшение отношения' },
    { key: 'major_positive', token: 'major_positive', title: 'Сильный плюс', hint: 'Хорошо заметный рост' },
    { key: 'life_changing', token: 'life_changing', title: 'Судьбоносный плюс', hint: 'Крупный переломный сдвиг' },
];
const IMPACT_SCALE_GROUPS = [
    {
        key: 'friendshipImpactValues',
        title: '🤝 Шкала дружбы',
        note: 'Меняет только доверие, лояльность, тепло и социальную дистанцию.',
    },
    {
        key: 'romanceImpactValues',
        title: '💖 Шкала романтики',
        note: 'Меняет только влечение, искру, личную тягу и романтическое охлаждение.',
    },
];

function renderMergeSuggestionsList() {
    bindActivePersonaState();
    const container = jQuery('#bb-dbg-merge-suggestions');
    if (container.length === 0) return;

    const suggestions = Array.isArray(chat_metadata['bb_vn_merge_suggestions'])
        ? [...chat_metadata['bb_vn_merge_suggestions']].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 6)
        : [];

    if (suggestions.length === 0) {
        container.html('<div style="font-size: 11px; color: #64748b;">Пока подозрительных дублей не найдено.</div>');
        return;
    }

    container.html(suggestions.map(item => {
        const score = Math.round(Number(item.score || 0) * 100);
        return `<button type="button" class="menu_button bb-dbg-merge-suggestion" data-from="${String(item.source || '').replace(/"/g, '&quot;')}" data-to="${String(item.target || '').replace(/"/g, '&quot;')}" style="text-align:left; width:100%; margin-top:6px; border-color: rgba(192, 132, 252, 0.22); color: #ddd6fe;">
            <span style="display:block; font-size:11px; color:#c4b5fd;">Кандидат на объединение · ${score}%</span>
            <strong style="display:block; color:#f8fafc;">${item.source}</strong>
            <span style="display:block; font-size:12px; color:#94a3b8;">→ ${item.target}</span>
        </button>`;
    }).join(''));

    jQuery('.bb-dbg-merge-suggestion').off('click').on('click', function() {
        jQuery('#bb-dbg-merge-from').val(jQuery(this).attr('data-from') || '');
        jQuery('#bb-dbg-merge-to').val(jQuery(this).attr('data-to') || '');
        notifyInfo('Кандидат на объединение подставлен в поля слияния.');
    });
}

window['bbRenderMergeSuggestionsList'] = renderMergeSuggestionsList;

function normalizeDebugTraitText(raw = '', fallbackLabel = 'Черта') {
    const text = String(raw || '').trim();
    if (!text) return '';
    return text.includes(':') ? text : `${fallbackLabel}: ${text}`;
}

function makeDebugEventId(prefix = 'debug') {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeSnapshotFilename() {
    const scopeKey = getCurrentPersonaScopeKey().replace(/[^\w-]+/g, '_');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `bb-vne-snapshot-${scopeKey}-${stamp}.json`;
}

function downloadSnapshotFile(snapshot) {
    const json = JSON.stringify(snapshot, null, 2);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = makeSnapshotFilename();
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function injectDebugData(impact, isRomance = false) {
    bindActivePersonaState();
    const charName = String(jQuery('#bb-debug-char-name').val()).trim();
    if(!charName) return notifyError("Укажите имя!");
    const chat = SillyTavern.getContext().chat;
    if (!chat?.length) return;
    const lastMsg = chat[chat.length - 1];
    if (!lastMsg.extra) lastMsg.extra = {};
    if (!lastMsg.extra.bb_social_swipes) lastMsg.extra.bb_social_swipes = {};
    const sId = lastMsg.swipe_id || 0;
    if (!lastMsg.extra.bb_social_swipes[sId]) lastMsg.extra.bb_social_swipes[sId] = [];
    const reason = String(jQuery('#bb-debug-reason').val() || '').trim() || (isRomance ? 'Дебаг-романтика' : 'Дебаг-доверие');
    lastMsg.extra.bb_social_swipes[sId].push({ name: charName, friendship_impact: isRomance ? "none" : impact, romance_impact: isRomance ? impact : "none", role_dynamic: "", reason, emotion: "тест", debug_event: true, debug_id: makeDebugEventId('impact'), scope: getCurrentPersonaScopeKey() });
    saveChatDebounced(); recalculateAllStats(false); notifySuccess("Данные внедрены.");
}

export function injectMixedDeepDebugData() {
    bindActivePersonaState();
    const charName = String(jQuery('#bb-debug-char-name').val()).trim();
    if(!charName) return notifyError("Укажите имя!");
    const chat = SillyTavern.getContext().chat;
    if (!chat?.length) return;
    const lastMsg = chat[chat.length - 1];
    if (!lastMsg.extra) lastMsg.extra = {};
    if (!lastMsg.extra.bb_social_swipes) lastMsg.extra.bb_social_swipes = {};
    const sId = lastMsg.swipe_id || 0;
    if (!lastMsg.extra.bb_social_swipes[sId]) lastMsg.extra.bb_social_swipes[sId] = [];
    const customReason = String(jQuery('#bb-debug-reason').val() || '').trim();
    lastMsg.extra.bb_social_swipes[sId].push({
        name: charName,
        friendship_impact: "unforgivable",
        romance_impact: "life_changing",
        role_dynamic: "",
        reason: customReason || "Тянет вопреки опасности",
        emotion: "опасное влечение",
        debug_event: true,
        debug_id: makeDebugEventId('mixed'),
        scope: getCurrentPersonaScopeKey(),
    });
    saveChatDebounced();
    recalculateAllStats(false);
    notifySuccess("Смешанное незабываемое событие внедрено.");
}

export function wipeGlobalLog() {
    const { scopeState } = bindActivePersonaState();
    const chat = SillyTavern.getContext().chat || [];
    scopeState.global_log = [];
    chat_metadata['bb_vn_global_log'] = scopeState.global_log;
    chat_metadata['bb_vn_log_cutoff_index'] = chat.length;
    saveChatDebounced();
    recalculateAllStats();
    notifySuccess("Журнал событий очищен!");
}

export function wipeAllSocialData() {
    const { scopeState, aliasSet } = bindActivePersonaState();
    const chat = SillyTavern.getContext().chat;
    if (!chat) return;
    chat.forEach(msg => {
        if (msg.extra && msg.extra.bb_social_swipes) {
            for (const sId in msg.extra.bb_social_swipes) {
                if (!Array.isArray(msg.extra.bb_social_swipes[sId])) continue;
                msg.extra.bb_social_swipes[sId] = msg.extra.bb_social_swipes[sId].filter(update => update?.scope && !aliasSet.has(update.scope));
            }
        }
        if (msg.extra && msg.extra.bb_vn_options_swipes) delete msg.extra.bb_vn_options_swipes;
        if (msg.extra && msg.extra.bb_vn_char_traits_swipes) {
            for (const sId in msg.extra.bb_vn_char_traits_swipes) {
                if (!Array.isArray(msg.extra.bb_vn_char_traits_swipes[sId])) continue;
                msg.extra.bb_vn_char_traits_swipes[sId] = msg.extra.bb_vn_char_traits_swipes[sId].filter(trait => trait?.scope && !aliasSet.has(trait.scope));
            }
        }
    });
    scopeState.global_log = [];
    scopeState.char_bases = {};
    scopeState.ignored_chars = [];
    scopeState.char_bases_romance = {};
    scopeState.platonic_chars = [];
    scopeState.char_registry = {};
    scopeState.merge_suggestions = [];
    scopeState.log_cutoff_index = 0;
    scopeState.snapshot_baseline = null;
    scopeState.snapshot_cutoff_index = 0;
    scopeState.snapshot_restore_state = null;
    chat_metadata['bb_vn_global_log'] = scopeState.global_log;
    chat_metadata['bb_vn_char_bases'] = scopeState.char_bases;
    chat_metadata['bb_vn_ignored_chars'] = scopeState.ignored_chars;
    chat_metadata['bb_vn_char_bases_romance'] = scopeState.char_bases_romance;
    chat_metadata['bb_vn_platonic_chars'] = scopeState.platonic_chars;
    chat_metadata['bb_vn_char_registry'] = scopeState.char_registry;
    chat_metadata['bb_vn_merge_suggestions'] = scopeState.merge_suggestions;
    delete chat_metadata['bb_vn_log_cutoff_index'];
    delete chat_metadata['bb_vn_char_traits'];
    delete chat_metadata['bb_vn_choice_context'];
    delete chat_metadata['bb_vn_pending_choice_context'];
    delete chat_metadata['bb_vn_last_used_choice_context'];
    addGlobalLog('system', 'Все отношения сброшены до нуля.');
    saveChatDebounced();
    recalculateAllStats();
    notifySuccess("История отношений в этом чате полностью сброшена!");
}

export function setupExtensionSettings() {
    bindActivePersonaState();
    if (document.getElementById('bb-social-settings-wrapper')) return;
    
    const s = extension_settings[MODULE_NAME];
    const selectedReplyLength = normalizeVnReplyLength(s.vnReplyLength);
    Object.assign(s, resolveImpactScaleSettings(s));
    const buildImpactFieldsHtml = (scaleKey, values) => IMPACT_SETTING_FIELDS.map(field => `
        <div class="bb-vn-impact-row">
            <div class="bb-vn-impact-copy">
                <span class="bb-vn-impact-title">${field.title}</span>
                <span class="bb-vn-impact-token">${field.token}</span>
                <span class="bb-vn-impact-hint">${field.hint}</span>
            </div>
            <input
                type="number"
                inputmode="numeric"
                class="text_pole bb-vn-impact-input"
                data-impact-scale="${scaleKey}"
                data-impact-key="${field.key}"
                min="-100"
                max="100"
                step="1"
                value="${values[field.key]}"
            >
        </div>
    `).join('');
    const impactGroupsHtml = IMPACT_SCALE_GROUPS.map(group => `
        <div class="inline-drawer bb-vn-settings-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>${group.title}</b>
                <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content bb-vn-settings-drawer-content">
                <span class="bb-vn-settings-note">${group.note}</span>
                <div class="bb-vn-impact-list">
                    ${buildImpactFieldsHtml(group.key, normalizeImpactSettings(s[group.key]))}
                </div>
            </div>
        </div>
    `).join('');
    const settingsHtml = `
        <div id="bb-social-settings-wrapper" class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header"><b>💖 BB Visual Novel Engine</b><div class="inline-drawer-icon fa-solid fa-chevron-down down"></div></div>
            <div class="inline-drawer-content bb-vn-settings-shell">
                <span class="bb-vn-settings-intro">Настройки Интерактивного Кино</span>
                <div class="bb-vn-settings-card">
                    <div class="bb-vn-settings-toggle-grid">
                        <label class="checkbox_label bb-vn-setting-pill"><input type="checkbox" id="bb-vn-cfg-autosend" ${s.autoSend ? 'checked' : ''}><span>Авто-отправка при выборе</span></label>
                        <label class="checkbox_label bb-vn-setting-pill"><input type="checkbox" id="bb-vn-cfg-autogen" ${s.autoGen ? 'checked' : ''}><span>Авто-показ вариантов действий</span></label>
                        <label class="checkbox_label bb-vn-setting-pill"><input type="checkbox" id="bb-vn-cfg-emotional-choice" ${s.emotionalChoiceFraming ? 'checked' : ''}><span>Тон и прогноз вариантов</span></label>
                        <label class="checkbox_label bb-vn-setting-pill"><input type="checkbox" id="bb-vn-cfg-disable-tracker" ${s.disableRelationshipTracker ? 'checked' : ''}><span>Отключить трекер отношений</span></label>
                        <label class="checkbox_label bb-vn-setting-pill"><input type="checkbox" id="bb-vn-cfg-moment-antialiased" ${s.momentAntialiased !== false ? 'checked' : ''}><span>Сглаживание текста в Дневнике</span></label>
                        <label class="checkbox_label bb-vn-setting-pill"><input type="checkbox" id="bb-vn-cfg-moment-force-gpu" ${s.momentForceGPU === true ? 'checked' : ''}><span>Принудительный GPU-рендеринг карточек</span></label>
                    </div>
                    <div class="bb-vn-settings-panel">
                        <label for="bb-vn-cfg-reply-length" class="bb-vn-settings-panel-label">Длина VN-ответа</label>
                        <select id="bb-vn-cfg-reply-length" class="text_pole">
                            <option value="short" ${selectedReplyLength === 'short' ? 'selected' : ''}>Короткий - быстрый темп</option>
                            <option value="medium" ${selectedReplyLength === 'medium' ? 'selected' : ''}>Средний - баланс</option>
                            <option value="long" ${selectedReplyLength === 'long' ? 'selected' : ''}>Длинный - больше сцены</option>
                        </select>
                        <span class="bb-vn-settings-note">Влияет и на длину вариантов действий, и на то, насколько активно VN продвигает следующий ответ.</span>
                    </div>
                </div>
                <div class="bb-vn-settings-card bb-vn-settings-card--accent">
                    <span class="bb-vn-settings-section-title">⚡ Custom API</span>
                    <label class="checkbox_label bb-vn-setting-pill bb-vn-setting-pill--single"><input type="checkbox" id="bb-vn-cfg-usecustom" ${s.useCustomApi ? 'checked' : ''}><span>Использовать свой API-ключ</span></label>
                    <div id="bb-vn-custom-api-block" class="bb-vn-settings-stack" style="display: ${s.useCustomApi ? 'flex' : 'none'};">
                        <input type="text" id="bb-vn-cfg-url" class="text_pole" placeholder="URL" value="${s.customApiUrl || ''}">
                        <input type="password" id="bb-vn-cfg-key" class="text_pole" placeholder="API Ключ" value="${s.customApiKey || ''}">
                        <div id="bb-vn-custom-api-status" class="bb-custom-api-status is-idle">
                            <span class="bb-custom-api-status-dot"></span>
                            <span class="bb-custom-api-status-text">Подключение не проверено</span>
                        </div>
                        <button id="bb-vn-btn-connect" class="menu_button bb-vn-settings-button"><i class="fa-solid fa-plug"></i>&nbsp; Подключиться</button>
                        <select id="bb-vn-cfg-model" class="text_pole" ${!s.customApiModel ? 'disabled' : ''}><option value="${s.customApiModel || ''}">${s.customApiModel || 'Модели не загружены'}</option></select>
                    </div>
                </div>
                <label class="checkbox_label bb-vn-setting-pill bb-vn-setting-pill--single"><input type="checkbox" id="bb-vn-cfg-usemacro" ${s.useMacro ? 'checked' : ''}><span>Использовать макрос {{bb_vn}}</span></label>

                <div class="inline-drawer bb-vn-settings-drawer">
                    <div class="inline-drawer-toggle inline-drawer-header">
                        <b>🎚️ Кастомная шкала отношений</b>
                        <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
                    </div>
                    <div class="inline-drawer-content bb-vn-settings-drawer-content">
                        <span class="bb-vn-settings-note">Здесь вы можете задать свои значения для шкал дружбы и романтики. После изменения отношения сразу пересчитываются по всей истории.</span>
                        ${impactGroupsHtml}
                        <button id="bb-vn-impact-reset" class="menu_button bb-vn-settings-button bb-vn-settings-button--ghost">
                            <i class="fa-solid fa-rotate-left"></i>&ensp; Сбросить обе шкалы
                        </button>
                    </div>
                </div>

                <div class="inline-drawer bb-vn-settings-drawer">
                    <div class="inline-drawer-toggle inline-drawer-header">
                        <b>🛠️ Консоль Разработчика</b>
                        <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
                    </div>
                    <div class="inline-drawer-content bb-vn-settings-drawer-content">
                        <input type="text" id="bb-debug-char-name" class="text_pole" placeholder="Имя персонажа">
                        <input type="text" id="bb-debug-reason" class="text_pole" placeholder="Текст причины" value="Дебаг-действие">
                        <div class="bb-vn-settings-actions-grid">
                            <button id="bb-dbg-add-pts" class="menu_button">➕ Дружба</button>
                            <button id="bb-dbg-sub-pts" class="menu_button">➖ Дружба</button>
                            <button id="bb-dbg-add-romance" class="menu_button" style="color:#f472b6; border-color:rgba(244,114,182,0.3);">💖 Романтика</button>
                            <button id="bb-dbg-sub-romance" class="menu_button" style="color:#e11d48; border-color:rgba(225,29,72,0.3);">💔 Романтика</button>
                            <button id="bb-dbg-add-deep-pos" class="menu_button" style="color:#86efac; border-color:rgba(74,222,128,0.3);">🟢 Глубокий светлый</button>
                            <button id="bb-dbg-add-deep-neg" class="menu_button" style="color:#fca5a5; border-color:rgba(251,113,133,0.3);">🔴 Глубокий мрачный</button>
                            <button id="bb-dbg-add-deep-mixed" class="menu_button" style="grid-column:1 / -1; color:#f9a8d4; border-color:rgba(244,114,182,0.28);">🌓 Смешанное +20/-20</button>
                            <button id="bb-dbg-add-trait-pos" class="menu_button" style="color:#86efac; border-color:rgba(74,222,128,0.3);">💎 Светлая черта</button>
                            <button id="bb-dbg-add-trait-neg" class="menu_button" style="color:#fca5a5; border-color:rgba(251,113,133,0.3);">💎 Мрачная черта</button>
                        </div>
                        <button id="bb-dbg-set-status" class="menu_button bb-vn-settings-button" style="color:#93c5fd; border-color:rgba(147,197,253,0.3);">🔄 Изменить статус к вам</button>
                        <hr class="bb-vn-settings-divider">
                        <span class="bb-vn-settings-section-title bb-vn-settings-section-title--small">🧬 Слияние дубликатов</span>
                        <div class="bb-vn-settings-split"><input type="text" id="bb-dbg-merge-from" class="text_pole" placeholder="Кого"><input type="text" id="bb-dbg-merge-to" class="text_pole" placeholder="В кого"></div>
                        <button id="bb-dbg-btn-merge" class="menu_button bb-vn-settings-button" style="color:#c084fc; border-color:rgba(192, 132, 252, 0.3);"><i class="fa-solid fa-code-merge"></i>&ensp; Слить в одного</button>
                        <div id="bb-dbg-merge-suggestions" style="display:flex; flex-direction:column; gap: 0; margin-top: 4px;"></div>
                        <hr class="bb-vn-settings-divider">
                        <button id="bb-dbg-reset-char" class="menu_button bb-vn-settings-button" style="background: rgba(239, 68, 68, 0.2); color: #ef4444; border-color: #ef4444;">💀 Полностью обнулить персонажа</button>
                        <button id="bb-dbg-toast" class="menu_button bb-vn-settings-button"><i class="fa-solid fa-bell"></i>&ensp; Рандомное уведомление</button>
                        <hr class="bb-vn-settings-divider">
                        <span class="bb-vn-settings-section-title bb-vn-settings-section-title--small">✏️ Редактирование событий</span>
                        <span class="bb-vn-settings-note">Выберите сообщение (по индексу) и отредактируйте описание, эмоцию или импакт события. Изменения пересчитают статы.</span>
                        <div class="bb-vn-settings-split">
                            <input type="number" id="bb-dbg-edit-msg-idx" class="text_pole" placeholder="Индекс сообщения" min="0" inputmode="numeric" style="width: 50%;">
                            <button id="bb-dbg-edit-load" class="menu_button bb-vn-settings-button" style="flex:1;"><i class="fa-solid fa-magnifying-glass"></i>&ensp; Загрузить</button>
                        </div>
                        <div id="bb-dbg-edit-events-list" style="display:flex; flex-direction:column; gap:6px; margin-top:4px;"></div>
                    </div>
                </div>

                <div class="bb-vn-settings-card bb-vn-settings-card--snapshot">
                    <span class="bb-vn-settings-section-title">Снимок базы связей</span>
                    <span class="bb-vn-settings-note">Экспорт сохраняет текущие связи, воспоминания, черты, журнал и дневник. Импорт подключает этот снимок как базу текущей персоны и продолжает считать только новые события.</span>
                    <input type="file" id="bb-social-snapshot-file" accept=".json,application/json" style="display:none;">
                    <div class="bb-vn-settings-actions-grid">
                        <button id="bb-social-export-btn" class="menu_button bb-vn-settings-button"><i class="fa-solid fa-file-export"></i>&ensp; Экспорт</button>
                        <button id="bb-social-import-btn" class="menu_button bb-vn-settings-button"><i class="fa-solid fa-file-import"></i>&ensp; Импорт</button>
                    </div>
                    <button id="bb-social-clear-snapshot-btn" class="menu_button bb-vn-settings-button" style="color:#fda4af; border-color:rgba(244,114,182,0.22);">Очистить snapshot-базу</button>
                </div>
                <div class="bb-vn-settings-stack">
                    <button id="bb-social-restore-chars-btn" class="menu_button bb-vn-settings-button">Вернуть скрытых персонажей</button>
                    <button id="bb-social-clear-log-btn" class="menu_button bb-vn-settings-button">Очистить журнал</button>
                    <button id="bb-social-wipe-btn" class="menu_button bb-vn-settings-button bb-vn-settings-button--danger">Сбросить историю</button>
                </div>
            </div>
        </div>
    `;
    const target = document.querySelector("#extensions_settings2") || document.querySelector("#extensions_settings");
    if (target) target.insertAdjacentHTML('beforeend', settingsHtml);

    let lastVerifiedCustomApiFingerprint = '';
    let customApiRuntimeState = '';
    let customApiRuntimeMessage = '';
    const customApiStatusClasses = ['is-idle', 'is-pending', 'is-saved', 'is-connected', 'is-error', 'is-disabled'];

    const buildCustomApiFingerprint = (url = '', key = '') => `${String(url || '').trim()}::${String(key || '').trim()}`;
    const clearCustomApiRuntimeState = () => {
        customApiRuntimeState = '';
        customApiRuntimeMessage = '';
    };

    const setCustomApiStatus = (state = 'idle', text = '') => {
        const status = jQuery('#bb-vn-custom-api-status');
        if (!status.length) return;
        status.removeClass(customApiStatusClasses.join(' ')).addClass(`is-${state}`);
        status.find('.bb-custom-api-status-text').text(text);
    };

    const setCustomApiModelPlaceholder = (label = 'Модели не загружены', value = '') => {
        const select = jQuery('#bb-vn-cfg-model').empty();
        select.append(`<option value="${String(value || '').replace(/"/g, '&quot;')}">${label}</option>`);
        select.prop('disabled', true);
    };

    const syncCustomApiVisualState = () => {
        const useCustomApi = !!extension_settings[MODULE_NAME].useCustomApi;
        const rawUrl = String(jQuery('#bb-vn-cfg-url').val() || '').trim();
        const rawKey = String(jQuery('#bb-vn-cfg-key').val() || '').trim();
        const selectedModel = String(extension_settings[MODULE_NAME].customApiModel || jQuery('#bb-vn-cfg-model').val() || '').trim();
        const currentFingerprint = buildCustomApiFingerprint(rawUrl, rawKey);

        if (!useCustomApi) {
            setCustomApiStatus('disabled', 'Кастомное подключение выключено.');
            return;
        }
        if (!rawUrl) {
            clearCustomApiRuntimeState();
            setCustomApiStatus('idle', 'Укажите URL для проверки подключения.');
            setCustomApiModelPlaceholder('Сначала укажите URL');
            return;
        }
        if (!rawKey) {
            clearCustomApiRuntimeState();
            setCustomApiStatus('idle', 'Добавьте API-ключ для проверки подключения.');
            setCustomApiModelPlaceholder('Нужен API-ключ');
            return;
        }
        if (currentFingerprint && currentFingerprint === lastVerifiedCustomApiFingerprint) {
            if (customApiRuntimeState === 'error') {
                setCustomApiStatus('error', customApiRuntimeMessage || 'Последний запрос к кастомной модели сорвался. Генерация ушла на основную модель.');
                return;
            }
            setCustomApiStatus('connected', selectedModel ? `Подключено: ${selectedModel}` : 'Подключение подтверждено.');
            return;
        }

        clearCustomApiRuntimeState();
        if (selectedModel) {
            setCustomApiModelPlaceholder(`${selectedModel} · требуется переподключение`, selectedModel);
            setCustomApiStatus('saved', `Сохранена модель ${selectedModel}. Нажмите «Подключиться», чтобы проверить соединение.`);
            return;
        }

        setCustomApiModelPlaceholder('Подключение не проверено');
        setCustomApiStatus('idle', 'Подключение не проверено. Нажмите «Подключиться».');
    };

    const customApiHealthHandler = (event) => {
        const detail = event?.detail && typeof event.detail === 'object' ? event.detail : {};
        const runtimeFingerprint = buildCustomApiFingerprint(detail.url || '', detail.key || '');
        const currentFingerprint = buildCustomApiFingerprint(jQuery('#bb-vn-cfg-url').val(), jQuery('#bb-vn-cfg-key').val());
        if (runtimeFingerprint && currentFingerprint && runtimeFingerprint !== currentFingerprint) return;
        customApiRuntimeState = detail.state === 'error' ? 'error' : 'connected';
        customApiRuntimeMessage = String(detail.message || '').trim();
        syncCustomApiVisualState();
    };

    if (window.bbVnCustomApiHealthHandler) {
        window.removeEventListener('bb-vn-custom-api-health', window.bbVnCustomApiHealthHandler);
    }
    window.bbVnCustomApiHealthHandler = customApiHealthHandler;
    window.addEventListener('bb-vn-custom-api-health', customApiHealthHandler);

    const applyModelOptions = (models = [], preferredModel = '') => {
        const select = jQuery('#bb-vn-cfg-model').empty();
        const safeModels = Array.isArray(models)
            ? models.map(m => String(m || '').trim()).filter(Boolean)
            : [];

        if (safeModels.length === 0) {
            select.append('<option value="">Модели не загружены</option>');
            select.prop('disabled', true);
            extension_settings[MODULE_NAME].customApiModel = '';
            return;
        }

        safeModels.forEach(modelId => {
            select.append(`<option value="${modelId}">${modelId}</option>`);
        });

        const initialModel = safeModels.includes(preferredModel)
            ? preferredModel
            : (extension_settings[MODULE_NAME].customApiModel && safeModels.includes(extension_settings[MODULE_NAME].customApiModel)
                ? extension_settings[MODULE_NAME].customApiModel
                : safeModels[0]);

        select.val(initialModel);
        select.prop('disabled', false);
        extension_settings[MODULE_NAME].customApiModel = initialModel;
    };

    jQuery('#bb-vn-cfg-autosend').on('change', function() { extension_settings[MODULE_NAME].autoSend = jQuery(this).is(':checked'); saveSettingsDebounced(); });
    jQuery('#bb-vn-cfg-autogen').on('change', function() { extension_settings[MODULE_NAME].autoGen = jQuery(this).is(':checked'); saveSettingsDebounced(); });
    jQuery('#bb-vn-cfg-emotional-choice').on('change', function() {
        extension_settings[MODULE_NAME].emotionalChoiceFraming = jQuery(this).is(':checked');
        saveSettingsDebounced();
        clearSavedVNOptions();
        restoreVNOptions(false);
        injectCombinedSocialPrompt();
    });
    jQuery('#bb-vn-cfg-disable-tracker').on('change', function() {
        extension_settings[MODULE_NAME].disableRelationshipTracker = jQuery(this).is(':checked');
        saveSettingsDebounced();
        clearSavedVNOptions();
        restoreVNOptions(false);
        injectCombinedSocialPrompt();
        recalculateAllStats(false);
        if (typeof window.updateHudVisibility === 'function') window.updateHudVisibility();
        if (typeof window.renderSocialHud === 'function') window.renderSocialHud();
    });
    jQuery('#bb-vn-cfg-moment-antialiased').on('change', function() {
        extension_settings[MODULE_NAME].momentAntialiased = jQuery(this).is(':checked');
        saveSettingsDebounced();
        applyMomentRenderClasses();
    });
    jQuery('#bb-vn-cfg-moment-force-gpu').on('change', function() {
        extension_settings[MODULE_NAME].momentForceGPU = jQuery(this).is(':checked');
        saveSettingsDebounced();
        applyMomentRenderClasses();
    });
    jQuery('#bb-vn-cfg-reply-length').on('change', function() {
        extension_settings[MODULE_NAME].vnReplyLength = normalizeVnReplyLength(jQuery(this).val());
        saveSettingsDebounced();
        clearSavedVNOptions();
        restoreVNOptions(false);
        injectCombinedSocialPrompt();
    });
    jQuery('#bb-vn-cfg-usecustom').on('change', function() { 
        const isChecked = jQuery(this).is(':checked'); extension_settings[MODULE_NAME].useCustomApi = isChecked;
        if (isChecked) {
            jQuery('#bb-vn-custom-api-block').stop(true, true).css('display', 'none').slideDown(200, function() {
                jQuery(this).css('display', 'flex');
            });
        } else {
            jQuery('#bb-vn-custom-api-block').stop(true, true).slideUp(200);
        }
        if (!isChecked) lastVerifiedCustomApiFingerprint = '';
        clearCustomApiRuntimeState();
        saveSettingsDebounced();
        syncCustomApiVisualState();
    });
    jQuery('#bb-vn-cfg-url, #bb-vn-cfg-key').on('change input', () => {
        extension_settings[MODULE_NAME].customApiUrl = jQuery('#bb-vn-cfg-url').val();
        extension_settings[MODULE_NAME].customApiKey = jQuery('#bb-vn-cfg-key').val();
        if (buildCustomApiFingerprint(extension_settings[MODULE_NAME].customApiUrl, extension_settings[MODULE_NAME].customApiKey) !== lastVerifiedCustomApiFingerprint) {
            lastVerifiedCustomApiFingerprint = '';
        }
        clearCustomApiRuntimeState();
        saveSettingsDebounced();
        syncCustomApiVisualState();
    });
    jQuery(document).on('change', '#bb-vn-cfg-model', function() {
        extension_settings[MODULE_NAME].customApiModel = jQuery(this).val();
        clearCustomApiRuntimeState();
        saveSettingsDebounced();
        syncCustomApiVisualState();
    });
    jQuery('#bb-vn-cfg-usemacro').on('change', function() { extension_settings[MODULE_NAME].useMacro = jQuery(this).is(':checked'); saveSettingsDebounced(); injectCombinedSocialPrompt(); });
    jQuery('.bb-vn-impact-input').on('change', function() {
        const scaleKey = String(jQuery(this).data('impact-scale') || '').trim();
        const key = String(jQuery(this).data('impact-key') || '').trim();
        if (!scaleKey || !key) return;
        const currentImpactValues = normalizeImpactSettings(extension_settings[MODULE_NAME][scaleKey]);
        const fallback = currentImpactValues[key];
        const normalized = normalizeImpactValue(jQuery(this).val(), fallback);
        extension_settings[MODULE_NAME][scaleKey] = {
            ...currentImpactValues,
            [key]: normalized,
        };
        jQuery(this).val(normalized);
        saveSettingsDebounced();
        recalculateAllStats(false);
    });
    jQuery('#bb-vn-impact-reset').on('click', function() {
        const defaults = resolveImpactScaleSettings();
        extension_settings[MODULE_NAME].friendshipImpactValues = defaults.friendshipImpactValues;
        extension_settings[MODULE_NAME].romanceImpactValues = defaults.romanceImpactValues;
        IMPACT_SCALE_GROUPS.forEach(group => {
            IMPACT_SETTING_FIELDS.forEach(field => {
                jQuery(`.bb-vn-impact-input[data-impact-scale="${group.key}"][data-impact-key="${field.key}"]`).val(defaults[group.key][field.key]);
            });
        });
        saveSettingsDebounced();
        recalculateAllStats(false);
        notifySuccess("Обе шкалы сброшены.");
    });

    jQuery('#bb-vn-btn-connect').on('click', async function() {
        const btn = jQuery(this); btn.html('...');
        clearCustomApiRuntimeState();
        setCustomApiStatus('pending', 'Проверяем подключение и загружаем модели...');
        try {
            const rawUrl = String(jQuery('#bb-vn-cfg-url').val() || '').trim();
            const rawKey = String(jQuery('#bb-vn-cfg-key').val() || '').trim();
            if (!rawUrl) throw new Error('URL пустой');

            extension_settings[MODULE_NAME].customApiUrl = rawUrl;
            extension_settings[MODULE_NAME].customApiKey = rawKey;

            // @ts-ignore
            const response = await fetch(rawUrl.replace(/\/$/, '') + '/models', { headers: { 'Authorization': `Bearer ${rawKey}` } });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            if (data?.data) {
                const modelIds = data.data.map(m => m?.id).filter(Boolean);
                applyModelOptions(modelIds, extension_settings[MODULE_NAME].customApiModel || '');
                extension_settings[MODULE_NAME].useCustomApi = true;
                jQuery('#bb-vn-cfg-usecustom').prop('checked', true);
                lastVerifiedCustomApiFingerprint = buildCustomApiFingerprint(rawUrl, rawKey);
                clearCustomApiRuntimeState();
                const activeModel = String(extension_settings[MODULE_NAME].customApiModel || jQuery('#bb-vn-cfg-model').val() || '').trim();
                setCustomApiStatus('connected', activeModel
                    ? `Подключено: ${activeModel}. Найдено моделей: ${modelIds.length}.`
                    : `Подключено. Найдено моделей: ${modelIds.length}.`);
                saveSettingsDebounced();
                notifySuccess("Модели загружены!");
            } else {
                throw new Error('Список моделей пустой');
            }
        } catch (e) {
            lastVerifiedCustomApiFingerprint = '';
            clearCustomApiRuntimeState();
            const savedModel = String(extension_settings[MODULE_NAME].customApiModel || '').trim();
            if (savedModel) setCustomApiModelPlaceholder(`${savedModel} · подключение не подтверждено`, savedModel);
            else setCustomApiModelPlaceholder('Подключение не удалось');
            setCustomApiStatus('error', 'Ошибка подключения. Проверьте URL, ключ и доступность API.');
            console.error('[BB VN] Ошибка подключения custom API:', e);
            notifyError("Ошибка подключения или пустой список моделей.");
        } finally { btn.html('Подключиться'); }
    });

    syncCustomApiVisualState();

    jQuery('#bb-dbg-add-pts').on('click', () => injectDebugData('major_positive'));
    jQuery('#bb-dbg-sub-pts').on('click', () => injectDebugData('major_negative'));
    jQuery('#bb-dbg-add-romance').on('click', () => injectDebugData('major_positive', true));
    jQuery('#bb-dbg-sub-romance').on('click', () => injectDebugData('major_negative', true));
    jQuery('#bb-dbg-add-deep-pos').on('click', () => injectDebugData('life_changing', false));
    jQuery('#bb-dbg-add-deep-neg').on('click', () => injectDebugData('unforgivable', false));
    jQuery('#bb-dbg-add-deep-mixed').on('click', () => injectMixedDeepDebugData());

    jQuery('#bb-dbg-add-trait-pos').on('click', function() {
        const charName = String(jQuery('#bb-debug-char-name').val()).trim();
        const trait = normalizeDebugTraitText(jQuery('#bb-debug-reason').val(), 'Светлая черта');
        if(!charName || !trait) return notifyError("Укажите имя и текст черты!");
        const chat = SillyTavern.getContext().chat; if (!chat?.length) return;
        const lastMsg = chat[chat.length - 1]; const sId = lastMsg.swipe_id || 0;
        if (!lastMsg.extra) lastMsg.extra = {}; if (!lastMsg.extra.bb_vn_char_traits_swipes) lastMsg.extra.bb_vn_char_traits_swipes = {};
        if (!lastMsg.extra.bb_vn_char_traits_swipes[sId]) lastMsg.extra.bb_vn_char_traits_swipes[sId] = [];
        lastMsg.extra.bb_vn_char_traits_swipes[sId].push({ charName, trait, type: 'positive', scope: getCurrentPersonaScopeKey() });
        saveChatDebounced(); recalculateAllStats(false); notifySuccess("Черта внедрена.");
    });

    jQuery('#bb-dbg-add-trait-neg').on('click', function() {
        const charName = String(jQuery('#bb-debug-char-name').val()).trim();
        const trait = normalizeDebugTraitText(jQuery('#bb-debug-reason').val(), 'Мрачная черта');
        if(!charName || !trait) return notifyError("Укажите имя и текст черты!");
        const chat = SillyTavern.getContext().chat; if (!chat?.length) return;
        const lastMsg = chat[chat.length - 1]; const sId = lastMsg.swipe_id || 0;
        if (!lastMsg.extra) lastMsg.extra = {}; if (!lastMsg.extra.bb_vn_char_traits_swipes) lastMsg.extra.bb_vn_char_traits_swipes = {};
        if (!lastMsg.extra.bb_vn_char_traits_swipes[sId]) lastMsg.extra.bb_vn_char_traits_swipes[sId] = [];
        lastMsg.extra.bb_vn_char_traits_swipes[sId].push({ charName, trait, type: 'negative', scope: getCurrentPersonaScopeKey() });
        saveChatDebounced(); recalculateAllStats(false); notifySuccess("Черта внедрена.");
    });

    jQuery('#bb-dbg-set-status').on('click', function() {
        const charName = String(jQuery('#bb-debug-char-name').val()).trim();
        const status = String(jQuery('#bb-debug-reason').val()).trim();
        if(!charName || !status) return notifyError("Укажите имя и статус!");
        const chat = SillyTavern.getContext().chat; if (!chat?.length) return;
        const lastMsg = chat[chat.length - 1]; const sId = lastMsg.swipe_id || 0;
        if (!lastMsg.extra) lastMsg.extra = {}; if (!lastMsg.extra.bb_social_swipes) lastMsg.extra.bb_social_swipes = {};
        if (!lastMsg.extra.bb_social_swipes[sId]) lastMsg.extra.bb_social_swipes[sId] = [];
        lastMsg.extra.bb_social_swipes[sId].push({ name: charName, friendship_impact: "none", romance_impact: "none", status, manual_status: true, reason: "Ручная смена статуса", emotion: "дебаг", scope: getCurrentPersonaScopeKey() });
        saveChatDebounced(); recalculateAllStats(false); notifySuccess("Статус изменен.");
    });

    jQuery('#bb-dbg-btn-merge').on('click', async function() {
        bindActivePersonaState();
        const from = String(jQuery('#bb-dbg-merge-from').val()).trim(), to = String(jQuery('#bb-dbg-merge-to').val()).trim();
        if(!from || !to || from === to) return notifyError("Некорректные имена!");

        let confirmed = false;
        try {
            confirmed = await SillyTavern.getContext().callPopup(
                `<h3>Подтвердить слияние?</h3><p><strong>${from}</strong> будет объединён с <strong>${to}</strong>.</p><p><span style="font-size:12px; color:#94a3b8;">Это затронет журнал, память, связи и алиасы. Перед слиянием лучше сделать снапшот.</span></p>`,
                'confirm'
            );
        } catch (error) {
            console.warn('[BB VN] Failed to show merge confirmation popup', error);
            confirmed = false;
        }

        if (!confirmed) {
            notifyInfo('Слияние отменено.');
            return;
        }

        const result = mergeCharacterRecords(from, to);
        if(result.ok) { saveChatDebounced(); recalculateAllStats(false); renderMergeSuggestionsList(); notifySuccess(result.same ? `Это уже один и тот же персонаж: ${result.targetName}` : `Слито записей: ${result.count}`); } else notifyError("Персонаж не найден.");
    });

    jQuery('#bb-dbg-reset-char').on('click', () => {
        const { scopeState, aliasSet } = bindActivePersonaState();
        const name = String(jQuery('#bb-debug-char-name').val()).trim();
        if(!name) return notifyError("Укажите имя!");
        const resolved = resolveCharacterIdentity(name, { allowCreate: false, allowSuggestions: false });
        const canonicalName = resolved?.primaryName || name;
        if(chat_metadata['bb_vn_char_bases']) delete chat_metadata['bb_vn_char_bases'][canonicalName];
        if(chat_metadata['bb_vn_char_bases_romance']) delete chat_metadata['bb_vn_char_bases_romance'][canonicalName];
        if (resolved?.id && chat_metadata['bb_vn_char_registry']) delete chat_metadata['bb_vn_char_registry'][resolved.id];
        if (scopeState.snapshot_baseline?.characters) delete scopeState.snapshot_baseline.characters[canonicalName];
        if (scopeState.snapshot_baseline?.char_bases) delete scopeState.snapshot_baseline.char_bases[canonicalName];
        if (scopeState.snapshot_baseline?.char_bases_romance) delete scopeState.snapshot_baseline.char_bases_romance[canonicalName];
        const matchesTargetCharacter = (value = '') => {
            const raw = String(value || '').trim();
            if (!raw) return false;
            if (raw === name || raw === canonicalName) return true;
            const resolvedTarget = resolveCharacterIdentity(raw, { allowCreate: false, allowSuggestions: false });
            return (resolvedTarget?.primaryName || raw) === canonicalName;
        };
        const chat = SillyTavern.getContext().chat;
        if(chat) {
            chat.forEach(msg => {
                if(msg.extra?.bb_social_swipes) { for(const sId in msg.extra.bb_social_swipes) { if(Array.isArray(msg.extra.bb_social_swipes[sId])) msg.extra.bb_social_swipes[sId] = msg.extra.bb_social_swipes[sId].filter(u => (u?.scope && !aliasSet.has(u.scope)) || !matchesTargetCharacter(u.name)); } }
                if(msg.extra?.bb_vn_char_traits_swipes) { for(const sId in msg.extra.bb_vn_char_traits_swipes) { if(Array.isArray(msg.extra.bb_vn_char_traits_swipes[sId])) msg.extra.bb_vn_char_traits_swipes[sId] = msg.extra.bb_vn_char_traits_swipes[sId].filter(t => (t?.scope && !aliasSet.has(t.scope)) || !matchesTargetCharacter(t.charName)); } }
            });
        }
        saveChatDebounced(); recalculateAllStats(false); notifySuccess("Персонаж обнулен.");
    });

    jQuery('#bb-dbg-toast').on('click', () => {
        const sample = [
            { title: 'Тестовый сигнал', text: 'Проверка системного уведомления.', badge: 'Дебаг', variant: 'system', icon: 'fa-solid fa-bug' },
            { title: 'Память отозвалась', text: 'Так выглядит тематический toast памяти.', badge: 'Дебаг', variant: 'memory', icon: 'fa-solid fa-book-open-reader' },
            { title: 'Связь потеплела', text: 'Так выглядит toast сближения.', badge: 'Дебаг', variant: 'bond', icon: 'fa-solid fa-handshake-angle' },
            { title: 'Искра сработала', text: 'Так выглядит романтический toast.', badge: 'Дебаг', variant: 'romance', icon: 'fa-solid fa-heart' },
            { title: 'Надлом маршрута', text: 'Так выглядит тревожный toast разлада.', badge: 'Дебаг', variant: 'fracture', icon: 'fa-solid fa-heart-crack' },
            { title: 'Редкий момент', text: 'Так выглядит усиленный toast крупного события.', badge: 'Дебаг', variant: 'legendary', icon: 'fa-solid fa-gem' },
        ][Math.floor(Math.random() * 6)];
        const types = ['system', 'memory', 'bond', 'romance', 'fracture', 'legendary'];
        showHudToast(sample);
    });

    const IMPACT_TOKEN_OPTIONS = ['none', 'minor_positive', 'minor_negative', 'major_positive', 'major_negative', 'life_changing', 'unforgivable'];
    const IMPACT_TOKEN_LABELS = { none: 'Нет', minor_positive: '🟢 Слабый +', minor_negative: '🔴 Слабый −', major_positive: '🟢 Сильный +', major_negative: '🔴 Сильный −', life_changing: '✨ Судьбоносный +', unforgivable: '💀 Критический −' };

    function renderEditEventsList(messageIndex) {
        const container = jQuery('#bb-dbg-edit-events-list');
        container.empty();
        const updates = getSocialUpdatesForMessage(messageIndex);
        if (updates.length === 0) {
            container.html('<div style="font-size:11px; color:#94a3b8; padding:4px 0;">У этого сообщения нет событий.</div>');
            return;
        }
        updates.forEach((u, i) => {
            const impactOptionsHtml = (currentValue, fieldName) => IMPACT_TOKEN_OPTIONS.map(opt =>
                `<option value="${opt}" ${opt === currentValue ? 'selected' : ''}>${IMPACT_TOKEN_LABELS[opt] || opt}</option>`
            ).join('');
            const card = jQuery(`
                <div class="bb-vn-edit-event-card" data-msg-idx="${messageIndex}" data-update-idx="${i}" style="border:1px solid rgba(148,163,184,0.2); border-radius:8px; padding:8px; background:rgba(15,23,42,0.3);">
                    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:6px;">
                        <strong style="font-size:12px; color:#e2e8f0;">${i + 1}. ${u.name}</strong>
                    </div>
                    <div style="display:flex; flex-direction:column; gap:4px;">
                        <input type="text" class="text_pole bb-edit-reason" value="${(u.reason || '').replace(/"/g, '&quot;')}" placeholder="Описание / причина" style="font-size:12px;">
                        <input type="text" class="text_pole bb-edit-emotion" value="${(u.emotion || '').replace(/"/g, '&quot;')}" placeholder="Эмоция" style="font-size:12px;">
                        <div style="display:flex; gap:4px;">
                            <select class="text_pole bb-edit-friendship" style="font-size:11px; flex:1;">${impactOptionsHtml(u.friendship_impact)}</select>
                            <select class="text_pole bb-edit-romance" style="font-size:11px; flex:1;">${impactOptionsHtml(u.romance_impact)}</select>
                        </div>
                        <button type="button" class="menu_button bb-dbg-event-save" data-msg-idx="${messageIndex}" data-update-idx="${i}" style="font-size:11px; padding:4px 12px; color:#4ade80; border-color:rgba(74,222,128,0.3); margin-top:2px;"><i class="fa-solid fa-floppy-disk"></i>&ensp;Сохранить</button>
                        <button type="button" class="menu_button bb-dbg-event-delete" data-msg-idx="${messageIndex}" data-update-idx="${i}" style="font-size:11px; padding:4px 12px; color:#f87171; border-color:rgba(248,113,113,0.3);"><i class="fa-solid fa-trash-can"></i></button>
                    </div>
                </div>
            `);
            container.append(card);
        });
    }

    jQuery('#bb-dbg-edit-load').on('click', function() {
        const msgIdx = parseInt(jQuery('#bb-dbg-edit-msg-idx').val(), 10);
        if (Number.isNaN(msgIdx) || msgIdx < 0) return notifyError('Укажите корректный индекс сообщения!');
        const chat = SillyTavern.getContext()?.chat;
        if (!chat || msgIdx >= chat.length) return notifyError('Сообщение с таким индексом не найдено!');
        renderEditEventsList(msgIdx);
    });

    jQuery('#bb-dbg-edit-msg-idx').on('focus', function() {
        if (jQuery(this).val()) return;
        const chat = SillyTavern.getContext()?.chat;
        if (!chat || !chat.length) return;
        const lastAssistantIdx = [...chat].map((m, i) => ({ m, i })).reverse().find(x => !x.m.is_user)?.i;
        if (lastAssistantIdx !== undefined) jQuery(this).attr('placeholder', `Последний ответ: ${lastAssistantIdx}`);
    });

    jQuery('#bb-dbg-edit-events-list').on('click', '.bb-dbg-event-save', function() {
        const card = jQuery(this).closest('.bb-vn-edit-event-card');
        const msgIdx = parseInt(card.data('msg-idx'), 10);
        const updateIdx = parseInt(card.data('update-idx'), 10);
        const reason = card.find('.bb-edit-reason').val();
        const emotion = card.find('.bb-edit-emotion').val();
        const friendshipImpact = card.find('.bb-edit-friendship').val();
        const romanceImpact = card.find('.bb-edit-romance').val();
        const result = editSocialUpdate({ messageIndex: msgIdx, updateIndex: updateIdx, reason, emotion, friendshipImpact, romanceImpact });
        if (result.ok) {
            if (result.changed) {
                notifySuccess('Событие обновлено. Статы пересчитаны.');
                renderEditEventsList(msgIdx);
            } else {
                notifyInfo('Нет изменений.');
            }
        } else {
            notifyError(result.error || 'Ошибка обновления.');
        }
    });

    jQuery('#bb-dbg-edit-events-list').on('click', '.bb-dbg-event-delete', async function() {
        const msgIdx = parseInt(jQuery(this).data('msg-idx'), 10);
        const updateIdx = parseInt(jQuery(this).data('update-idx'), 10);
        let confirmed = false;
        try {
            confirmed = await SillyTavern.getContext().callPopup(
                `<h3>Удалить событие?</h3><p>Это событие будет удалено, а статы пересчитаны.</p>`,
                'confirm'
            );
        } catch (error) { confirmed = false; }
        if (!confirmed) return;
        const result = deleteSocialUpdate({ messageIndex: msgIdx, updateIndex: updateIdx });
        if (result.ok) {
            notifySuccess('Событие удалено. Статы пересчитаны.');
            renderEditEventsList(msgIdx);
        } else {
            notifyError(result.error || 'Ошибка удаления.');
        }
    });

    window['bbEditLoadEventsForMessage'] = function(msgIdx) {
        jQuery('#bb-dbg-edit-msg-idx').val(msgIdx);
        renderEditEventsList(msgIdx);
    };

    jQuery('#bb-social-export-btn').on('click', () => {
        bindActivePersonaState();
        recalculateAllStats(false);
        const snapshot = exportActivePersonaSnapshot();
        downloadSnapshotFile(snapshot);
        const characterCount = Object.keys(snapshot?.data?.characters || {}).length;
        notifySuccess(`Snapshot экспортирован: ${characterCount} персонажей.`);
    });

    jQuery('#bb-social-import-btn').on('click', () => {
        const input = jQuery('#bb-social-snapshot-file');
        input.val('');
        input.trigger('click');
    });

    jQuery('#bb-social-snapshot-file').on('change', async function() {
        const file = this.files?.[0];
        if (!file) return;
        try {
            const raw = await file.text();
            const result = importActivePersonaSnapshot(raw);
            saveChatDebounced();
            recalculateAllStats(false);
            notifySuccess(`Snapshot импортирован: ${result.characters} персонажей.${result.hasRawUpdates ? ' Сырые данные восстановлены, полный пересчёт от начала чата.' : ' Старые события до точки импорта больше не наслаиваются повторно.'}`);
        } catch (error) {
            console.error('[BB VN] Snapshot import failed:', error);
            notifyError("Не удалось импортировать snapshot. Проверьте JSON-файл.");
        } finally {
            jQuery(this).val('');
        }
    });

    jQuery('#bb-social-clear-snapshot-btn').on('click', () => {
        const hadSnapshot = clearActivePersonaSnapshot();
        saveChatDebounced();
        recalculateAllStats(false);
        if (hadSnapshot) notifyInfo("Snapshot-база очищена. Состояние до импорта восстановлено, расчёт снова идёт от данных чата.");
        else notifyInfo("Активной snapshot-базы не было.");
    });

    jQuery('#bb-social-restore-chars-btn').on('click', () => { const { scopeState } = bindActivePersonaState(); scopeState.ignored_chars = []; chat_metadata['bb_vn_ignored_chars'] = scopeState.ignored_chars; saveChatDebounced(); recalculateAllStats(); notifySuccess("Скрытые персонажи восстановлены!"); });
    jQuery('#bb-social-clear-log-btn').on('click', wipeGlobalLog);
    jQuery('#bb-social-wipe-btn').on('click', wipeAllSocialData);
    renderMergeSuggestionsList();
}

export function applyMomentRenderClasses() {
    const s = extension_settings[MODULE_NAME];
    const hud = document.getElementById('bb-social-hud');
    if (!hud) return;

    hud.classList.toggle('bb-hud-moment-antialiased', s.momentAntialiased !== false);
    hud.classList.toggle('bb-hud-moment-force-gpu', s.momentForceGPU === true);
}
