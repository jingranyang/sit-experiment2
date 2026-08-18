(function () {
  'use strict';

  // =========================================================================
  // This page is designed to run standalone on GitHub Pages and be embedded
  // (via <iframe>) or linked to from a Qualtrics survey. It handles ONLY the
  // cooperative math task with computer-simulated teammates/opponents —
  // consent, instructions, allocation tasks, surveys, and debrief are expected
  // to live in Qualtrics itself. See qualtrics-integration.md for wiring.
  //
  // URL parameters accepted:
  //   pid        participant/response ID to echo back (default: random)
  //   group      'A' or 'B' — assign externally (e.g. from Qualtrics'
  //              randomizer). If omitted, this page randomizes it itself.
  //   ingroup    number of simulated teammates, excluding the real participant
  //              (default 4)
  //   outgroup   number of simulated opponents (default 5)
  //   duration   task duration in seconds (default 180)
  //   difficulty 'easy' | 'medium' | 'hard' (default 'medium')
  //   bias       'win' | 'lose' | 'tie' | 'random' — probabilistic tendency
  //              for the participant's own team, not a hard guarantee
  //              (default 'random')
  //   returnUrl  if set, a "continue" button appends result fields (prefixed
  //              sit_) to this URL as query params and navigates there
  //   origin     targetOrigin for postMessage back to the parent window
  //              (default '*' — tighten this if you control the Qualtrics
  //              data center domain)
  //   autostart  '1' skips the intro screen and starts the task immediately
  // =========================================================================

  function randInt(min, max) {
    const range = max - min + 1;
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return min + (buf[0] % range);
  }
  function randFloat(min, max) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return min + (buf[0] / 0xffffffff) * (max - min);
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------------------------------------------------------------------
  // Config from URL
  // ---------------------------------------------------------------------
  const qs = new URLSearchParams(location.search);
  const CONFIG = {
    pid: qs.get('pid') || ('anon_' + Math.random().toString(36).slice(2, 10)),
    groupParam: (qs.get('group') || '').toUpperCase(),
    inGroupCount: clampInt(qs.get('ingroup'), 4, 0, 50),
    outGroupCount: clampInt(qs.get('outgroup'), 5, 0, 50),
    durationSec: clampInt(qs.get('duration'), 180, 10, 1800),
    difficulty: ['easy', 'medium', 'hard'].includes(qs.get('difficulty')) ? qs.get('difficulty') : 'medium',
    bias: ['win', 'lose', 'tie', 'random'].includes(qs.get('bias')) ? qs.get('bias') : 'random',
    returnUrl: qs.get('returnUrl') || '',
    targetOrigin: qs.get('origin') || '*',
    autostart: qs.get('autostart') === '1',
  };
  function clampInt(v, def, min, max) {
    const n = parseInt(v, 10);
    if (Number.isNaN(n)) return def;
    return Math.max(min, Math.min(max, n));
  }

  // ---------------------------------------------------------------------
  // Math problem generator
  // ---------------------------------------------------------------------
  function generateProblem(difficulty) {
    let a, b, op, answer;
    const ops = ['+', '-', '*'];
    op = ops[randInt(0, difficulty === 'easy' ? 1 : ops.length - 1)];
    if (difficulty === 'easy') { a = randInt(1, 20); b = randInt(1, 20); }
    else if (difficulty === 'hard') { a = op === '*' ? randInt(2, 12) : randInt(10, 99); b = op === '*' ? randInt(2, 12) : randInt(10, 99); }
    else { a = op === '*' ? randInt(2, 9) : randInt(1, 50); b = op === '*' ? randInt(2, 9) : randInt(1, 50); }
    if (op === '-' && b > a) { [a, b] = [b, a]; }
    if (op === '+') answer = a + b; else if (op === '-') answer = a - b; else answer = a * b;
    return { text: `${a} ${op} ${b}`, answer };
  }

  // ---------------------------------------------------------------------
  // Roster + bot schedule generation (ported from the server-based version's
  // lib/botgen.js — same logic, running client-side since there is no
  // backend in this deployment).
  // ---------------------------------------------------------------------
  function buildRoster() {
    const realGroup = CONFIG.groupParam === 'A' || CONFIG.groupParam === 'B'
      ? CONFIG.groupParam
      : (randInt(0, 1) === 0 ? 'A' : 'B');
    const otherGroup = realGroup === 'A' ? 'B' : 'A';

    const slots = [{ isReal: true, groupLabel: realGroup }];
    for (let i = 0; i < CONFIG.inGroupCount; i++) slots.push({ isReal: false, groupLabel: realGroup, botId: 'bot_' + Math.random().toString(36).slice(2, 10) });
    for (let i = 0; i < CONFIG.outGroupCount; i++) slots.push({ isReal: false, groupLabel: otherGroup, botId: 'bot_' + Math.random().toString(36).slice(2, 10) });

    for (let i = slots.length - 1; i > 0; i--) {
      const j = randInt(0, i);
      [slots[i], slots[j]] = [slots[j], slots[i]];
    }
    let realLabel = null;
    const roster = slots.map((slot, idx) => {
      const label = idx + 1;
      if (slot.isReal) { realLabel = label; return { id: 'self', label, groupLabel: slot.groupLabel, isReal: true }; }
      return { id: slot.botId, label, groupLabel: slot.groupLabel, isReal: false };
    });
    return { roster, realGroup, realLabel };
  }

  const DIFFICULTY_BASE_INTERVAL_SEC = { easy: 4.5, medium: 6, hard: 8.5 };

  function generateBotSchedule(roster, realGroupLabel) {
    const baseInterval = DIFFICULTY_BASE_INTERVAL_SEC[CONFIG.difficulty] || DIFFICULTY_BASE_INTERVAL_SEC.medium;
    const durationSec = CONFIG.durationSec;
    const bias = CONFIG.bias;
    let ownGroupMult = 1, otherGroupMult = 1;
    if (bias === 'win') { otherGroupMult = 1.25; ownGroupMult = 0.92; }
    else if (bias === 'lose') { otherGroupMult = 0.8; ownGroupMult = 1.08; }
    else if (bias === 'tie') { otherGroupMult = 1; ownGroupMult = 1; }

    const schedule = {};
    for (const p of roster) {
      if (p.isReal) continue;
      const groupMult = p.groupLabel === realGroupLabel ? ownGroupMult : otherGroupMult;
      const skill = randFloat(0.75, 1.3);
      const jitterTight = bias === 'tie' ? 0.25 : 0.5;
      const effectiveInterval = baseInterval * groupMult * skill;
      const events = [];
      let t = 0;
      while (t < durationSec) {
        const gap = Math.max(0.8, -Math.log(1 - Math.random()) * effectiveInterval * (1 - jitterTight + Math.random() * jitterTight * 2));
        t += gap;
        if (t < durationSec) events.push(Math.round(t * 1000));
      }
      schedule[p.id] = events;
    }
    return schedule;
  }

  function computeScoreboard(roster, schedule, realGroupLabel, realCorrectCount, elapsedMs) {
    const teams = { A: [], B: [] };
    const totals = { A: 0, B: 0 };
    for (const p of roster) {
      const count = p.isReal ? realCorrectCount : (schedule[p.id] || []).filter((t) => t <= elapsedMs).length;
      teams[p.groupLabel].push({ id: p.id, label: p.label, correctCount: count, isReal: !!p.isReal });
      totals[p.groupLabel] += count;
    }
    teams.A.sort((a, b) => a.label - b.label);
    teams.B.sort((a, b) => a.label - b.label);
    return { teams, totals };
  }

  // ---------------------------------------------------------------------
  // State + render
  // ---------------------------------------------------------------------
  const app = document.getElementById('app');
  const built = buildRoster();
  const S = {
    roster: built.roster,
    group: built.realGroup,
    label: built.realLabel,
    schedule: null,
    correctCount: 0,
    currentProblem: null,
    lastAnswerResult: null,
    startAt: null,
    endAt: null,
    phase: 'intro',
    teams: { A: [], B: [] },
    totals: { A: 0, B: 0 },
    finished: false,
  };

  function formatTime(totalSeconds) {
    const m = Math.floor(totalSeconds / 60), s = totalSeconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function render() {
    if (S.phase === 'intro') return renderIntro();
    if (S.phase === 'playing') return renderPlaying();
    if (S.phase === 'results') return renderResults();
  }

  function renderRosterColumns() {
    const teamA = S.roster.filter((p) => p.groupLabel === 'A');
    const teamB = S.roster.filter((p) => p.groupLabel === 'B');
    const col = (team, list, cls) => `
      <div class="team-col ${cls}">
        <h3>Group ${team}</h3>
        <ul class="member-list">
          ${list.map((p) => `<li class="member-row ${p.id === 'self' ? 'me' : ''}"><span>Participant ${p.label}${p.id === 'self' ? '（你）' : ''}</span></li>`).join('')}
        </ul>
      </div>`;
    return `<div class="team-columns">${col('A', teamA, 'a')}${col('B', teamB, 'b')}</div>`;
  }

  function renderIntro() {
    const groupColor = S.group === 'A' ? 'a' : 'b';
    app.innerHTML = `
      <div class="card center">
        <h1>你被分配到 <span class="badge ${groupColor}">Group ${esc(S.group)}</span></h1>
        <p class="muted">你的编号：Participant ${esc(S.label)}。以下是本轮所有参与者的分组情况。</p>
      </div>
      <div class="card">
        <h2>队伍名单</h2>
        ${renderRosterColumns()}
        <button id="start-btn" class="mt" style="width:100%;">开始合作计算任务</button>
      </div>`;
    document.getElementById('start-btn').addEventListener('click', startGame);
  }

  function startGame() {
    S.schedule = generateBotSchedule(S.roster, S.group);
    S.startAt = Date.now();
    S.endAt = S.startAt + CONFIG.durationSec * 1000;
    S.phase = 'playing';
    render();
    tick();
    requestProblem();
  }

  let tickHandle = null;
  function tick() {
    if (tickHandle) clearInterval(tickHandle);
    tickHandle = setInterval(() => {
      const elapsedMs = Math.max(0, Math.min(Date.now(), S.endAt) - S.startAt);
      const { teams, totals } = computeScoreboard(S.roster, S.schedule, S.group, S.correctCount, elapsedMs);
      S.teams = teams; S.totals = totals;
      updateScoreboardDom();
      updateTimerDom();
      if (Date.now() >= S.endAt) {
        clearInterval(tickHandle);
        finishGame();
      }
    }, 400);
  }

  function finishGame() {
    S.finished = true;
    S.phase = 'results';
    render();
    reportCompletion();
  }

  function requestProblem() {
    if (S.phase !== 'playing' || S.finished) return;
    S.currentProblem = generateProblem(CONFIG.difficulty);
    S.lastAnswerResult = null;
    updateProblemDom();
    const inp = document.getElementById('answer-input');
    if (inp) { inp.value = ''; inp.focus(); }
  }

  function submitAnswer(value) {
    if (!S.currentProblem || S.finished) return;
    const isCorrect = Number(value) === S.currentProblem.answer;
    if (isCorrect) S.correctCount++;
    S.lastAnswerResult = isCorrect ? 'correct' : 'wrong';
    updateProblemDom();
    setTimeout(requestProblem, 150);
  }

  function renderPlaying() {
    const msLeft = Math.max(0, (S.endAt || Date.now() + CONFIG.durationSec * 1000) - Date.now());
    app.innerHTML = `
      <div class="card">
        <div class="timer">剩余时间 <span id="timer-display">${formatTime(Math.ceil(msLeft / 1000))}</span></div>
        <div class="problem-box" id="problem-box">
          <div class="problem-text">${S.currentProblem ? esc(S.currentProblem.text) + ' = ?' : '…'}</div>
          <input type="number" id="answer-input" placeholder="输入答案后按回车" autocomplete="off" style="max-width:200px; margin:0 auto; text-align:center; font-size:1.2rem;" />
        </div>
      </div>
      <div class="card">
        <h2>实时计分板</h2>
        <div id="scoreboard-slot">${renderScoreboardHtml()}</div>
      </div>`;
    const inp = document.getElementById('answer-input');
    if (inp) {
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && inp.value !== '') submitAnswer(inp.value); });
      inp.focus();
    }
  }

  function updateTimerDom() {
    const el = document.getElementById('timer-display');
    if (el) el.textContent = formatTime(Math.ceil(Math.max(0, S.endAt - Date.now()) / 1000));
  }
  function updateScoreboardDom() {
    const el = document.getElementById('scoreboard-slot');
    if (el) el.innerHTML = renderScoreboardHtml();
  }
  function updateProblemDom() {
    const box = document.getElementById('problem-box');
    if (!box) return;
    box.querySelector('.problem-text').textContent = S.currentProblem ? `${S.currentProblem.text} = ?` : '…';
    const inp = document.getElementById('answer-input');
    if (inp) inp.value = '';
    if (S.lastAnswerResult) {
      box.classList.remove('flash', 'flash-bad');
      void box.offsetWidth;
      box.classList.add(S.lastAnswerResult === 'correct' ? 'flash' : 'flash-bad');
    }
  }

  function renderScoreboardHtml() {
    const col = (team, cls) => {
      const list = (S.teams[team] || []).slice().sort((a, b) => a.label - b.label);
      return `
        <div class="team-col ${cls}">
          <h3>Group ${team}${team === S.group ? '（你的队伍）' : ''}</h3>
          <div class="team-total">${S.totals[team] || 0}</div>
          <ul class="member-list">
            ${list.map((p) => `<li class="member-row ${p.isReal ? 'me' : ''}"><span>Participant ${p.label}${p.isReal ? '（你）' : ''}</span><span class="count">${p.correctCount}</span></li>`).join('')}
          </ul>
        </div>`;
    };
    return `<div class="team-columns">${col('A', 'a')}${col('B', 'b')}</div>`;
  }

  function renderResults() {
    const a = S.totals.A || 0, b = S.totals.B || 0;
    let outcome = 'tie', resultText = '双方打成平手！';
    if (a !== b) {
      const won = (a > b && S.group === 'A') || (b > a && S.group === 'B');
      outcome = won ? 'win' : 'lose';
      resultText = won ? '恭喜，你的队伍获胜！' : '很遗憾，你的队伍这局落后了。';
    }
    const ownTeamTotal = S.totals[S.group] || 0;
    const otherGroup = S.group === 'A' ? 'B' : 'A';
    const otherTeamTotal = S.totals[otherGroup] || 0;

    app.innerHTML = `
      <div class="card center">
        <h1>计算任务结束</h1>
        <p class="lead">${esc(resultText)}</p>
        ${renderScoreboardHtml()}
        <div id="continue-slot" class="mt"></div>
      </div>`;

    const slot = document.getElementById('continue-slot');
    if (CONFIG.returnUrl) {
      const btn = document.createElement('button');
      btn.style.width = '100%';
      btn.textContent = '继续（返回问卷）';
      btn.addEventListener('click', () => {
        const url = new URL(CONFIG.returnUrl);
        const payload = resultPayload(outcome, ownTeamTotal, otherTeamTotal);
        Object.entries(payload).forEach(([k, v]) => url.searchParams.set('sit_' + k, v));
        location.href = url.toString();
      });
      slot.appendChild(btn);
    } else {
      const notice = document.createElement('div');
      notice.className = 'notice';
      notice.innerHTML = '本页未配置返回地址（returnUrl），如果这个页面是被 Qualtrics 用 iframe 嵌入的，结果已经通过 postMessage 自动发送，无需额外操作。';
      slot.appendChild(notice);
    }
  }

  function resultPayload(outcome, ownTeamTotal, otherTeamTotal) {
    return {
      pid: CONFIG.pid,
      group: S.group,
      ownCorrect: S.correctCount,
      ownTeamTotal,
      otherTeamTotal,
      outcome,
      durationSec: CONFIG.durationSec,
    };
  }

  function reportCompletion() {
    const a = S.totals.A || 0, b = S.totals.B || 0;
    let outcome = 'tie';
    if (a !== b) outcome = ((a > b && S.group === 'A') || (b > a && S.group === 'B')) ? 'win' : 'lose';
    const ownTeamTotal = S.totals[S.group] || 0;
    const otherGroup = S.group === 'A' ? 'B' : 'A';
    const otherTeamTotal = S.totals[otherGroup] || 0;
    const payload = resultPayload(outcome, ownTeamTotal, otherTeamTotal);
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'sit_task_complete', payload }, CONFIG.targetOrigin);
      }
    } catch (e) { /* cross-origin parent access errors are expected/harmless here */ }
  }

  if (CONFIG.autostart) {
    startGame();
  } else {
    render();
  }
})();
