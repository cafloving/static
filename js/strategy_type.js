/**
 * 策略类型展示：STRATEGY1 / STRATEGY2 / 1X2_3W / LAY_BACK / EU_ASIA
 * （勿用 STRATEGY1 ? S1 : S2，会把 1X2_3W 误标成 S2）
 */
(function (global) {
    'use strict';

    function norm(st) {
        return String(st || '').trim().toUpperCase();
    }

    /** 策略目录对外名（config_name / 叶名 → 展示）。内部键不变。 */
    var CONFIG_LABEL = {
        default: 'Global config',
        admin_strategy: 'base',
        global_config: 'Ingest & processing global',
        '1X2-3W': '1x2 3-Way',
        'FT-PRE-1X2-3W': '1x2 3-Way',
        lay_back: 'EU 1x2 Back-Lay (3-Way)',
        eu_asia: '1x2 vs AH Cross-Market Hedge (2-Way)',
        'EU-3W': 'EU 1x2 Back-Lay (3-Way)',
        'AH-2W': 'AH Back-Lay (2-Way)',
        'OU-2W': 'OU Back-Lay (2-Way)',
        'BTTS-2W': 'BTTS Back-Lay (2-Way)',
        'DC-3W': 'Double Chance Back-Lay (3-Way)',
        'DNB-2W': 'DNB Back-Lay (2-Way)',
        'EH-3W': 'European Handicap Back-Lay (3-Way)',
        'C1X2-3W': 'Corners 1x2 Back-Lay (3-Way)',
        'COU-2W': 'Corners OU Back-Lay (2-Way)',
        'CD1X2-3W': 'Cards 1x2 Back-Lay (3-Way)',
        'CDOU-2W': 'Cards OU Back-Lay (2-Way)',
        'AH-ML-2': 'AH Multi-Leg (2)',
        'AH-ML-3': 'AH Multi-Leg (3)',
        'AH-ML-4': 'AH Multi-Leg (4)',
        'OU-ML-2': 'OU Multi-Leg (2)',
        'OU-ML-3': 'OU Multi-Leg (3)',
        'OU-ML-4': 'OU Multi-Leg (4)',
        'CS-ML-N': 'Correct Score Dutching (N+OTHER)',
        'TT-ML-N': 'Team Total Multi-Leg (N)',
        'CMH-EU-AH-2W': '1x2 vs AH Cross-Market Hedge (2-Way)',
        'CMH-EU-AH-3W': '1x2 vs AH Cross-Market Hedge (3-Way, line 0)',
        'CMH-EU-EH': '1x2 vs European Handicap CMH',
        'CMH-EU-DC': '1x2 vs Double Chance CMH',
        'CMH-EU-DNB': '1x2 vs DNB CMH',
        'CMH-AH-EH': 'AH vs European Handicap CMH',
        'CMH-DC-DNB': 'Double Chance vs DNB CMH',
        'CMH-C1X2-CHCP': 'Corners 1x2 vs Corners HCP CMH',
        'CMH-CD1X2-CDHCP': 'Cards 1x2 vs Cards HCP CMH',
        'CMH-EU-OU': '1x2 vs OU CMH',
        'CMP-OU-BTTS': 'OU + BTTS Combination',
        'CMP-OU-TT': 'OU + Team Total Combination',
        'CMP-EU-AH-OU': '1x2 + AH + OU Combination',
        'COR-OU-CS': 'OU + Correct Score Corridor',
        'COR-CS': 'Correct Score Corridor'
    };

    /** 中文对外名（叶名）；与官网 strategyLabelsZh 对齐。 */
    var CONFIG_LABEL_ZH = {
        '1X2-3W': '胜平负三向',
        'EU-3W': '欧盘胜平负 Back/Lay（三项）',
        'AH-2W': '亚洲让球 Back/Lay（两项）',
        'OU-2W': '大小球 Back/Lay（两项）',
        'BTTS-2W': '双方进球 Back/Lay（两项）',
        'DC-3W': '双重机会 Back/Lay（三项）',
        'DNB-2W': '平局退款 Back/Lay（两项）',
        'EH-3W': '欧洲让球 Back/Lay（三项）',
        'C1X2-3W': '角球胜平负 Back/Lay（三项）',
        'COU-2W': '角球大小 Back/Lay（两项）',
        'CD1X2-3W': '牌数胜平负 Back/Lay（三项）',
        'CDOU-2W': '牌数大小 Back/Lay（两项）',
        'AH-ML-2': '亚洲让球多腿（2）',
        'AH-ML-3': '亚洲让球多腿（3）',
        'AH-ML-4': '亚洲让球多腿（4）',
        'OU-ML-2': '大小球多腿（2）',
        'OU-ML-3': '大小球多腿（3）',
        'OU-ML-4': '大小球多腿（4）',
        'CS-ML-N': '波胆配比（N+其它）',
        'TT-ML-N': '球队进球数多腿（N）',
        'CMH-EU-AH-2W': '胜平负×亚盘 跨盘口（两项）',
        'CMH-EU-AH-3W': '胜平负×亚盘零线 跨盘口（三项）',
        'CMH-EU-EH': '胜平负×欧让 跨盘口',
        'CMH-EU-DC': '胜平负×双重机会 跨盘口',
        'CMH-EU-DNB': '胜平负×平局退款 跨盘口',
        'CMH-AH-EH': '亚盘×欧让 跨盘口',
        'CMH-DC-DNB': '双重机会×平局退款 跨盘口',
        'CMH-C1X2-CHCP': '角球胜平负×角球让球 跨盘口',
        'CMH-CD1X2-CDHCP': '牌数胜平负×牌数让球 跨盘口',
        'CMH-EU-OU': '胜平负×大小球 跨盘口',
        'CMP-OU-BTTS': '大小球+双方进球 组合',
        'CMP-OU-TT': '大小球+球队进球 组合',
        'CMP-EU-AH-OU': '胜平负+亚盘+大小球 组合',
        'COR-OU-CS': '大小球+波胆 走廊',
        'COR-CS': '波胆走廊',
        lay_back: '欧盘 Back/Lay',
        eu_asia: '胜平负×亚盘 跨盘口'
    };

    function leafOf(name) {
        return String(name || '').trim().replace(/^FT-(EARLY|CLOSE|LIVE|PRE|HT|FT)-/, '');
    }

    function isHtName(name) {
        return /^FT-HT-/i.test(String(name || '').trim());
    }

    /** 出单简称：半场叶与赛前同叶名，必须带上阶段，避免看成 PRE。 */
    function withPhase(name, text) {
        var shown = String(text || '');
        if (!isHtName(name) || !shown) return shown;
        if (shown.indexOf('半场') >= 0 || /half-?time/i.test(shown)) return shown;
        return (uiLang() === 'zh' ? '半场 · ' : 'Half-time · ') + shown;
    }

    function uiLang() {
        try {
            var html = String(document.documentElement.lang || '').toLowerCase();
            if (html.indexOf('zh') === 0) return 'zh';
            var ls = String(localStorage.getItem('arbi-x-lang') || '').toLowerCase();
            if (ls === 'zh') return 'zh';
        } catch (e) { /* ignore */ }
        return 'en';
    }

    function applyConfigLabels(map) {
        if (!map || typeof map !== 'object') return;
        Object.keys(map).forEach(function (k) {
            var v = String(map[k] || '').trim();
            if (k && v) CONFIG_LABEL[k] = v;
        });
    }

    function applyHeadsLabels(heads) {
        (heads || []).forEach(function (h) {
            if (!h || !h.config_name) return;
            var n = String(h.display_name || '').trim();
            if (n) CONFIG_LABEL[h.config_name] = n;
        });
    }

    function configLabel(name, stored) {
        var k = String(name || '').trim();
        var shown = String(stored || '').trim();
        if (shown) {
            if (k) CONFIG_LABEL[k] = shown;
            if (uiLang() === 'zh' && /[\u4e00-\u9fff]/.test(shown)) return withPhase(k, shown);
            if (uiLang() !== 'zh') return withPhase(k, shown);
        }
        if (uiLang() === 'zh') {
            return withPhase(k, CONFIG_LABEL_ZH[k] || CONFIG_LABEL_ZH[leafOf(k)]
                || CONFIG_LABEL[k] || CONFIG_LABEL[leafOf(k)] || k);
        }
        return withPhase(k, CONFIG_LABEL[k] || CONFIG_LABEL[leafOf(k)] || k);
    }

    function label(st, configName) {
        var cn = String(configName || '').trim();
        if (cn) {
            var shown = configLabel(cn, '');
            if (shown && shown !== cn) return shown;
            var en = CONFIG_LABEL[cn] || CONFIG_LABEL[leafOf(cn)];
            if (en) return withPhase(cn, uiLang() === 'zh'
                ? (CONFIG_LABEL_ZH[cn] || CONFIG_LABEL_ZH[leafOf(cn)] || en)
                : en);
        }
        var zh = uiLang() === 'zh';
        switch (norm(st)) {
            case 'STRATEGY1':
                return 'S1';
            case 'STRATEGY2':
                return 'S2';
            case '1X2_3W':
                return zh ? '胜平负三向' : '1x2 3-Way';
            case 'LAY_BACK':
                return zh ? '同盘口对冲 Back/Lay' : 'Lay-Back';
            case 'EU_ASIA':
                return zh ? '胜平负×亚盘 跨盘口' : 'EU-Asia';
            case 'MULTI_LEG':
                return zh ? '多腿配比' : 'Multi-Leg';
            default:
                return st || '-';
        }
    }

    function labelOf(row) {
        if (!row) return '-';
        if (typeof row === 'string') return label(row);
        return label(row.strategy_type, row.config_name);
    }

    function feeMdOf(row) {
        if (!row) return feeMd('');
        return feeMd(row.config_name || row.strategy_type);
    }

    function badgeClass(st) {
        switch (norm(st)) {
            case 'STRATEGY1':
                return 'bg-success';
            case 'STRATEGY2':
                return 'bg-warning text-dark';
            case '1X2_3W':
                return 'bg-info text-dark';
            case 'LAY_BACK':
                return 'bg-primary';
            case 'EU_ASIA':
                return 'bg-dark';
            case 'MULTI_LEG':
                return 'bg-secondary';
            default:
                return 'bg-secondary';
        }
    }

    /** 两单（Back-Lay / 1x2-AH）1/2MD；N 腿 1/N MD。 */
    function isTwoLeg(st) {
        var n = norm(st);
        return n === 'LAY_BACK' || n === 'EU_ASIA' || n === 'lay_back' || n === 'eu_asia'
            || /-2W$/.test(n) || /(^|-)AH-ML-2$/.test(n);
    }

    function isFourLeg(st) {
        var n = norm(st);
        return /(^|-)AH-ML-4$/.test(n) || /(^|-)OU-ML-4$/.test(n);
    }

    function feeLegs(st, n) {
        var legs = Number(n);
        if (isFinite(legs) && legs >= 2) return Math.floor(legs);
        if (isTwoLeg(st)) return 2;
        if (isFourLeg(st)) return 4;
        return 3;
    }

    function feeMd(st, n) {
        return '1/' + feeLegs(st, n) + 'MD';
    }

    function engineOf(name, head) {
        var k = String(name || '').trim();
        if (leafOf(k) === '1X2-3W') return '1x2_3w';
        var gs = (head && head.global_settings) || {};
        var e = String((head && head.calc_engine) || gs.calc_engine || '').trim();
        if (e) return e;
        if (k === 'admin_strategy' || k === 'default') return '';
        if (/^FT-(EARLY|CLOSE|LIVE|HT|FT)-/.test(k)) return 'deferred';
        if (k === 'FT-PRE-CMH-EU-AH-2W' || k === 'CMH-EU-AH-2W' ||
            k === 'FT-PRE-CMH-EU-AH-3W' || k === 'CMH-EU-AH-3W' ||
            k === 'FT-LIVE-CMH-EU-AH-2W' || k === 'FT-LIVE-CMH-EU-AH-3W' ||
            k === 'eu_asia') return 'eu_asia';
        if (/CMH-|CMP-|COR-/.test(k)) return 'deferred';
        if (/(^|-)CS-ML-N$/.test(k)) return 'deferred';
        if (/^FT-PRE-(AH-ML-3|AH-ML-4|OU-ML-3|OU-ML-4|TT-ML-N)$/.test(k) ||
            k === 'AH-ML-3' || k === 'AH-ML-4' || k === 'OU-ML-3' || k === 'OU-ML-4' || k === 'TT-ML-N') {
            return 'multi_leg';
        }
        if (/-ML-/.test(k) && !/(^|-)AH-ML-2$/.test(k)) return 'deferred';
        if (/(^|-)AH-ML-2$/.test(k) || /-2W$/.test(k) || /-3W$/.test(k)) return 'lay_back';
        return '';
    }

    function isHedgeEditor(name, head) {
        var e = engineOf(name, head);
        return e === 'lay_back' || e === 'eu_asia' || e === 'multi_leg' || e === 'deferred' || e === '1x2_3w';
    }

    function pickHedgeVal(gs, s1, key, fallback) {
        gs = gs || {};
        s1 = s1 || {};
        if (gs[key] != null && gs[key] !== '') return gs[key];
        if (s1[key] != null && s1[key] !== '') return s1[key];
        return fallback;
    }

    /** Admin 服务用户（交易页默认筛选用）。 */
    var ADMIN_SERVICE_USER_ID = 'USR-ADMIN0001';

    /**
     * 填充服务用户下拉：全部 + list_users。
     * opts.defaultUserId：无已选值时默认选中（交易页用 Admin）。
     */
    async function fillUserSelect(selectEl, opts) {
        if (!selectEl) return;
        opts = opts || {};
        const keep = selectEl.value;
        const allLabel = opts.allLabel || '全部用户';
        const defaultUserId = opts.defaultUserId || '';
        selectEl.innerHTML = '<option value="">' + allLabel + '</option>';
        try {
            const res = await fetch('/api/v1/service-users');
            const body = await res.json();
            const users = (body && body.data) || [];
            users.sort(function (a, b) {
                if (a.user_id === ADMIN_SERVICE_USER_ID) return -1;
                if (b.user_id === ADMIN_SERVICE_USER_ID) return 1;
                return 0;
            });
            users.forEach(function (u) {
                const id = u.user_id || '';
                if (!id) return;
                const name = u.username || u.display_name || id;
                const opt = document.createElement('option');
                opt.value = id;
                opt.textContent = name + ' (' + id + ')';
                selectEl.appendChild(opt);
            });
            if (keep) {
                selectEl.value = keep;
            } else if (defaultUserId) {
                selectEl.value = defaultUserId;
            }
            if (defaultUserId && !selectEl.value) {
                selectEl.value = defaultUserId;
            }
        } catch (e) {
            console.warn('fillUserSelect', e);
            if (defaultUserId) {
                const opt = document.createElement('option');
                opt.value = defaultUserId;
                opt.textContent = 'admin (' + defaultUserId + ')';
                selectEl.appendChild(opt);
                selectEl.value = defaultUserId;
            }
        }
    }

    function englishFromBlob(blob) {
        blob = blob || {};
        var name = '';
        if (typeof blob.display_name === 'string' && blob.display_name.trim() && blob.display_name !== blob.config_name) {
            name = blob.display_name.trim();
        }
        var desc = typeof blob.description === 'string' ? blob.description.trim() : '';
        var i18n = blob.i18n;
        if (!i18n && blob.global_settings) i18n = blob.global_settings.i18n;
        var en = i18n && i18n.en && typeof i18n.en === 'object' ? i18n.en : null;
        if (!name && en && typeof en.name === 'string') name = en.name.trim();
        if ((!desc || desc.charAt(0) === '{') && en && typeof en.description === 'string') desc = en.description.trim();
        if (desc.charAt(0) === '{') {
            try {
                var parsed = JSON.parse(desc);
                if (parsed && parsed.en && typeof parsed.en === 'string') desc = parsed.en;
                else if (parsed && parsed.en && typeof parsed.en.description === 'string') desc = parsed.en.description;
                else desc = '';
            } catch (e) {
                desc = '';
            }
        }
        return { name: name, description: desc };
    }

    function fillI18nFields(blob) {
        var copy = englishFromBlob(blob);
        var n = document.getElementById('strategyNameEn') || document.getElementById('i18nName_en');
        var d = document.getElementById('strategyDescEn') || document.getElementById('i18nDesc_en');
        if (n) n.value = copy.name || '';
        if (d) d.value = copy.description || '';
    }

    function readI18nFields() {
        var n = document.getElementById('strategyNameEn') || document.getElementById('i18nName_en');
        var d = document.getElementById('strategyDescEn') || document.getElementById('i18nDesc_en');
        return {
            name: n ? n.value.trim() : '',
            description: d ? d.value.trim() : '',
        };
    }

    function descriptionsJson(copy) {
        copy = copy || readI18nFields();
        return copy.description || '';
    }

    global.StrategyType = {
        label: label,
        labelOf: labelOf,
        feeMdOf: feeMdOf,
        configLabel: configLabel,
        applyConfigLabels: applyConfigLabels,
        applyHeadsLabels: applyHeadsLabels,
        i18nFromBlob: englishFromBlob,
        fillI18nFields: fillI18nFields,
        readI18nFields: readI18nFields,
        descriptionsJson: descriptionsJson,
        CONFIG_LABEL: CONFIG_LABEL,
        badgeClass: badgeClass,
        norm: norm,
        isTwoLeg: isTwoLeg,
        isFourLeg: isFourLeg,
        feeLegs: feeLegs,
        feeMd: feeMd,
        engineOf: engineOf,
        isHedgeEditor: isHedgeEditor,
        pickHedgeVal: pickHedgeVal,
        fillUserSelect: fillUserSelect,
        ADMIN_SERVICE_USER_ID: ADMIN_SERVICE_USER_ID,
    };
})(window);
