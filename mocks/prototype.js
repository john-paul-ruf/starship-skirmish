/* =============================================================
   STARSHIP SKIRMISH — prototype.js
   MOCK-ONLY flow runner. This file is prototype scaffolding and is
   NOT intended to survive into src/. It exists so the static mocks
   can be walked end-to-end as clickable flows.

   Responsibilities:
     1. Inject a persistent flow bar (step N of M, prev/next).
     2. Provide a flow picker overlay (all six flows from design.md §5).
     3. Bind keyboard shortcuts so every screen is reachable by key.
     4. Rewrite [data-proto-next] / [data-proto-prev] elements so a
        mock's own primary buttons advance the active flow.

   Usage — one line at the end of each mock's <body>:
     <script src="prototype.js"></script>

   Flow state travels in the URL (?flow=fight&step=2) so it survives
   a plain <a href> navigation. No storage, no framework, no build.
   ============================================================= */
(function () {
  'use strict';

  /* ---------- 1. FLOW DEFINITIONS (design.md §5) --------------- */
  var FLOWS = {
    build: {
      name: 'Build a ship',
      tag: 'PRIMARY',
      blurb: 'swap → read delta → swap again',
      steps: [
        { file: 'encyclopedia.html',  label: 'Library',        note: 'Start in the Encyclopedia. Hit NEW BUILD.' },
        { file: 'shipyard.html',      label: 'Pick chassis',   note: 'Choose a hull. Its class publishes the slot layout.' },
        { file: 'shipyard.html',      label: 'Fit components', note: 'Spend into slots. Every fit is an explicit trade.' },
        { file: 'shipyard.html',      label: 'Read the deltas',note: 'Point total and derived stats move on every swap.' },
        { file: 'encyclopedia.html',  label: 'Saved',          note: 'Back to the library with the new build.' }
      ]
    },
    fight: {
      name: 'Fight',
      tag: 'PAYOFF',
      blurb: 'blind commit, simultaneous resolution',
      steps: [
        { file: 'encyclopedia.html',    label: 'Library',       note: 'Pick SKIRMISH to take builds to the field.' },
        { file: 'skirmish-setup.html',  label: 'Budget & draft',note: 'Choose a budget, draft a fleet, configure bots.' },
        { file: 'tactical-move.html',   label: 'Plot arcs',     note: 'Blind. Newtonian. Watch the boundary.' },
        { file: 'tactical-attack.html', label: 'Assign fire',   note: 'Blind. Post-movement positions. Called shots if shields are down.' },
        { file: 'post-match.html',      label: 'Last standing', note: 'Outcome, per-ship fate, seed, full combat log.' }
      ]
    },
    share: {
      name: 'Share a build',
      tag: 'THE META',
      blurb: 'the link IS the ship',
      steps: [
        { file: 'shipyard.html',     label: 'Copy share link', note: '≤1900 chars, encoded against the versioned catalog.' },
        { file: 'share-import.html', label: 'Import preview',  note: 'Full fit shown before anything is written.' },
        { file: 'encyclopedia.html', label: 'Added',           note: 'Additive. Collisions offer rename / replace / cancel.' }
      ]
    },
    backup: {
      name: 'Back up / trade a fleet',
      tag: 'PORTABILITY',
      blurb: 'JSON is the only real backup',
      steps: [
        { file: 'encyclopedia.html', label: 'Select & export', note: 'Whole library or a subset, to a JSON file.' },
        { file: 'share-import.html', label: 'Drop a .json',    note: 'Per-build result summary. Never deletes.' },
        { file: 'encyclopedia.html', label: 'Merged',          note: 'Additive by default.' }
      ]
    },
    refit: {
      name: 'Return after a year',
      tag: 'NO LOSS, EVER',
      blurb: 'the flag is a receipt, not a lock',
      steps: [
        { file: 'encyclopedia.html', label: 'Migration runs',  note: 'Every artifact upgrades to current schema + stats.' },
        { file: 'encyclopedia.html', label: 'needs-refit',     note: 'Shows what changed and by how much.' },
        { file: 'shipyard.html',     label: 'Re-fit or keep',  note: 'Still viewable, duplicable, shareable either way.' }
      ]
    },
    concede: {
      name: 'Deadlock exit',
      tag: 'RULING D',
      blurb: 'a player exit, not a game rule',
      steps: [
        { file: 'tactical-move.html', label: 'Unwinnable',  note: 'No timer, no turn cap, no draw state.' },
        { file: 'post-match.html',    label: 'Conceded',    note: 'Immediate loss. Bots never concede.' }
      ]
    }
  };

  /* Screens for the jump menu + hotkeys */
  var SCREENS = [
    { key: '1', file: 'shipyard.html',       label: 'Shipyard' },
    { key: '2', file: 'encyclopedia.html',   label: 'Encyclopedia' },
    { key: '3', file: 'share-import.html',   label: 'Share / Import' },
    { key: '4', file: 'skirmish-setup.html', label: 'Skirmish Setup' },
    { key: '5', file: 'tactical-move.html',  label: 'Tactical — Move' },
    { key: '6', file: 'tactical-attack.html',label: 'Tactical — Attack' },
    { key: '7', file: 'post-match.html',     label: 'Post-Match' },
    { key: '0', file: 'index.html',          label: 'Prototype Index' }
  ];

  /* ---------- 2. STATE ----------------------------------------- */
  var qs = new URLSearchParams(location.search);
  var flowKey = qs.get('flow');
  var stepIdx = parseInt(qs.get('step'), 10);
  var flow = FLOWS[flowKey] || null;
  if (!flow || isNaN(stepIdx) || stepIdx < 0 || stepIdx >= flow.steps.length) {
    if (flow) stepIdx = 0; else { flow = null; stepIdx = 0; }
  }

  function href(fk, si) {
    var f = FLOWS[fk];
    if (!f) return 'index.html';
    var s = f.steps[si];
    return s.file + '?flow=' + fk + '&step=' + si;
  }

  /* ---------- 3. STYLES ---------------------------------------- */
  var css = document.createElement('style');
  css.textContent = [
    '.proto-bar{position:fixed;left:0;right:0;bottom:0;z-index:200;display:flex;align-items:center;gap:12px;',
    'height:40px;padding:0 12px;background:rgba(7,11,17,.94);backdrop-filter:blur(6px);',
    'border-top:1px solid var(--line-hot);box-shadow:0 -12px 40px -24px #000;font-family:var(--mono)}',
    '.proto-bar.is-hidden{transform:translateY(100%)}',
    '.proto-tag{font-size:9px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:var(--ink-ghost);',
    'border:1px solid var(--line);border-radius:10px;padding:2px 8px;flex:none}',
    '.proto-name{font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--cyan);flex:none}',
    '.proto-note{font-size:10px;letter-spacing:.06em;color:var(--ink-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.proto-pips{display:flex;gap:4px;flex:none}',
    '.proto-pip{width:20px;height:3px;background:var(--line);border-radius:2px;display:block;text-decoration:none}',
    '.proto-pip:hover{background:var(--line-hot)}',
    '.proto-pip.is-done{background:var(--cyan-deep)}',
    '.proto-pip.is-now{background:var(--cyan);box-shadow:0 0 10px -2px var(--cyan)}',
    '.proto-toggle{position:fixed;right:12px;bottom:48px;z-index:200}',
    '.proto-sheet{position:fixed;inset:0;z-index:210;display:none;place-items:center;background:rgba(2,4,7,.82);backdrop-filter:blur(4px)}',
    '.proto-sheet.is-open{display:grid}',
    '.proto-card{width:min(920px,calc(100vw - 64px));max-height:calc(100vh - 80px);overflow:auto;',
    'background:var(--panel);border:1px solid var(--line-hot);border-radius:var(--r-lg);box-shadow:var(--glow-2),0 40px 90px -30px #000}',
    '.proto-flow{display:block;text-decoration:none;color:inherit;padding:10px 12px;background:var(--panel-in);',
    'border:1px solid var(--line);border-left:2px solid var(--cyan);border-radius:var(--r);transition:background .12s,border-color .12s}',
    '.proto-flow:hover{background:var(--panel-hi);border-color:var(--cyan)}',
    '.proto-kbd{display:inline-grid;place-items:center;min-width:18px;height:18px;padding:0 5px;font-size:10px;font-weight:700;',
    'color:var(--ink);background:var(--panel-hi);border:1px solid var(--line-hot);border-bottom-width:2px;border-radius:var(--r-sm)}',
    '@media(max-width:1023px){.proto-bar,.proto-toggle,.proto-sheet{display:none!important}}'
  ].join('');
  document.head.appendChild(css);

  /* ---------- 4. FLOW BAR -------------------------------------- */
  var bar = document.createElement('div');
  bar.className = 'proto-bar';

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  }); }

  function renderBar() {
    var html = '';
    if (flow) {
      var prev = stepIdx > 0 ? href(flowKey, stepIdx - 1) : null;
      var next = stepIdx < flow.steps.length - 1 ? href(flowKey, stepIdx + 1) : null;
      var st = flow.steps[stepIdx];

      html += '<span class="proto-tag">' + esc(flow.tag) + '</span>';
      html += '<span class="proto-name">' + esc(flow.name) + '</span>';
      html += '<span class="proto-pips">';
      for (var i = 0; i < flow.steps.length; i++) {
        var cl = i < stepIdx ? 'is-done' : (i === stepIdx ? 'is-now' : '');
        html += '<a class="proto-pip ' + cl + '" href="' + href(flowKey, i) +
                '" title="' + esc((i + 1) + '. ' + flow.steps[i].label) + '"></a>';
      }
      html += '</span>';
      html += '<span class="mono-xs" style="flex:none;color:var(--ink-hi)">' +
              (stepIdx + 1) + '/' + flow.steps.length + ' &middot; ' + esc(st.label) + '</span>';
      html += '<span class="proto-note grow">' + esc(st.note) + '</span>';
      html += prev ? '<a class="btn btn-sm" href="' + prev + '">&larr; Prev</a>'
                   : '<span class="btn btn-sm is-disabled">&larr; Prev</span>';
      html += next ? '<a class="btn btn-sm btn-primary" href="' + next + '">Next &rarr;</a>'
                   : '<a class="btn btn-sm btn-primary" href="index.html">Finish &check;</a>';
    } else {
      html += '<span class="proto-tag">Prototype</span>';
      html += '<span class="proto-note grow">Not in a flow. Pick one to walk the mocks end-to-end, ' +
              'or jump to any screen.</span>';
    }
    html += '<button class="btn btn-sm" data-proto-open>Flows &amp; Keys <span class="proto-kbd">?</span></button>';
    html += '<button class="btn btn-sm btn-ghost" data-proto-hide title="Hide this bar">&times;</button>';
    bar.innerHTML = html;
  }
  renderBar();

  /* ---------- 5. FLOW / SHORTCUT SHEET ------------------------- */
  var sheet = document.createElement('div');
  sheet.className = 'proto-sheet';
  (function () {
    var h = '<div class="proto-card">';
    h += '<div class="panel-hd"><span class="t-h2">Prototype Navigator</span><span class="grow"></span>' +
         '<span class="mono-xs">mocks are standalone HTML &middot; no framework &middot; no build step</span>' +
         '<button class="btn btn-sm btn-ghost" data-proto-close>&times; Close</button></div>';
    h += '<div class="panel-bd" style="display:grid;grid-template-columns:1.25fr 1fr;gap:24px">';

    /* Flows */
    h += '<div><div class="t-label" style="margin-bottom:8px">Flows &mdash; design.md &sect;5</div><div class="stack">';
    Object.keys(FLOWS).forEach(function (k) {
      var f = FLOWS[k];
      h += '<a class="proto-flow" href="' + href(k, 0) + '">' +
           '<div style="display:flex;align-items:center;gap:8px;margin-bottom:3px">' +
           '<span class="t-h2" style="font-size:12px">' + esc(f.name) + '</span>' +
           '<span class="grow"></span>' +
           '<span class="chip chip-cyan">' + esc(f.tag) + '</span>' +
           '<span class="mono-xs">' + f.steps.length + ' steps</span></div>' +
           '<div class="mono-xs">' + esc(f.blurb) + '</div></a>';
    });
    h += '</div></div>';

    /* Screens + keys */
    h += '<div><div class="t-label" style="margin-bottom:8px">Jump to screen</div><div class="stack">';
    SCREENS.forEach(function (s) {
      h += '<a class="proto-flow" style="border-left-color:var(--line-hot);padding:7px 12px" href="' + s.file + '">' +
           '<div style="display:flex;align-items:center;gap:8px">' +
           '<span class="proto-kbd">' + s.key + '</span>' +
           '<span style="font-size:12px;color:var(--ink-hi)">' + esc(s.label) + '</span>' +
           '<span class="grow"></span><span class="mono-xs">' + esc(s.file) + '</span></div></a>';
    });
    h += '</div><hr class="hr-dash">';
    h += '<div class="t-label" style="margin-bottom:8px">Keys</div>';
    h += '<div class="stack">' +
         '<div class="stat"><span class="stat-k">Next / prev step</span><span><span class="proto-kbd">&rarr;</span> <span class="proto-kbd">&larr;</span></span></div>' +
         '<div class="stat"><span class="stat-k">This navigator</span><span class="proto-kbd">?</span></div>' +
         '<div class="stat"><span class="stat-k">Reduced motion</span><span class="proto-kbd">R</span></div>' +
         '<div class="stat"><span class="stat-k">Hide / show bar</span><span class="proto-kbd">H</span></div>' +
         '<div class="stat"><span class="stat-k">Close</span><span class="proto-kbd">Esc</span></div>' +
         '</div>';
    h += '</div></div></div>';
    sheet.innerHTML = h;
  })();

  /* ---------- 6. MOUNT ----------------------------------------- */
  function mount() {
    document.body.appendChild(bar);
    document.body.appendChild(sheet);
    /* Keep the bar from covering the last row of any scrolling page. */
    var pad = document.createElement('style');
    pad.textContent = 'body{padding-bottom:40px}';
    document.head.appendChild(pad);
    wireHooks();
  }

  /* ---------- 7. [data-proto-next] HOOKS ----------------------- *
     A mock's own primary button can carry data-proto-next. When the
     screen is being walked as part of a flow, the button advances the
     flow (preserving ?flow/&step). Outside a flow it keeps whatever
     href the mock author gave it.                                  */
  function wireHooks() {
    if (!flow) return;
    var nextHref = stepIdx < flow.steps.length - 1 ? href(flowKey, stepIdx + 1) : 'index.html';
    var prevHref = stepIdx > 0 ? href(flowKey, stepIdx - 1) : 'index.html';
    document.querySelectorAll('[data-proto-next]').forEach(function (el) {
      if (el.tagName === 'A') el.setAttribute('href', nextHref);
      else el.addEventListener('click', function () { location.href = nextHref; });
    });
    document.querySelectorAll('[data-proto-prev]').forEach(function (el) {
      if (el.tagName === 'A') el.setAttribute('href', prevHref);
      else el.addEventListener('click', function () { location.href = prevHref; });
    });
  }

  /* ---------- 8. EVENTS ---------------------------------------- */
  function openSheet()  { sheet.classList.add('is-open'); }
  function closeSheet() { sheet.classList.remove('is-open'); }

  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-proto-open]'))  { openSheet(); }
    if (e.target.closest('[data-proto-close]')) { closeSheet(); }
    if (e.target.closest('[data-proto-hide]'))  { bar.classList.add('is-hidden'); }
    if (e.target === sheet) closeSheet();
  });

  document.addEventListener('keydown', function (e) {
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    if (e.key === 'Escape') { closeSheet(); return; }
    if (e.key === '?')      { e.preventDefault(); sheet.classList.contains('is-open') ? closeSheet() : openSheet(); return; }
    if (e.key === 'r' || e.key === 'R') { document.body.classList.toggle('rm'); return; }
    if (e.key === 'h' || e.key === 'H') { bar.classList.toggle('is-hidden'); return; }

    if (flow && e.key === 'ArrowRight' && stepIdx < flow.steps.length - 1) {
      location.href = href(flowKey, stepIdx + 1); return;
    }
    if (flow && e.key === 'ArrowLeft' && stepIdx > 0) {
      location.href = href(flowKey, stepIdx - 1); return;
    }
    var hit = SCREENS.filter(function (s) { return s.key === e.key; })[0];
    if (hit) location.href = hit.file;
  });

  /* ---------- 9. GO -------------------------------------------- */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }

  /* Expose for the index page's own controls. */
  window.PROTO = { FLOWS: FLOWS, SCREENS: SCREENS, href: href, open: openSheet };
})();
