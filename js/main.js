// /usr/local/app/workspace/betting_platform_complete/web/static/js/main.js
// 博彩平台管理界面通用JavaScript工具库
// 版本: 6.0
// 最后更新: 2026-01-23

// 全局配置
const CONFIG = {
    TOAST_DURATION: 3000,
    DECIMAL_PLACES: 2,
    CURRENCY_SYMBOL: '$'
};

// 工具函数集合
const Utils = {
    // 格式化货币
    formatCurrency: (amount, symbol = CONFIG.CURRENCY_SYMBOL) => {
        if (amount === null || amount === undefined) return '-';
        return `${symbol}${parseFloat(amount).toFixed(CONFIG.DECIMAL_PLACES)}`;
    },

    // 格式化百分比
    formatPercentage: (value, decimals = 2) => {
        if (value === null || value === undefined) return '-';
        return `${(parseFloat(value) * 100).toFixed(decimals)}%`;
    },

    // 格式化日期时间
    formatDateTime: (dateString, format = 'YYYY-MM-DD HH:mm:ss') => {
        if (!dateString) return '-';
        const date = new Date(dateString);
        const pad = (num) => num.toString().padStart(2, '0');
        
        const year = date.getFullYear();
        const month = pad(date.getMonth() + 1);
        const day = pad(date.getDate());
        const hours = pad(date.getHours());
        const minutes = pad(date.getMinutes());
        const seconds = pad(date.getSeconds());
        
        return format
            .replace('YYYY', year)
            .replace('MM', month)
            .replace('DD', day)
            .replace('HH', hours)
            .replace('mm', minutes)
            .replace('ss', seconds);
    },

    // 格式化相对时间
    formatRelativeTime: (dateString) => {
        if (!dateString) return '-';
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now - date;
        
        const seconds = Math.floor(diffMs / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        
        if (days > 0) return `${days}天前`;
        if (hours > 0) return `${hours}小时前`;
        if (minutes > 0) return `${minutes}分钟前`;
        return '刚刚';
    },

    // 复制到剪贴板
    copyToClipboard: async (text) => {
        try {
            await navigator.clipboard.writeText(text);
            Toast.show('已复制到剪贴板', 'success');
            return true;
        } catch (err) {
            console.error('复制失败:', err);
            Toast.show('复制失败', 'error');
            return false;
        }
    },

    // 防抖函数
    debounce: (func, wait) => {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    },

    // 节流函数
    throttle: (func, limit) => {
        let inThrottle;
        return function() {
            const args = arguments;
            const context = this;
            if (!inThrottle) {
                func.apply(context, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    },

    // 生成唯一ID
    generateId: (prefix = 'tmp') => {
        const timestamp = Date.now().toString(36);
        const random = Math.random().toString(36).substr(2, 9);
        return `${prefix}-${timestamp}-${random}`;
    },

    /** 单次 API 请求的 request_id（写入 X-Request-Id，便于对照后端日志） */
    newRequestId: () => {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
        }
        return Utils.generateId('r').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
    },

    // 验证URL
    isValidUrl: (url) => {
        try {
            new URL(url);
            return true;
        } catch {
            return false;
        }
    },

    // 验证邮箱
    isValidEmail: (email) => {
        const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return re.test(email);
    },

    // 验证数字
    isValidNumber: (value) => {
        return !isNaN(parseFloat(value)) && isFinite(value);
    },

    // 验证整数
    isValidInteger: (value) => {
        return Number.isInteger(parseInt(value));
    },

    // 验证正数
    isPositiveNumber: (value) => {
        return Utils.isValidNumber(value) && parseFloat(value) > 0;
    },

    // 验证赔率
    isValidOdds: (odds) => {
        return Utils.isPositiveNumber(odds) && parseFloat(odds) > 1;
    },

    // 计算下注金额（10的整数倍）
    calculateStake: (totalStake, odds, allOdds) => {
        const invSum = allOdds.reduce((sum, odd) => sum + (1 / parseFloat(odd)), 0);
        const stake = (totalStake / parseFloat(odds) / invSum);
        return Math.floor(stake / 10) * 10; // 向下取整到10的整数倍
    },

    // 计算ROI
    calculateROI: (totalStake, profit) => {
        if (!totalStake || totalStake <= 0) return 0;
        return parseFloat(profit) / parseFloat(totalStake);
    },

    // 计算总下注金额
    calculateTotalStake: (stakes) => {
        return Object.values(stakes).reduce((sum, stake) => sum + parseFloat(stake), 0);
    },

    // 深拷贝对象
    deepClone: (obj) => {
        if (obj === null || typeof obj !== 'object') return obj;
        if (obj instanceof Date) return new Date(obj.getTime());
        if (obj instanceof Array) return obj.map(item => Utils.deepClone(item));
        if (typeof obj === 'object') {
            const cloned = {};
            Object.keys(obj).forEach(key => {
                cloned[key] = Utils.deepClone(obj[key]);
            });
            return cloned;
        }
    },

    // 安全获取嵌套属性
    safeGet: (obj, path, defaultValue = null) => {
        return path.split('.').reduce((current, key) => {
            return current && current[key] !== undefined ? current[key] : defaultValue;
        }, obj);
    },

    // 数组去重
    uniqueArray: (arr, key) => {
        if (!key) return [...new Set(arr)];
        const seen = new Set();
        return arr.filter(item => {
            const value = item[key];
            if (seen.has(value)) return false;
            seen.add(value);
            return true;
        });
    },

    // 数组分组
    groupBy: (arr, key) => {
        return arr.reduce((groups, item) => {
            const group = item[key];
            groups[group] = groups[group] || [];
            groups[group].push(item);
            return groups;
        }, {});
    },

    // 排序数组
    sortBy: (arr, key, order = 'asc') => {
        return [...arr].sort((a, b) => {
            const aVal = a[key];
            const bVal = b[key];
            if (order === 'asc') {
                return aVal > bVal ? 1 : -1;
            } else {
                return aVal < bVal ? 1 : -1;
            }
        });
    },

    // 分页
    paginate: (array, pageSize, pageNumber) => {
        return array.slice((pageNumber - 1) * pageSize, pageNumber * pageSize);
    },

    // 搜索过滤
    search: (array, searchTerm, keys = []) => {
        if (!searchTerm) return array;
        const term = searchTerm.toLowerCase();
        return array.filter(item => {
            if (keys.length === 0) {
                return JSON.stringify(item).toLowerCase().includes(term);
            }
            return keys.some(key => {
                const value = Utils.safeGet(item, key, '').toString().toLowerCase();
                return value.includes(term);
            });
        });
    }
};

// Toast通知系统
const Toast = {
    container: null,

    init() {
        if (!this.container) {
            this.container = document.createElement('div');
            this.container.className = 'toast-container position-fixed top-0 end-0 p-3';
            this.container.style.zIndex = '9999';
            document.body.appendChild(this.container);
        }
    },

    show(message, type = 'info', duration = CONFIG.TOAST_DURATION) {
        this.init();
        
        const toastId = Utils.generateId('toast');
        const toast = document.createElement('div');
        toast.id = toastId;
        toast.className = `toast align-items-center text-white bg-${this.getTypeClass(type)} border-0`;
        toast.setAttribute('role', 'alert');
        toast.setAttribute('aria-live', 'assertive');
        toast.setAttribute('aria-atomic', 'true');
        
        toast.innerHTML = `
            <div class="d-flex">
                <div class="toast-body">${message}</div>
                <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
            </div>
        `;
        
        this.container.appendChild(toast);
        
        const bsToast = new bootstrap.Toast(toast, { delay: duration });
        bsToast.show();
        
        toast.addEventListener('hidden.bs.toast', () => {
            toast.remove();
        });
    },

    success(message, duration) {
        this.show(message, 'success', duration);
    },

    error(message, duration) {
        this.show(message, 'danger', duration);
    },

    warning(message, duration) {
        this.show(message, 'warning', duration);
    },

    info(message, duration) {
        this.show(message, 'info', duration);
    },

    getTypeClass(type) {
        const typeMap = {
            'success': 'success',
            'error': 'danger',
            'warning': 'warning',
            'info': 'info'
        };
        return typeMap[type] || 'info';
    }
};

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    Toast.init();
    const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
    tooltipTriggerList.map(tooltipTriggerEl => new bootstrap.Tooltip(tooltipTriggerEl));
});

/**
 * 主单/子单/方向状态（045 后主单 INIT/PARTIAL/FINISH，子单 PENDING/EXECUTED）
 */
const BetStatus = {
    normMain(status) {
        return String(status || '').trim().toUpperCase();
    },
    normSub(status) {
        const s = String(status || '').trim().toUpperCase();
        if (s === 'CANCELLED') return 'CANCEL';
        return s;
    },
    isMainFinished(status) {
        const s = this.normMain(status);
        return s === 'FINISH' || s === 'EXECUTED';
    },
    isMainActionable(status) {
        const s = this.normMain(status);
        return s === 'INIT' || s === 'PARTIAL' || s === 'PENDING';
    },
    isSubPending(status) {
        return this.normSub(status) === 'PENDING';
    },
    isSubExecuted(status) {
        return this.normSub(status) === 'EXECUTED';
    },
    mainLabel(status) {
        const map = {
            INIT: '待补单',
            PARTIAL: '部分成交',
            FINISH: '已完成',
            REJECTED: '已拒绝',
            PENDING: '待执行',
            EXECUTED: '已执行',
            CANCELLED: '已取消',
        };
        return map[this.normMain(status)] || (status || '未知');
    },
    mainBadge(status, fontSize = '0.7rem') {
        const s = this.normMain(status);
        const styles = {
            INIT: 'bg-secondary',
            PARTIAL: 'bg-info text-dark',
            FINISH: 'bg-success',
            REJECTED: 'bg-danger',
            PENDING: 'bg-warning text-dark',
            EXECUTED: 'bg-success',
            CANCELLED: 'bg-secondary',
        };
        const cls = styles[s] || 'bg-light text-dark';
        return `<span class="badge ${cls}" style="font-size:${fontSize};">${this.mainLabel(s)}</span>`;
    },
    fillBadge(fillStatus, fontSize = '0.7rem') {
        const s = String(fillStatus || 'NONE').trim().toUpperCase();
        const map = {
            NONE: ['secondary', '未成交'],
            OPEN: ['warning', '未填满'],
            PARTIAL: ['warning', '部分成交'],
            FILLED: ['success', '已填满'],
            FULL: ['success', '全部成交'],
            CANCELLED: ['secondary', '已取消'],
        };
        const [cls, label] = map[s] || ['secondary', s];
        return `<span class="badge bg-${cls}" style="font-size:${fontSize};">${label}</span>`;
    },
    subBadge(status, fontSize = '0.65rem') {
        const s = this.normSub(status);
        const map = {
            PENDING: ['warning text-dark', '待执行'],
            EXECUTED: ['success', '已成交'],
            CANCEL: ['danger', '已拒绝'],
            EXPIRED: ['secondary', '已过期'],
        };
        const [cls, label] = map[s] || ['secondary', s || '-'];
        return `<span class="badge bg-${cls}" style="font-size:${fontSize};">${label}</span>`;
    },
    dirHasPendingSub(dir) {
        return (dir?.sub_orders || []).some((s) => this.isSubPending(s.status));
    },
    dirIsFilled(dir) {
        if (!dir) return false;
        if (this.isMainFinished(dir.status)) return true;
        return parseFloat(dir.stake_actual || 0) > 0;
    },
    dirDisplayStake(dir) {
        if (!dir) return 0;
        if (this.dirIsFilled(dir) && dir.stake_actual != null) {
            return parseFloat(dir.stake_actual) || 0;
        }
        return parseFloat(dir.stake_planned || dir.stake_planned_calc || 0) || 0;
    },
    dirDisplayOdds(dir) {
        if (!dir) return 0;
        if (this.dirIsFilled(dir) && dir.odds_actual != null) {
            return parseFloat(dir.odds_actual) || 0;
        }
        return parseFloat(dir.odds_at_decision || 0) || 0;
    },
    dirRowClass(dir) {
        if (this.dirHasPendingSub(dir)) return 'text-warning';
        if (this.dirIsFilled(dir)) return 'text-success fw-bold';
        return 'text-muted';
    },
    dirIcon(dir) {
        if (this.dirHasPendingSub(dir)) return 'clock';
        if (this.dirIsFilled(dir)) return 'check-circle-fill';
        return 'x-circle';
    },
    dirStatusBadge(dir, fontSize = '0.7rem') {
        if (!dir) return `<span class="badge bg-secondary" style="font-size:${fontSize};">无</span>`;
        if (this.dirHasPendingSub(dir)) {
            return `<span class="badge bg-warning text-dark" style="font-size:${fontSize};">待执行</span>`;
        }
        const s = this.normMain(dir.status);
        if (s === 'FINISH' || (parseFloat(dir.stake_actual || 0) > 0 && s !== 'REJECTED')) {
            return `<span class="badge bg-success" style="font-size:${fontSize};">已成交</span>`;
        }
        if (s === 'PARTIAL') {
            return `<span class="badge bg-info text-dark" style="font-size:${fontSize};">计划中</span>`;
        }
        return this.mainBadge(s, fontSize);
    },
    countPendingDirections(directions) {
        return Object.values(directions || {}).filter((d) => this.dirHasPendingSub(d)).length;
    },
    isMgmtRowPending(order) {
        const st = this.normMain(order?.status);
        if (st === 'PENDING') return true;
        if (st === 'PARTIAL' || st === 'INIT') return !!(order?.pending_sub_order);
        return false;
    },
    isMgmtRowExecuted(order) {
        const st = this.normMain(order?.status);
        return st === 'EXECUTED' || st === 'FINISH';
    },
};

// 导出到全局作用域
window.Utils = Utils;
window.Toast = Toast;
window.BetStatus = BetStatus;

// 全局注入 X-Request-Id：每个 fetch / jQuery ajax 自动带上，后端日志 [trace_id] 可对齐
(function installRequestIdTransport() {
    function ensureHeader(headers, name, value) {
        if (!headers) return;
        if (typeof headers.has === 'function') {
            if (!headers.has(name)) headers.set(name, value);
            return;
        }
        const lower = name.toLowerCase();
        const keys = Object.keys(headers);
        if (keys.some((k) => k.toLowerCase() === lower)) return;
        headers[name] = value;
    }

    if (typeof window.fetch === 'function') {
        const origFetch = window.fetch.bind(window);
        window.fetch = function (input, init) {
            const opts = init ? Object.assign({}, init) : {};
            let headers = opts.headers;
            if (headers instanceof Headers) {
                headers = new Headers(headers);
            } else if (headers && typeof headers === 'object') {
                headers = Object.assign({}, headers);
            } else {
                headers = {};
            }
            ensureHeader(headers, 'X-Request-Id', Utils.newRequestId());
            const method = String((opts.method || (input && input.method) || 'GET')).toUpperCase();
            if (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
                const nonce = (window.crypto && crypto.getRandomValues)
                    ? Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')
                    : (Utils.newRequestId() + Utils.newRequestId()).replace(/-/g, '').slice(0, 32);
                ensureHeader(headers, 'X-Request-Ts', String(Math.floor(Date.now() / 1000)));
                ensureHeader(headers, 'X-Request-Nonce', nonce);
            }
            opts.headers = headers;
            return origFetch(input, opts);
        };
    }

    if (typeof window.jQuery !== 'undefined' && window.jQuery.ajaxPrefilter) {
        window.jQuery.ajaxPrefilter(function (options, _originalOptions, jqXHR) {
            const headers = options.headers || {};
            const has = Object.keys(headers).some((k) => k.toLowerCase() === 'x-request-id');
            if (!has) {
                jqXHR.setRequestHeader('X-Request-Id', Utils.newRequestId());
            }
            const method = String(options.type || options.method || 'GET').toUpperCase();
            if (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
                const nonce = (window.crypto && crypto.getRandomValues)
                    ? Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')
                    : (Utils.newRequestId() + Utils.newRequestId()).replace(/-/g, '').slice(0, 32);
                jqXHR.setRequestHeader('X-Request-Ts', String(Math.floor(Date.now() / 1000)));
                jqXHR.setRequestHeader('X-Request-Nonce', nonce);
            }
        });
    }
})();