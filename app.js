(() => {
  'use strict';

  const KEY = 'hisab-khata-v1';
  const THEME_KEY = 'hisab-khata-theme';
  const $ = (s) => document.querySelector(s);


  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const today = () => new Date().toISOString().slice(0, 10);

  function makeEntry(type, name, amount, note = '') {
    return { id: uid(), type, name: name.trim(), amount, paid: 0, note: note.trim(), date: today(), payments: [] };
  }

  // ---------- storage ----------
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (Array.isArray(data)) return data;
      }
    } catch (e) { /* start empty */ }
    return [];
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(entries)); }
    catch (e) { toast('Save kora gelo na (browser storage bondho?)'); }
  }

  let entries = load();
  const imported = importFromLink();
  save();

  // A link like ...#import=<base64 of [[type, name, amount, note], ...]> adds those
  // entries once. The hash never reaches the server, and is cleared after reading.
  function importFromLink() {
    const m = location.hash.match(/^#import=([A-Za-z0-9_\-+/=]+)$/);
    if (!m) return 0;
    history.replaceState(null, '', location.pathname + location.search);
    try {
      let b64 = m[1].replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
      b64 += '='.repeat((4 - (b64.length % 4)) % 4);
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const rows = JSON.parse(new TextDecoder().decode(bytes));
      let added = 0;
      for (const [type, name, amount, note] of rows) {
        if (!['dibo', 'pabo'].includes(type) || !name || !(amount > 0)) continue;
        const dup = entries.some((e) => e.type === type && e.name === name && e.amount === amount);
        if (dup) continue;
        entries.push(makeEntry(type, String(name), Number(amount), String(note || '')));
        added++;
      }
      return added;
    } catch (e) { return -1; }
  }

  // ---------- helpers ----------
  // Accepts "4500", "4,500", "4k", "3300+4000", "3300 + 4k"
  function parseAmount(str) {
    const parts = String(str).replace(/,/g, '').split('+');
    let total = 0;
    for (let p of parts) {
      p = p.trim().toLowerCase();
      const m = p.match(/^(\d+(?:\.\d+)?)\s*(k)?\s*(tk|taka|৳)?$/);
      if (!m) return NaN;
      total += parseFloat(m[1]) * (m[2] ? 1000 : 1);
    }
    return Math.round(total * 100) / 100;
  }
  const fmt = (n) => Number(n).toLocaleString('en-IN') + ' ৳';
  const left = (e) => Math.max(0, e.amount - e.paid);
  const isDone = (e) => left(e) <= 0;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (s) => s.trim().toLowerCase().replace(/\s+/g, ' ');

  // ---------- state ----------
  let tab = 'all';
  let undoSnapshot = null;

  // ---------- render ----------
  function render() {
    const open = entries.filter((e) => !isDone(e));
    const dibo = open.filter((e) => e.type === 'dibo').reduce((s, e) => s + left(e), 0);
    const pabo = open.filter((e) => e.type === 'pabo').reduce((s, e) => s + left(e), 0);
    const net = pabo - dibo;

    $('#sumDibo').textContent = fmt(dibo);
    $('#sumPabo').textContent = fmt(pabo);
    $('#cntDibo').textContent = open.filter((e) => e.type === 'dibo').length + ' jon';
    $('#cntPabo').textContent = open.filter((e) => e.type === 'pabo').length + ' jon';
    $('#sumNet').textContent = fmt(Math.abs(net));
    $('#netText').textContent = net > 0 ? 'Apni pabe' : net < 0 ? 'Apnake dite hobe' : 'Shob shoman';
    $('#netCard').className = 'card net ' + (net > 0 ? 'pos' : net < 0 ? 'neg' : '');

    const names = [...new Set(entries.map((e) => e.name))].sort();
    $('#names').innerHTML = names.map((n) => `<option value="${esc(n)}">`).join('');

    const q = norm($('#search').value);
    const showPaid = $('#showPaid').checked;
    let rows = entries.filter((e) => (showPaid || !isDone(e)) && (!q || norm(e.name).includes(q)));

    const list = $('#list');
    if (tab === 'people') { list.innerHTML = renderPeople(rows); return; }
    if (tab !== 'all') rows = rows.filter((e) => e.type === tab);

    if (!rows.length) {
      list.innerHTML = `<p class="empty">${q ? 'Kichu pawa jay nai' : 'Kono entry nai'}</p>`;
      return;
    }
    const groups = tab === 'all' ? ['dibo', 'pabo'] : [tab];
    list.innerHTML = groups.map((g) => {
      const items = rows.filter((e) => e.type === g)
        .sort((a, b) => isDone(a) - isDone(b) || left(b) - left(a));
      if (!items.length) return '';
      const sum = items.reduce((s, e) => s + left(e), 0);
      return `<div class="group-h"><span>${g === 'dibo' ? 'Ami dibo' : 'Ami pabo'}</span><span>${fmt(sum)}</span></div>` +
        items.map(rowHtml).join('');
    }).join('');
  }

  function rowHtml(e) {
    const done = isDone(e);
    const partial = e.paid > 0 && !done;
    const meta = [e.note, e.date, partial ? `${fmt(e.paid)} shodh hoyeche` : '', done ? 'Shodh ✓' : '']
      .filter(Boolean).map(esc).join(' · ');
    return `<article class="row ${e.type} ${done ? 'done' : ''}" data-id="${e.id}">
      <div><div class="name">${esc(e.name)}</div><div class="meta">${meta}</div></div>
      <div class="amt">${fmt(done ? e.amount : left(e))}${partial ? `<small>mot ${fmt(e.amount)}</small>` : ''}</div>
      <div class="acts">
        ${done ? '<button data-a="reopen">Abar khulun</button>'
               : '<button data-a="settle">✓ Shodh</button><button data-a="partial">Kichu shodh</button>'}
        <button data-a="edit">Edit</button>
        <button data-a="del">Muche din</button>
      </div>
    </article>`;
  }

  function renderPeople(rows) {
    const map = new Map();
    for (const e of rows) {
      if (isDone(e)) continue;
      const k = norm(e.name);
      const p = map.get(k) || { name: e.name, dibo: 0, pabo: 0 };
      p[e.type] += left(e);
      map.set(k, p);
    }
    const people = [...map.values()].map((p) => ({ ...p, net: p.pabo - p.dibo }))
      .sort((a, b) => a.net - b.net);
    if (!people.length) return '<p class="empty">Kono baki nai</p>';
    return people.map((p) => {
      const t = p.net < 0 ? 'dibo' : 'pabo';
      const both = p.dibo && p.pabo;
      return `<article class="row ${p.net ? t : ''}">
        <div><div class="name">${esc(p.name)}${p.net ? `<span class="badge ${t}">${t === 'dibo' ? 'dibo' : 'pabo'}</span>` : ''}</div>
        <div class="meta">${both ? `Dibo ${fmt(p.dibo)} · Pabo ${fmt(p.pabo)}` : ''}</div></div>
        <div class="amt">${p.net ? fmt(Math.abs(p.net)) : 'Shoman'}</div>
      </article>`;
    }).join('');
  }

  // ---------- actions ----------
  function snapshot() { undoSnapshot = JSON.stringify(entries); }
  function commit(msg, undoable = true) {
    save(); render();
    if (msg) toast(msg, undoable);
  }

  $('#addForm').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = ev.target;
    const amount = parseAmount(f.amount.value);
    const err = $('#formErr');
    if (!f.name.value.trim()) { err.textContent = 'Naam likhun'; return; }
    if (!(amount > 0)) { err.textContent = 'Taka thik moto likhun (jemon 4500, 4k, 3300+4000)'; f.amount.focus(); return; }
    err.textContent = '';
    snapshot();
    entries.push(makeEntry(f.type.value, f.name.value, amount, f.note.value));
    f.name.value = ''; f.amount.value = ''; f.note.value = '';
    f.name.focus();
    commit('Jog hoyeche');
  });

  $('#list').addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-a]');
    if (!btn) return;
    const e = entries.find((x) => x.id === btn.closest('.row').dataset.id);
    if (!e) return;
    const a = btn.dataset.a;
    if (a === 'settle') {
      snapshot();
      const rest = left(e);
      e.payments.push({ amount: rest, date: today() });
      e.paid = e.amount;
      commit(`${e.name}: shodh hoyeche`);
    } else if (a === 'reopen') {
      snapshot();
      e.paid = 0; e.payments = [];
      commit(`${e.name}: abar khola holo`);
    } else if (a === 'partial') openPay(e);
    else if (a === 'edit') openEdit(e);
    else if (a === 'del') {
      snapshot();
      entries = entries.filter((x) => x !== e);
      commit(`${e.name} muche fela holo`);
    }
  });

  // edit dialog
  let editing = null;
  function openEdit(e) {
    editing = e;
    const f = $('#editForm');
    f.name.value = e.name; f.amount.value = e.amount; f.note.value = e.note; f.type.value = e.type;
    $('#editErr').textContent = '';
    $('#editDlg').showModal();
  }
  $('#editForm').addEventListener('submit', (ev) => {
    if (ev.submitter && ev.submitter.value === 'cancel') return;
    const f = ev.target;
    const amount = parseAmount(f.amount.value);
    if (!f.name.value.trim() || !(amount > 0)) {
      ev.preventDefault();
      $('#editErr').textContent = 'Naam ar thik taka din';
      return;
    }
    snapshot();
    Object.assign(editing, { name: f.name.value.trim(), amount, note: f.note.value.trim(), type: f.type.value });
    editing.paid = Math.min(editing.paid, amount);
    commit('Update hoyeche');
  });

  // partial payment dialog
  let paying = null;
  function openPay(e) {
    paying = e;
    $('#payTitle').textContent = `${e.name}: kichu taka shodh`;
    $('#payInfo').textContent = `Baki ache ${fmt(left(e))}`;
    $('#payForm').amount.value = '';
    $('#payErr').textContent = '';
    $('#payDlg').showModal();
  }
  $('#payForm').addEventListener('submit', (ev) => {
    if (ev.submitter && ev.submitter.value === 'cancel') return;
    const amt = parseAmount(ev.target.amount.value);
    if (!(amt > 0) || amt > left(paying)) {
      ev.preventDefault();
      $('#payErr').textContent = `0 theke ${fmt(left(paying))} er moddhe likhun`;
      return;
    }
    snapshot();
    paying.paid += amt;
    paying.payments.push({ amount: amt, date: today() });
    commit(`${paying.name}: ${fmt(amt)} shodh, baki ${fmt(left(paying))}`);
  });

  // tabs & filters
  document.querySelector('.tabs').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-tab]');
    if (!b) return;
    tab = b.dataset.tab;
    document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
    render();
  });
  $('#search').addEventListener('input', render);
  $('#showPaid').addEventListener('change', render);

  // menu
  const menu = $('#menu');
  $('#menuBtn').addEventListener('click', (ev) => {
    ev.stopPropagation();
    menu.hidden = !menu.hidden;
    $('#menuBtn').setAttribute('aria-expanded', String(!menu.hidden));
  });
  document.addEventListener('click', () => { menu.hidden = true; $('#menuBtn').setAttribute('aria-expanded', 'false'); });
  menu.addEventListener('click', (ev) => {
    const a = ev.target.dataset.act;
    if (a === 'csv') exportCsv();
    if (a === 'backup') download(`hisab-backup-${today()}.json`, JSON.stringify(entries, null, 2), 'application/json');
    if (a === 'restore') $('#restoreFile').click();
    if (a === 'reset' && confirm('Shob entry muche felben? (Undo kora jabe)')) {
      snapshot(); entries = []; commit('Shob muche fela holo');
    }
  });
  $('#restoreFile').addEventListener('change', async (ev) => {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data) || !data.every((e) => e && e.name && e.type && typeof e.amount === 'number')) throw 0;
      snapshot();
      entries = data.map((e) => ({ payments: [], paid: 0, note: '', date: today(), ...e, id: e.id || uid() }));
      commit('Backup theke restore hoyeche');
    } catch (e) { toast('Ei file ta thik backup na', false); }
  });

  function exportCsv() {
    const head = ['Dhoron', 'Naam', 'Mot taka', 'Shodh hoyeche', 'Baki', 'Note', 'Tarikh'];
    const lines = entries.map((e) => [e.type === 'dibo' ? 'Ami dibo' : 'Ami pabo', e.name, e.amount, e.paid, left(e), e.note, e.date]);
    const csv = [head, ...lines].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    download(`hisab-${today()}.csv`, '\ufeff' + csv, 'text/csv');
  }
  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // toast + undo
  let toastTimer;
  function toast(msg, undoable = false) {
    const t = $('#toast');
    t.innerHTML = `<span>${esc(msg)}</span>${undoable && undoSnapshot ? '<button id="undoBtn">Undo</button>' : ''}`;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 4000);
    const u = $('#undoBtn');
    if (u) u.onclick = () => {
      entries = JSON.parse(undoSnapshot); undoSnapshot = null;
      save(); render(); t.classList.remove('show');
    };
  }

  // theme
  function applyTheme(t) {
    if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  }
  try { applyTheme(localStorage.getItem(THEME_KEY)); } catch (e) {}
  $('#themeBtn').addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === 'dark'
      : matchMedia('(prefers-color-scheme: dark)').matches;
    const next = dark ? 'light' : 'dark';
    applyTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
  });

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  render();
  if (imported > 0) toast(`${imported} ta entry add hoyeche`);
  else if (imported < 0) toast('Link ta thik na, data add hoy nai');
})();
