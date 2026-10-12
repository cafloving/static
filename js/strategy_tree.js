/**
 * FT 策略树：浏览 / 多选。
 * 勾选某一级 = 勾选其全部下级叶节点。
 * 对外标签一律用 Key（FT / PRE / L1 / FT-PRE-EU-3W），不用本地化长名。
 */
(function (global) {
    'use strict';

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function pickName(node) {
        if (!node) return '';
        if (typeof node.display_name === 'string' && node.display_name.trim()) return node.display_name.trim();
        if (typeof node.name === 'string' && node.name.trim()) return node.name.trim();
        return '';
    }

    function pickDesc(node, headsByName) {
        var text = node && node.description;
        if (typeof text === 'string' && text.trim() && text.charAt(0) !== '{') return text.trim();
        var d = node && node.descriptions;
        var key = node && (node.config_name || node.id);
        if ((!d || typeof d !== 'object') && key && headsByName && headsByName[key]) {
            if (typeof headsByName[key].description === 'string') return headsByName[key].description;
            d = headsByName[key].descriptions;
        }
        if (d && typeof d.en === 'string') return d.en;
        return '';
    }

    function pickKey(node) {
        if (!node) return '';
        if (node.kind === 'leaf') return node.config_name || node.id || '';
        if (node.key) return node.key;
        if (node.kind === 'sport') return node.sport || node.id || 'FT';
        if (node.kind === 'phase') return node.phase || node.id || '';
        if (node.kind === 'layer') return node.layer_code || node.id || '';
        return node.id || node.config_name || '';
    }

    function descHtml(node, headsByName) {
        var text = pickDesc(node, headsByName);
        if (!text) return '';
        return '<span class="strategy-tree-desc">' + esc(text) + '</span>';
    }

    function walkLeaves(node, acc) {
        if (!node) return acc;
        if (node.kind === 'leaf' && node.config_name) {
            acc.push(node.config_name);
            return acc;
        }
        (node.children || []).forEach(function (c) { walkLeaves(c, acc); });
        return acc;
    }

    function descendantLeaves(node) {
        return walkLeaves(node, []);
    }

    function findNode(root, id) {
        if (!root) return null;
        if (root.id === id || root.config_name === id) return root;
        var kids = root.children || [];
        for (var i = 0; i < kids.length; i++) {
            var found = findNode(kids[i], id);
            if (found) return found;
        }
        return null;
    }

    function engineOf(node, headsByName) {
        if (node && node.calc_engine) return node.calc_engine;
        var key = node && node.config_name;
        if (key && global.StrategyType && StrategyType.engineOf) {
            return StrategyType.engineOf(key, headsByName && headsByName[key]);
        }
        return '';
    }

    function renderNav(root, opts) {
        opts = opts || {};
        var headsByName = opts.headsByName || {};
        var onSelect = opts.onSelect || function () {};
        var selected = opts.selected || '';

        function badge(node) {
            if (node.kind !== 'leaf') return '';
            var eng = engineOf(node, headsByName);
            if (eng === 'deferred') return ' <span class="badge bg-secondary">暂缓</span>';
            return '';
        }

        function meta(node) {
            if (node.kind !== 'leaf') return '';
            var row = headsByName[node.config_name];
            var id = row ? ('#' + (row.legacy_id || '-')) : '未种子';
            var eng = engineOf(node, headsByName);
            return '<div class="small text-muted">' + esc(id) + (eng ? ' · ' + esc(eng) : '') + '</div>';
        }

        function item(node, depth) {
            var kids = node.children || [];
            var isLeaf = node.kind === 'leaf';
            var open = depth < 2;
            var active = isLeaf && node.config_name === selected ? ' active' : '';
            var key = isLeaf ? node.config_name : '';
            var title = pickKey(node);
            var body = '<div class="fw-semibold font-monospace">' + esc(title) + badge(node) + '</div>' + meta(node);
            var head = isLeaf
                ? ('<button type="button" class="list-group-item list-group-item-action strategy-tree-leaf' + active +
                    '" data-key="' + esc(key) + '">' + body + '</button>')
                : ('<button type="button" class="list-group-item list-group-item-action strategy-tree-group" data-id="' +
                    esc(node.id) + '"><span class="strategy-tree-caret">' + (open ? '▾' : '▸') +
                    '</span> <strong class="font-monospace">' + esc(title) + '</strong>' +
                    (kids.length ? ' <span class="text-muted small">(' + descendantLeaves(node).length + ')</span>' : '') +
                    '</button>');
            var inner = kids.map(function (c) { return item(c, depth + 1); }).join('');
            if (!kids.length) return head;
            return '<div class="strategy-tree-node" data-open="' + (open ? '1' : '0') + '">' +
                head + '<div class="strategy-tree-children"' + (open ? '' : ' hidden') + '>' + inner + '</div></div>';
        }

        var html = item(root, 0);
        return {
            html: html,
            bind: function (el) {
                if (!el) return;
                el.onclick = function (ev) {
                    var leaf = ev.target.closest('.strategy-tree-leaf');
                    if (leaf) {
                        onSelect(leaf.getAttribute('data-key'));
                        return;
                    }
                    var group = ev.target.closest('.strategy-tree-group');
                    if (!group) return;
                    var wrap = group.parentElement;
                    if (!wrap || !wrap.classList.contains('strategy-tree-node')) return;
                    var open = wrap.getAttribute('data-open') !== '1';
                    wrap.setAttribute('data-open', open ? '1' : '0');
                    var kidsEl = wrap.querySelector(':scope > .strategy-tree-children');
                    if (kidsEl) kidsEl.hidden = !open;
                    var caret = group.querySelector('.strategy-tree-caret');
                    if (caret) caret.textContent = open ? '▾' : '▸';
                };
            },
        };
    }

    function renderPicker(root, opts) {
        opts = opts || {};
        var selected = new Set(opts.selected || []);
        var includeSystem = opts.systemNodes || [];

        function allLeaves(node) {
            return descendantLeaves(node);
        }

        function stateOf(node) {
            var leaves = allLeaves(node);
            if (!leaves.length) return 'none';
            var n = 0;
            leaves.forEach(function (k) { if (selected.has(k)) n++; });
            if (n === 0) return 'none';
            if (n === leaves.length) return 'all';
            return 'some';
        }

        function box(node) {
            var st = node.kind === 'leaf'
                ? (selected.has(node.config_name) ? 'all' : 'none')
                : stateOf(node);
            var checked = st === 'all' ? ' checked' : '';
            var ind = st === 'some' ? ' data-indeterminate="1"' : '';
            return '<input type="checkbox" class="form-check-input strategy-tree-check" data-id="' +
                esc(node.id || node.config_name) + '"' + checked + ind + '>';
        }

        function item(node, depth) {
            var kids = node.children || [];
            var isLeaf = node.kind === 'leaf';
            var title = pickKey(node);
            var extra = isLeaf
                ? ''
                : (' <span class="text-muted small">(' + allLeaves(node).length + ')</span>');
            var def = node.calc_engine === 'deferred' ? ' <span class="badge bg-secondary">暂缓</span>' : '';
            var text = '<span class="strategy-tree-pick-text"><span class="font-monospace">' +
                esc(title) + extra + def + '</span>' +
                (isLeaf ? descHtml(node, opts.headsByName) : '') + '</span>';
            var checkLabel = '<label class="strategy-tree-pick-label">' + box(node) + text + '</label>';
            var row = '<div class="strategy-tree-pick-row" style="padding-left:' + (depth * 12) + 'px">' +
                checkLabel + '</div>';
            if (!kids.length) return row;
            return '<div class="strategy-tree-node" data-open="1">' +
                '<div class="strategy-tree-pick-row" style="padding-left:' + (depth * 12) + 'px">' +
                '<button type="button" class="strategy-tree-caret-btn" aria-label="折叠">▾</button>' +
                checkLabel + '</div>' +
                '<div class="strategy-tree-children">' +
                kids.map(function (c) { return item(c, depth + 1); }).join('') +
                '</div></div>';
        }

        var sys = includeSystem.map(function (n) {
            var id = n.config_name;
            var checked = selected.has(id) ? ' checked' : '';
            return '<div class="strategy-tree-pick-row"><label class="strategy-tree-pick-label">' +
                '<input type="checkbox" class="form-check-input strategy-tree-check" data-id="' + esc(id) + '"' + checked + '>' +
                '<span class="strategy-tree-pick-text"><code class="small">' + esc(id) + '</code>' +
                descHtml(n, opts.headsByName) + '</span></label></div>';
        }).join('');

        return {
            html: sys + item(root, 0),
            bind: function (el) {
                if (!el) return;
                function syncIndeterminate() {
                    el.querySelectorAll('.strategy-tree-check').forEach(function (inp) {
                        inp.indeterminate = inp.getAttribute('data-indeterminate') === '1';
                    });
                }
                el.addEventListener('change', function (ev) {
                    var inp = ev.target;
                    if (!inp.classList.contains('strategy-tree-check')) return;
                    var id = inp.getAttribute('data-id');
                    var node = findNode(root, id);
                    var keys = [];
                    if (node) keys = descendantLeaves(node);
                    if (!keys.length) keys = [id];
                    keys.forEach(function (k) {
                        if (inp.checked) selected.add(k);
                        else selected.delete(k);
                    });
                    if (typeof opts.onChange === 'function') opts.onChange(Array.from(selected));
                    el.innerHTML = renderPicker(root, Object.assign({}, opts, { selected: Array.from(selected) })).html;
                    renderPicker(root, Object.assign({}, opts, { selected: Array.from(selected) })).bind(el);
                    // re-bind would double; instead re-render via caller
                });
                syncIndeterminate();
            },
            selected: function () { return Array.from(selected); },
        };
    }

    /** 勾选树：change 时重绘，避免重复 bind。 */
    function mountPicker(el, root, opts) {
        if (!el) return { selected: function () { return []; } };
        opts = opts || {};
        var selected = new Set(opts.selected || []);
        function paint() {
            var view = renderPicker(root, Object.assign({}, opts, {
                selected: Array.from(selected),
                onChange: function (keys) {
                    selected = new Set(keys);
                    paint();
                    if (typeof opts.onChange === 'function') opts.onChange(Array.from(selected));
                },
            }));
            el.innerHTML = view.html;
            el.querySelectorAll('.strategy-tree-check').forEach(function (inp) {
                inp.indeterminate = inp.getAttribute('data-indeterminate') === '1';
            });
            el.onclick = function (ev) {
                var caret = ev.target.closest('.strategy-tree-caret-btn');
                if (!caret) return;
                ev.preventDefault();
                var wrap = caret.closest('.strategy-tree-node');
                if (!wrap) return;
                var open = wrap.getAttribute('data-open') !== '1';
                wrap.setAttribute('data-open', open ? '1' : '0');
                var kidsEl = wrap.querySelector(':scope > .strategy-tree-children');
                if (kidsEl) kidsEl.hidden = !open;
                caret.textContent = open ? '▾' : '▸';
            };
            el.onchange = function (ev) {
                var inp = ev.target;
                if (!inp.classList.contains('strategy-tree-check')) return;
                var id = inp.getAttribute('data-id');
                var node = findNode(root, id);
                var keys = node ? descendantLeaves(node) : [];
                if (!keys.length) keys = [id];
                keys.forEach(function (k) {
                    if (inp.checked) selected.add(k);
                    else selected.delete(k);
                });
                paint();
                if (typeof opts.onChange === 'function') opts.onChange(Array.from(selected));
            };
        }
        paint();
        return {
            selected: function () { return Array.from(selected); },
            setSelected: function (keys) {
                selected = new Set(keys || []);
                paint();
            },
        };
    }

    function renderView(root, opts) {
        opts = opts || {};
        var selected = new Set(opts.selected || []);
        var headsByName = opts.headsByName || {};
        var extraMap = opts.leafExtra || {};

        function leafLine(node) {
            var name = node.config_name || node.id || '';
            var keyHtml = '<code>' + esc(name) + '</code>';
            if (typeof opts.leafHref === 'function') {
                keyHtml = '<a href="' + esc(opts.leafHref(name)) + '">' + keyHtml + '</a>';
            }
            var extra = extraMap[name];
            var shown = pickName(node);
            return '<li>' + keyHtml +
                (shown && shown !== name ? ' <span class="text-muted">' + esc(shown) + '</span>' : '') +
                (extra ? ' <span class="text-muted small">' + esc(extra) + '</span>' : '') +
                descHtml(node, headsByName) + '</li>';
        }

        function item(node, depth) {
            var kids = node.children || [];
            var leaves = descendantLeaves(node);
            var n = 0;
            leaves.forEach(function (k) { if (selected.has(k)) n++; });
            if (node.kind === 'leaf') {
                if (!selected.has(node.config_name)) return '';
                return leafLine(node);
            }
            if (n === 0) return '';
            var inner = kids.map(function (c) { return item(c, depth + 1); }).join('');
            return '<li><strong class="font-monospace">' + esc(pickKey(node)) + '</strong><ul>' + inner + '</ul></li>';
        }

        var sys = (opts.systemNodes || []).map(function (n) {
            var id = n.config_name;
            if (!selected.has(id)) return '';
            return leafLine(n);
        }).join('');

        return '<ul class="strategy-tree-view">' + sys + item(root, 0) + '</ul>';
    }

    global.StrategyTree = {
        pickName: pickName,
        pickKey: pickKey,
        pickDesc: pickDesc,
        descendantLeaves: descendantLeaves,
        findNode: findNode,
        renderNav: renderNav,
        mountPicker: mountPicker,
        renderView: renderView,
    };
})(window);
