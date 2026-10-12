/**
 * 列表页筛选：表单 ↔ 地址栏 query。
 * 时间一律 UTC 墙钟（与表格 fmtUtc、库字段一致）。
 * datetime-local 无时区，框里填的就是 UTC 的年月日时分。
 */
(function (global) {
    function pad(n) {
        return String(n).padStart(2, '0');
    }

    function toUtcDatetimeInput(d) {
        const x = d instanceof Date ? d : new Date(d);
        if (isNaN(x.getTime())) return '';
        return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}T${pad(x.getUTCHours())}:${pad(x.getUTCMinutes())}`;
    }

    function defaultRange() {
        const now = new Date();
        const from = new Date(now.getTime());
        from.setUTCMonth(from.getUTCMonth() - 3);
        return { start: toUtcDatetimeInput(from), end: toUtcDatetimeInput(now) };
    }

    function fromUrlDatetime(s) {
        if (!s) return '';
        return String(s).trim().replace(' ', 'T').slice(0, 16);
    }

    function toApiDatetime(val, isEnd) {
        if (!val) return '';
        let s = String(val).trim().replace('T', ' ');
        if (s.endsWith('Z')) s = s.slice(0, -1).trim();
        if (s.endsWith('+00:00')) s = s.slice(0, -6).trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
            return isEnd ? s + ' 23:59:59' : s + ' 00:00:00';
        }
        if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s)) {
            return s + (isEnd ? ':59' : ':00');
        }
        return s;
    }

    function applyToForm(params, fields) {
        for (const f of fields) {
            const el = document.getElementById(f.id);
            if (!el || !params.has(f.key)) continue;
            const raw = params.get(f.key);
            if (f.type === 'check') {
                el.checked = raw === '1' || raw === 'true';
            } else if (f.type === 'datetime') {
                el.value = fromUrlDatetime(raw);
            } else {
                el.value = raw;
            }
        }
    }

    function applyDefaultDates(params, startId, endId) {
        const range = defaultRange();
        const startEl = document.getElementById(startId);
        const endEl = document.getElementById(endId);
        if (startEl && !params.has('start_date')) startEl.value = range.start;
        if (endEl && !params.has('end_date')) endEl.value = range.end;
    }

    function collect(fields) {
        const out = {};
        for (const f of fields) {
            const el = document.getElementById(f.id);
            if (!el) continue;
            if (f.type === 'check') {
                if (el.checked) out[f.key] = '1';
            } else if (el.value !== undefined && el.value !== null && String(el.value) !== '') {
                out[f.key] = el.value;
            }
        }
        return out;
    }

    function readPaging(params, opts) {
        const pageKey = (opts && opts.pageKey) || 'page';
        const pageSizeKeys = (opts && opts.pageSizeKeys) || ['page_size', 'per_page'];
        const pageSizeId = (opts && opts.pageSizeId) || 'pageSizeSelect';
        let page = 1;
        let pageSize = (opts && opts.defaultPageSize) || 20;
        if (params.has(pageKey)) {
            const p = parseInt(params.get(pageKey), 10);
            if (p > 0) page = p;
        }
        for (const key of pageSizeKeys) {
            if (!params.has(key)) continue;
            const s = parseInt(params.get(key), 10);
            if (s > 0) {
                pageSize = s;
                const sel = document.getElementById(pageSizeId);
                if (sel) {
                    const exists = Array.from(sel.options).some(function (o) { return o.value === String(s); });
                    if (!exists) {
                        const o = document.createElement('option');
                        o.value = String(s);
                        o.textContent = String(s);
                        sel.appendChild(o);
                    }
                    sel.value = String(s);
                }
            }
            break;
        }
        return { page: page, pageSize: pageSize };
    }

    function replaceState(values, opts) {
        opts = opts || {};
        const pageKey = opts.pageKey || 'page';
        const pageSizeKey = opts.pageSizeKey || 'page_size';
        const defaultPageSize = opts.defaultPageSize || 20;
        const params = new URLSearchParams();
        Object.keys(values).forEach(function (k) {
            const v = values[k];
            if (v !== undefined && v !== null && String(v) !== '') params.set(k, v);
        });
        if (opts.page && Number(opts.page) > 1) params.set(pageKey, String(opts.page));
        if (opts.pageSize && Number(opts.pageSize) !== defaultPageSize) {
            params.set(pageSizeKey, String(opts.pageSize));
        }
        const qs = params.toString();
        history.replaceState(null, '', qs ? (location.pathname + '?' + qs) : location.pathname);
    }

    global.FilterUrl = {
        toUtcDatetimeInput: toUtcDatetimeInput,
        defaultRange: defaultRange,
        defaultRangeUtc: defaultRange,
        fromUrlDatetime: fromUrlDatetime,
        toApiDatetime: toApiDatetime,
        applyToForm: applyToForm,
        applyDefaultDates: applyDefaultDates,
        collect: collect,
        readPaging: readPaging,
        replaceState: replaceState,
    };
})(window);
