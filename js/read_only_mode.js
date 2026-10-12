/**
 * guest 只读：禁用带 requires-write 的控件；拦截 403 提示。
 */
(function () {
    'use strict';

    if (window.__CAN_WRITE__ !== false) return;

    function applyReadOnlyUi() {
        const selectors = [
            '.requires-write',
            '[data-requires-write="true"]',
            '[data-order-action]',
            '[data-action="execute"]',
            '[data-action="reject"]',
            'button[onclick*="executeOrder"]',
            'button[onclick*="rejectSubOrder"]',
            'button[onclick*="confirmReset"]',
        ].join(', ');
        document.querySelectorAll(selectors).forEach(el => {
            if (el.tagName === 'A') {
                el.classList.add('disabled', 'pe-none', 'opacity-50');
                el.setAttribute('aria-disabled', 'true');
                el.addEventListener('click', e => {
                    e.preventDefault();
                    e.stopPropagation();
                });
            } else {
                el.disabled = true;
            }
            if (!el.title) el.title = '只读账号无权操作';
        });
        document.querySelectorAll('form.requires-write-form').forEach(form => {
            form.addEventListener('submit', e => {
                e.preventDefault();
                showReadOnlyToast();
            });
        });
    }

    function showReadOnlyToast() {
        if (typeof window.showCopyToast === 'function') {
            window.showCopyToast('只读账号无权操作', 'error');
            return;
        }
        alert('只读账号无权操作');
    }

    window.showReadOnlyToast = showReadOnlyToast;
    window.applyReadOnlyUi = applyReadOnlyUi;

    const nativeFetch = window.fetch.bind(window);
    window.fetch = function (...args) {
        return nativeFetch(...args).then(resp => {
            if (resp.status === 403) {
                resp.clone().json().then(data => {
                    const msg = (data && (data.message || data.error)) || '';
                    if (msg.includes('只读') || msg.includes('readonly') || msg.includes('forbidden')) {
                        showReadOnlyToast();
                    }
                }).catch(() => {});
            }
            return resp;
        });
    };

    document.addEventListener('DOMContentLoaded', applyReadOnlyUi);
})();
