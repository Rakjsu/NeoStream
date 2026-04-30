export const SHOW_UP_TO_DATE_MODAL_EVENT = 'showUpToDateModal';

export function showUpToDateModal() {
    window.dispatchEvent(new CustomEvent(SHOW_UP_TO_DATE_MODAL_EVENT));
}
