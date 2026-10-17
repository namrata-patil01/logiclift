/* LogicLift – single-file app logic (vanilla JS + Supabase) */
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const app = document.getElementById('app');

const SUBJECTS = ['Logical Reasoning', 'Mathematics', 'Coding', 'General Knowledge'];
const LANGS = ['English', 'Marathi', 'Hindi'];
const LEVELS = ['Easy', 'Medium', 'Hard'];
const TIME = { Easy: 30, Medium: 20, Hard: 15 };           // seconds per question
const API_CAT = { 'Mathematics': 19, 'Coding': 18, 'General Knowledge': 9 }; // Open Trivia DB

const S = { user: null, profile: null, quiz: null, result: null, soundOn: true, tq: [], edit: null };

/* ---------- helpers ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shuffle = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const card = 'bg-panel border border-edge rounded-2xl p-6';
const btn = 'px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 font-semibold transition disabled:opacity-50';
const btn2 = 'px-4 py-2.5 rounded-xl border border-edge hover:bg-edge/40 transition';
const input = 'w-full bg-ink border border-edge rounded-xl px-3 py-2.5 focus:border-violet-400 outline-none';
const opts = (arr, sel) => arr.map(x => `<option ${x === sel ? 'selected' : ''}>${esc(x)}</option>`).join('');
const toast = (m) => { const t = document.getElementById('toast'); t.textContent = m; t.classList.remove('hidden'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.add('hidden'), 3500); };
const fmt = d => new Date(d).toLocaleString();

/* ---------- sound (Web Audio, no files needed) ---------- */
let actx;
function beep(f, d = .15, type = 'sine', v = .08) {
  if (!S.soundOn) return;
  actx = actx || new (window.AudioContext || window.webkitAudioContext)();
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.value = f; g.gain.value = v;
  o.connect(g); g.connect(actx.destination); o.start(); o.stop(actx.currentTime + d);
}
const sfx = {
  right: () => { beep(660); setTimeout(() => beep(880), 120); },
  wrong: () => beep(180, .3, 'sawtooth'),
  tick: () => beep(1000, .05, 'square', .03),
  done: () => [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => beep(f, .2), i * 140)),
};

/* ---------- auth ---------- */
async function loadProfile() {
  const { data } = await sb.from('profiles').select('*').eq('id', S.user.id).single();
  S.profile = data;
}
sb.auth.onAuthStateChange(async (event, session) => {
  S.user = session?.user ?? null;
  if (event === 'PASSWORD_RECOVERY') return viewNewPassword();
  if (S.user) { await loadProfile(); if (['SIGNED_IN', 'INITIAL_SESSION'].includes(event)) viewHome(); }
  else { S.profile = null; viewAuth('login'); }
  renderNav();
});

function renderNav() {
  const nav = document.getElementById('nav');
  nav.innerHTML = `<div class="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
    <button onclick="${S.user ? 'viewHome()' : 'viewAuth(\'login\')'}" class="font-extrabold text-lg tracking-tight">Logic<span class="text-violet-400">Lift</span></button>
    <div class="flex items-center gap-2 text-sm">
      <button onclick="S.soundOn=!S.soundOn;renderNav()" class="${btn2} !py-1.5" aria-label="Toggle sound">${S.soundOn ? 'Sound on' : 'Sound off'}</button>
      ${S.user ? `
        <button onclick="viewHistory()" class="${btn2} !py-1.5">History</button>
        ${S.profile?.role === 'teacher' ? `<button onclick="viewTeacher()" class="${btn2} !py-1.5">Teacher</button>` : ''}
        <button onclick="sb.auth.signOut()" class="${btn2} !py-1.5">Sign out</button>` : ''}
    </div></div>`;
}

function viewAuth(mode) {
  const titles = { login: 'Sign in', signup: 'Create account', reset: 'Reset password' };
  app.innerHTML = `<div class="${card} max-w-md mx-auto">
    <h1 class="text-2xl font-extrabold mb-1">${titles[mode]}</h1>
    <p class="text-slate-400 text-sm mb-5">Train your logic, one timed question at a time.</p>
    <div class="space-y-3">
      ${mode === 'signup' ? `<input id="a-name" class="${input}" placeholder="Full name" autocomplete="name">
      <select id="a-role" class="${input}">
        <option value="student">I am a student</option><option value="teacher">I am a teacher</option></select>` : ''}
      <input id="a-email" type="email" class="${input}" placeholder="Email" autocomplete="email">
      ${mode !== 'reset' ? `<input id="a-pass" type="password" class="${input}" placeholder="Password (min 8 characters)" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}">` : ''}
      <button class="${btn} w-full" onclick="doAuth('${mode}')">${titles[mode]}</button>
    </div>
    <div class="mt-4 text-sm text-slate-400 flex justify-between">
      ${mode === 'login' ? `<button onclick="viewAuth('signup')" class="hover:text-white">New here? Create account</button><button onclick="viewAuth('reset')" class="hover:text-white">Forgot password?</button>`
        : `<button onclick="viewAuth('login')" class="hover:text-white">Back to sign in</button>`}
    </div></div>`;
}
async function doAuth(mode) {
  const email = document.getElementById('a-email').value.trim();
  const pass = document.getElementById('a-pass')?.value;
  try {
    if (mode === 'reset') {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.href.split('#')[0] });
      if (error) throw error; return toast('Check your email for the reset link.');
    }
    if (!pass || pass.length < 8) return toast('Password must be at least 8 characters.');
    if (mode === 'signup') {
      const full_name = document.getElementById('a-name').value.trim();
      const account_type = document.getElementById('a-role').value;
      const { data, error } = await sb.auth.signUp({ email, password: pass, options: { data: { full_name, account_type } } });
      if (error) throw error;
      if (!data.session) { toast('Account created. Confirm your email, then sign in.'); viewAuth('login'); }
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password: pass });
      if (error) throw error;
    }
  } catch (e) { toast(e.message); }
}
function viewNewPassword() {
  app.innerHTML = `<div class="${card} max-w-md mx-auto space-y-3">
    <h1 class="text-2xl font-extrabold">Set a new password</h1>
    <input id="np" type="password" class="${input}" placeholder="New password (min 8 characters)">
    <button class="${btn} w-full" onclick="saveNewPassword()">Save password</button></div>`;
}
async function saveNewPassword() {
  const p = document.getElementById('np').value;
  if (p.length < 8) return toast('Password must be at least 8 characters.');
  const { error } = await sb.auth.updateUser({ password: p });
  if (error) return toast(error.message);
  toast('Password updated.'); viewHome();
}

/* ---------- home / quiz setup ---------- */
async function viewHome() {
  clearInterval(S.quiz?.timer);
  const { data: tch } = await sb.from('profiles').select('id, full_name').eq('role', 'teacher').order('full_name');
  S.teachers = tch || [];
  app.innerHTML = `<div class="${card}">
    <h1 class="text-2xl font-extrabold">Hi ${esc(S.profile?.full_name || 'there')}, pick your challenge</h1>
    <div class="grid sm:grid-cols-2 gap-4 mt-6">
      <div class="sm:col-span-2">
        <div class="text-sm text-slate-400 mb-1">Question source</div>
        <input type="hidden" id="s-source" value="db">
        <div class="grid grid-cols-2 gap-3">
          <button id="src-db" onclick="setSource('db')" class="text-left p-4 rounded-xl border-2 transition">
            <div class="font-semibold">Teacher questions</div>
            <div class="text-xs text-slate-400 mt-1">Saved by your teacher. All languages.</div></button>
          <button id="src-api" onclick="setSource('api')" class="text-left p-4 rounded-xl border-2 transition">
            <div class="font-semibold">Online API</div>
            <div class="text-xs text-slate-400 mt-1">Fresh questions from the internet, translated to your language.</div></button>
        </div></div>
      <label id="s-teacher-wrap" class="block text-sm text-slate-400 sm:col-span-2">Teacher
        <select id="s-teacher" class="${input} mt-1">
          <option value="sample">LogicLift sample questions</option>
          ${S.teachers.map(t => `<option value="${esc(t.id)}">${esc(t.full_name || 'Unnamed teacher')}</option>`).join('')}</select></label>
      <label class="block text-sm text-slate-400">Language
        <select id="s-lang" class="${input} mt-1">${opts(LANGS)}</select></label>
      <label class="block text-sm text-slate-400">Subject
        <select id="s-subject" class="${input} mt-1">${opts(SUBJECTS)}</select></label>
      <label class="block text-sm text-slate-400">Difficulty
        <select id="s-level" class="${input} mt-1">${opts(LEVELS)}</select></label>
      <label class="block text-sm text-slate-400">Number of questions
        <select id="s-count" class="${input} mt-1">${opts(['5', '10', '15'], '10')}</select></label>
    </div>
    <p id="s-note" class="text-xs text-slate-500 mt-3">Timer per question: Easy 30s, Medium 20s, Hard 15s. Using a hint halves the points for that question.</p>
    <button class="${btn} mt-6 w-full" onclick="startQuiz()">Start quiz</button></div>`;
  srcChanged();
}
function setSource(v) {
  document.getElementById('s-source').value = v;
  srcChanged();
}
function srcChanged() {
  const api = document.getElementById('s-source').value === 'api';
  document.getElementById('s-teacher-wrap').classList.toggle('hidden', api);
  ['db', 'api'].forEach(k => {
    const on = (k === 'api') === api;
    document.getElementById('src-' + k).className =
      'text-left p-4 rounded-xl border-2 transition ' + (on ? 'border-violet-400 bg-violet-600/20' : 'border-edge hover:border-violet-400/60');
  });
  document.getElementById('s-note').textContent = api
    ? 'API covers Mathematics, Coding and General Knowledge. Marathi and Hindi questions are auto-translated, so wording may be imperfect.'
    : 'Timer per question: Easy 30s, Medium 20s, Hard 15s. Using a hint halves the points for that question.';
}

const mk = (question, options, answer, hint, explanation, id) => ({
  id, question, options, answer,
  hint: hint || `The answer starts with "${String(options[answer])[0]}".`,
  explanation: explanation || '',
});
async function fetchDb(c) {
  let q = sb.from('questions').select('*')
    .eq('language', c.language).eq('subject', c.subject).eq('difficulty', c.difficulty);
  q = c.teacher === 'sample' ? q.is('created_by', null) : q.eq('created_by', c.teacher);
  const { data, error } = await q;
  if (error) throw error;
  return shuffle(data).slice(0, c.count).map(x => mk(x.question, x.options, x.answer, x.hint, x.explanation, x.id));
}
async function fetchApi(c) {
  const cat = API_CAT[c.subject];
  if (!cat) throw new Error('The API has no questions for this subject. Use the teacher question bank.');
  const r = await fetch(`https://opentdb.com/api.php?amount=${c.count}&category=${cat}&difficulty=${c.difficulty.toLowerCase()}&type=multiple&encode=url3986`);
  const j = await r.json();
  if (j.response_code !== 0) throw new Error('The API returned no questions. Try another level or subject.');
  const d = decodeURIComponent;
  const qs = j.results.map(x => {
    const correct = d(x.correct_answer), o = shuffle([correct, ...x.incorrect_answers.map(d)]);
    return mk(d(x.question), o, o.indexOf(correct));
  });
  return c.language === 'English' ? qs : translateQs(qs, c.language);
}

/* Free translation (MyMemory, no key, daily limit). Falls back to English if it fails. */
const LANG_CODE = { Marathi: 'mr', Hindi: 'hi' };
async function tr(text, to) {
  const r = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|${to}`);
  const j = await r.json(), t = j?.responseData?.translatedText;
  if (j.responseStatus !== 200 || !t || /MYMEMORY WARNING/i.test(t)) throw new Error('translate');
  return t;
}
async function translateQs(qs, lang) {
  const to = LANG_CODE[lang], out = [];
  toast('Translating questions to ' + lang + '…');
  try {
    for (const q of qs) {
      const [question, ...options] = await Promise.all([tr(q.question, to), ...q.options.map(o => tr(o, to))]);
      out.push(mk(question, options, q.answer));
    }
    return out;
  } catch (e) {
    toast('Translation limit reached, so these questions are in English.');
    qs.failed = true;
    return qs;
  }
}
async function startQuiz() {
  const c = {
    source: document.getElementById('s-source').value, language: document.getElementById('s-lang').value,
    subject: document.getElementById('s-subject').value, difficulty: document.getElementById('s-level').value,
    count: +document.getElementById('s-count').value,
    teacher: document.getElementById('s-teacher').value,
  };
  try {
    const qs = c.source === 'api' ? await fetchApi(c) : await fetchDb(c);
    if (!qs.length) return toast(`No ${c.language} questions for ${c.subject} (${c.difficulty}) yet. Ask your teacher to add some, or try another level.`);
    S.quiz = { cfg: c, qs, i: 0, answers: [], timer: null };
    beep(440); renderQuestion();
  } catch (e) { toast(e.message); }
}

/* ---------- quiz screen ---------- */
const RING = 2 * Math.PI * 36;
function renderQuestion() {
  const z = S.quiz, q = z.qs[z.i], total = TIME[z.cfg.difficulty];
  z.left = total; z.locked = false; z.hint = false; z.t0 = Date.now();
  app.innerHTML = `<div class="${card}">
    <div class="flex items-center justify-between mb-5">
      <div class="text-sm text-slate-400">Question ${z.i + 1} of ${z.qs.length}<br>${esc(z.cfg.subject)} · ${esc(z.cfg.difficulty)}</div>
      <div class="relative w-20 h-20">
        <svg viewBox="0 0 80 80" class="w-20 h-20 -rotate-90">
          <circle cx="40" cy="40" r="36" fill="none" stroke="#2a3170" stroke-width="6"/>
          <circle id="ring" class="ring" cx="40" cy="40" r="36" fill="none" stroke="#a78bfa" stroke-width="6" stroke-linecap="round"
            stroke-dasharray="${RING}" stroke-dashoffset="0"/></svg>
        <div id="left" class="absolute inset-0 grid place-items-center text-xl font-extrabold">${total}</div>
      </div>
    </div>
    <h2 class="text-xl font-semibold leading-snug mb-5">${esc(q.question)}</h2>
    <div class="space-y-3">${q.options.map((o, k) => `
      <button id="opt-${k}" onclick="answer(${k})" class="w-full text-left px-4 py-3 rounded-xl border border-edge hover:border-violet-400 hover:bg-edge/40 transition">${esc(o)}</button>`).join('')}</div>
    <div class="mt-5 flex items-center gap-3">
      <button id="hintBtn" onclick="showHint()" class="${btn2} text-sm">Show hint (−50% points)</button>
      <p id="hint" class="text-sm text-violet-400"></p></div></div>`;
  clearInterval(z.timer);
  z.timer = setInterval(tick, 1000);
}
function tick() {
  const z = S.quiz, total = TIME[z.cfg.difficulty];
  z.left--;
  document.getElementById('left').textContent = z.left;
  const ring = document.getElementById('ring');
  ring.style.strokeDashoffset = RING * (1 - z.left / total);
  if (z.left <= 5) { ring.setAttribute('stroke', '#f87171'); sfx.tick(); }
  if (z.left <= 0) answer(-1);
}
function showHint() {
  const z = S.quiz; if (z.locked || z.hint) return;
  z.hint = true;
  document.getElementById('hint').textContent = z.qs[z.i].hint;
  document.getElementById('hintBtn').disabled = true;
}
function answer(k) {
  const z = S.quiz; if (z.locked) return;
  z.locked = true; clearInterval(z.timer);
  const q = z.qs[z.i], total = TIME[z.cfg.difficulty];
  const time = Math.min(total, Math.round((Date.now() - z.t0) / 1000));
  const correct = k === q.answer;
  z.answers.push({ question: q.question, options: q.options, chosen: k, answer: q.answer, correct,
    time, hint: z.hint, timedOut: k === -1, explanation: q.explanation });
  q.options.forEach((_, j) => {
    const b = document.getElementById('opt-' + j); b.disabled = true;
    if (j === q.answer) b.className = 'w-full text-left px-4 py-3 rounded-xl border border-emerald-400 bg-emerald-500/20';
    else if (j === k) b.className = 'w-full text-left px-4 py-3 rounded-xl border border-rose-400 bg-rose-500/20';
  });
  correct ? sfx.right() : sfx.wrong();
  setTimeout(() => { z.i++; z.i < z.qs.length ? renderQuestion() : finishQuiz(); }, 1400); // auto-progress
}
async function finishQuiz() {
  const z = S.quiz, A = z.answers;
  const score = A.reduce((s, a) => s + (a.correct ? (a.hint ? .5 : 1) : 0), 0);
  const res = { ...z.cfg, total: A.length, score, time_taken: A.reduce((s, a) => s + a.time, 0), details: A, created_at: new Date().toISOString() };
  S.result = res; sfx.done();
  const { error } = await sb.from('attempts').insert({
    user_id: S.user.id, language: res.language, subject: res.subject, difficulty: res.difficulty,
    source: res.source, score, total: res.total, time_taken: res.time_taken, details: A,
    teacher_id: res.source === 'db' && res.teacher !== 'sample' ? res.teacher : null });
  if (error) toast('Could not save this attempt: ' + error.message);
  viewResult();
}

/* ---------- result, analysis, review ---------- */
function insight(r) {
  const A = r.details, n = A.length, acc = A.filter(a => a.correct).length / n * 100;
  const avg = r.time_taken / n, lim = TIME[r.difficulty];
  if (acc >= 80) return 'Strong result. Try the next difficulty level.';
  if (avg < lim * .4 && acc < 60) return 'You answer fast but miss often. Slow down and read every option.';
  if (A.filter(a => a.timedOut).length >= n / 3) return 'Many questions ran out of time. Practise at Easy level to build speed.';
  if (A.filter(a => a.hint).length >= n / 2) return 'You lean on hints a lot. Try a few questions without them.';
  return 'Good effort. Use the review page to learn from the mistakes.';
}
function viewResult() {
  const r = S.result, A = r.details, n = A.length;
  const pct = Math.round(r.score / n * 100), lim = TIME[r.difficulty];
  const stat = (l, v) => `<div class="bg-ink border border-edge rounded-xl p-3 text-center"><div class="text-xl font-extrabold">${v}</div><div class="text-xs text-slate-400">${l}</div></div>`;
  app.innerHTML = `<div class="${card}">
    <h1 class="text-2xl font-extrabold">${esc(r.subject)} · ${esc(r.difficulty)}</h1>
    <p class="text-slate-400 text-sm">${esc(r.language)} · ${fmt(r.created_at)}</p>
    <div class="text-center my-6"><div class="text-6xl font-extrabold text-violet-400">${r.score}<span class="text-2xl text-slate-400"> / ${n}</span></div>
      <div class="text-slate-400">${pct}% score</div></div>
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
      ${stat('Correct', A.filter(a => a.correct).length)}${stat('Avg time', (r.time_taken / n).toFixed(1) + 's')}
      ${stat('Hints used', A.filter(a => a.hint).length)}${stat('Timed out', A.filter(a => a.timedOut).length)}</div>
    <h2 class="font-semibold mt-6 mb-2">Time per question</h2>
    <div class="space-y-1.5">${A.map((a, i) => `
      <div class="flex items-center gap-2 text-xs"><span class="w-6 text-slate-400">Q${i + 1}</span>
        <div class="flex-1 bg-ink rounded-full h-3"><div class="h-3 rounded-full ${a.correct ? 'bg-emerald-400' : 'bg-rose-400'}" style="width:${Math.max(4, a.time / lim * 100)}%"></div></div>
        <span class="w-8 text-right">${a.time}s</span></div>`).join('')}</div>
    <p class="mt-5 p-3 rounded-xl bg-violet-600/20 border border-violet-500/40 text-sm">${esc(insight(r))}</p>
    <div class="flex flex-wrap gap-2 mt-6">
      <button class="${btn}" onclick="viewReview()">Review answers</button>
      <button class="${btn2}" onclick="downloadPdf()">Download PDF</button>
      <button class="${btn2}" onclick="viewHome()">Play again</button></div>
    <h2 class="font-semibold mt-6 mb-2 text-sm">Share your score</h2>
    <div class="flex flex-wrap gap-2 text-sm">${shareLinks(r)}</div></div>`;
}
function shareLinks(r) {
  const text = `I scored ${r.score}/${r.total} in ${r.subject} (${r.difficulty}) on LogicLift!`;
  const u = encodeURIComponent(location.origin + location.pathname), t = encodeURIComponent(text);
  const a = (h, l) => `<a class="${btn2} !py-1.5" target="_blank" rel="noopener" href="${h}">${l}</a>`;
  return a(`https://wa.me/?text=${t}%20${u}`, 'WhatsApp') + a(`https://twitter.com/intent/tweet?text=${t}&url=${u}`, 'X')
    + a(`https://www.facebook.com/sharer/sharer.php?u=${u}&quote=${t}`, 'Facebook')
    + a(`https://www.linkedin.com/sharing/share-offsite/?url=${u}`, 'LinkedIn') + a(`https://t.me/share/url?url=${u}&text=${t}`, 'Telegram')
    + (navigator.share ? `<button class="${btn2} !py-1.5" onclick="navigator.share({text:'${text.replace(/'/g, '')}',url:location.href})">More…</button>` : '');
}
function viewReview() {
  const A = S.result.details;
  app.innerHTML = `<div class="flex items-center justify-between mb-4"><h1 class="text-2xl font-extrabold">Review</h1>
    <button class="${btn2}" onclick="viewResult()">Back to result</button></div>
    <div class="space-y-4">${A.map((a, i) => `
      <div class="${card} !p-5 border-l-4 ${a.correct ? '!border-l-emerald-400' : '!border-l-rose-400'}">
        <div class="text-xs text-slate-400 mb-1">Question ${i + 1} · ${a.time}s${a.hint ? ' · hint used' : ''}${a.timedOut ? ' · timed out' : ''}</div>
        <p class="font-semibold mb-3">${esc(a.question)}</p>
        <ul class="space-y-1.5 text-sm">${a.options.map((o, k) => `
          <li class="px-3 py-2 rounded-lg border ${k === a.answer ? 'border-emerald-400 bg-emerald-500/15' : k === a.chosen ? 'border-rose-400 bg-rose-500/15' : 'border-edge'}">
            ${esc(o)}${k === a.answer ? ' — correct answer' : ''}${k === a.chosen && k !== a.answer ? ' — your answer' : ''}</li>`).join('')}</ul>
        ${a.explanation ? `<p class="text-sm text-slate-300 mt-3">${esc(a.explanation)}</p>` : ''}</div>`).join('')}</div>`;
}

/* ---------- PDF (jsPDF built-in font: Latin text only) ---------- */
function downloadPdf() {
  const r = S.result, { jsPDF } = window.jspdf, d = new jsPDF();
  let y = 20;
  const line = (t, size = 11, bold = false) => {
    d.setFont('helvetica', bold ? 'bold' : 'normal'); d.setFontSize(size);
    d.splitTextToSize(String(t), 175).forEach(l => { if (y > 280) { d.addPage(); y = 20; } d.text(l, 18, y); y += size * .5 + 2; });
  };
  line('LogicLift – Quiz Result', 18, true); y += 2;
  line(`Student: ${S.profile?.full_name || S.user.email}`);
  line(`${r.subject} | ${r.difficulty} | ${r.language} | ${fmt(r.created_at)}`);
  line(`Score: ${r.score} / ${r.total} (${Math.round(r.score / r.total * 100)}%)`, 14, true);
  line(`Total time: ${r.time_taken}s | Hints: ${r.details.filter(a => a.hint).length} | Timed out: ${r.details.filter(a => a.timedOut).length}`);
  line(`Insight: ${insight(r)}`); y += 4;
  r.details.forEach((a, i) => {
    line(`Q${i + 1}. ${a.question}`, 11, true);
    line(`Your answer: ${a.chosen >= 0 ? a.options[a.chosen] : 'No answer (time up)'}  ${a.correct ? '[Correct]' : '[Wrong]'}`);
    if (!a.correct) line(`Correct answer: ${a.options[a.answer]}`);
    if (a.explanation) line(`Why: ${a.explanation}`);
    y += 3;
  });
  d.save('logiclift-result.pdf');
}

/* ---------- history ---------- */
async function viewHistory() {
  const { data, error } = await sb.from('attempts').select('*').eq('user_id', S.user.id).order('created_at', { ascending: false }).limit(50);
  if (error) return toast(error.message);
  S.hist = data;
  app.innerHTML = `<h1 class="text-2xl font-extrabold mb-4">Your history</h1>
    ${data.length ? `<div class="space-y-2">${data.map((a, i) => `
      <button onclick="openAttempt(${i})" class="${card} !p-4 w-full text-left hover:border-violet-400 transition flex justify-between">
        <span><b>${esc(a.subject)}</b> · ${esc(a.difficulty)}<br><span class="text-xs text-slate-400">${fmt(a.created_at)}</span></span>
        <span class="text-violet-400 font-extrabold text-lg">${a.score}/${a.total}</span></button>`).join('')}</div>`
      : `<p class="text-slate-400">No attempts yet. <button class="underline" onclick="viewHome()">Start your first quiz</button>.</p>`}`;
}
function openAttempt(i) { S.result = S.hist[i]; viewResult(); }

/* ---------- teacher dashboard ---------- */
const FORMAT_HELP = `1. What comes next: 2, 4, 8, ?
A) 10
B) 12
C) 16
D) 14
Answer: C
Hint: Each number doubles.
Explanation: 8 x 2 = 16.

2. Next question here...
A) ...`;

async function viewTeacher(tab = 'upload') {
  if (S.profile?.role !== 'teacher') return toast('Teachers only.');  // real protection is RLS in the database
  const t = (k, l) => `<button class="${tab === k ? btn : btn2}" onclick="viewTeacher('${k}')">${l}</button>`;
  const head = `<h1 class="text-2xl font-extrabold mb-4">Teacher dashboard</h1>
    <div class="flex flex-wrap gap-2 mb-5">${t('upload', 'Upload PDF')}${t('api', 'Import from API')}${t('questions', 'My questions')}${t('attempts', 'Student results')}</div>`;

  if (tab === 'upload') {
    S.parsed = null;
    app.innerHTML = `${head}<div class="${card} space-y-3">
      <h2 class="font-semibold">Add questions from a PDF</h2>
      <div class="grid sm:grid-cols-3 gap-3">
        <select id="u-lang" class="${input}">${opts(LANGS)}</select>
        <select id="u-subject" class="${input}">${opts(SUBJECTS)}</select>
        <select id="u-level" class="${input}">${opts(LEVELS)}</select></div>
      <p class="text-xs text-slate-400">These 3 choices apply to every question in the file.</p>
      <input id="u-file" type="file" accept=".pdf,.txt" onchange="readFile(this.files[0])" class="${input}">
      <textarea id="u-text" rows="10" class="${input} font-mono text-xs" placeholder="Text from your PDF appears here. Fix any mistakes, or paste your questions directly."></textarea>
      <details class="text-sm text-slate-400"><summary class="cursor-pointer">Required format</summary>
        <pre class="mt-2 p-3 bg-ink rounded-lg text-xs overflow-x-auto">${esc(FORMAT_HELP)}</pre>
        <p class="mt-2">Hint and Explanation are optional. Each question needs 4 options (A to D) and an Answer line. Marathi labels also work: उत्तर, सूचना, स्पष्टीकरण. The PDF must contain real text, not a scanned photo.</p></details>
      <button class="${btn}" onclick="previewParsed()">Read questions</button>
      <div id="u-preview"></div></div>`;
    return;
  }

  if (tab === 'api') {
    S.parsed = null;
    app.innerHTML = `${head}<div class="${card} space-y-3">
      <h2 class="font-semibold">Import questions from the online API</h2>
      <div class="grid sm:grid-cols-4 gap-3">
        <select id="i-lang" class="${input}">${opts(LANGS)}</select>
        <select id="i-subject" class="${input}">${opts(Object.keys(API_CAT))}</select>
        <select id="i-level" class="${input}">${opts(LEVELS)}</select>
        <select id="i-count" class="${input}">${opts(['5', '10', '15', '20'], '10')}</select></div>
      <p class="text-xs text-slate-400">Language, subject, difficulty, number of questions. Ready-made questions are fetched, you check them in a preview, and the ones you keep are saved to your own bank. Marathi and Hindi are auto-translated by a free service with a daily limit, so check the wording.</p>
      <button class="${btn}" onclick="importApi()">Fetch questions</button>
      <div id="u-preview"></div></div>`;
    return;
  }

  if (tab === 'attempts') {
    const { data, error } = await sb.from('attempts').select('*, profiles(full_name)').eq('teacher_id', S.user.id).order('created_at', { ascending: false }).limit(100);
    if (error) return toast(error.message);
    app.innerHTML = `${head}${data.length ? `<div class="overflow-x-auto ${card} !p-0"><table class="w-full text-sm">
        <thead class="text-left text-slate-400"><tr><th class="p-3">Student</th><th>Subject</th><th>Level</th><th>Score</th><th>Date</th></tr></thead>
        <tbody>${data.map(a => `<tr class="border-t border-edge"><td class="p-3">${esc(a.profiles?.full_name || 'Unnamed')}</td>
          <td>${esc(a.subject)}</td><td>${esc(a.difficulty)}</td><td>${a.score}/${a.total}</td><td>${fmt(a.created_at)}</td></tr>`).join('')}</tbody></table></div>`
      : `<p class="text-slate-400">No student has taken your questions yet.</p>`}`;
    return;
  }

  const { data, error } = await sb.from('questions').select('*').eq('created_by', S.user.id).order('id', { ascending: false });
  if (error) return toast(error.message);
  S.tq = data; const e = S.edit;
  app.innerHTML = `${head}
    <div class="${card} space-y-3">
      <h2 class="font-semibold">${e ? 'Edit question' : 'Add one question'}</h2>
      <div class="grid sm:grid-cols-3 gap-3">
        <select id="t-lang" class="${input}">${opts(LANGS, e?.language)}</select>
        <select id="t-subject" class="${input}">${opts(SUBJECTS, e?.subject)}</select>
        <select id="t-level" class="${input}">${opts(LEVELS, e?.difficulty)}</select></div>
      <textarea id="t-q" rows="2" class="${input}" placeholder="Question">${esc(e?.question)}</textarea>
      <div class="grid sm:grid-cols-2 gap-3">${[0, 1, 2, 3].map(k => `<input id="t-o${k}" class="${input}" placeholder="Option ${k + 1}" value="${esc(e?.options?.[k])}">`).join('')}</div>
      <select id="t-ans" class="${input}">${[0, 1, 2, 3].map(k => `<option value="${k}" ${e?.answer === k ? 'selected' : ''}>Correct answer: Option ${k + 1}</option>`).join('')}</select>
      <input id="t-hint" class="${input}" placeholder="Hint (optional)" value="${esc(e?.hint)}">
      <input id="t-exp" class="${input}" placeholder="Explanation shown in review (optional)" value="${esc(e?.explanation)}">
      <div class="flex gap-2"><button class="${btn}" onclick="saveQuestion()">${e ? 'Save changes' : 'Add question'}</button>
        ${e ? `<button class="${btn2}" onclick="S.edit=null;viewTeacher('questions')">Cancel</button>` : ''}</div></div>
    <h2 class="font-semibold mt-6 mb-2">${data.length} of your questions</h2>
    <div class="space-y-2">${data.map((q, i) => `
      <div class="${card} !p-4 flex justify-between gap-3">
        <div><p class="font-medium">${esc(q.question)}</p>
          <p class="text-xs text-slate-400">${esc(q.language)} · ${esc(q.subject)} · ${esc(q.difficulty)}</p></div>
        <div class="flex gap-2 shrink-0 text-sm"><button class="${btn2} !py-1" onclick="S.edit=S.tq[${i}];viewTeacher('questions')">Edit</button>
          <button class="${btn2} !py-1 text-rose-300" onclick="delQuestion(${i})">Delete</button></div></div>`).join('')}</div>`;
}

/* ---- PDF / text import ---- */
async function readFile(f) {
  if (!f) return;
  try {
    let text = '';
    if (f.name.toLowerCase().endsWith('.pdf')) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      const pdf = await pdfjsLib.getDocument({ data: await f.arrayBuffer() }).promise;
      for (let p = 1; p <= pdf.numPages; p++) {
        const content = await (await pdf.getPage(p)).getTextContent();
        let y = null;
        content.items.forEach(it => {
          const iy = Math.round(it.transform[5]);
          if (y !== null && Math.abs(iy - y) > 2) text += '\n';
          text += it.str; y = iy;
        });
        text += '\n';
      }
    } else text = await f.text();
    document.getElementById('u-text').value = text.trim();
    toast(text.trim() ? 'File read. Check the text, then press "Read questions".' : 'No text found. This PDF may be a scanned photo. Paste the questions instead.');
  } catch (e) { toast('Could not read this file: ' + e.message); }
}

function parseQuestions(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const reQ = /^(?:Q(?:uestion)?\.?\s*)?(\d+)\s*[\.\):\-]\s*(.+)$/i;
  const reOpt = /^\(?([A-Da-d])[\.\)]\s*(.+)$/;
  const reAns = /^(?:Answer|Ans|उत्तर|योग्य उत्तर|बरोबर उत्तर)\s*[:\-]\s*\(?([A-Da-d1-4])\)?/i;
  const reHint = /^(?:Hint|सूचना|संकेत|टीप)\s*[:\-]\s*(.*)$/i;
  const reExp = /^(?:Explanation|Exp|स्पष्टीकरण|विवरण)\s*[:\-]\s*(.*)$/i;
  const all = []; let cur = null, field = null;
  const start = q => { cur = { question: q, options: [], answer: -1, hint: '', explanation: '' }; all.push(cur); field = 'question'; };
  for (const l of lines) {
    let m;
    if ((m = l.match(reAns)) && cur) { const c = m[1].toUpperCase(); cur.answer = /\d/.test(c) ? +c - 1 : 'ABCD'.indexOf(c); field = null; }
    else if ((m = l.match(reHint)) && cur) { cur.hint = m[1]; field = 'hint'; }
    else if ((m = l.match(reExp)) && cur) { cur.explanation = m[1]; field = 'explanation'; }
    else if ((m = l.match(reOpt)) && cur && cur.options.length < 4) { cur.options.push(m[2]); field = 'option'; }
    else if ((m = l.match(reQ)) && (!cur || cur.options.length || cur.answer >= 0)) start(m[2]);
    else if (cur && field) {                      // wrapped line: continue the previous field
      if (field === 'option') cur.options[cur.options.length - 1] += ' ' + l; else cur[field] += ' ' + l;
    }
  }
  const qs = all.filter(q => q.question && q.options.length === 4 && q.answer >= 0 && q.answer < 4)
    .map(q => ({ ...q, hint: q.hint || null, explanation: q.explanation || null }));
  return { qs, skipped: all.length - qs.length };
}

function renderPreview(qs, skipped, saveCall) {
  S.saveCall = saveCall;
  document.getElementById('u-preview').innerHTML = qs.length ? `
    <p class="text-sm mt-2">${qs.length} questions ready${skipped ? `, ${skipped} skipped (missing 4 options or the Answer line)` : ''}. Correct answers are in green. Remove any you don't want.</p>
    <div class="space-y-2 mt-2 max-h-80 overflow-y-auto">${qs.map((q, i) => `
      <div class="p-3 rounded-xl border border-edge text-sm flex justify-between gap-3"><div><b>${i + 1}. ${esc(q.question)}</b>
        <ul class="mt-1 text-slate-300">${q.options.map((o, k) => `<li class="${k === q.answer ? 'text-emerald-400' : ''}">${'ABCD'[k]}) ${esc(o)}${k === q.answer ? ' ✓' : ''}</li>`).join('')}</ul></div>
        <button class="${btn2} !py-1 text-rose-300 shrink-0 self-start" onclick="removeParsed(${i})">Remove</button></div>`).join('')}</div>
    <button class="${btn} mt-3" onclick="${saveCall}">Save ${qs.length} questions</button>`
    : `<p class="text-sm text-rose-300 mt-2">No questions to save. Check the required format or try again.</p>`;
}
function removeParsed(i) { S.parsed.splice(i, 1); renderPreview(S.parsed, 0, S.saveCall); }
function previewParsed() {
  const { qs, skipped } = parseQuestions(document.getElementById('u-text').value);
  S.parsed = qs; renderPreview(qs, skipped, 'saveParsed()');
}

/* ---- import from the online API into the teacher's own bank ---- */
async function importApi() {
  const v = id => document.getElementById(id).value;
  const c = { language: v('i-lang'), subject: v('i-subject'), difficulty: v('i-level'), count: +v('i-count') };
  try {
    toast('Fetching questions…');
    const qs = await fetchApi(c);
    S.parsed = qs.map(q => ({ question: q.question, options: q.options, answer: q.answer, hint: null, explanation: null }));
    S.meta = { language: qs.failed ? 'English' : c.language, subject: c.subject, difficulty: c.difficulty };
    if (qs.failed) toast('Translation limit reached, so these will be saved as English questions.');
    renderPreview(S.parsed, 0, 'saveApi()');
  } catch (e) { toast(e.message); }
}
async function saveApi() {
  const rows = S.parsed.map(q => ({ ...q, ...S.meta, created_by: S.user.id }));
  const { error } = await sb.from('questions').insert(rows);
  if (error) return toast(error.message);
  toast(rows.length + ' questions saved to your bank.'); viewTeacher('questions');
}
async function saveParsed() {
  const v = id => document.getElementById(id).value;
  const rows = S.parsed.map(q => ({ ...q, language: v('u-lang'), subject: v('u-subject'), difficulty: v('u-level'), created_by: S.user.id }));
  const { error } = await sb.from('questions').insert(rows);
  if (error) return toast(error.message);
  toast(rows.length + ' questions saved.'); viewTeacher('questions');
}

async function saveQuestion() {
  const v = id => document.getElementById(id).value.trim();
  const options = [0, 1, 2, 3].map(k => v('t-o' + k));
  if (!v('t-q') || options.some(o => !o)) return toast('Enter the question and all four options.');
  const row = { language: v('t-lang'), subject: v('t-subject'), difficulty: v('t-level'), question: v('t-q'),
    options, answer: +v('t-ans'), hint: v('t-hint') || null, explanation: v('t-exp') || null };
  const { error } = S.edit
    ? await sb.from('questions').update(row).eq('id', S.edit.id)
    : await sb.from('questions').insert({ ...row, created_by: S.user.id });
  if (error) return toast(error.message);
  toast(S.edit ? 'Question saved.' : 'Question added.'); S.edit = null; viewTeacher('questions');
}
async function delQuestion(i) {
  if (!confirm('Delete this question?')) return;
  const { error } = await sb.from('questions').delete().eq('id', S.tq[i].id);
  if (error) return toast(error.message);
  toast('Question deleted.'); viewTeacher('questions');
}

/* ---------- start ---------- */
renderNav();
viewAuth('login');