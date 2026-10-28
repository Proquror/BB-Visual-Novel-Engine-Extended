/**
 * Shared stacking-priority switch for floating popups.
 *
 * While a popup (toolbar popup or a confirm dialog raised from the HUD) is
 * open, the HUD panel, its backdrop and the toast container drop below the
 * popup overlay; on close they return to their normal stacking order.
 */
export function setHudPopupPriority(isPopupActive) {
    document.body.classList.toggle('bb-hud-popup-active', Boolean(isPopupActive));
}
