/**
 * 出单页成交录入器：Suggested 只读 + Actual 可改；Calculate / Confirm & Record。
 * 依赖短链 payload（window.__ARB_SHARE__）与 POST /api/v1/strategy-share/{token}/record。
 */
(function () {
    'use strict';

    // 与 mainpage BASE_CURRENCIES / currencyOptions 一致（数字货币靠前）
    var CCY_ORDER = [
        'USDT', 'USDC', 'BTC', 'ETH', 'BNB', 'SOL', 'TRX', 'XRP', 'DOGE',
        'USD', 'EUR', 'GBP', 'CNY', 'HKD', 'JPY', 'KRW', 'SGD', 'AUD', 'CAD', 'CHF',
        'BRL', 'TRY', 'INR', 'THB', 'VND', 'PHP', 'MYR', 'IDR', 'AED', 'MXN', 'NZD',
        'ZAR', 'PLN', 'SEK', 'NOK', 'DKK', 'OTHER',
    ];
    var PLACE_OPTS = [
        { v: 'placed', l: 'Placed' },
        { v: 'partial', l: 'Partial' },
        { v: 'not_placed', l: 'Not placed' },
        { v: 'failed', l: 'Failed' },
    ];

    var root, rowsEl, budgetEl, roiEl, warnEl, expEl, msgEl, busy = false;
    var share = null;
    var token = '';
    var accountBaseCcy = 'USDT';
    var savedTrade = null; // 最近一笔已落库成交（列表语义：最新）

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function parsePos(v) {
        var n = parseFloat(v);
        return isFinite(n) && n > 0 ? n : 0;
    }

    function parseNonNeg(v) {
        var n = parseFloat(v);
        return isFinite(n) && n >= 0 ? n : NaN;
    }

    function suggestedLegs() {
        var legs = (share && share.legs) || [];
        return legs.map(function (leg, i) {
            var odds = Number(leg.suggested_odds != null ? leg.suggested_odds : (leg.rec_odds || leg.odds || 0));
            var stake = Number(leg.suggested_stake != null ? leg.suggested_stake : (leg.rec_stake || leg.stake || 0));
            return {
                leg_index: i,
                platform: leg.platform || '',
                selection: leg.selection_label || String(leg.bet_type || '').split(':')[0] || '—',
                market: leg.market_short || '',
                ticket: leg.ticket_line || '',
                quote_side: String(leg.quote_side || '').toLowerCase(),
                is_exchange: !!leg.is_exchange,
                suggested_odds: odds > 1 ? odds : 0,
                suggested_stake: stake > 0 ? stake : 0,
                bet_type: leg.bet_type || '',
            };
        });
    }

    function ccyOptions(selected) {
        var sel = String(selected || 'USDT').toUpperCase();
        return CCY_ORDER.map(function (c) {
            return '<option value="' + c + '"' + (c === sel ? ' selected' : '') + '>' + c + '</option>';
        }).join('');
    }

    function placeOptions(selected) {
        var sel = String(selected || 'placed');
        return PLACE_OPTS.map(function (o) {
            return '<option value="' + o.v + '"' + (o.v === sel ? ' selected' : '') + '>' + esc(o.l) + '</option>';
        }).join('');
    }

    function renderRows(preset) {
        if (!rowsEl) return;
        var legs = suggestedLegs();
        var html = '';
        legs.forEach(function (leg, i) {
            var p = (preset && preset[i]) || {};
            var ao = p.actual_odds != null ? p.actual_odds : leg.suggested_odds;
            var as_ = p.actual_stake != null ? p.actual_stake : leg.suggested_stake;
            var ccy = p.currency || accountBaseCcy;
            var st = p.place_status || 'placed';
            var fx = p.fx_rate_to_base != null ? p.fx_rate_to_base : (String(ccy).toUpperCase() === accountBaseCcy ? 1 : '');
            var qs = leg.is_exchange
                ? ('<span class="atr-qs">' + esc((leg.quote_side || 'back').toUpperCase()) + '</span>')
                : '';
            var fmtLine = '';
            if (leg.suggested_odds > 1 && window.HedgeCalcMath && typeof HedgeCalcMath.oddsFormatLine === 'function') {
                fmtLine = HedgeCalcMath.oddsFormatLine(leg.suggested_odds) || '';
            }
            html +=
                '<div class="atr-leg" data-idx="' + i + '">' +
                    '<div class="atr-leg-head">' +
                        '<strong>' + esc(leg.selection) + '</strong>' +
                        '<span>' + esc(leg.market || '—') + '</span>' +
                        qs +
                        '<span>' + esc(leg.platform || '—') + '</span>' +
                    '</div>' +
                    (fmtLine ? ('<div class="leg-odds-formats">' + esc(fmtLine) + '</div>') : '') +
                    '<div class="atr-grid">' +
                        '<label>Suggested Odds<input type="text" class="atr-sug-odds" value="' + esc(leg.suggested_odds || '') + '" readonly></label>' +
                        '<label>Actual Odds<input type="number" class="atr-act-odds" min="1.01" step="0.001" value="' + esc(ao || '') + '"></label>' +
                        '<label>Suggested Stake<input type="text" class="atr-sug-stake" value="' + esc(leg.suggested_stake || '') + '" readonly></label>' +
                        '<label>Actual Stake<input type="number" class="atr-act-stake" min="0" step="0.01" value="' + esc(as_ || '') + '"></label>' +
                        '<label>Currency<select class="atr-ccy">' + ccyOptions(ccy) + '</select></label>' +
                        '<label>FX→Base<input type="number" class="atr-fx" min="0.00000001" step="any" value="' + esc(fx) + '"></label>' +
                        '<label>Status<select class="atr-status">' + placeOptions(st) + '</select></label>' +
                    '</div>' +
                '</div>';
        });
        rowsEl.innerHTML = html || '<p class="atr-empty">No legs in this ticket.</p>';
    }

    function readActualLegs() {
        var nodes = rowsEl ? rowsEl.querySelectorAll('.atr-leg') : [];
        var out = [];
        nodes.forEach(function (node) {
            var idx = parseInt(node.getAttribute('data-idx'), 10);
            var status = (node.querySelector('.atr-status') || {}).value || 'placed';
            var odds = parsePos((node.querySelector('.atr-act-odds') || {}).value);
            var stake = parseNonNeg((node.querySelector('.atr-act-stake') || {}).value);
            var ccy = ((node.querySelector('.atr-ccy') || {}).value || accountBaseCcy).toUpperCase();
            var fxRaw = (node.querySelector('.atr-fx') || {}).value;
            var fx = parsePos(fxRaw);
            if (ccy === accountBaseCcy) {
                fx = fx > 0 ? fx : 1;
            } else if (!(fx > 0)) {
                throw new Error('leg ' + idx + ': FX→Base required when currency ≠ ' + accountBaseCcy);
            }
            out.push({
                leg_index: idx,
                actual_odds: odds || null,
                actual_stake: isFinite(stake) ? stake : null,
                currency: ccy === 'OTHER' ? 'OTHER' : ccy,
                fx_rate_to_base: fx,
                place_status: status,
            });
        });
        return out;
    }

    /** 互斥 BACK 腿：给定实际赔率与金额，最差情景 ROI。 */
    function worstRoiBackLegs(legs) {
        var active = [];
        legs.forEach(function (L) {
            if (L.place_status === 'not_placed' || L.place_status === 'failed') return;
            if (!(L.actual_odds > 1) || !(L.actual_stake >= 0)) return;
            var base = L.actual_stake * (L.fx_rate_to_base || 1);
            active.push({ odds: L.actual_odds, stake: base });
        });
        if (active.length < 2) return null;
        var total = 0;
        active.forEach(function (a) { total += a.stake; });
        if (!(total > 0)) return null;
        var worst = Infinity;
        active.forEach(function (a) {
            var profit = a.stake * a.odds - total;
            if (profit < worst) worst = profit;
        });
        return worst / total;
    }

    function calcMode() {
        var st = String((share && share.strategy_type) || '').toUpperCase();
        var mode = (share && share.calc && share.calc.mode) || '';
        if (mode === 'lay_back' || st === 'LAY_BACK' || /EU-3W|AH-2W|OU-2W|BTTS|DC-3W|DNB|EH-3W/.test(st)) {
            // 出单若是 lay_back 且恰两腿 back+lay
            var legs = (share && share.legs) || [];
            var sides = legs.map(function (l) { return String(l.quote_side || '').toLowerCase(); });
            if (sides.indexOf('lay') >= 0 && sides.indexOf('back') >= 0) return 'lay_back';
        }
        if (mode === 'eu_asia' || st.indexOf('CMH-EU-AH') >= 0 || st === 'EU_ASIA') return 'eu_asia';
        return 'multi_back';
    }

    function calcLayBackRoi(actual) {
        var legs = (share && share.legs) || [];
        var back = null, lay = null;
        actual.forEach(function (a, i) {
            var qs = String((legs[i] && legs[i].quote_side) || '').toLowerCase();
            if (qs === 'lay') lay = a;
            else back = a;
        });
        if (!back || !lay) return worstRoiBackLegs(actual);
        if (!(back.actual_odds > 1) || !(lay.actual_odds > 1)) return null;
        if (!(back.actual_stake > 0)) return null;
        var ob = back.actual_odds, ol = lay.actual_odds;
        if (!(ob > ol)) return null;
        var sb = back.actual_stake * (back.fx_rate_to_base || 1);
        var sl = sb * ob / ol;
        var liability = sl * (ol - 1);
        var profit = sb * (ob - ol) / ol;
        var total = sb + liability;
        return total > 0 ? profit / total : null;
    }

    function calcEuAsiaRoi(actual) {
        if (!actual || actual.length < 2) return null;
        var eu = actual[0], ah = actual[1];
        if (!(eu.actual_odds > 1) || !(ah.actual_odds > 1) || !(eu.actual_stake > 0)) return null;
        var x = eu.actual_stake * (eu.fx_rate_to_base || 1);
        var o = eu.actual_odds, a = ah.actual_odds;
        var y = x * o / a;
        var profit = Math.min(x * (o - 1) - y, y * (a - 1) - x);
        var total = x + y;
        return total > 0 ? profit / total : null;
    }

    function calculateRoi() {
        var actual;
        try {
            actual = readActualLegs();
        } catch (e) {
            if (roiEl) {
                roiEl.textContent = 'Current ROI: —';
                roiEl.className = 'atr-roi';
            }
            setMsg(e && e.message ? e.message : String(e), true);
            return { roi: null, actual: [], exposure: false };
        }
        var mode = calcMode();
        var roi = null;
        if (mode === 'lay_back') roi = calcLayBackRoi(actual);
        else if (mode === 'eu_asia') roi = calcEuAsiaRoi(actual);
        else roi = worstRoiBackLegs(actual);

        var exposure = actual.some(function (a) {
            return a.place_status === 'partial' || a.place_status === 'not_placed' || a.place_status === 'failed';
        });

        if (roiEl) {
            if (roi == null || !isFinite(roi)) {
                roiEl.textContent = 'Current ROI: —';
                roiEl.className = 'atr-roi';
            } else {
                var pct = (roi * 100).toFixed(2) + '%';
                roiEl.textContent = 'Current ROI: ' + (roi >= 0 ? '+' : '') + pct + (roi >= 0 ? ' ✓' : ' ⚠️');
                roiEl.className = 'atr-roi' + (roi >= 0 ? ' ok' : ' bad');
            }
        }
        if (warnEl) {
            if (roi != null && isFinite(roi) && roi < 0) {
                warnEl.hidden = false;
                warnEl.textContent = 'This combination is no longer profitable. You can still Confirm & Record to save the real trade.';
            } else {
                warnEl.hidden = true;
                warnEl.textContent = '';
            }
        }
        if (expEl) {
            if (exposure) {
                expEl.hidden = false;
                expEl.textContent = 'Exposure detected';
            } else {
                expEl.hidden = true;
                expEl.textContent = '';
            }
        }
        return { roi: roi, actual: actual, exposure: exposure };
    }

    function useSuggestedStakes() {
        var legs = suggestedLegs();
        var budget = parsePos(budgetEl && budgetEl.value);
        var sugTotal = 0;
        legs.forEach(function (l) { sugTotal += l.suggested_stake || 0; });
        var nodes = rowsEl ? rowsEl.querySelectorAll('.atr-leg') : [];
        nodes.forEach(function (node, i) {
            var leg = legs[i];
            if (!leg) return;
            var oddsInp = node.querySelector('.atr-act-odds');
            var stakeInp = node.querySelector('.atr-act-stake');
            if (oddsInp && leg.suggested_odds > 1) oddsInp.value = String(leg.suggested_odds);
            if (stakeInp) {
                if (budget > 0 && sugTotal > 0) {
                    stakeInp.value = String(Math.round(budget * (leg.suggested_stake / sugTotal) * 100) / 100);
                } else if (leg.suggested_stake > 0) {
                    stakeInp.value = String(leg.suggested_stake);
                }
            }
            var st = node.querySelector('.atr-status');
            if (st) st.value = 'placed';
        });
        calculateRoi();
        setMsg('Applied suggested stakes' + (budget > 0 ? ' to budget ' + budget : '') + '.', false);
    }

    function setMsg(text, isErr) {
        if (!msgEl) return;
        msgEl.textContent = text || '';
        msgEl.className = 'atr-msg' + (isErr ? ' err' : '');
    }

    function confirmRecord() {
        if (busy || !token) return;
        var st = window.__ARB_OPP_STATUS__ || {};
        if (st.status === 'expired') {
            var ok = window.confirm('This opportunity is expired. Do not place on the original ROI. Save actual fills anyway?');
            if (!ok) return;
        }
        var calc = calculateRoi();
        if (!calc.actual || !calc.actual.length) {
            setMsg('Fix stake/FX before recording', true);
            return;
        }
        var body = {
            base_currency: accountBaseCcy,
            actual_roi: calc.roi != null && isFinite(calc.roi) ? calc.roi : null,
            allow_unprofitable: true,
            legs: calc.actual,
        };
        busy = true;
        setMsg('Saving…', false);
        fetch('/api/v1/strategy-share/' + encodeURIComponent(token) + '/record', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        })
            .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
            .then(function (res) {
                busy = false;
                if (!res.ok || !res.d || res.d.code !== 0) {
                    setMsg((res.d && res.d.message) || 'Record failed', true);
                    return;
                }
                var t = res.d.data || {};
                savedTrade = t;
                updateSupplementBtn();
                var line = 'Recorded #' + (t.id || '') + ' · ' + (t.hedge_status || '');
                if (res.d.exposure) line += ' · Exposure';
                setMsg(line, false);
                if (expEl && res.d.exposure) {
                    expEl.hidden = false;
                    expEl.textContent = 'Exposure detected';
                }
            })
            .catch(function () {
                busy = false;
                setMsg('Network error', true);
            });
    }

    function updateSupplementBtn() {
        var btn = document.getElementById('atrSupplement');
        if (!btn) return;
        var show = !!(savedTrade && savedTrade.id && (savedTrade.exposure_flag || savedTrade.hedge_status === 'exposure'));
        btn.hidden = !show;
    }

    /** 补单：只提交相对已存成交中未 fully placed 的腿。 */
    function supplementRecord() {
        if (busy || !token || !savedTrade || !savedTrade.id) return;
        var calc = calculateRoi();
        if (!calc.actual || !calc.actual.length) {
            setMsg('Fix stake/FX before supplement', true);
            return;
        }
        var needIdx = {};
        (savedTrade.legs || []).forEach(function (leg) {
            var st = String(leg.place_status || '');
            if (st !== 'placed') needIdx[leg.leg_index] = true;
        });
        var legs = calc.actual.filter(function (a) {
            return needIdx[a.leg_index];
        }).map(function (a) {
            var sug = ((share && share.legs) || [])[a.leg_index] || {};
            return {
                leg_index: a.leg_index,
                platform_slug: sug.platform || sug.platform_slug || '',
                selection_label: sug.selection_label || '',
                market_short: sug.market_short || '',
                outcome_type: sug.outcome_type || '',
                direction: sug.bet_type || sug.direction || '',
                quote_side: sug.quote_side || '',
                is_exchange: !!sug.is_exchange,
                line: sug.line != null ? sug.line : null,
                has_line: !!(sug.has_line || sug.line != null),
                suggested_odds: sug.suggested_odds != null ? sug.suggested_odds : sug.odds,
                suggested_stake: sug.suggested_stake != null ? sug.suggested_stake : sug.stake,
                actual_odds: a.actual_odds,
                actual_stake: a.actual_stake,
                currency: a.currency,
                fx_rate_to_base: a.fx_rate_to_base,
                place_status: a.place_status || 'placed',
            };
        });
        if (!legs.length) {
            setMsg('No legs to supplement (all already placed)', true);
            return;
        }
        busy = true;
        setMsg('Supplementing…', false);
        fetch('/api/v1/strategy-share/' + encodeURIComponent(token) + '/supplement', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                parent_trade_id: savedTrade.parent_trade_id || savedTrade.id,
                actual_roi: calc.roi != null && isFinite(calc.roi) ? calc.roi : null,
                legs: legs,
            }),
        })
            .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
            .then(function (res) {
                busy = false;
                if (!res.ok || !res.d || res.d.code !== 0) {
                    setMsg((res.d && res.d.message) || 'Supplement failed', true);
                    return;
                }
                var t = res.d.data || {};
                savedTrade = t;
                updateSupplementBtn();
                setMsg('Supplement #' + (t.id || '') + ' · ' + (t.hedge_status || ''), false);
                if (expEl) {
                    if (t.exposure_flag) {
                        expEl.hidden = false;
                        expEl.textContent = 'Exposure detected';
                    } else {
                        expEl.hidden = true;
                    }
                }
            })
            .catch(function () {
                busy = false;
                setMsg('Network error', true);
            });
    }

    function loadExisting() {
        if (!token) return;
        fetch('/api/v1/strategy-share/' + encodeURIComponent(token) + '/trade')
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (!d || d.code !== 0) return;
                if (d.base_currency) {
                    accountBaseCcy = String(d.base_currency).toUpperCase();
                    var baseHint = document.getElementById('atrBaseCcy');
                    if (baseHint) baseHint.textContent = 'Base: ' + accountBaseCcy;
                }
                if (!d.data || !d.data.legs) {
                    savedTrade = null;
                    updateSupplementBtn();
                    renderRows(null);
                    calculateRoi();
                    return;
                }
                savedTrade = d.data;
                updateSupplementBtn();
                var preset = {};
                (d.data.legs || []).forEach(function (leg) {
                    preset[leg.leg_index] = {
                        actual_odds: leg.actual_odds,
                        actual_stake: leg.actual_stake,
                        currency: leg.currency,
                        fx_rate_to_base: leg.fx_rate_to_base,
                        place_status: leg.place_status,
                    };
                });
                renderRows(preset);
                calculateRoi();
                setMsg('Loaded saved trade #' + d.data.id, false);
            })
            .catch(function () { /* ignore */ });
    }

    function mount(payload, tok) {
        share = payload || null;
        token = String(tok || '').trim();
        root = document.getElementById('arbTradeRecorder');
        if (!root || !share) return;
        root.hidden = false;
        rowsEl = document.getElementById('atrRows');
        budgetEl = document.getElementById('atrBudget');
        roiEl = document.getElementById('atrRoi');
        warnEl = document.getElementById('atrWarn');
        expEl = document.getElementById('atrExposure');
        msgEl = document.getElementById('atrMsg');
        savedTrade = null;
        updateSupplementBtn();
        renderRows(null);
        var sugTotal = 0;
        suggestedLegs().forEach(function (l) { sugTotal += l.suggested_stake || 0; });
        if (budgetEl && sugTotal > 0) budgetEl.value = String(Math.round(sugTotal * 100) / 100);
        calculateRoi();
        loadExisting();
    }

    function bind() {
        var btnUse = document.getElementById('atrUseSuggested');
        var btnCalc = document.getElementById('atrCalculate');
        var btnSave = document.getElementById('atrConfirm');
        var btnSup = document.getElementById('atrSupplement');
        if (btnUse) btnUse.addEventListener('click', function () { useSuggestedStakes(); });
        if (btnCalc) btnCalc.addEventListener('click', function () { calculateRoi(); });
        if (btnSave) btnSave.addEventListener('click', function () { confirmRecord(); });
        if (btnSup) btnSup.addEventListener('click', function () { supplementRecord(); });
        document.addEventListener('input', function (ev) {
            if (!root || root.hidden) return;
            if (ev.target && ev.target.closest && ev.target.closest('#atrRows')) {
                calculateRoi();
            }
        });
        document.addEventListener('change', function (ev) {
            if (!root || root.hidden) return;
            if (ev.target && ev.target.closest && ev.target.closest('#atrRows')) {
                calculateRoi();
            }
        });
    }

    window.ArbTradeRecorder = { mount: mount };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bind);
    } else {
        bind();
    }
})();
