export const TERMS_VERSION = '2026-09-21-v2';

export function termsConfirmationMarkup(id = 'school-terms') {
  return `<div class="platform-terms-confirmation"><input type="checkbox" id="${id}" name="termsAccepted" checked required aria-describedby="${id}-label"><label id="${id}-label" for="${id}">我已閱讀並同意<a href="agreement.html" target="_blank" rel="noopener">使用協議及私隱說明</a></label></div>`;
}

export function bindTermsConfirmation(form) {
  if (!document.querySelector('link[data-platform-terms]')) {
    const style = document.createElement('link');
    style.rel = 'stylesheet'; style.href = 'platform-terms.css?v=20260921-school9';
    style.dataset.platformTerms = 'true'; document.head.append(style);
  }
  const input = form.elements.termsAccepted;
  input.addEventListener('invalid', () => input.setCustomValidity('請先閱讀並同意使用協議及私隱說明。'));
  input.addEventListener('change', () => input.setCustomValidity(''));
}
