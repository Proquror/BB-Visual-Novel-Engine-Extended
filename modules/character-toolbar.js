import { t, ui, getUiLanguage } from './i18n.js';

let currentChat;
let currentKey = '';
let query = '';
let toolbarOpen = false;
const modes = ['trust_desc', 'trust_asc', 'romance_desc', 'name'];
export const normalizeCharacterSort = value => modes.includes(value) ? value : 'trust_desc';

export function selectCharacterNames(stats, search = '', sort = 'trust_desc', language = getUiLanguage()) {
    const needle = String(search).normalize('NFKC').toLocaleLowerCase(language).trim();
    const names = Object.keys(stats).filter(name => name.normalize('NFKC').toLocaleLowerCase(language).includes(needle));
    const alphabetical = (a, b) => a.localeCompare(b, language, { numeric: true });
    const value = (name, field) => Number.isFinite(Number(stats[name]?.[field])) ? Number(stats[name][field]) : 0;
    const mode = normalizeCharacterSort(sort);
    return names.sort((a, b) => {
        const difference = mode === 'trust_desc' ? value(b, 'affinity') - value(a, 'affinity')
            : mode === 'trust_asc' ? value(a, 'affinity') - value(b, 'affinity')
            : mode === 'romance_desc' ? value(b, 'romance') - value(a, 'romance') : 0;
        return difference || alphabetical(a, b);
    });
}

export function syncCharacterToolbarContext(context, persona) {
    const key = JSON.stringify([context.chatId, context.characterId, context.groupId, persona]);
    if (currentChat !== context.chat || currentKey !== key) { query = ''; currentChat = context.chat; currentKey = key; }
}

export function mountCharacterToolbar(root, stats, settings, context, persona, save) {
    const stack = root.querySelector('.bb-route-card-stack');
    if (!stack) return;
    syncCharacterToolbarContext(context, persona);
    const doc = root.ownerDocument;
    // Disclosure: the search/sort tools live behind a «Поиск и сортировка» pill,
    // so the characters panel stays clean until the user asks for the tools.
    const disclosure = doc.createElement('div');
    disclosure.className = 'bb-character-toolbar-disclosure';
    disclosure.classList.toggle('is-open', toolbarOpen);
    const actions = doc.createElement('div');
    actions.className = 'bb-character-toolbar-actions';
    const toggle = doc.createElement('button');
    toggle.type = 'button';
    toggle.className = 'bb-character-toolbar-toggle';
    toggle.setAttribute('aria-expanded', toolbarOpen ? 'true' : 'false');
    const toggleIcon = doc.createElement('i');
    toggleIcon.className = 'fa-solid fa-magnifying-glass';
    const toggleLabel = doc.createElement('span');
    toggleLabel.textContent = t('Поиск и сортировка');
    const toggleBadge = doc.createElement('span');
    toggleBadge.className = 'bb-character-toolbar-badge';
    const toggleChevron = doc.createElement('i');
    toggleChevron.className = 'fa-solid fa-chevron-down';
    toggle.append(toggleIcon, toggleLabel, toggleBadge, toggleChevron);
    actions.append(toggle);
    disclosure.append(actions);
    const toolbar = doc.createElement('div');
    toolbar.className = 'bb-character-toolbar';
    toolbar.classList.toggle('bb-character-toolbar-collapsed', !toolbarOpen);
    const searchLabel = doc.createElement('label');
    searchLabel.textContent = t('Поиск персонажа');
    const search = doc.createElement('input');
    search.type = 'search'; search.className = 'text_pole'; search.value = query;
    search.placeholder = t('Имя персонажа');
    searchLabel.append(search);
    const sortLabel = doc.createElement('label');
    sortLabel.textContent = t('Сортировка персонажей');
    const sort = doc.createElement('select');sort.className = 'text_pole';
    for (const [value, label] of [['trust_desc', 'Доверие: сначала выше'], ['trust_asc', 'Доверие: сначала ниже'], ['romance_desc', 'Романтика: сначала выше'], ['name', 'По имени']]) {
        const option = doc.createElement('option');option.value = value;option.textContent = t(label);sort.append(option);
    }
    sort.value = normalizeCharacterSort(settings.hudCharacterSort);sortLabel.append(sort);
    const compactLabel = doc.createElement('label');compactLabel.className = 'bb-character-compact-toggle';
    const compact = doc.createElement('input');compact.type = 'checkbox';compact.checked = settings.hudCompactCards === true;
    const compactText = doc.createElement('span');compactText.textContent = t('Компактные карточки');compactLabel.append(compact, compactText);
    const reset = doc.createElement('button');reset.type = 'button';reset.className = 'menu_button';reset.textContent = t('Сбросить поиск');
    const count = doc.createElement('span');count.className = 'bb-character-result-count';count.setAttribute('aria-live', 'polite');
    const empty = doc.createElement('div');empty.className = 'bb-empty-hud';empty.textContent = t('Персонажи не найдены. Измените поиск.');
    toolbar.append(searchLabel, sortLabel, compactLabel, reset, count);
    disclosure.append(toolbar);
    // The disclosure introduces the whole panel: it sits ABOVE the route hero
    // (like a panel header) instead of splitting the hero from the cards.
    const hero = root.querySelector('.bb-panel-hero');
    root.insertBefore(disclosure, hero || stack);
    root.insertBefore(empty, stack);
    const cards = new Map([...stack.querySelectorAll('.bb-char-card')].map(card => [card.dataset.char, card]));
    function update() {
        const names = selectCharacterNames(stats, query, sort.value);
        const visible = new Set(names);
        for (const [name, card] of cards) card.hidden = !visible.has(name);
        for (const name of names) if (cards.has(name)) stack.append(cards.get(name));
        stack.classList.toggle('bb-cards-compact', compact.checked);
        count.textContent = ui`Показано: ${names.length} / ${cards.size}`;
        empty.hidden = names.length > 0;
        reset.disabled = !search.value;
        // While the tools are collapsed, the badge on the toggle is the only
        // reminder that a filter is active.
        const filtering = String(query).trim() !== '' || sort.value !== 'trust_desc';
        toggleBadge.textContent = filtering ? String(names.length) : '';
        toggleBadge.classList.toggle('is-active', filtering);
        toggle.setAttribute('aria-expanded', toolbarOpen ? 'true' : 'false');
    }
    toggle.addEventListener('click', () => {
        toolbarOpen = !toolbarOpen;
        disclosure.classList.toggle('is-open', toolbarOpen);
        toolbar.classList.toggle('bb-character-toolbar-collapsed', !toolbarOpen);
        toggle.setAttribute('aria-expanded', toolbarOpen ? 'true' : 'false');
        if (toolbarOpen) search.focus();
    });
    search.addEventListener('input', () => { query = search.value;update(); });
    reset.addEventListener('click', () => { query = '';search.value = '';update();search.focus(); });
    sort.addEventListener('change', () => { settings.hudCharacterSort = normalizeCharacterSort(sort.value);save();update(); });
    compact.addEventListener('change', () => { settings.hudCompactCards = compact.checked;save();update(); });
    update();
}
