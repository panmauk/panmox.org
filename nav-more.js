/* Products menu: the "Other" apps sit beside the main list, like a mega-menu.
   Hovering (or tapping) "Other" shows them in the empty space; hovering any of
   the main items hides them again. Every page already has #productsDropdown
   with an "Other" button (#otherBtn); this file builds the panel behind it. */
(function () {
  var dd = document.getElementById('productsDropdown');
  var btn = document.getElementById('otherBtn');
  if (!dd || !btn) return;
  var inner = dd.querySelector('.nav-dropdown-inner');
  var heading = inner.querySelector('h4');
  var list = inner.querySelector('ul');

  var APPS = [
    ['neuralxp.html#whats-new', 'Neural', 'XP', '#b765ff', 'AI for Windows XP. A modern language model on machines the world forgot.'],
    ['lostengine.html#whats-new', 'Lost', 'Engine', '#ff8c00', 'The search engine that finds everything except what you’re looking for.'],
    ['overbyte.html?intro=1#whats-new', 'Over', 'Byte', '#28c878', 'Reverse compression. Makes files bigger. On purpose.'],
    ['linuxsimplify.html?intro=1#whats-new', 'Linux', 'Simplify', '#4d8dff', 'Switch from Windows to GNU/Linux, the easy way.']
  ];

  var css = document.createElement('style');
  css.textContent =
    '.nav-other-btn{font-family:var(--serif,serif);font-weight:500;font-size:28px;letter-spacing:-.5px;color:var(--paper,#ebe2d0);' +
      'background:none;border:0;padding:0;cursor:pointer;display:inline-flex;align-items:center;gap:12px;transition:color .25s,transform .25s}' +
    '.nav-other-btn:hover,.nav-dropdown.other-open .nav-other-btn{color:var(--cyan,#00e5ff);transform:translateX(10px)}' +
    '.nav-other-arrow{font-family:var(--mono,monospace);font-size:.6em;opacity:.6}' +
    '.nav-dropdown.show{overflow-y:auto;max-height:min(540px,calc(100vh - 56px))}' +
    '.nav-split{display:grid;grid-template-columns:minmax(240px,300px) minmax(0,1fr);gap:40px;align-items:start}' +
    '.nav-other{opacity:0;visibility:hidden;transform:translateX(-12px);transition:opacity .25s,transform .25s,visibility .25s;' +
      'border-left:1px solid var(--rule,rgba(235,226,208,.08));padding-left:40px}' +
    '.nav-dropdown.other-open .nav-other{opacity:1;visibility:visible;transform:none}' +
    '.nav-other-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}' +
    '.nav-dropdown .nav-other-grid a{display:block;padding:16px 18px;border:1px solid var(--rule,rgba(235,226,208,.08));border-radius:12px;' +
      'background:rgba(235,226,208,.02);text-decoration:none;transition:border-color .25s,background .25s,transform .25s}' +
    '.nav-dropdown .nav-other-grid a:hover{border-color:rgba(0,229,255,.4);background:rgba(0,229,255,.04);transform:translateY(-2px)}' +
    '.nav-other-name{display:block;font-family:var(--serif,serif);font-weight:500;font-size:24px;letter-spacing:-.5px;color:var(--paper,#ebe2d0);margin-bottom:6px}' +
    '.nav-other-desc{display:block;font-family:var(--sans,system-ui,sans-serif);font-size:14px;line-height:1.5;color:var(--paper-dim,#b9b09e)}' +
    '.nav-other-note{margin:16px 2px 0;font-family:var(--mono,monospace);font-size:11px;letter-spacing:1px;line-height:1.6;color:var(--paper-mute,#8a8372)}' +
    '@media (max-width:860px){' +
      '.nav-split{grid-template-columns:minmax(0,1fr);gap:20px}' +
      '.nav-other{display:none;border-left:0;padding-left:0;transform:none}' +
      '.nav-dropdown.other-open .nav-other{display:block}' +
      '.nav-other-btn{font-size:24px}' +
      '.nav-other-grid{grid-template-columns:minmax(0,1fr)}' +
      '.nav-dropdown .nav-other-grid a{padding:14px 16px}' +
      '.nav-other-name{font-size:22px}' +
    '}';
  document.head.appendChild(css);

  // list on the left, "Other" apps on the right
  var split = document.createElement('div');
  split.className = 'nav-split';
  inner.insertBefore(split, list);
  split.appendChild(list);

  var panel = document.createElement('div');
  panel.className = 'nav-other';
  panel.id = 'otherPanel';
  panel.innerHTML = '<div class="nav-other-grid">' + APPS.map(function (a) {
    return '<a href="' + a[0] + '"><span class="nav-other-name"><span style="color:' + a[3] + '">' + a[1] + '</span>' + a[2] +
      '</span><span class="nav-other-desc">' + a[4] + '</span></a>';
  }).join('') + '</div>' +
    '<p class="nav-other-note">Side projects, not our main products. We update them only when needed to keep them working.</p>';
  split.appendChild(panel);

  function setOpen(open) {
    dd.classList.toggle('other-open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  var canHover = window.matchMedia && window.matchMedia('(hover: hover)').matches;
  if (canHover) btn.addEventListener('mouseenter', function () { setOpen(true); });
  btn.addEventListener('click', function () { setOpen(!dd.classList.contains('other-open')); });
  // hovering (or focusing) any of the main items hides the Other apps again
  list.querySelectorAll('a').forEach(function (a) {
    if (canHover) a.addEventListener('mouseenter', function () { setOpen(false); });
    a.addEventListener('focus', function () { setOpen(false); });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dd.classList.contains('other-open')) setOpen(false);
  });
  // closing the menu always resets it
  new MutationObserver(function () {
    if (!dd.classList.contains('show')) setOpen(false);
  }).observe(dd, { attributes: true, attributeFilter: ['class'] });
})();
