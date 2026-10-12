/**
 * Admin / 管理用户：悬浮框展示待审支付证明 + 未关闭求助工单。
 * Admin 仍连订单 SSE，仅用于交易页自动刷新（面板不再列订单消息；出单通知走官网站内信）。
 */
(function () {
    'use strict';

    if (!window.__CAN_MANAGE_OPS__) return;

    const PROOFS_URL = '/api/v1/service-users/payment-proofs';
    const TICKETS_URL = '/api/v1/help-tickets?status=open';
    const STREAM_URL = '/api/v1/admin/notifications/stream';
    const POLL_MS = 45000;

    let panelOpen = false;
    let pendingProofs = [];
    let openTickets = [];
    let pollTimer = null;
    let es = null;
    let reconnectTimer = null;
    let audioCtx = null;
    let lastBadge = 0;

    function fmtTime(isoStr) {
        if (window.fmtUtc) return window.fmtUtc(isoStr);
        return isoStr || '';
    }

    function escapeHtml(str) {
        if (str == null) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function ensureAudio() {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return Promise.resolve();
        if (!audioCtx) audioCtx = new AC();
        if (audioCtx.state === 'suspended') return audioCtx.resume();
        return Promise.resolve();
    }

    function playNotifySound() {
        ensureAudio().then(() => {
            if (!audioCtx || audioCtx.state !== 'running') return;
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'sine';
            osc.frequency.value = 880;
            gain.gain.value = 0.08;
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start();
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.35);
            osc.stop(audioCtx.currentTime + 0.35);
        }).catch(() => {});
    }

    function armAudioUnlock() {
        const unlock = () => { ensureAudio(); };
        ['pointerdown', 'keydown', 'touchstart'].forEach(ev => {
            document.addEventListener(ev, unlock, { capture: true });
        });
    }

    function badgeCount() {
        return pendingProofs.length + openTickets.length;
    }

    function updateBadge() {
        const badge = document.getElementById('adminNotifyBadge');
        if (!badge) return;
        const n = badgeCount();
        if (n > 0) {
            badge.textContent = n > 99 ? '99+' : String(n);
            badge.classList.remove('d-none');
        } else {
            badge.classList.add('d-none');
        }
        if (n > lastBadge && lastBadge >= 0) {
            playNotifySound();
        }
        lastBadge = n;
    }

    function renderList() {
        const listEl = document.getElementById('adminNotifyList');
        if (!listEl) return;
        const parts = [];
        if (!pendingProofs.length && !openTickets.length) {
            listEl.innerHTML = '<div class="text-muted small text-center py-3">暂无待处理项</div>';
            return;
        }
        if (pendingProofs.length) {
            parts.push('<div class="small fw-semibold text-muted px-1 py-1">支付证明 · 待审</div>');
            pendingProofs.slice(0, 15).forEach(p => {
                parts.push(`
                    <a class="admin-notify-item admin-notify-item-unread text-decoration-none text-dark d-block"
                       href="/service-users/payment-proofs">
                        <div class="d-flex justify-content-between align-items-start gap-2">
                            <div class="fw-semibold small">${escapeHtml(p.username || p.user_id || '用户')}</div>
                            <small class="text-muted text-nowrap">${fmtTime(p.created_at)}</small>
                        </div>
                        <div class="small text-secondary">${escapeHtml(p.plan_id || '')} · ${escapeHtml((p.proof_text || '').slice(0, 80))}</div>
                    </a>`);
            });
        }
        if (openTickets.length) {
            parts.push('<div class="small fw-semibold text-muted px-1 py-1 mt-1">求助工单 · open</div>');
            openTickets.slice(0, 15).forEach(t => {
                parts.push(`
                    <a class="admin-notify-item admin-notify-item-unread text-decoration-none text-dark d-block"
                       href="/service-users/help-tickets">
                        <div class="d-flex justify-content-between align-items-start gap-2">
                            <div class="fw-semibold small">#${escapeHtml(t.id)} ${escapeHtml(t.email || '')}</div>
                            <small class="text-muted text-nowrap">${fmtTime(t.created_at)}</small>
                        </div>
                        <div class="small text-secondary">${escapeHtml((t.message || '').slice(0, 80))}</div>
                    </a>`);
            });
        }
        listEl.innerHTML = parts.join('');
    }

    function loadOps() {
        return Promise.all([
            fetch(PROOFS_URL).then(r => r.json()).catch(() => ({ success: false })),
            fetch(TICKETS_URL).then(r => r.json()).catch(() => ({ success: false })),
        ]).then(([proofBody, ticketBody]) => {
            if (proofBody && proofBody.success) {
                pendingProofs = (proofBody.data || []).filter(p => String(p.status || '') === 'pending');
            }
            if (ticketBody && ticketBody.success) {
                openTickets = ticketBody.data || [];
            }
            updateBadge();
            if (panelOpen) renderList();
        });
    }

    function triggerOrderPageRefresh() {
        window.dispatchEvent(new CustomEvent('admin-order-refresh'));
        if (typeof window.loadDecisions === 'function') window.loadDecisions();
        if (typeof window.loadOrders === 'function') window.loadOrders();
        if (typeof window.loadRiskExposure === 'function') window.loadRiskExposure();
    }

    function connectOrderStream() {
        if (!window.__WEB_ADMIN__) return;
        if (es) {
            es.close();
            es = null;
        }
        es = new EventSource(STREAM_URL);
        es.addEventListener('new_message', () => {
            triggerOrderPageRefresh();
        });
        es.onerror = () => {
            if (es) {
                es.close();
                es = null;
            }
            if (!reconnectTimer) {
                reconnectTimer = setTimeout(() => {
                    reconnectTimer = null;
                    connectOrderStream();
                }, 3000);
            }
        };
    }

    function togglePanel() {
        panelOpen = !panelOpen;
        const panel = document.getElementById('adminNotifyPanel');
        if (!panel) return;
        panel.classList.toggle('d-none', !panelOpen);
        if (panelOpen) {
            const listEl = document.getElementById('adminNotifyList');
            if (listEl) {
                listEl.innerHTML = '<div class="text-muted small text-center py-3">加载中…</div>';
            }
            loadOps();
        }
    }

    function buildWidget() {
        const html = `
            <div id="adminNotifyWidget" class="admin-notify-widget">
                <button type="button" id="adminNotifyToggle" class="admin-notify-fab" title="支付证明 / 求助工单">
                    <i class="bi bi-bell-fill"></i>
                    <span id="adminNotifyBadge" class="admin-notify-badge d-none">0</span>
                </button>
                <div id="adminNotifyPanel" class="admin-notify-panel d-none">
                    <div class="admin-notify-panel-header">
                        <span><i class="bi bi-inboxes"></i> 支付证明 &amp; 求助工单</span>
                        <button type="button" class="btn btn-sm btn-link p-0" id="adminNotifyClose">关闭</button>
                    </div>
                    <div id="adminNotifyList" class="admin-notify-list"></div>
                    <div class="border-top px-2 py-1 d-flex gap-2 small">
                        <a href="/service-users/payment-proofs">全部支付证明</a>
                        <a href="/service-users/help-tickets">全部求助工单</a>
                    </div>
                </div>
            </div>`;
        document.body.insertAdjacentHTML('beforeend', html);
        document.getElementById('adminNotifyToggle').addEventListener('click', togglePanel);
        document.getElementById('adminNotifyClose').addEventListener('click', togglePanel);
    }

    document.addEventListener('DOMContentLoaded', function () {
        buildWidget();
        armAudioUnlock();
        lastBadge = -1;
        loadOps().then(() => { lastBadge = badgeCount(); });
        pollTimer = setInterval(loadOps, POLL_MS);
        connectOrderStream();
    });
})();
