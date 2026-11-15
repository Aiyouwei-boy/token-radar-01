// Token Radar — the dashboard. No fetch, no network: everything comes from
// window.RADAR, written by main.ts from the same board as board.json.
// The playground re-runs the model in the page, from the same four figures
// the server model used (TVL, 7-day growth, age, chain count), so the ranking
// a reader sees is the model — move a slider and it moves.
(function () {
  var D = window.RADAR;
  if (!D) { document.body.textContent = 'Radar data failed to load.'; return; }

  var DEFAULTS = { growth: D.model.growth_weight, mat: D.model.maturity_range, chain: D.model.breadth_per_chain };
  var params = { growth: DEFAULTS.growth, mat: DEFAULTS.mat, chain: DEFAULTS.chain };
  var state = { tab: 'board', q: '', cat: '', sort: 'implied', watchOnly: false, selected: null };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(n) {
    if (n == null) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function pct(n) { return n == null ? '—' : (n > 0 ? '+' : '') + n.toFixed(1) + '%'; }
  function ageText(a) { return a == null ? 'unknown' : a >= 365 ? (a / 365).toFixed(1) + 'y' : a + 'd'; }
  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

  // The model, in the page: identical arithmetic to lib/model.ts.
  function compute(row) {
    var growth = clamp(row.change_7d == null ? 0 : row.change_7d, D.model.growth_floor, D.model.growth_cap);
    var growthMult = 1 + (growth / 100) * params.growth;
    var age = row.age_days == null ? D.model.unknown_age_days : row.age_days;
    var matMult = D.model.maturity_floor + params.mat * Math.sqrt(clamp(age, 0, D.model.maturity_days) / D.model.maturity_days);
    var breadth = 1 + Math.min(Math.max(row.chains.length - 1, 0), D.model.breadth_max_chains) * params.chain;
    return { growth: growth, growthMult: growthMult, matMult: matMult, breadth: breadth,
      implied: Math.max(1, Math.round(row.tvl_usd * D.model.base_multiple * growthMult * matMult * breadth)) };
  }

  var $ = function (id) { return document.getElementById(id); };
  var bySlug = {};
  D.rows.forEach(function (r) { bySlug[r.slug] = r; });

  // Header facts.
  $('asof').textContent = 'Snapshot ' + D.as_of;
  $('counts').textContent = D.board_size + ' ranked · ' + D.watchlist_size + ' watchlist';
  var top = D.rows[0];
  $('facts').innerHTML =
    '<div><dt>Top implied value</dt><dd>' + money(top ? top.implied_value_usd : 0) + '</dd></div>' +
    '<div><dt>Watchlist covered</dt><dd>' + D.watchlist_size + ' / ' + D.watchlist_size + '</dd></div>' +
    '<div><dt>Early finds (below floor)</dt><dd>' + D.early_size + '</dd></div>' +
    '<div><dt>Already trading, set aside</dt><dd>' + D.live_size + '</dd></div>' +
    '<div><dt>Model</dt><dd>' + esc(D.model_version) + '</dd></div>';

  // Category filter options, from the board itself.
  var cats = {};
  D.rows.forEach(function (r) { if (r.category) cats[r.category] = true; });
  Object.keys(cats).sort().forEach(function (c) {
    var o = document.createElement('option'); o.value = c; o.textContent = c; $('cat').appendChild(o);
  });

  function currentRows() {
    if (state.tab === 'live') return D.live.map(function (r, i) { return { live: true, rank: i + 1, slug: r.slug, name: r.name, category: r.category, chains: r.chains, tvl_usd: r.tvl_usd, change_7d: r.change_7d, age_days: null, implied_value_usd: r.mcap_usd || 0, mcap: r.mcap_usd }; });
    var rows = D.rows.map(function (r) { var c = compute(r); return { live: false, rank: r.rank, slug: r.slug, name: r.name, category: r.category, chains: r.chains, tvl_usd: r.tvl_usd, change_7d: r.change_7d, age_days: r.age_days, implied_value_usd: c.implied, listed_at: r.listed_at, farm_steps: r.farm_steps, model: r.model, computed: c, watch: isWatch(r) }; });
    if (state.watchOnly) rows = rows.filter(function (r) { return r.watch; });
    if (state.cat) rows = rows.filter(function (r) { return r.category === state.cat; });
    if (state.q) { var q = state.q.toLowerCase(); rows = rows.filter(function (r) { return r.name.toLowerCase().indexOf(q) >= 0 || r.slug.indexOf(q) >= 0; }); }
    var key = state.sort;
    rows.sort(function (a, b) {
      if (key === 'tvl') return b.tvl_usd - a.tvl_usd;
      if (key === 'growth') return (b.change_7d || 0) - (a.change_7d || 0);
      if (key === 'age') return (b.age_days || 0) - (a.age_days || 0);
      return b.implied_value_usd - a.implied_value_usd;
    });
    return rows;
  }

  function isWatch(r) { return D.watchlist && D.watchlist.indexOf ? D.watchlist.indexOf(r.slug) >= 0 : false; }

  function render() {
    var rows = currentRows();
    var max = 0;
    rows.forEach(function (r) { if (r.implied_value_usd > max) max = r.implied_value_usd; });
    var html = '';
    rows.forEach(function (r) {
      var g = r.change_7d;
      var gCls = g == null ? '' : g >= 0 ? 'pos' : 'neg';
      var badge = r.live ? '<span class="badge live">TRADES</span>'
        : r.watch ? '<span class="badge">WATCHLIST</span>' : '<span class="badge early">EARLY</span>';
      var val = r.live ? money(r.mcap) : money(r.implied_value_usd);
      var barW = max ? Math.max(4, Math.round((r.implied_value_usd / max) * 100)) : 0;
      html += '<tr data-slug="' + esc(r.slug) + '" data-selected="' + (state.selected === r.slug) + '">' +
        '<td class="num">' + r.rank + '</td>' +
        '<td><span class="name"><b>' + esc(r.name) + '</b><span class="sub">' + esc(r.category || 'Uncategorised') + ' · ' + esc(r.chains.slice(0, 3).join(', ') || '—') + '</span></span></td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num ' + gCls + '">' + pct(g) + '</td>' +
        '<td class="num">' + ageText(r.age_days) + '</td>' +
        '<td><span class="implied"><span class="num">' + val + '</span><span class="bar"><i style="width:' + barW + '%"></i></span></span></td>' +
        '<td>' + badge + '</td></tr>';
    });
    $('rows').innerHTML = html;
    $('empty').hidden = rows.length > 0;
    $('count').textContent = rows.length + (state.tab === 'live' ? ' trading protocols' : ' ranked protocols');
    document.querySelectorAll('#rows tr').forEach(function (tr) {
      tr.addEventListener('click', function () { openDetail(tr.getAttribute('data-slug')); });
    });
  }

  function openDetail(slug) {
    var row = bySlug[slug];
    var live = null;
    if (!row) { D.live.forEach(function (l) { if (l.slug === slug) live = l; }); }
    state.selected = slug;
    var d = $('detail');
    if (row) {
      var c = compute(row);
      $('d-sub').textContent = 'Rank #' + row.rank + ' · records no token';
      $('d-name').textContent = row.name;
      $('d-meta').textContent = (row.category || 'Uncategorised') + ' · ' + row.chains.join(', ');
      var steps = row.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
      $('d-body').innerHTML =
        '<div class="d-section"><h3>Why this value</h3><div class="equation">' +
        '<div><span>TVL × 0.20</span><b>' + money(row.tvl_usd * D.model.base_multiple) + '</b></div>' +
        '<div><span>Growth ' + pct(row.change_7d) + ' → ×' + c.growthMult.toFixed(2) + '</span><b>weight ' + params.growth.toFixed(2) + '</b></div>' +
        '<div><span>Age ' + ageText(row.age_days) + ' → ×' + c.matMult.toFixed(2) + '</span><b>range ' + params.mat.toFixed(2) + '</b></div>' +
        '<div><span>' + row.chains.length + ' chain' + (row.chains.length === 1 ? '' : 's') + ' → ×' + c.breadth.toFixed(2) + '</span><b>+' + params.chain.toFixed(2) + ' each</b></div>' +
        '<div><span>Implied value</span><b>' + money(c.implied) + '</b></div></div></div>' +
        '<div class="d-section"><h3>Farm plan — 7 steps, cost and time on each</h3><ol class="steps">' + steps + '</ol>' +
        '<p class="sub" style="margin-top:12px">This plan is a claim about the snapshot, not a promise: the snapshot says the protocol records no token, never that it has none, and it says nothing about an airdrop.</p></div>';
    } else if (live) {
      $('d-sub').textContent = 'Already trading — not ranked';
      $('d-name').textContent = live.name;
      $('d-meta').textContent = (live.category || 'Uncategorised') + ' · ' + live.chains.join(', ');
      $('d-body').innerHTML =
        '<div class="d-section"><h3>Market value, not a model</h3><div class="equation">' +
        '<div><span>Market cap</span><b>' + money(live.mcap_usd) + '</b></div>' +
        '<div><span>TVL</span><b>' + money(live.tvl_usd) + '</b></div>' +
        '<div><span>7-day TVL change</span><b>' + pct(live.change_7d) + '</b></div></div>' +
        '<p class="sub" style="margin-top:12px">This protocol already trades, so the board shows the market\u2019s own value and gives it no farm plan. It is here so a reader can see what “still to come” is being separated from.</p></div>';
    } else { return; }
    d.hidden = false;
    try { history.replaceState(null, '', '#' + slug); } catch (e) {}
    render();
  }

  function closeDetail() {
    state.selected = null;
    $('detail').hidden = true;
    try { history.replaceState(null, '', location.pathname); } catch (e) {}
    render();
  }

  $('d-close').addEventListener('click', closeDetail);
  $('q').addEventListener('input', function (e) { state.q = e.target.value; render(); });
  $('cat').addEventListener('change', function (e) { state.cat = e.target.value; render(); });
  $('sort').addEventListener('change', function (e) { state.sort = e.target.value; render(); });
  $('watchonly').addEventListener('change', function (e) { state.watchOnly = e.target.checked; render(); });
  $('clear').addEventListener('click', function () { state.q = ''; state.cat = ''; state.watchOnly = false; $('q').value = ''; $('cat').value = ''; $('watchonly').checked = false; render(); });
  function setTab(tab) {
    state.tab = tab;
    $('tab-board').setAttribute('aria-pressed', tab === 'board' ? 'true' : 'false');
    $('tab-live').setAttribute('aria-pressed', tab === 'live' ? 'true' : 'false');
    render();
  }
  $('tab-board').addEventListener('click', function () { setTab('board'); });
  $('tab-live').addEventListener('click', function () { setTab('live'); });

  // Playground: re-rank from the same figures, live.
  function bindSlider(id, out, key, fmt) {
    $(id).addEventListener('input', function (e) {
      params[key] = parseFloat(e.target.value);
      $(out).textContent = fmt(params[key]);
      render();
      if (state.selected && bySlug[state.selected]) openDetail(state.selected);
    });
  }
  bindSlider('s-growth', 'o-growth', 'growth', function (v) { return v.toFixed(2); });
  bindSlider('s-mat', 'o-mat', 'mat', function (v) { return v.toFixed(2); });
  bindSlider('s-chain', 'o-chain', 'chain', function (v) { return v.toFixed(2); });
  $('reset-model').addEventListener('click', function () {
    params = { growth: DEFAULTS.growth, mat: DEFAULTS.mat, chain: DEFAULTS.chain };
    $('s-growth').value = DEFAULTS.growth; $('s-mat').value = DEFAULTS.mat; $('s-chain').value = DEFAULTS.chain;
    $('o-growth').textContent = DEFAULTS.growth.toFixed(2); $('o-mat').textContent = DEFAULTS.mat.toFixed(2); $('o-chain').textContent = DEFAULTS.chain.toFixed(2);
    render();
  });

  // The board data carries the watchlist so the page can badge it.
  // main.ts writes D.watchlist into data.js from the snapshot.
  render();
  var hash = location.hash ? location.hash.slice(1) : '';
  if (hash && (bySlug[hash] || D.live.some(function (l) { return l.slug === hash; }))) openDetail(hash);
})();
