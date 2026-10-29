import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendPasswordResetEmail, signOut,
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, doc, onSnapshot, setDoc,
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

(() => {
  'use strict';

  // Keys used by older versions; cleared on load.
  const LOCAL_KEY = 'hisab-khata-v1';
  const PENDING_KEY = 'hisab-khata-pending-import';
  const THEME_KEY = 'hisab-khata-theme';
  const $ = (s) => document.querySelector(s);

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const today = () => new Date().toISOString().slice(0, 10);

  function makeEntry(type, name, amount, note = '') {
    return { id: uid(), type, name: name.trim(), amount, paid: 0, note: note.trim(), date: today(), payments: [] };
  }

  // ---------- firebase ----------
  const fbApp = initializeApp(firebaseConfig);
  const auth = getAuth(fbApp);
  const db = initializeFirestore(fbApp, { localCache: persistentLocalCache() });

  let user = null;
  let entries = [];
  let unsubscribe = null;

  // Each user has one document, users/{uid}; Firestore rules let only that user read or write it.
  function save() {
    if (!user) return;
    setDoc(doc(db, 'users', user.uid), { entries, updated: Date.now() })
      .catch(() => toast('Save kora gelo na, internet check korun', false));
  }

  // Every new account starts empty. Older versions kept entries in this browser and
  // accepted #import= data links; drop both so they never land in someone else's account.
  try {
    localStorage.removeItem(LOCAL_KEY);
    sessionStorage.removeItem(PENDING_KEY);
  } catch (e) { /* storage blocked */ }
  if (location.hash.startsWith('#import=')) history.replaceState(null, '', location.pathname + location.search);

  // ---------- auth screen ----------
  let registering = false;
  function setAuthMode(reg) {
    registering = reg;
    $('#authTitle').textContent = reg ? 'Notun account khulun' : 'Login korun';
    $('#authSubmit').textContent = reg ? 'Register' : 'Login';
    $('#authSwitch').textContent = reg ? 'Account ache? Login korun' : 'Account nai? Register korun';
    $('#authForm').password.autocomplete = reg ? 'new-password' : 'current-password';
    $('#authErr').textContent = '';
  }
  const AUTH_ERRORS = {
    'auth/invalid-credential': 'Email ba password vul',
    'auth/wrong-password': 'Email ba password vul',
    'auth/user-not-found': 'Ei email e kono account nai',
    'auth/email-already-in-use': 'Ei email e already account ache, login korun',
    'auth/weak-password': 'Password kompokkhe 6 okkhor hote hobe',
    'auth/invalid-email': 'Email thik moto likhun',
    'auth/missing-password': 'Password likhun',
    'auth/too-many-requests': 'Onek bar chesta hoyeche, kichukkhon por abar chesta korun',
    'auth/network-request-failed': 'Internet connection nai',
  };
  const authMsg = (err) => AUTH_ERRORS[err && err.code] || 'Kichu ekta vul hoyeche, abar chesta korun';

  $('#authSwitch').addEventListener('click', () => setAuthMode(!registering));
  $('#authForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = ev.target;
    const btn = $('#authSubmit');
    btn.disabled = true;
    $('#authErr').textContent = '';
    try {
      const email = f.email.value.trim();
      if (registering) await createUserWithEmailAndPassword(auth, email, f.password.value);
      else await signInWithEmailAndPassword(auth, email, f.password.value);
      f.password.value = '';
    } catch (err) {
      $('#authErr').textContent = authMsg(err);
    } finally { btn.disabled = false; }
  });
  $('#forgotBtn').addEventListener('click', async () => {
    const email = $('#authForm').email.value.trim();
    if (!email) { $('#authErr').textContent = 'Age upore email likhun'; return; }
    try {
      await sendPasswordResetEmail(auth, email);
      $('#authErr').textContent = '';
      toast('Password reset link apnar email e pathano hoyeche', false);
    } catch (err) { $('#authErr').textContent = authMsg(err); }
  });

  function showView(name) {
    $('#bootView').hidden = name !== 'boot';
    $('#authView').hidden = name !== 'auth';
    $('#appView').hidden = name !== 'app';
    $('#menuBtn').hidden = name !== 'app';
  }

  onAuthStateChanged(auth, (u) => {
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    user = u;
    entries = [];
    undoSnapshot = null;
    if (!u) { setAuthMode(registering); showView('auth'); return; }
    $('#userEmail').textContent = u.email;
    showView('app');
    render();
    unsubscribe = onSnapshot(doc(db, 'users', u.uid), (snap) => {
      const data = snap.exists() ? snap.data() : null;
      entries = data && Array.isArray(data.entries) ? data.entries : [];
      render();
    }, () => toast('Data load kora gelo na', false));
  });

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
  const byId = (id) => entries.find((x) => x.id === id);

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
    return `<article class="row ${e.type} ${done ? 'done' : ''}" data-id="${esc(e.id)}">
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
    const e = byId(btn.closest('.row').dataset.id);
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

  // edit dialog (keeps the id: a sync from another device may replace the entry objects)
  let editingId = null;
  function openEdit(e) {
    editingId = e.id;
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
    const e = byId(editingId);
    if (!e) return;
    snapshot();
    Object.assign(e, { name: f.name.value.trim(), amount, note: f.note.value.trim(), type: f.type.value });
    e.paid = Math.min(e.paid, amount);
    commit('Update hoyeche');
  });

  // partial payment dialog
  let payingId = null;
  function openPay(e) {
    payingId = e.id;
    $('#payTitle').textContent = `${e.name}: kichu taka shodh`;
    $('#payInfo').textContent = `Baki ache ${fmt(left(e))}`;
    $('#payForm').amount.value = '';
    $('#payErr').textContent = '';
    $('#payDlg').showModal();
  }
  $('#payForm').addEventListener('submit', (ev) => {
    if (ev.submitter && ev.submitter.value === 'cancel') return;
    const e = byId(payingId);
    if (!e) return;
    const amt = parseAmount(ev.target.amount.value);
    if (!(amt > 0) || amt > left(e)) {
      ev.preventDefault();
      $('#payErr').textContent = `0 theke ${fmt(left(e))} er moddhe likhun`;
      return;
    }
    snapshot();
    e.paid += amt;
    e.payments.push({ amount: amt, date: today() });
    commit(`${e.name}: ${fmt(amt)} shodh, baki ${fmt(left(e))}`);
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
    if (a === 'logout') signOut(auth);
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

  // ---------- install to home screen ----------
  // Chrome/Edge/Samsung fire beforeinstallprompt and can install with one tap.
  // iPhone Safari and other browsers can't, so the button shows the menu steps instead.
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isMobile = isIOS || /Android|Mobile/i.test(ua);
  const isInstalled = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  let installPrompt = null;
  const installBtn = $('#installBtn');

  function updateInstallBtn() {
    installBtn.hidden = isInstalled() || !(installPrompt || isMobile);
  }
  window.addEventListener('beforeinstallprompt', (ev) => {
    ev.preventDefault();
    installPrompt = ev;
    updateInstallBtn();
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    updateInstallBtn();
    toast('App install hoyeche, Home screen e "Hisab" icon dekhun', false);
  });
  installBtn.addEventListener('click', async () => {
    if (installPrompt) {
      installPrompt.prompt();
      await installPrompt.userChoice.catch(() => {});
      installPrompt = null;
      updateInstallBtn();
      return;
    }
    const inApp = /FBAN|FBAV|Instagram|Messenger|WhatsApp/i.test(ua);
    const steps = inApp ? [
      'Ei page ta Facebook/WhatsApp er vitore khola. Upore <b>⋮</b> ba <b>…</b> chapun',
      '<b>Open in Chrome</b> (iPhone e <b>Open in Safari</b>) chapun',
      'Oikhane abar <b>📲 Install</b> button chapun',
    ] : isIOS ? [
      'Ei page ta <b>Safari</b> te khulun (Chrome e iPhone e hoy na)',
      'Niche <b>Share</b> button (□↑) chapun',
      'Niche scroll kore <b>Add to Home Screen</b> chapun',
      'Upore dane <b>Add</b> chapun',
    ] : [
      'Browser er upore dane <b>⋮</b> menu chapun',
      '<b>Add to Home screen</b> ba <b>Install app</b> chapun',
      '<b>Install</b> / <b>Add</b> chapun',
    ];
    $('#installSteps').innerHTML = steps.map((s) => `<li>${s}</li>`).join('');
    $('#installDlg').showModal();
  });
  updateInstallBtn();
})();
