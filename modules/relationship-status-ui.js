import { createRelationshipStatusSession } from './social.js';
import { t } from './i18n.js';

export function openRelationshipStatusEditor(charName) {
    if (document.querySelector('.bb-relationship-status-dialog')) return;
    const session = createRelationshipStatusSession(charName);
    const node = (tag, text = '', className = '') => {
        const element = document.createElement(tag);
        element.textContent = text;
        element.className = className;
        return element;
    };
    const dialog = node('dialog', '', 'bb-portrait-dialog bb-relationship-status-dialog');
    const close = () => { dialog.close(); dialog.remove(); };
    const button = (text, action) => {
        const element = node('button', t(text), 'menu_button');
        element.type = 'button';
        element.addEventListener('click', action);
        return element;
    };
    const header = node('header');
    const title = node('h3', t('Статус отношений') + ' · ' + charName);
    title.id = 'bb-relationship-status-title';
    dialog.setAttribute('aria-labelledby', title.id);
    header.append(title, button('Закрыть', close));
    const label = node('label', t('Кем ваш персонаж является для этого персонажа?'));
    const input = node('input', '', 'text_pole');
    input.type = 'text'; input.maxLength = 160;
    input.value = session.value || session.suggestion;
    label.append(input);
    const hint = node('p', t('Например: любимая дочь, давний друг. До 4 слов. Баллы отношений не изменятся.'));
    const suggestion = node('p');
    if (session.suggestion) suggestion.textContent = t('Вариант модели:') + ' ' + session.suggestion;
    const status = node('p', '', 'bb-portrait-status');
    status.setAttribute('role', 'status');
    const save = value => {
        if (!session.save(value)) {
            status.textContent = t('Чат, персона или статус изменились. Откройте редактор заново.');
            return;
        }
        close();
    };
    const footer = node('footer');
    footer.append(button('Автоматически', () => save('')), button('Сохранить', () => {
        if (!input.value.trim()) {
            status.textContent = t('Введите статус или выберите «Автоматически».');
            input.focus(); return;
        }
        save(input.value);
    }));
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.append(header, label, hint, suggestion, status, footer);
    document.body.append(dialog); dialog.showModal(); input.focus();
}
