/**
 * 策略计算器：
 * - three_way（Admin / S1 / S2）：HOME / DRAW / AWAY 三向配平
 * - lay_back：BACK / LAY 两边对冲（layStake = backStake * Ob/Ol）
 * - eu_asia：欧盘 x、亚盘 y = x×O/A（两边净利相同）
 */
(function () {
    'use strict';

    var THREE_KEYS = ['home', 'draw', 'away'];
    var LB_KEYS = ['back', 'lay'];
    var EA_KEYS = ['eu', 'ah'];
    var HOME_DEFAULT = 100;
    var EPS = 0.005;
    var FX_TTL_MS = 10 * 60 * 1000;
    var FX_CACHE_KEY = 'hedge_fx_cache_v3';
    var CCY_PREF_KEY = 'hedge_fx_ccy_pref_v2';

    var LANG = (window.__HEDGE_CALC_LANG__ === 'en') ? 'en' : 'zh';
    function t(zh, en) { return LANG === 'en' ? en : zh; }

    function parsePos(v) {
        var n = parseFloat(v);
        return isFinite(n) && n > 0 ? n : 0;
    }

    /** 欧式(decimal) → 美式；d≤1 无效。≥2 → +(d-1)*100，(1,2) → -100/(d-1)。 */
    function decimalToAmerican(d) {
        d = parseFloat(d);
        if (!(d > 1)) return null;
        if (d >= 2) return Math.round((d - 1) * 100);
        return Math.round(-100 / (d - 1));
    }

    /** 美式 → 欧式；|a|<100 或 0 视为未成形/无效（不兜底猜）。 */
    function americanToDecimal(a) {
        a = parseFloat(a);
        if (!isFinite(a) || a === 0 || Math.abs(a) < 100) return null;
        if (a > 0) return 1 + a / 100;
        return 1 + 100 / Math.abs(a);
    }

    function formatDecimalOdds(d) {
        if (!(d > 1)) return '';
        return String(Math.round(d * 1000) / 1000);
    }

    function formatAmericanOdds(a) {
        if (a == null || !isFinite(a)) return '';
        return String(a);
    }

    function gcdInt(a, b) {
        a = Math.abs(Math.round(a));
        b = Math.abs(Math.round(b));
        while (b) {
            var t = a % b;
            a = b;
            b = t;
        }
        return a || 1;
    }

    function fmtPosOdds(n) {
        if (!(n > 0) || !isFinite(n)) return '';
        return String(Math.round(n * 1000) / 1000);
    }

    function fmtSignedOdds(n) {
        if (!isFinite(n) || n === 0) return '';
        var s = fmtPosOdds(Math.abs(n));
        return n > 0 ? ('+' + s) : ('-' + s);
    }

    /** 港盘 = 欧 − 1（净赔）。 */
    function decimalToHk(d) {
        d = parseFloat(d);
        if (!(d > 1)) return null;
        return d - 1;
    }

    /** 马来：热门 0～1；冷门（欧≥2）为负，与印尼互为倒数。 */
    function decimalToMalay(d) {
        d = parseFloat(d);
        if (!(d > 1)) return null;
        var h = d - 1;
        if (h >= 1) return -1 / h;
        return h;
    }

    /** 印尼：热门为负；冷门为正。 */
    function decimalToIndo(d) {
        d = parseFloat(d);
        if (!(d > 1)) return null;
        var h = d - 1;
        if (h >= 1) return h;
        return -1 / h;
    }

    function decimalToFractional(d) {
        d = parseFloat(d);
        if (!(d > 1)) return null;
        var x = d - 1;
        var den = 10000;
        var num = Math.round(x * den);
        if (!(num > 0)) return null;
        var g = gcdInt(num, den);
        return (num / g) + '/' + (den / g);
    }

    function decimalToProbPct(d) {
        d = parseFloat(d);
        if (!(d > 1)) return null;
        return 100 / d;
    }

    /** 欧盘一口价 → 七种写法（欧/港/马来/印尼/美/英式/概率）。 */
    function oddsFormats(d) {
        d = parseFloat(d);
        if (!(d > 1)) return null;
        var hk = decimalToHk(d);
        var my = decimalToMalay(d);
        var indo = decimalToIndo(d);
        var us = decimalToAmerican(d);
        var uk = decimalToFractional(d);
        var pr = decimalToProbPct(d);
        if (hk == null || my == null || indo == null || us == null || !uk || pr == null) return null;
        var usTxt = us > 0 ? ('+' + us) : String(us);
        var prTxt = (Math.round(pr * 100) / 100).toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
        return {
            eu: formatDecimalOdds(d),
            hk: fmtPosOdds(hk),
            my: fmtSignedOdds(my),
            id: fmtSignedOdds(indo),
            us: usTxt,
            uk: uk,
            prob: prTxt + '%',
        };
    }

    function oddsFormatLine(d) {
        var f = oddsFormats(d);
        if (!f) return '';
        return 'EU ' + f.eu + ' · HK ' + f.hk + ' · MY ' + f.my + ' · ID ' + f.id +
            ' · US ' + f.us + ' · UK ' + f.uk + ' · Prob ' + f.prob;
    }

    function calcFromAnchor(odds, anchorKey, anchorStake) {
        var oh = odds.home, od = odds.draw, oa = odds.away;
        if (oh <= 1 || od <= 1 || oa <= 1) return null;
        var stake = parsePos(anchorStake);
        if (stake <= 0) return null;
        var oAnchor = odds[anchorKey];
        if (!oAnchor) return null;
        var payout = stake * oAnchor;
        var stakes = {
            home: payout / oh,
            draw: payout / od,
            away: payout / oa,
        };
        var total = stakes.home + stakes.draw + stakes.away;
        var profit = payout - total;
        return {
            stakes: stakes,
            total: total,
            payout: payout,
            profit: profit,
            pct: total > 0 ? profit / total : 0,
        };
    }

    function winFeeRate(rate) {
        var r = Number(rate);
        return isFinite(r) && r > 0 && r < 1 ? r : 0;
    }

    /** 正利润才抽；亏损和走水不抽。 */
    function profitAfterWinFee(gross, rate) {
        var r = winFeeRate(rate);
        if (!(gross > 0) || !(r > 0)) return gross;
        return gross * (1 - r);
    }

    /** lay↔back：按两边输赢分别算利润，抽水只扣打赢一边的盈利。 */
    function calcLayBack(backOdds, layOdds, backStake, backFee, layFee) {
        var ob = parsePos(backOdds), ol = parsePos(layOdds), sb = parsePos(backStake);
        var rb = winFeeRate(backFee), rl = winFeeRate(layFee);
        if (ob <= 1 || ol <= 1 || sb <= 0) return null;
        var obNet = 1 + (ob - 1) * (1 - rb);
        var denom = ol - rl;
        if (!(obNet > 0) || !(denom > 0)) return null;
        var sl = sb * obNet / denom;
        var liability = sl * (ol - 1);
        var backWin = profitAfterWinFee(sb * (ob - 1), rb) - liability;
        var layWin = profitAfterWinFee(sl, rl) - sb;
        var profit = Math.min(backWin, layWin);
        var total = sb + liability;
        return {
            backStake: sb,
            layStake: sl,
            liability: liability,
            total: total,
            payout: total + profit,
            profit: profit,
            pct: total > 0 ? profit / total : 0,
            roi: (rb === 0 && rl === 0) ? (ob / ol) : (total > 0 ? 1 + profit / total : 0),
        };
    }

    function calcLayBackFromLay(backOdds, layOdds, layStake, backFee, layFee) {
        var ob = parsePos(backOdds), ol = parsePos(layOdds), sl = parsePos(layStake);
        var rb = winFeeRate(backFee), rl = winFeeRate(layFee);
        if (ob <= 1 || ol <= 1 || sl <= 0) return null;
        var obNet = 1 + (ob - 1) * (1 - rb);
        var denom = ol - rl;
        if (!(obNet > 0) || !(denom > 0)) return null;
        var sb = sl * denom / obNet;
        return calcLayBack(ob, ol, sb, rb, rl);
    }

    /**
     * 经典等价市场表（与 Go FilterEquivalentLayBackSlots 同组）。
     * DNB ↔ AH line=0：同一经济含义，只比 LayBack ROI，不跨盘配平。
     */
    var EQUIVALENT_LAY_BACK_GROUPS = {
        dnb_ah0: ['DNB-2W', 'AH-2W', 'AH-ML-2'],
    };

    /** 单对 LayBack 盈利倍数 Ob/Ol；无效返回 null。 */
    function layBackROI(backOdds, layOdds) {
        var lb = calcLayBack(backOdds, layOdds, HOME_DEFAULT);
        return lb ? lb.roi : null;
    }

    /**
     * 等价组内只留更高 ROI 的候选。
     * candidates: [{ name, backOdds, layOdds, packageRoi? }, ...]
     * packageRoi 可选：多向完整对冲时传各向 ROI 的最小值（对齐 Go LayBackPackageROI）。
     * 返回胜出项；roi 相等时按 name 字典序取前。无效项直接跳过（不兜底）。
     */
    function pickBetterLayBackEquivalent(candidates) {
        if (!candidates || !candidates.length) return null;
        var best = null;
        for (var i = 0; i < candidates.length; i++) {
            var c = candidates[i];
            if (!c || !c.name) continue;
            var roi = typeof c.packageRoi === 'number' ? c.packageRoi : layBackROI(c.backOdds, c.layOdds);
            if (!(roi > 0)) continue;
            if (!best || roi > best.roi || (roi === best.roi && String(c.name) < String(best.name))) {
                best = { name: c.name, roi: roi, candidate: c };
            }
        }
        return best;
    }

    /**
     * N 向 Dutching（经典 InvSum）：互斥全集 odds[]，inv=Σ(1/oᵢ)。
     * inv>1 无套利 → null；否则 sᵢ = total/(oᵢ·inv)，利润 = total·(1/inv−1)。
     * 波胆全集 / +OTHER 走此式（A）；与 three_way 同公式、结果数 N。
     */
    function calcDutching(oddsArr, totalStake) {
        if (!oddsArr || !oddsArr.length) return null;
        var total = parsePos(totalStake);
        if (total <= 0) return null;
        var inv = 0;
        var odds = [];
        for (var i = 0; i < oddsArr.length; i++) {
            var o = parsePos(oddsArr[i]);
            if (o <= 1) return null;
            odds.push(o);
            inv += 1 / o;
        }
        if (!(inv > 0) || inv > 1 + 1e-12) return null;
        var stakes = [];
        for (var j = 0; j < odds.length; j++) {
            stakes.push(total / (odds[j] * inv));
        }
        var payout = total / inv;
        var profit = payout - total;
        return {
            stakes: stakes,
            odds: odds,
            inv: inv,
            total: total,
            payout: payout,
            profit: profit,
            pct: profit / total,
        };
    }

    function parseLine(v) {
        var n = parseFloat(v);
        return isFinite(n) ? n : null;
    }

    /** 欧盘 x，亚盘 y = x×O/A；两边净利 = x×(O−1)−y = y×(A−1)−x（不是 x×(O−A)/A）。 */
    function calcEuAsia(euOdds, ahOdds, euStake) {
        var o = parsePos(euOdds), a = parsePos(ahOdds), x = parsePos(euStake);
        if (o <= 1 || a <= 1 || x <= 0) return null;
        var y = x * o / a;
        var total = x + y;
        var euWin = x * (o - 1) - y;
        var ahWin = y * (a - 1) - x;
        var profit = Math.min(euWin, ahWin);
        return {
            euStake: x,
            ahStake: y,
            total: total,
            payout: x * o,
            profit: profit,
            pct: total > 0 ? profit / total : 0,
            euWin: euWin,
            ahWin: ahWin,
        };
    }

    function calcEuAsiaFromAh(euOdds, ahOdds, ahStake) {
        var o = parsePos(euOdds), a = parsePos(ahOdds), y = parsePos(ahStake);
        if (o <= 1 || a <= 1 || y <= 0) return null;
        return calcEuAsia(o, a, y * a / o);
    }

    var ML_STAKE_EPS = 1e-8;
    var ML_PNL_EPS = 1e-8;
    var ML_LIN_EPS = 1e-12;
    var BREAK_EVEN_ROI_EPS = 0.005;

    /** 与 calc.asianCover 同口径：买主 cover=(主−客)+line，买客 cover=(客−主)−line。 */
    function asianCover(hg, ag, homeLine, buyHome) {
        if (buyHome) return (hg - ag) + homeLine;
        return (ag - hg) - homeLine;
    }

    /** 四分之一球拆半（与 Go splitQuarterLine 一致）。 */
    function splitQuarterLine(line) {
        var r = Math.round(line * 4);
        if (Math.abs(line * 4 - r) > 1e-9) return null;
        if (Math.abs(r) % 2 === 0) return null;
        return { lo: Math.floor(line * 2) / 2, hi: Math.ceil(line * 2) / 2 };
    }

    /** 半/整线：走水=0，赢=odds-1，输=-1。 */
    function asianHalfLinePnL(cover, odds) {
        if (!(odds > 1)) return null;
        if (Math.abs(cover) < 1e-9) return 0;
        return cover > 0 ? (odds - 1) : -1;
    }

    /** 业界 split-stake 亚盘结算（与 Go asianPnLFactorFromScore 一致）。 */
    function asianPnLFactorFromScore(hg, ag, homeLine, buyHome, odds) {
        var sp = splitQuarterLine(homeLine);
        if (sp) {
            var f1 = asianHalfLinePnL(asianCover(hg, ag, sp.lo, buyHome), odds);
            var f2 = asianHalfLinePnL(asianCover(hg, ag, sp.hi, buyHome), odds);
            if (f1 == null || f2 == null) return null;
            return 0.5 * f1 + 0.5 * f2;
        }
        return asianHalfLinePnL(asianCover(hg, ag, homeLine, buyHome), odds);
    }

    /** @deprecated 仅 cover；四分之一球请用 FromScore。|cover|≈0.75 按半。 */
    function asianPnLFactor(cover, odds) {
        if (!(odds > 1)) return null;
        var abs = Math.abs(cover);
        if (abs < 1e-9) return 0;
        var win = odds - 1;
        if (abs > 0.25 + 1e-9 && Math.abs(abs - 0.75) > 1e-9) return cover > 0 ? win : -1;
        return cover > 0 ? win / 2 : -0.5;
    }

    function euPnLFactor(hg, ag, buyHome, odds) {
        if (!(odds > 1)) return null;
        if (hg === ag) return -1;
        if (buyHome) return hg > ag ? (odds - 1) : -1;
        return ag > hg ? (odds - 1) : -1;
    }

    function drawPnLFactor(hg, ag, odds) {
        if (!(odds > 1)) return null;
        return hg === ag ? (odds - 1) : -1;
    }

    function solveLinear3(M, b) {
        var n = 3;
        var m = [];
        var i, j, r, c, col, pivot, best, div, f;
        for (i = 0; i < n; i++) {
            m[i] = [M[i][0], M[i][1], M[i][2], b[i]];
        }
        for (col = 0; col < n; col++) {
            pivot = col;
            best = Math.abs(m[col][col]);
            for (r = col + 1; r < n; r++) {
                if (Math.abs(m[r][col]) > best) {
                    best = Math.abs(m[r][col]);
                    pivot = r;
                }
            }
            if (best < ML_LIN_EPS) return null;
            if (pivot !== col) {
                var tmp = m[col];
                m[col] = m[pivot];
                m[pivot] = tmp;
            }
            div = m[col][col];
            for (c = col; c <= n; c++) m[col][c] /= div;
            for (r = 0; r < n; r++) {
                if (r === col) continue;
                f = m[r][col];
                if (f === 0) continue;
                for (c = col; c <= n; c++) m[r][c] -= f * m[col][c];
            }
        }
        var x = [m[0][3], m[1][3], m[2][3]];
        for (i = 0; i < 3; i++) {
            if (!isFinite(x[i])) return null;
        }
        return x;
    }

    function euAsia3WScenarioRow(euOdds, drawOdds, ahOdds, homeLine, euHome, ahHome, hg, ag) {
        var euF = euPnLFactor(hg, ag, euHome, euOdds);
        var drF = drawPnLFactor(hg, ag, drawOdds);
        var ahF = asianPnLFactorFromScore(hg, ag, homeLine, ahHome, ahOdds);
        if (euF == null || drF == null || ahF == null) return null;
        return [euF, drF, ahF];
    }

    /**
     * 欧亚三腿（line=0）：与 Go SolveEuAsia3WStakes 同口径。
     * 相对本金和=1；返回 {euStake, drawStake, ahStake, total, profit, pct, worstROI}。
     */
    function calcEuAsia3W(euOdds, drawOdds, ahOdds, totalStake, euHome, ahHome, homeLine) {
        var o = parsePos(euOdds), d = parsePos(drawOdds), a = parsePos(ahOdds);
        var T = parsePos(totalStake);
        if (o <= 1 || d <= 1 || a <= 1 || T <= 0) return null;
        var line = (homeLine == null || !isFinite(homeLine)) ? 0 : homeLine;
        if (Math.abs(line) > 1e-9) return null;
        var rowH = euAsia3WScenarioRow(o, d, a, line, !!euHome, !!ahHome, 1, 0);
        var rowA = euAsia3WScenarioRow(o, d, a, line, !!euHome, !!ahHome, 0, 1);
        var rowD = euAsia3WScenarioRow(o, d, a, line, !!euHome, !!ahHome, 0, 0);
        if (!rowH || !rowA || !rowD) return null;
        var M = [
            [rowH[0] - rowA[0], rowH[1] - rowA[1], rowH[2] - rowA[2]],
            [rowA[0] - rowD[0], rowA[1] - rowD[1], rowA[2] - rowD[2]],
            [1, 1, 1],
        ];
        var x = solveLinear3(M, [0, 0, 1]);
        if (!x) return null;
        var k;
        for (k = 0; k < 3; k++) {
            if (!(x[k] > ML_STAKE_EPS) || !isFinite(x[k])) return null;
        }
        var worst = Infinity;
        var hg, ag, row, pnl;
        for (hg = 0; hg <= 5; hg++) {
            for (ag = 0; ag <= 5; ag++) {
                row = euAsia3WScenarioRow(o, d, a, line, !!euHome, !!ahHome, hg, ag);
                if (!row) return null;
                pnl = row[0] * x[0] + row[1] * x[1] + row[2] * x[2];
                if (pnl < worst) worst = pnl;
            }
        }
        if (!(worst + ML_PNL_EPS >= -1)) return null;
        var euS = T * x[0], drS = T * x[1], ahS = T * x[2];
        var profit = T * worst;
        return {
            euStake: euS,
            drawStake: drS,
            ahStake: ahS,
            total: T,
            payout: T + profit,
            profit: profit,
            pct: worst,
            worstROI: worst,
            ratios: x,
        };
    }

    /** 欧亚两腿 worst ROI（与 Go EvalEuAsiaROI 同配平）。 */
    function evalEuAsiaWorstROI(euOdds, ahOdds, homeLine, euHome, ahHome) {
        var o = parsePos(euOdds), a = parsePos(ahOdds);
        if (o <= 1 || a <= 1) return null;
        var euStake = 1.0, ahStake = o / a, total = euStake + ahStake;
        var worst = Infinity, n = 0;
        var hg, ag, euF, ahF, roi;
        for (hg = 0; hg <= 5; hg++) {
            for (ag = 0; ag <= 5; ag++) {
                euF = euPnLFactor(hg, ag, !!euHome, o);
                if (euF == null) continue;
                ahF = asianPnLFactorFromScore(hg, ag, homeLine, !!ahHome, a);
                if (ahF == null) continue;
                roi = (euF * euStake + ahF * ahStake) / total;
                n++;
                if (roi < worst) worst = roi;
            }
        }
        if (!n) return null;
        return worst;
    }

    /** 用已展示的欧亚投注金额重算 worst ROI（走盘/半赢半输按比分网格）。 */
    function evalEuAsiaStakes(euOdds, ahOdds, euStake, ahStake, homeLine, euHome, ahHome) {
        var o = parsePos(euOdds), a = parsePos(ahOdds);
        var es = parsePos(euStake), as_ = parsePos(ahStake);
        if (o <= 1 || a <= 1 || es <= 0 || as_ <= 0) return null;
        var total = es + as_;
        var worst = Infinity, n = 0, hg, ag, euF, ahF, profit;
        for (hg = 0; hg <= 5; hg++) {
            for (ag = 0; ag <= 5; ag++) {
                euF = euPnLFactor(hg, ag, !!euHome, o);
                if (euF == null) continue;
                ahF = asianPnLFactorFromScore(hg, ag, homeLine, !!ahHome, a);
                if (ahF == null) continue;
                profit = euF * es + ahF * as_;
                n++;
                if (profit < worst) worst = profit;
            }
        }
        if (!n) return null;
        return { profit: worst, roi: worst / total, total: total, minReturn: total + worst };
    }

    function isBreakEvenHighRisk(roi) {
        var r = parseFloat(roi);
        return isFinite(r) && Math.abs(r) < BREAK_EVEN_ROI_EPS;
    }

    /**
     * 敞口列表/详情统一口径：总投入用计算器配比；max_loss=0 → 虚拟总投入；
     * 盈利缺省用 总投×ROI；不亏(ROI≈0) → 高风险。
     */
    function exposureDisplay(risk) {
        var directions = (risk && risk.directions) || {};
        var bundle = shareDisplay(risk && risk.strategy_type, directions);
        var totalStake = 0;
        Object.keys(bundle.dirs || {}).forEach(function (k) {
            if (bundle.dirs[k] > 0) totalStake += bundle.dirs[k];
        });
        if (!(totalStake > 0)) totalStake = parseFloat(risk && risk.total_stake) || 0;
        var maxLossRaw = parseFloat(risk && risk.max_loss);
        if (!isFinite(maxLossRaw)) maxLossRaw = 0;
        var virtual = !(maxLossRaw > 0) && totalStake > 0;
        var displayMaxLoss = virtual ? totalStake : maxLossRaw;
        var roi = parseFloat(risk && risk.roi);
        if (!isFinite(roi)) roi = null;
        var profit = parseFloat(risk && risk.expected_return);
        if (!(profit > 0) && !(profit < 0)) {
            if (roi != null && totalStake > 0) profit = totalStake * roi;
            else profit = 0;
        }
        var breakEven = isBreakEvenHighRisk(roi);
        var phase = phaseOf(risk && (risk.config_name || risk.strategy_type));
        return {
            dirs: bundle.dirs,
            subs: bundle.subs,
            totalStake: totalStake,
            maxLossRaw: maxLossRaw,
            displayMaxLoss: displayMaxLoss,
            virtualMaxLoss: virtual,
            profit: profit,
            roi: roi,
            breakEvenHighRisk: breakEven,
            phase: phase,
        };
    }

    function phaseOf(name) {
        var k = String(name || '').trim().toUpperCase();
        if (/^FT-LIVE-/.test(k) || /(^|-)LIVE($|-)/.test(k)) return 'LIVE';
        if (/^FT-PRE-/.test(k) || /(^|-)PRE($|-)/.test(k)) return 'PRE';
        return '';
    }

    function ahSettle(cover) {
        var abs = Math.abs(cover);
        if (abs < 1e-9) return 'push';
        if (abs > 0.25 + 1e-9) return cover > 0 ? 'win' : 'lose';
        return cover > 0 ? 'half_win' : 'half_lose';
    }

    function euSettle(hg, ag, buyHome) {
        if (hg === ag) return 'lose';
        if (buyHome) return hg > ag ? 'win' : 'lose';
        return ag > hg ? 'win' : 'lose';
    }

    function pairTag(eu, ah) {
        if (ah === 'push') return 'push';
        if (eu === 'win' && ah === 'win') return 'both_win';
        if (eu === 'lose' && ah === 'lose') return 'both_lose';
        if (ah === 'half_win' || ah === 'half_lose') return 'half';
        return 'lock';
    }

    function pairTagLabel(tag) {
        if (tag === 'push') return t('走水', 'push');
        if (tag === 'both_win') return t('两腿赢', 'both-win');
        if (tag === 'both_lose') return t('两腿输', 'both-lose');
        if (tag === 'half') return t('半结', 'half');
        return t('锁', 'hedge');
    }

    function formatEuAsiaLineNote() {
        var policy = t('两腿仅±0.5/±1；走水计入，任一情景净亏不配。', '2-leg only ±0.5/±1; push counted, any net loss rejected.');
        var line = euAsiaMeta.hasLine ? euAsiaMeta.line : null;
        if (line == null || !isFinite(line)) {
            return t('选盘 |line|∈{0.5,1}。', 'Pair |line|∈{0.5,1}. ') + policy;
        }
        var scores = [[1, 0, '1-0'], [2, 0, '2-0'], [0, 0, '0-0'], [0, 1, '0-1']];
        var groups = { push: [], both_win: [], both_lose: [], half: [], lock: [] };
        var dummyOdds = 2.0;
        scores.forEach(function (s) {
            var eu = euSettle(s[0], s[1], euAsiaMeta.euHome);
            var f = asianPnLFactorFromScore(s[0], s[1], line, euAsiaMeta.ahHome, dummyOdds);
            var ah = 'lose';
            if (f != null) {
                if (Math.abs(f) < 1e-9) ah = 'push';
                else if (Math.abs(f - (dummyOdds - 1)) < 1e-9) ah = 'win';
                else if (Math.abs(f + 1) < 1e-9) ah = 'lose';
                else if (f > 0) ah = 'half_win';
                else ah = 'half_lose';
            }
            groups[pairTag(eu, ah)].push(s[2]);
        });
        var bits = [];
        ['push', 'both_win', 'lock', 'half', 'both_lose'].forEach(function (tag) {
            if (!groups[tag].length) return;
            bits.push(pairTagLabel(tag) + ' ' + groups[tag].join('/'));
        });
        var abs = Math.abs(line);
        var extra = '';
        if (Math.abs(line) < 1e-9) {
            extra = t(' 平手盘两腿不配。', ' Line 0 not paired on 2-leg.');
        } else if (Math.abs(abs - 0.5) > 1e-9 && Math.abs(abs - 1) > 1e-9) {
            extra = t(' 非±0.5/±1 不算盘配对。', ' Not ±0.5/±1 — not paired.');
        }
        return bits.join(' · ') + extra + ' ' + policy;
    }

    function setEuAsiaNote(text) {
        if (!noteEl) return;
        if (!text) {
            noteEl.hidden = true;
            noteEl.textContent = '';
            return;
        }
        noteEl.hidden = false;
        noteEl.textContent = text;
    }

    function effectiveOdds(o, rate, n) {
        if (n < 2 || rate <= 0 || o <= 0) return o;
        var rn = rate / n;
        return o * (1 - rn) + rn;
    }

    /** 买盘赢利抽水后的兑现赔率：1+(o-1)×(1-费率)。 */
    function netBackOdds(o, rate) {
        var r = winFeeRate(rate);
        if (!(r > 0) || !(o > 1)) return o;
        return 1 + (o - 1) * (1 - r);
    }

    function currentFeeN() {
        if (feeN >= 2) return feeN;
        if (calcMode === 'lay_back' || calcMode === 'eu_asia') return 2;
        if (calcMode === 'multi_leg' && mlRatios.length >= 2) return mlRatios.length;
        return 3;
    }

    function foldOdds(o, key) {
        return netBackOdds(o, feeByKey[key] || 0);
    }

    function feeMdText() {
        var parts = [t('盈利抽水', 'Win commission')];
        var labels = {
            home: t('主', 'H'), draw: t('平', 'D'), away: t('客', 'A'),
            back: 'Back', lay: 'Lay', eu: t('欧', 'EU'), ah: t('亚', 'AH'),
        };
        activeKeys().forEach(function (k) {
            var f = feeByKey[k];
            if (!(f > 0)) return;
            var pct = f <= 1 ? f * 100 : f;
            var txt = Number.isInteger(pct) ? String(pct) : pct.toFixed(2).replace(/\.?0+$/, '');
            parts.push((labels[k] || k) + ' ' + txt + '%');
        });
        return parts.join(' · ');
    }

    function appendFeeToMeta() {
        if (!metaEl || !metaEl.textContent) return;
        if (metaEl.textContent.indexOf('盈利抽水') >= 0 || metaEl.textContent.indexOf('Win commission') >= 0) return;
        metaEl.textContent += ' · ' + feeMdText();
    }

    var SHARE_BASE = 1000;

    function shareLegOdds(sub) {
        var rec = parseFloat(sub && sub.recommended_odds);
        if (isFinite(rec) && rec > 1) return rec;
        var o = parseFloat(sub && (sub.odds_planned || sub.odds_at_decision));
        return isFinite(o) && o > 1 ? o : 0;
    }

    function shareLegFee(sub) {
        var f = parseFloat(sub && sub.fee);
        return isFinite(f) && f > 0 ? f : 0;
    }

    function shareQuoteSide(sub) {
        return String((sub && sub.quote_side) || '').trim().toLowerCase();
    }

    /**
     * 与短链计算器同一口径：锚 1000，1/N MD 折完再配平。
     * 返回 { dirs: {betType: mainStake}, subs: {sub_order_id: stake} }
     */
    function shareDisplay(strategyType, directions) {
        var st = String(strategyType || '').trim().toUpperCase();
        var dirs = directions || {};
        var out = { dirs: {}, subs: {} };
        var keys = Object.keys(dirs);
        if (!keys.length) return out;

        function assignSub(sub, stake) {
            if (!sub || !(stake > 0)) return;
            if (sub.sub_order_id) out.subs[sub.sub_order_id] = stake;
        }

        if (st === 'LAY_BACK') {
            var pairDirs = 0;
            keys.forEach(function (bt) {
                var subs = (dirs[bt] && dirs[bt].sub_orders) || [];
                var hasB = false, hasL = false;
                subs.forEach(function (s) {
                    if (shareQuoteSide(s) === 'lay') hasL = true;
                    else if (shareQuoteSide(s) === 'back') hasB = true;
                });
                if (hasB && hasL) pairDirs += 1;
            });
            var feeN = pairDirs >= 3 ? pairDirs : 2;
            keys.forEach(function (bt) {
                var d = dirs[bt];
                var subs = (d && d.sub_orders) || [];
                var back, lay;
                subs.forEach(function (s) {
                    if (shareQuoteSide(s) === 'lay') lay = s;
                    else if (shareQuoteSide(s) === 'back') back = s;
                });
                if (!back || !lay) return;
                var lb = calcLayBack(
                    shareLegOdds(back),
                    shareLegOdds(lay),
                    SHARE_BASE,
                    shareLegFee(back),
                    shareLegFee(lay)
                );
                if (!lb) return;
                out.dirs[bt] = lb.backStake + lb.layStake;
                assignSub(back, lb.backStake);
                assignSub(lay, lb.layStake);
            });
            return out;
        }

        if (st === 'EU_ASIA') {
            var eu, ah, draw, euKey, ahKey, drawKey;
            keys.forEach(function (bt) {
                var u = String(bt || '').toUpperCase();
                if (u === 'HOME' || u === 'AWAY') { eu = dirs[bt]; euKey = bt; }
                if (u === 'DRAW') { draw = dirs[bt]; drawKey = bt; }
                if (u.indexOf('AH_') === 0) { ah = dirs[bt]; ahKey = bt; }
            });
            if (!eu || !ah) return out;
            var euSub = ((eu.sub_orders) || [])[0];
            var ahSub = ((ah.sub_orders) || [])[0];
            var drawSub = draw ? ((draw.sub_orders) || [])[0] : null;
            var euEff = netBackOdds(shareLegOdds(euSub || eu), shareLegFee(euSub || eu));
            var ahEff = netBackOdds(shareLegOdds(ahSub || ah), shareLegFee(ahSub || ah));
            var line = null;
            if (ahSub && ahSub.has_line) line = parseFloat(ahSub.line);
            else if (ah && ah.has_line) line = parseFloat(ah.line);
            else if (ahSub && isFinite(parseFloat(ahSub.line))) line = parseFloat(ahSub.line);
            var euHome = String(euKey || '').toUpperCase() !== 'AWAY';
            var ahHome = String(ahKey || '').toUpperCase() === 'AH_HOME';
            if (draw) {
                var drawEff = netBackOdds(shareLegOdds(drawSub || draw), shareLegFee(drawSub || draw));
                var ea3 = calcEuAsia3W(euEff, drawEff, ahEff, SHARE_BASE, euHome, ahHome, line == null ? 0 : line);
                if (!ea3) return out;
                out.dirs[euKey] = ea3.euStake;
                out.dirs[drawKey] = ea3.drawStake;
                out.dirs[ahKey] = ea3.ahStake;
                assignSub(euSub, ea3.euStake);
                assignSub(drawSub, ea3.drawStake);
                assignSub(ahSub, ea3.ahStake);
                return out;
            }
            var ea = calcEuAsia(euEff, ahEff, SHARE_BASE);
            if (!ea) return out;
            out.dirs[euKey] = ea.euStake;
            out.dirs[ahKey] = ea.ahStake;
            assignSub(euSub, ea.euStake);
            assignSub(ahSub, ea.ahStake);
            return out;
        }

        if (st === 'CS_DUTCH') {
            var feeN = keys.length;
            if (feeN < 2) return out;
            var oddsArr = [];
            var order = [];
            keys.forEach(function (bt) {
                var d = dirs[bt];
                var sub = ((d && d.sub_orders) || [])[0];
                var o = netBackOdds(shareLegOdds(sub || d), shareLegFee(sub || d));
                if (!(o > 1)) return;
                oddsArr.push(o);
                order.push({ bt: bt, sub: sub });
            });
            if (oddsArr.length !== keys.length || oddsArr.length < 2) return out;
            var dutch = calcDutching(oddsArr, SHARE_BASE);
            if (!dutch) return out;
            order.forEach(function (item, i) {
                out.dirs[item.bt] = dutch.stakes[i];
                assignSub(item.sub, dutch.stakes[i]);
            });
            return out;
        }

        if (st === 'MULTI_LEG') {
            var n = keys.length;
            if (n < 2) return out;
            var ratios = [];
            keys.forEach(function (bt) {
                var d = dirs[bt];
                var sub = ((d && d.sub_orders) || [])[0];
                var ratio = parseFloat(sub && sub.calc_ratio);
                if (!(ratio > 0)) ratio = parseFloat(sub && sub.recommended_stake);
                if (!(ratio > 0)) ratio = parseFloat(d && d.stake_planned_calc);
                ratios.push({ bt: bt, d: d, sub: sub, ratio: ratio > 0 ? ratio : 0 });
            });
            var first = 0;
            ratios.forEach(function (r) { if (first <= 0 && r.ratio > 0) first = r.ratio; });
            if (first <= 0) return out;
            var scale = SHARE_BASE / first;
            ratios.forEach(function (r) {
                if (!(r.ratio > 0)) return;
                var stake = r.ratio * scale;
                out.dirs[r.bt] = stake;
                assignSub(r.sub, stake);
            });
            return out;
        }

        var home = dirs.HOME, draw = dirs.DRAW, away = dirs.AWAY;
        if (!home || !draw || !away) return out;
        var hSub = (home.sub_orders || [])[0];
        var dSub = (draw.sub_orders || [])[0];
        var aSub = (away.sub_orders || [])[0];
        var tw = calcFromAnchor({
            home: netBackOdds(shareLegOdds(hSub || home), shareLegFee(hSub || home)),
            draw: netBackOdds(shareLegOdds(dSub || draw), shareLegFee(dSub || draw)),
            away: netBackOdds(shareLegOdds(aSub || away), shareLegFee(aSub || away)),
        }, 'home', SHARE_BASE);
        if (!tw) return out;
        out.dirs.HOME = tw.stakes.home;
        out.dirs.DRAW = tw.stakes.draw;
        out.dirs.AWAY = tw.stakes.away;
        assignSub(hSub, tw.stakes.home);
        assignSub(dSub, tw.stakes.draw);
        assignSub(aSub, tw.stakes.away);
        return out;
    }

    window.HedgeCalcMath = {
        calcFromAnchor: calcFromAnchor,
        calcLayBack: calcLayBack,
        calcLayBackFromLay: calcLayBackFromLay,
        layBackROI: layBackROI,
        pickBetterLayBackEquivalent: pickBetterLayBackEquivalent,
        EQUIVALENT_LAY_BACK_GROUPS: EQUIVALENT_LAY_BACK_GROUPS,
        calcDutching: calcDutching,
        calcEuAsia: calcEuAsia,
        calcEuAsiaFromAh: calcEuAsiaFromAh,
        calcEuAsia3W: calcEuAsia3W,
        evalEuAsiaWorstROI: evalEuAsiaWorstROI,
        evalEuAsiaStakes: evalEuAsiaStakes,
        effectiveOdds: effectiveOdds,
        shareDisplay: shareDisplay,
        exposureDisplay: exposureDisplay,
        phaseOf: phaseOf,
        isBreakEvenHighRisk: isBreakEvenHighRisk,
        SHARE_BASE: SHARE_BASE,
        HOME_DEFAULT: HOME_DEFAULT,
        BREAK_EVEN_ROI_EPS: BREAK_EVEN_ROI_EPS,
        convertAmount: convertAmount,
        quoteUsd: quoteUsd,
        decimalToAmerican: decimalToAmerican,
        americanToDecimal: americanToDecimal,
        decimalToHk: decimalToHk,
        decimalToMalay: decimalToMalay,
        decimalToIndo: decimalToIndo,
        decimalToFractional: decimalToFractional,
        decimalToProbPct: decimalToProbPct,
        oddsFormats: oddsFormats,
        oddsFormatLine: oddsFormatLine,
    };

    var root, panel, fab, stakeInputs, oddsInputs, americanOddsInputs, ccySelects, profitEl, metaEl, fxTimeEl, noteEl;
    var titleEl, rowsThree, rowsLayBack, rowsEuAsia, rowsMultiLeg, lineInput;
    var labelEu, labelAh;
    var calcMode = 'three_way';
    var feeN = 0;
    var feeByKey = { home: 0, draw: 0, away: 0, back: 0, lay: 0, eu: 0, ah: 0 };
    var mlRatios = [];
    var anchorKey = 'home';
    var writing = false;
    var displayCcy = 'USDT';
    var rowCcy = { home: 'USDT', draw: 'USDT', away: 'USDT', back: 'USDT', lay: 'USDT', eu: 'USDT', ah: 'USDT' };
    var euAsiaMeta = { euHome: true, ahHome: false, hasLine: false, line: null };
    var fx = { currencies: [], rates: { USD: 1 }, cachedAt: 0 };
    var fxTimer = 0;

    function activeKeys() {
        if (calcMode === 'lay_back') return LB_KEYS;
        if (calcMode === 'eu_asia') return EA_KEYS;
        return THREE_KEYS;
    }

    function isolate(el) {
        [
            'click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup',
            'keydown', 'keyup', 'keypress', 'input', 'change', 'wheel',
            'touchstart', 'touchend', 'dblclick', 'contextmenu',
        ].forEach(function (type) {
            el.addEventListener(type, function (e) {
                e.stopPropagation();
            });
        });
        el.addEventListener('submit', function (e) {
            e.preventDefault();
            e.stopPropagation();
        });
    }

    function ccyMeta(code) {
        var list = fx.currencies || [];
        for (var i = 0; i < list.length; i++) {
            if (list[i].code === code) return list[i];
        }
        return null;
    }

    function displayCode(code) {
        var m = ccyMeta(code);
        return (m && m.display_code) || code || '';
    }

    function decimalsOf(code) {
        var m = ccyMeta(code);
        var d = (m && m.decimals != null) ? Number(m.decimals) : NaN;
        if (code === 'BTC') return isFinite(d) ? Math.max(d, 8) : 8;
        if (code === 'ETH') return isFinite(d) ? Math.max(d, 6) : 6;
        if (code === 'USDT' || code === 'USDC') return isFinite(d) ? Math.max(d, 4) : 4;
        if (isFinite(d)) return d;
        return 2;
    }

    function quoteUsd(code) {
        if (!code || code === 'USD') return 1;
        if ((code === 'USDT' || code === 'USDC') && !(fx.rates && fx.rates[code] > 0)) return 1;
        var q = fx.rates && fx.rates[code];
        return (q && q > 0) ? Number(q) : 0;
    }

    function convertAmount(amount, fromCode, toCode) {
        var qf = quoteUsd(fromCode);
        var qt = quoteUsd(toCode);
        if (!(amount > 0) || qf <= 0 || qt <= 0) return 0;
        return amount * qf / qt;
    }

    function toUsd(amount, code) {
        return convertAmount(amount, code, 'USD');
    }

    function fromUsd(usd, code) {
        return convertAmount(usd, 'USD', code);
    }

    function fmtN(n, code) {
        var d = decimalsOf(code);
        var f = Math.pow(10, d);
        var x = Math.round(n * f) / f;
        return x.toFixed(d);
    }

    function readOddsThree() {
        return {
            home: parsePos(oddsInputs.home && oddsInputs.home.value),
            draw: parsePos(oddsInputs.draw && oddsInputs.draw.value),
            away: parsePos(oddsInputs.away && oddsInputs.away.value),
        };
    }

    function readStake(key) {
        return stakeInputs[key] ? parsePos(stakeInputs[key].value) : 0;
    }

    function renderProfit(profitUsd, totalUsd, payoutUsd, pct, emptyMsg) {
        if (profitUsd == null) {
            profitEl.className = 'hedge-calc-profit-zero';
            profitEl.textContent = emptyMsg;
            metaEl.textContent = '';
            renderFxTime();
            return;
        }
        var unit = displayCode(displayCcy);
        var profit = fromUsd(profitUsd, displayCcy);
        var total = fromUsd(totalUsd, displayCcy);
        var payout = fromUsd(payoutUsd, displayCcy);
        var sign = profit >= -EPS ? (profit > EPS ? '+' : '') : '';
        var cls = profit > EPS
            ? 'hedge-calc-profit-pos'
            : (profit < -EPS ? 'hedge-calc-profit-neg' : 'hedge-calc-profit-zero');
        var be = isBreakEvenHighRisk(pct);
        if (be) cls = 'hedge-calc-profit-neg';
        profitEl.className = cls;
        profitEl.textContent = t('盈利 ', 'Profit ') + sign + fmtN(profit, displayCcy) + ' ' + unit
            + '  (' + sign + (pct * 100).toFixed(2) + '%)'
            + (be ? t(' · 高风险·可能不亏', ' · HIGH RISK · may break-even') : '');
        metaEl.textContent = t('总投入 ', 'Total ') + fmtN(total, displayCcy) + ' ' + unit
            + t(' · 返还 ', ' · Payout ') + fmtN(payout, displayCcy) + ' ' + unit
            + (be ? t(' · 最坏接近不亏，按高风险处理', ' · worst near break-even → treat as high risk') : '');
        renderFxTime();
    }

    function renderThree(result, skipStakeKey) {
        syncWinFeeInput();
        if (!result) {
            renderProfit(null, null, null, 0, t('输入三方赔率', 'Enter 3-way odds'));
            return;
        }
        writing = true;
        THREE_KEYS.forEach(function (k) {
            if (!stakeInputs[k]) return;
            if (k === skipStakeKey) return;
            if (document.activeElement === stakeInputs[k]) return;
            stakeInputs[k].value = fmtN(fromUsd(result.stakes[k], rowCcy[k]), rowCcy[k]);
        });
        writing = false;
        renderProfit(result.profit, result.total, result.payout, result.pct);
        appendFeeToMeta();
    }

    function renderLayBack(result, skipStakeKey) {
        syncWinFeeInput();
        if (!result) {
            renderProfit(null, null, null, 0, t('输入 BACK / LAY 赔率', 'Enter BACK / LAY odds'));
            return;
        }
        writing = true;
        if (skipStakeKey !== 'back' && stakeInputs.back && document.activeElement !== stakeInputs.back) {
            stakeInputs.back.value = fmtN(fromUsd(result.backStake, rowCcy.back), rowCcy.back);
        }
        if (skipStakeKey !== 'lay' && stakeInputs.lay && document.activeElement !== stakeInputs.lay) {
            stakeInputs.lay.value = fmtN(fromUsd(result.layStake, rowCcy.lay), rowCcy.lay);
        }
        writing = false;
        var unit = displayCode(displayCcy);
        renderProfit(result.profit, result.total, result.payout, result.pct);
        metaEl.textContent = t('总投入 ', 'Total ') + fmtN(fromUsd(result.total, displayCcy), displayCcy) + ' ' + unit
            + t(' · Lay 责任 ', ' · Lay liability ') + fmtN(fromUsd(result.liability, displayCcy), displayCcy) + ' ' + unit
            + t(' · 返还 ', ' · Payout ') + fmtN(fromUsd(result.payout, displayCcy), displayCcy) + ' ' + unit
            + ' · ' + feeMdText();
    }

    function renderEuAsia(result, skipStakeKey) {
        syncWinFeeInput();
        if (!result) {
            setEuAsiaNote('');
            renderProfit(null, null, null, 0, t('输入欧盘 / 亚盘赔率', 'Enter EU / Asian odds'));
            return;
        }
        writing = true;
        if (skipStakeKey !== 'eu' && stakeInputs.eu && document.activeElement !== stakeInputs.eu) {
            stakeInputs.eu.value = fmtN(fromUsd(result.euStake, rowCcy.eu), rowCcy.eu);
        }
        if (skipStakeKey !== 'ah' && stakeInputs.ah && document.activeElement !== stakeInputs.ah) {
            stakeInputs.ah.value = fmtN(fromUsd(result.ahStake, rowCcy.ah), rowCcy.ah);
        }
        writing = false;
        var unit = displayCode(displayCcy);
        renderProfit(result.profit, result.total, result.payout, result.pct);
        var euWinLbl = euAsiaMeta.euHome ? t('主胜', 'Home') : t('客胜', 'Away');
        var ahWinLbl = euAsiaMeta.euHome ? t('平/客胜', 'Draw/Away') : t('平/主胜', 'Draw/Home');
        metaEl.textContent = t('总投入 ', 'Total ') + fmtN(fromUsd(result.total, displayCcy), displayCcy) + ' ' + unit
            + ' · ' + euWinLbl + ' ' + fmtN(fromUsd(result.euWin, displayCcy), displayCcy)
            + ' · ' + ahWinLbl + ' ' + fmtN(fromUsd(result.ahWin, displayCcy), displayCcy)
            + t(' · 亚盘 y=x×O/A', ' · AH y=x×O/A')
            + ' · ' + feeMdText();
        setEuAsiaNote(formatEuAsiaLineNote());
    }

    function rateUpdatedAt(code) {
        var m = ccyMeta(code);
        return (m && m.fetched_at) || '';
    }

    function renderFxTime() {
        if (!fxTimeEl) return;
        var keys = activeKeys();
        var miss = keys.some(function (k) {
            return quoteUsd(rowCcy[k]) <= 0 && rowCcy[k] !== 'USD';
        });
        var seen = {};
        var parts = [];
        keys.forEach(function (k) {
            var code = rowCcy[k];
            if (seen[code]) return;
            seen[code] = true;
            var ts = rateUpdatedAt(code);
            parts.push(displayCode(code) + ' ' + (ts || t('尚未更新', 'not updated')));
        });
        var text = t('汇率更新 ', 'FX updated ') + parts.join(' · ');
        if (miss) text += t(' · 暂无汇率', ' · rate missing');
        fxTimeEl.textContent = text;
    }

    function recalc(skipStakeKey) {
        if (calcMode === 'lay_back') {
            recalcLayBack(skipStakeKey);
            return;
        }
        if (calcMode === 'eu_asia') {
            recalcEuAsia(skipStakeKey);
            return;
        }
        if (calcMode === 'multi_leg') {
            recalcMultiLeg(skipStakeKey);
            return;
        }
        var odds = readOddsThree();
        odds.home = foldOdds(odds.home, 'home');
        odds.draw = foldOdds(odds.draw, 'draw');
        odds.away = foldOdds(odds.away, 'away');
        var stakeDisp = readStake(anchorKey);
        if (anchorKey === 'home' && stakeDisp <= 0) stakeDisp = HOME_DEFAULT;
        var stakeUsd = toUsd(stakeDisp, rowCcy[anchorKey]);
        renderThree(calcFromAnchor(odds, anchorKey, stakeUsd), skipStakeKey);
    }

    function recalcLayBack(skipStakeKey) {
        if (!oddsInputs.back || !oddsInputs.lay) {
            renderLayBack(null);
            return;
        }
        var ob = parsePos(oddsInputs.back.value);
        var ol = parsePos(oddsInputs.lay.value);
        var ak = (skipStakeKey === 'lay' || anchorKey === 'lay') ? 'lay' : 'back';
        var stakeDisp = readStake(ak);
        if (ak === 'back' && stakeDisp <= 0) stakeDisp = HOME_DEFAULT;
        var stakeUsd = toUsd(stakeDisp, rowCcy[ak]);
        var lb = ak === 'lay'
            ? calcLayBackFromLay(ob, ol, stakeUsd, feeByKey.back, feeByKey.lay)
            : calcLayBack(ob, ol, stakeUsd, feeByKey.back, feeByKey.lay);
        renderLayBack(lb, skipStakeKey);
    }

    function recalcEuAsia(skipStakeKey) {
        if (!oddsInputs.eu || !oddsInputs.ah) {
            renderEuAsia(null);
            return;
        }
        var ak = (skipStakeKey === 'ah' || anchorKey === 'ah') ? 'ah' : 'eu';
        var stakeDisp = readStake(ak);
        if (ak === 'eu' && stakeDisp <= 0) stakeDisp = HOME_DEFAULT;
        var stakeUsd = toUsd(stakeDisp, rowCcy[ak]);
        var o = foldOdds(parsePos(oddsInputs.eu.value), 'eu');
        var a = foldOdds(parsePos(oddsInputs.ah.value), 'ah');
        var ea = ak === 'ah'
            ? calcEuAsiaFromAh(o, a, stakeUsd)
            : calcEuAsia(o, a, stakeUsd);
        renderEuAsia(ea, skipStakeKey);
    }

    function paintMultiLegRows(legs, ccy) {
        if (!rowsMultiLeg) return;
        mlRatios = [];
        var first = 0;
        legs.forEach(function (leg) {
            var s = parsePos(leg.stake || leg.rec_stake);
            if (first <= 0 && s > 0) first = s;
        });
        if (first <= 0) first = 1;
        rowsMultiLeg.innerHTML = '';
        legs.forEach(function (leg, i) {
            var dir = String(leg.dir || leg.bet_type || ('L' + (i + 1)));
            var side = String(leg.quote_side || '').toLowerCase();
            var odds = parsePos(leg.odds || leg.rec_odds);
            var stake = parsePos(leg.stake || leg.rec_stake);
            if (stake <= 0) stake = first;
            var hasLine = leg.has_line === true || leg.hasLine === true;
            var line = Number(leg.line);
            var label = dir;
            if (side && dir.toLowerCase().indexOf(side) < 0) label += ' · ' + side.toUpperCase();
            if (hasLine && isFinite(line) && dir.indexOf(':') < 0) {
                // 与下载/计算一致：主队编码 line，客边不翻
                label += ' ' + (line > 0 ? '+' + line : String(line));
            }
            mlRatios.push({ dir: dir, odds: odds, ratio: stake / first, fee: Number(leg.fee || 0) });
            var row = document.createElement('div');
            row.className = 'hedge-calc-row';
            var sel = document.createElement('select');
            sel.className = 'hedge-calc-ccy';
            sel.setAttribute('aria-label', label + ' currency');
            var list = (fx.currencies && fx.currencies.length) ? fx.currencies : [
                { code: 'USDT', display_code: 'USDT' },
                { code: 'PHP', display_code: 'PHP' },
                { code: 'CNY', display_code: 'RMB' },
                { code: 'ETH', display_code: 'ETH' },
            ];
            list.forEach(function (c) {
                var opt = document.createElement('option');
                opt.value = c.code;
                opt.textContent = c.display_code || c.code;
                sel.appendChild(opt);
            });
            var rowCcyCode = String(leg.ccy || leg.currency || ccy || 'USDT').toUpperCase();
            ensureCcyOption(sel, rowCcyCode);
            sel.value = rowCcyCode;
            row.appendChild(sel);
            var lab = document.createElement('span');
            lab.className = 'hedge-calc-label';
            lab.textContent = label;
            row.appendChild(lab);
            var oIn = document.createElement('input');
            oIn.type = 'number';
            oIn.min = '1.01';
            oIn.step = '0.01';
            oIn.setAttribute('data-ml-odds', String(i));
            oIn.setAttribute('aria-label', label + ' EU odds');
            oIn.placeholder = t('欧式', 'EU');
            if (odds > 1) oIn.value = String(odds);
            row.appendChild(oIn);
            var usIn = document.createElement('input');
            usIn.type = 'number';
            usIn.step = '1';
            usIn.setAttribute('data-ml-odds-us', String(i));
            usIn.setAttribute('aria-label', label + ' US odds');
            usIn.placeholder = t('美式', 'US');
            var am0 = decimalToAmerican(odds);
            if (am0 != null) usIn.value = formatAmericanOdds(am0);
            row.appendChild(usIn);
            var sIn = document.createElement('input');
            sIn.type = 'number';
            sIn.min = '0.01';
            sIn.step = '0.01';
            sIn.setAttribute('data-ml-stake', String(i));
            sIn.value = String(stake);
            row.appendChild(sIn);
            rowsMultiLeg.appendChild(row);
            oIn.addEventListener('input', function () {
                if (writing) return;
                writing = true;
                var am = decimalToAmerican(parsePos(oIn.value));
                usIn.value = am != null ? formatAmericanOdds(am) : '';
                writing = false;
                recalcMultiLeg(null);
            });
            usIn.addEventListener('input', function () {
                if (writing) return;
                var raw = usIn.value;
                if (raw === '' || raw === '-' || raw === '+') return;
                var d = americanToDecimal(parseFloat(raw));
                if (d == null || !(d > 1)) return;
                writing = true;
                oIn.value = formatDecimalOdds(d);
                writing = false;
                recalcMultiLeg(null);
            });
            sIn.addEventListener('input', function () { recalcMultiLeg(i); });
        });
        displayCcy = ccy || displayCcy;
    }

    function recalcMultiLeg(anchorIdx) {
        if (!rowsMultiLeg || !mlRatios.length) {
            renderProfit(null, null, null, 0, t('需要引擎配比', 'Need engine ratios'));
            return;
        }
        var stakes = [];
        var odds = [];
        mlRatios.forEach(function (r, i) {
            var oEl = rowsMultiLeg.querySelector('[data-ml-odds="' + i + '"]');
            var sEl = rowsMultiLeg.querySelector('[data-ml-stake="' + i + '"]');
            odds[i] = parsePos(oEl && oEl.value);
            stakes[i] = parsePos(sEl && sEl.value);
        });
        var idx = (anchorIdx == null || anchorIdx < 0) ? 0 : anchorIdx;
        var base = stakes[idx];
        if (base <= 0) base = HOME_DEFAULT;
        var ratio = mlRatios[idx] && mlRatios[idx].ratio > 0 ? mlRatios[idx].ratio : 1;
        var unit = base / ratio;
        writing = true;
        mlRatios.forEach(function (r, i) {
            var sEl = rowsMultiLeg.querySelector('[data-ml-stake="' + i + '"]');
            if (!sEl) return;
            var s = unit * r.ratio;
            if (i !== idx) sEl.value = fmtN(s, displayCcy);
            stakes[i] = s;
        });
        writing = false;
        var total = 0;
        stakes.forEach(function (s) { total += s; });
        renderProfit(0, toUsd(total, displayCcy), toUsd(total, displayCcy), 0);
        if (metaEl) {
            metaEl.textContent = t('总投入 ', 'Total ') + fmtN(total, displayCcy) + ' ' + displayCode(displayCcy)
                + t(' · 配比来自多腿求解器（与引擎同比）', ' · ratios from multi-leg solver (engine ratios)');
            appendFeeToMeta();
        }
    }

    function syncUsFromEu(key) {
        var us = americanOddsInputs && americanOddsInputs[key];
        if (!us) return;
        var d = parsePos(oddsInputs[key] && oddsInputs[key].value);
        var am = decimalToAmerican(d);
        us.value = am != null ? formatAmericanOdds(am) : '';
    }

    function syncEuFromUs(key) {
        var us = americanOddsInputs && americanOddsInputs[key];
        var el = oddsInputs && oddsInputs[key];
        if (!us || !el) return false;
        var raw = us.value;
        if (raw === '' || raw === '-' || raw === '+') return false;
        var d = americanToDecimal(parseFloat(raw));
        if (d == null || !(d > 1)) return false;
        el.value = formatDecimalOdds(d);
        return true;
    }

    function setDecimalOdds(key, decimal) {
        if (!oddsInputs[key]) return;
        oddsInputs[key].value = decimal > 1 ? String(decimal) : '';
        syncUsFromEu(key);
    }

    function onOddsInput() {
        if (writing) return;
        if (calcMode === 'eu_asia') {
            if (readStake('eu') <= 0 && stakeInputs.eu) {
                writing = true;
                stakeInputs.eu.value = String(HOME_DEFAULT);
                writing = false;
                anchorKey = 'eu';
            }
            recalc();
            return;
        }
        if (calcMode === 'lay_back') {
            if (readStake('back') <= 0 && stakeInputs.back) {
                writing = true;
                stakeInputs.back.value = String(HOME_DEFAULT);
                writing = false;
                anchorKey = 'back';
            }
            recalc();
            return;
        }
        if (readStake('home') <= 0 && stakeInputs.home) {
            writing = true;
            stakeInputs.home.value = String(HOME_DEFAULT);
            writing = false;
            anchorKey = 'home';
        }
        recalc();
    }

    function onEuOddsInput(key) {
        if (writing) return;
        writing = true;
        syncUsFromEu(key);
        writing = false;
        onOddsInput();
    }

    function onUsOddsInput(key) {
        if (writing) return;
        writing = true;
        var ok = syncEuFromUs(key);
        writing = false;
        if (ok) onOddsInput();
    }

    function onStakeInput(key) {
        if (writing) return;
        if (readStake(key) <= 0) return;
        anchorKey = key;
        displayCcy = rowCcy[key];
        recalc(key);
    }

    function fillCcySelects() {
        var list = fx.currencies || [];
        if (!list.length) {
            list = [
                { code: 'USDT', display_code: 'USDT', decimals: 4 },
                { code: 'PHP', display_code: 'PHP', decimals: 2 },
                { code: 'CNY', display_code: 'RMB', decimals: 2 },
                { code: 'ETH', display_code: 'ETH', decimals: 6 },
            ];
        }
        var codes = {};
        list.forEach(function (c) { codes[c.code] = true; });
        activeKeys().forEach(function (k) {
            var sel = ccySelects[k];
            if (!sel) return;
            var cur = rowCcy[k];
            sel.innerHTML = '';
            list.forEach(function (c) {
                var opt = document.createElement('option');
                opt.value = c.code;
                opt.textContent = c.display_code || c.code;
                sel.appendChild(opt);
            });
            if (!codes[cur]) cur = list[0].code;
            rowCcy[k] = cur;
            sel.value = cur;
        });
        if (!codes[displayCcy] && list[0]) displayCcy = list[0].code;
        saveCcyPref();
    }

    function saveCcyPref() {
        try {
            localStorage.setItem(CCY_PREF_KEY, JSON.stringify({
                row: rowCcy,
                display: displayCcy,
            }));
        } catch (e) { /* ignore */ }
    }

    function loadCcyPref() {
        try {
            var raw = localStorage.getItem(CCY_PREF_KEY);
            if (!raw) return;
            var p = JSON.parse(raw);
            if (p && p.row) {
                THREE_KEYS.concat(LB_KEYS, EA_KEYS).forEach(function (k) {
                    if (p.row[k]) rowCcy[k] = p.row[k];
                });
            }
            if (p && p.display) displayCcy = p.display;
        } catch (e) { /* ignore */ }
    }

    function applyFxPayload(data) {
        if (!data) return;
        fx.currencies = data.currencies || [];
        fx.rates = data.rates || { USD: 1 };
        fx.rates.USD = 1;
        fx.cachedAt = data.cachedAt || Date.now();
        fillCcySelects();
        recalc();
        renderFxTime();
    }

    function readFxCache() {
        try {
            var raw = localStorage.getItem(FX_CACHE_KEY);
            if (!raw) return null;
            var c = JSON.parse(raw);
            if (!c || !c.rates) return null;
            return c;
        } catch (e) {
            return null;
        }
    }

    function writeFxCache(data) {
        try {
            localStorage.setItem(FX_CACHE_KEY, JSON.stringify({
                currencies: data.currencies || [],
                rates: data.rates || {},
                cachedAt: Date.now(),
            }));
        } catch (e) { /* ignore */ }
    }

    function fetchFx(force) {
        var cached = readFxCache();
        var now = Date.now();
        if (cached && cached.cachedAt && (now - cached.cachedAt) < FX_TTL_MS) {
            applyFxPayload(cached);
            if (!force) return Promise.resolve();
        } else if (cached) {
            applyFxPayload(cached);
        }
        return fetch('/api/v1/fx/rates')
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (!d || d.code !== 0) return;
                writeFxCache(d);
                applyFxPayload(d);
            })
            .catch(function () { /* 用缓存 */ });
    }

    function onCcyChange(key) {
        var sel = ccySelects[key];
        if (!sel) return;
        var neu = sel.value;
        var old = rowCcy[key];
        if (neu === old) return;
        var amt = readStake(key);
        if (amt > 0 && quoteUsd(old) > 0 && quoteUsd(neu) > 0) {
            writing = true;
            stakeInputs[key].value = fmtN(convertAmount(amt, old, neu), neu);
            writing = false;
        }
        rowCcy[key] = neu;
        displayCcy = neu;
        saveCcyPref();
        if (anchorKey === key) {
            recalc(key);
        } else {
            recalc();
        }
    }

    function setMode(mode, title) {
        var next = 'three_way';
        if (mode === 'lay_back') next = 'lay_back';
        if (mode === 'eu_asia') next = 'eu_asia';
        if (mode === 'multi_leg') next = 'multi_leg';
        if (next === 'lay_back' && (!oddsInputs.back || !oddsInputs.lay)) {
            next = 'three_way';
        }
        if (next === 'eu_asia' && (!oddsInputs.eu || !oddsInputs.ah)) {
            next = 'three_way';
        }
        if (next === 'multi_leg' && !rowsMultiLeg) {
            next = 'three_way';
        }
        calcMode = next;
        if (rowsThree) rowsThree.hidden = calcMode !== 'three_way';
        if (rowsLayBack) rowsLayBack.hidden = calcMode !== 'lay_back';
        if (rowsEuAsia) rowsEuAsia.hidden = calcMode !== 'eu_asia';
        if (rowsMultiLeg) rowsMultiLeg.hidden = calcMode !== 'multi_leg';
        if (calcMode !== 'eu_asia') setEuAsiaNote('');
        var custom = String(title || '').trim();
        if (titleEl) {
            titleEl.textContent = custom || (calcMode === 'lay_back'
                ? t('Lay-Back 计算器', 'Lay-Back Calculator')
                : (calcMode === 'eu_asia'
                    ? t('欧亚对冲计算器', 'EU-Asia Calculator')
                    : (calcMode === 'multi_leg'
                        ? t('多腿配比计算器', 'Multi-leg Calculator')
                        : t('三向计算器', '3-way Calculator'))));
        }
        if (fab) {
            fab.title = custom || (calcMode === 'lay_back'
                ? t('Lay-Back 对冲计算器', 'Lay-Back hedge calculator')
                : (calcMode === 'eu_asia'
                    ? t('欧亚对冲计算器', 'EU-Asia hedge calculator')
                    : (calcMode === 'multi_leg'
                        ? t('多腿配比计算器', 'Multi-leg calculator')
                        : t('三向对冲计算器', '3-way hedge calculator'))));
        }
        anchorKey = calcMode === 'lay_back' ? 'back' : (calcMode === 'eu_asia' ? 'eu' : 'home');
        fillCcySelects();
    }

    function setOpen(open) {
        panel.hidden = !open;
        fab.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open) {
            fetchFx(false);
            if (!fxTimer) {
                fxTimer = window.setInterval(function () { fetchFx(true); }, FX_TTL_MS);
            }
            var focusEl = calcMode === 'lay_back'
                ? oddsInputs.back
                : (calcMode === 'eu_asia' ? oddsInputs.eu : oddsInputs.home);
            if (focusEl) focusEl.focus({ preventScroll: true });
        }
    }

    /**
     * opts:
     *   mode?: 'three_way'|'lay_back'|'eu_asia'
     *   三向: odds:{home,draw,away}, stakes?, homeStake?, ccy?, open?, fxRates?
     *   lay_back: backOdds, layOdds, backStake?, ccy?, open?, fxRates?
     *   eu_asia: euOdds, ahOdds, euStake?, line, hasLine, euDir, ahSide, ccy?, open?, fxRates?
     */
    function applyFeePreset(opts) {
        feeByKey = { home: 0, draw: 0, away: 0, back: 0, lay: 0, eu: 0, ah: 0 };
        var n = parseInt(opts.feeN, 10);
        feeN = (isFinite(n) && n >= 2) ? n : 0;
        var fees = opts.fees || {};
        Object.keys(feeByKey).forEach(function (k) {
            var v = parseFloat(fees[k]);
            feeByKey[k] = isFinite(v) && v > 0 ? v : 0;
        });
        if (feeN < 2) {
            if (opts.mode === 'lay_back' || opts.mode === 'eu_asia') feeN = 2;
            else if (opts.mode === 'multi_leg' && opts.legs && opts.legs.length >= 2) feeN = opts.legs.length;
            else feeN = 3;
        }
    }

    function syncWinFeeInput() {
        var input = document.getElementById('hedgeCalcWinFee');
        if (!input || document.activeElement === input) return;
        var vals = [];
        activeKeys().forEach(function (k) {
            if (feeByKey[k] > 0) vals.push(feeByKey[k]);
        });
        if (!vals.length) {
            input.value = '';
            return;
        }
        var same = vals.every(function (v) { return Math.abs(v - vals[0]) < 1e-9; });
        input.value = same ? String(Math.round(vals[0] * 1000) / 10) : '';
    }

    function ensureWinFeeInput() {
        if (!panel || document.getElementById('hedgeCalcWinFee')) return;
        var result = panel.querySelector('.hedge-calc-result');
        if (!result) return;
        var row = document.createElement('label');
        row.className = 'hedge-calc-fee';
        row.style.cssText = 'display:flex;align-items:center;gap:8px;margin:6px 0;font-size:12px;';
        row.innerHTML = '<span>盈利抽水%</span><input type="number" id="hedgeCalcWinFee" min="0" max="99" step="0.1" placeholder="0" style="width:72px">';
        result.parentNode.insertBefore(row, result);
        document.getElementById('hedgeCalcWinFee').addEventListener('input', function () {
            var pct = parseFloat(this.value);
            var rate = isFinite(pct) && pct > 0 ? pct / 100 : 0;
            if (!(rate > 0 && rate < 1)) rate = 0;
            Object.keys(feeByKey).forEach(function (k) { feeByKey[k] = rate; });
            recalc();
        });
    }

    function applyPreset(opts) {
        if (!panel) return false;
        opts = opts || {};
        applyFeePreset(opts);
        var ccy = (opts.ccy || 'USDT').toUpperCase();
        var homeStake = parsePos(opts.homeStake);
        if (homeStake <= 0) homeStake = 1000;
        var open = opts.open !== false;

        if (opts.fxRates && typeof opts.fxRates === 'object') {
            var curList = (fx.currencies && fx.currencies.length) ? fx.currencies.slice() : [
                { code: 'USDT', display_code: 'USDT', decimals: 4 },
                { code: 'PHP', display_code: 'PHP', decimals: 2 },
                { code: 'CNY', display_code: 'RMB', decimals: 2 },
                { code: 'ETH', display_code: 'ETH', decimals: 6 },
            ];
            var at = opts.fxFetchedAt || new Date().toISOString();
            Object.keys(opts.fxRates).forEach(function (code) {
                var found = false;
                for (var i = 0; i < curList.length; i++) {
                    if (curList[i].code === code) {
                        curList[i] = Object.assign({}, curList[i], {
                            quote_usd: opts.fxRates[code],
                            fetched_at: at,
                        });
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    curList.push({
                        code: code, display_code: code, decimals: 4,
                        quote_usd: opts.fxRates[code], fetched_at: at,
                    });
                }
            });
            applyFxPayload({
                currencies: curList,
                rates: Object.assign({ USD: 1 }, opts.fxRates),
                cachedAt: Date.now(),
            });
        }

        if (opts.mode === 'lay_back') {
            setMode('lay_back', opts.title);
            if (calcMode !== 'lay_back') return false;
            var backO = parsePos(opts.backOdds);
            var layO = parsePos(opts.layOdds);
            var backS = parsePos(opts.backStake);
            if (backS <= 0) backS = homeStake;
            if (backO <= 1 || layO <= 1) return false;
            writing = true;
            setDecimalOdds('back', backO);
            setDecimalOdds('lay', layO);
            rowCcy.back = rowCcy.lay = ccy;
            LB_KEYS.forEach(function (k) {
                if (ccySelects[k]) {
                    ensureCcyOption(ccySelects[k], ccy);
                    ccySelects[k].value = ccy;
                }
            });
            var lb = calcLayBack(backO, layO, toUsd(backS, ccy), feeByKey.back, feeByKey.lay);
            if (!lb) {
                writing = false;
                return false;
            }
            stakeInputs.back.value = fmtN(fromUsd(lb.backStake, ccy), ccy);
            stakeInputs.lay.value = fmtN(fromUsd(lb.layStake, ccy), ccy);
            writing = false;
            displayCcy = ccy;
            anchorKey = 'back';
            saveCcyPref();
            renderLayBack(lb, null);
            if (open) setOpen(true);
            return true;
        }

        if (opts.mode === 'eu_asia') {
            setMode('eu_asia', opts.title);
            if (calcMode !== 'eu_asia') return false;
            var euO = parsePos(opts.euOdds);
            var ahO = parsePos(opts.ahOdds);
            var euS = parsePos(opts.euStake);
            if (euS <= 0) euS = homeStake;
            if (euO <= 1 || ahO <= 1) return false;
            var euDir = String(opts.euDir || 'HOME').toUpperCase();
            var ahSide = String(opts.ahSide || '').toUpperCase();
            euAsiaMeta.euHome = euDir !== 'AWAY';
            euAsiaMeta.ahHome = ahSide === 'AH_HOME';
            euAsiaMeta.hasLine = opts.hasLine === true;
            var line = parseLine(opts.line);
            euAsiaMeta.line = line;
            writing = true;
            setDecimalOdds('eu', euO);
            setDecimalOdds('ah', ahO);
            if (labelEu) labelEu.textContent = euDir === 'AWAY' ? 'AWAY' : 'HOME';
            if (labelAh) {
                if (euAsiaMeta.hasLine && line != null) {
                    // 与下载/计算一致：主队编码 line，客边不翻
                    var sideTag = ahSide || 'AH';
                    labelAh.textContent = sideTag + (line > 0 ? ':+' + line : ':' + String(line));
                } else {
                    labelAh.textContent = ahSide || 'AH';
                }
            }
            rowCcy.eu = rowCcy.ah = ccy;
            EA_KEYS.forEach(function (k) {
                if (ccySelects[k]) {
                    ensureCcyOption(ccySelects[k], ccy);
                    ccySelects[k].value = ccy;
                }
            });
            var ea = calcEuAsia(foldOdds(euO, 'eu'), foldOdds(ahO, 'ah'), toUsd(euS, ccy));
            if (!ea) {
                writing = false;
                return false;
            }
            stakeInputs.eu.value = fmtN(fromUsd(ea.euStake, ccy), ccy);
            stakeInputs.ah.value = fmtN(fromUsd(ea.ahStake, ccy), ccy);
            writing = false;
            displayCcy = ccy;
            anchorKey = 'eu';
            saveCcyPref();
            renderEuAsia(ea, null);
            if (open) setOpen(true);
            return true;
        }

        if (opts.mode === 'multi_leg') {
            setMode('multi_leg', opts.title);
            if (calcMode !== 'multi_leg') return false;
            var legs = opts.legs || [];
            if (legs.length < 2) return false;
            paintMultiLegRows(legs, ccy);
            displayCcy = ccy;
            saveCcyPref();
            recalcMultiLeg(null);
            if (open) setOpen(true);
            return true;
        }

        setMode('three_way', opts.title);
        var odds = opts.odds || {};
        var stakes = opts.stakes || null;
        THREE_KEYS.forEach(function (k) {
            if (!oddsInputs[k] || !stakeInputs[k]) return;
            rowCcy[k] = ccy;
            if (ccySelects[k]) {
                ensureCcyOption(ccySelects[k], ccy);
                ccySelects[k].value = ccy;
            }
            var o = parsePos(odds[k]);
            writing = true;
            setDecimalOdds(k, o);
            writing = false;
        });
        displayCcy = ccy;
        saveCcyPref();

        if (stakes && parsePos(stakes.home) > 0) {
            writing = true;
            THREE_KEYS.forEach(function (k) {
                if (!stakeInputs[k]) return;
                var s = parsePos(stakes[k]);
                stakeInputs[k].value = s > 0 ? fmtN(s, ccy) : '';
            });
            writing = false;
            anchorKey = 'home';
            recalc('home');
        } else if (stakeInputs.home) {
            writing = true;
            stakeInputs.home.value = fmtN(homeStake, ccy);
            writing = false;
            anchorKey = 'home';
            recalc('home');
        }
        if (open) setOpen(true);
        return true;
    }

    function ensureCcyOption(sel, code) {
        if (!sel || !code) return;
        for (var i = 0; i < sel.options.length; i++) {
            if (sel.options[i].value === code) return;
        }
        var opt = document.createElement('option');
        opt.value = code;
        opt.textContent = code;
        sel.appendChild(opt);
    }

    window.HedgeCalc = {
        applyPreset: applyPreset,
        setOpen: setOpen,
        setMode: setMode,
    };

    function bindKey(k) {
        if (oddsInputs[k]) oddsInputs[k].addEventListener('input', function () { onEuOddsInput(k); });
        if (americanOddsInputs[k]) americanOddsInputs[k].addEventListener('input', function () { onUsOddsInput(k); });
        if (stakeInputs[k]) stakeInputs[k].addEventListener('input', function () { onStakeInput(k); });
        if (ccySelects[k]) ccySelects[k].addEventListener('change', function () { onCcyChange(k); });
    }

    function bind() {
        root = document.getElementById('hedgeCalcWidget');
        panel = document.getElementById('hedgeCalcPanel');
        fab = document.getElementById('hedgeCalcFab');
        profitEl = document.getElementById('hedgeCalcProfit');
        metaEl = document.getElementById('hedgeCalcMeta');
        noteEl = document.getElementById('hedgeCalcEuAsiaNote');
        fxTimeEl = document.getElementById('hedgeCalcFxTime');
        titleEl = document.getElementById('hedgeCalcTitle');
        rowsThree = document.getElementById('hedgeCalcRowsThreeWay');
        rowsLayBack = document.getElementById('hedgeCalcRowsLayBack');
        rowsEuAsia = document.getElementById('hedgeCalcRowsEuAsia');
        rowsMultiLeg = document.getElementById('hedgeCalcRowsMultiLeg');
        lineInput = null;
        labelEu = document.getElementById('hedgeCalcLabelEu');
        labelAh = document.getElementById('hedgeCalcLabelAh');
        if (!root || !panel || !fab) return;
        ensureWinFeeInput();

        oddsInputs = {
            home: document.getElementById('hedgeCalcOddsHome'),
            draw: document.getElementById('hedgeCalcOddsDraw'),
            away: document.getElementById('hedgeCalcOddsAway'),
            back: document.getElementById('hedgeCalcOddsBack'),
            lay: document.getElementById('hedgeCalcOddsLay'),
            eu: document.getElementById('hedgeCalcOddsEu'),
            ah: document.getElementById('hedgeCalcOddsAh'),
        };
        americanOddsInputs = {
            home: document.getElementById('hedgeCalcOddsHomeUs'),
            draw: document.getElementById('hedgeCalcOddsDrawUs'),
            away: document.getElementById('hedgeCalcOddsAwayUs'),
            back: document.getElementById('hedgeCalcOddsBackUs'),
            lay: document.getElementById('hedgeCalcOddsLayUs'),
            eu: document.getElementById('hedgeCalcOddsEuUs'),
            ah: document.getElementById('hedgeCalcOddsAhUs'),
        };
        stakeInputs = {
            home: document.getElementById('hedgeCalcStakeHome'),
            draw: document.getElementById('hedgeCalcStakeDraw'),
            away: document.getElementById('hedgeCalcStakeAway'),
            back: document.getElementById('hedgeCalcStakeBack'),
            lay: document.getElementById('hedgeCalcStakeLay'),
            eu: document.getElementById('hedgeCalcStakeEu'),
            ah: document.getElementById('hedgeCalcStakeAh'),
        };
        ccySelects = {
            home: document.getElementById('hedgeCalcCcyHome'),
            draw: document.getElementById('hedgeCalcCcyDraw'),
            away: document.getElementById('hedgeCalcCcyAway'),
            back: document.getElementById('hedgeCalcCcyBack'),
            lay: document.getElementById('hedgeCalcCcyLay'),
            eu: document.getElementById('hedgeCalcCcyEu'),
            ah: document.getElementById('hedgeCalcCcyAh'),
        };
        isolate(root);
        loadCcyPref();
        setMode('three_way');
        var cached = readFxCache();
        if (cached) applyFxPayload(cached);
        renderFxTime();

        fab.addEventListener('click', function (e) {
            e.preventDefault();
            setOpen(panel.hidden);
        });
        document.getElementById('hedgeCalcClose').addEventListener('click', function (e) {
            e.preventDefault();
            setOpen(false);
        });

        THREE_KEYS.concat(LB_KEYS, EA_KEYS).forEach(function (k) {
            bindKey(k);
            syncUsFromEu(k);
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bind);
    } else {
        bind();
    }
})();
