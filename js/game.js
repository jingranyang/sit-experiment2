(function () {
  'use strict';

  // =========================================================================
  // This page is designed to run standalone on GitHub Pages and be embedded
  // (via <iframe>) or linked to from a Qualtrics survey. It handles THREE
  // sequential cooperative mini-tasks with computer-simulated teammates and
  // opponents: (1) a math task, (2) a "spot the difference" task (找不同/
  // 大家来找茬), (3) a tile-pair-matching task (连连看). Consent,
  // instructions, allocation tasks, surveys, and debrief are expected to
  // live in Qualtrics itself. See QUALTRICS_INTEGRATION.md for wiring.
  //
  // URL parameters accepted:
  //   pid            participant/response ID to echo back (default: random)
  //   group          'A' or 'B' — assign externally (e.g. from Qualtrics'
  //                  randomizer). If omitted, this page randomizes it itself.
  //   ingroup        number of simulated teammates, excluding the real
  //                  participant (default 4)
  //   outgroup       number of simulated opponents (default 5)
  //   duration       math task duration in seconds (default 180)
  //   difficulty     math task difficulty: 'easy' | 'medium' | 'hard'
  //                  (default 'medium')
  //   diffDuration   spot-the-difference task duration in seconds
  //                  (default 120)
  //   diffDifficulty spot-the-difference difficulty: 'easy' | 'medium' |
  //                  'hard' (default 'medium') — controls how many shapes/
  //                  differences per picture pair
  //   linkDuration   连连看 task duration in seconds (default 150)
  //   linkDifficulty 连连看 difficulty: 'easy' | 'medium' | 'hard' (default
  //                  'medium') — controls board size / number of symbols.
  //                  Scoring: each FULLY CLEARED board is worth 1 base
  //                  point; clearing a board faster than the difficulty's
  //                  typical pace earns a fractional speed bonus on top
  //                  (see computeLinkCombinedTotals), so both "how many
  //                  boards" and "how fast" contribute to the score.
  //   bias           'win' | 'lose' | 'tie' | 'random' — probabilistic
  //                  tendency for the participant's own team across ALL
  //                  THREE tasks, not a hard guarantee (default 'random')
  //   help           '0' disables the mutual-help mechanic; anything else
  //                  (default) leaves it on. When on, every helpThreshold
  //                  units of the participant's own progress in a task
  //                  (correct answers / completed diff pairs / cleared
  //                  link boards) earns a "help charge" that can be spent
  //                  on any chosen in-group teammate, and teammates
  //                  periodically send the participant an unprompted hint
  //                  in return (with their identity always shown).
  //   helpThreshold  how many units of own progress earn one help charge
  //                  (default 5)
  //   helpReceiveInterval  seconds between unprompted "receive help"
  //                  events (roughly randomized around this value); mainly
  //                  useful for shortening the wait in automated tests.
  //                  Default: task-specific (~20-30s)
  //   returnUrl      if set, a "continue" button on the final results screen
  //                  appends result fields (prefixed sit_) to this URL as
  //                  query params and navigates there
  //   origin         targetOrigin for postMessage back to the parent window
  //                  (default '*' — tighten this if you control the
  //                  Qualtrics data center domain)
  //   autostart      '1' skips the intro screen and starts the math task
  //                  immediately
  //   debug          '1' exposes window.__sitDebug with internal state, used
  //                  by the automated test suite to click exact difference
  //                  coordinates instead of guessing pixels
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
  function formatTime(totalSeconds) {
    const m = Math.floor(totalSeconds / 60), s = totalSeconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  // ---------------------------------------------------------------------
  // Config from URL
  // ---------------------------------------------------------------------
  const qs = new URLSearchParams(location.search);
  function clampInt(v, def, min, max) {
    const n = parseInt(v, 10);
    if (Number.isNaN(n)) return def;
    return Math.max(min, Math.min(max, n));
  }
  const CONFIG = {
    pid: qs.get('pid') || ('anon_' + Math.random().toString(36).slice(2, 10)),
    groupParam: (qs.get('group') || '').toUpperCase(),
    inGroupCount: clampInt(qs.get('ingroup'), 4, 0, 50),
    outGroupCount: clampInt(qs.get('outgroup'), 5, 0, 50),
    durationSec: clampInt(qs.get('duration'), 180, 10, 1800),
    difficulty: ['easy', 'medium', 'hard'].includes(qs.get('difficulty')) ? qs.get('difficulty') : 'medium',
    diffDurationSec: clampInt(qs.get('diffDuration'), 120, 10, 1800),
    diffDifficulty: ['easy', 'medium', 'hard'].includes(qs.get('diffDifficulty')) ? qs.get('diffDifficulty') : 'medium',
    linkDurationSec: clampInt(qs.get('linkDuration'), 150, 10, 1800),
    linkDifficulty: ['easy', 'medium', 'hard'].includes(qs.get('linkDifficulty')) ? qs.get('linkDifficulty') : 'medium',
    bias: ['win', 'lose', 'tie', 'random'].includes(qs.get('bias')) ? qs.get('bias') : 'random',
    helpEnabled: qs.get('help') !== '0',
    helpThreshold: clampInt(qs.get('helpThreshold'), 5, 1, 100),
    helpReceiveIntervalSec: qs.get('helpReceiveInterval') ? clampInt(qs.get('helpReceiveInterval'), 0, 3, 600) : 0,
    returnUrl: qs.get('returnUrl') || '',
    targetOrigin: qs.get('origin') || '*',
    autostart: qs.get('autostart') === '1',
    debug: qs.get('debug') === '1',
  };

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
  // Roster generation (shared across both tasks — same simulated teammates
  // and opponents throughout).
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

  // Generic simulated-performance schedule: a list of "point" timestamps per
  // bot persona, reused for both the math task (1 point per correct answer)
  // and the spot-the-difference task (1 point per fully completed picture
  // pair). baseIntervalSec is the average seconds between points for a
  // "typical" bot before per-persona skill variance and outcome bias are
  // applied.
  function generatePointSchedule(roster, realGroupLabel, durationSec, baseIntervalSec, bias) {
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
      const effectiveInterval = baseIntervalSec * groupMult * skill;
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

  function computeScoreboard(roster, schedule, realGroupLabel, realCount, elapsedMs) {
    const teams = { A: [], B: [] };
    const totals = { A: 0, B: 0 };
    for (const p of roster) {
      const count = p.isReal ? realCount : (schedule[p.id] || []).filter((t) => t <= elapsedMs).length;
      teams[p.groupLabel].push({ id: p.id, label: p.label, correctCount: count, isReal: !!p.isReal });
      totals[p.groupLabel] += count;
    }
    teams.A.sort((a, b) => a.label - b.label);
    teams.B.sort((a, b) => a.label - b.label);
    return { teams, totals };
  }

  const MATH_BASE_INTERVAL_SEC = { easy: 4.5, medium: 6, hard: 8.5 };
  // Average seconds for a bot to complete one full picture pair (i.e. find
  // every difference in it) — roughly (per-difference time) x (diff count).
  const DIFF_BASE_INTERVAL_SEC = { easy: 14, medium: 26, hard: 45 };
  // Average seconds for a bot to fully clear one 连连看 board — roughly
  // (per-pair search time) x (pair count). Also used as the "par time" a
  // completed board is compared against when computing the speed bonus.
  const LINK_BASE_INTERVAL_SEC = { easy: 20, medium: 45, hard: 80 };
  // A board cleared in 0 seconds would earn a full +1.0 bonus point on top
  // of its +1.0 base point; a board cleared at exactly the par time earns
  // +0; slower than par earns +0 (never negative).
  const LINK_BONUS_WEIGHT = 1;

  // Roughly how many real seconds pass between one in-group teammate
  // spontaneously sending the participant a hint, per task (randomized
  // +/-40% around this so it doesn't feel mechanical). Overridable via the
  // helpReceiveInterval URL param, mainly for automated testing.
  const HELP_RECEIVE_INTERVAL_SEC = { math: 22, diff: 28, link: 32 };

  function freshHelpState() {
    return { helpCharges: 0, helpChargesEarnedTotal: 0, helpsGiven: 0, helpsReceived: 0, helpFeed: [], activeHint: null, helpReceiveHandle: null };
  }

  // ---------------------------------------------------------------------
  // Shared state
  // ---------------------------------------------------------------------
  const app = document.getElementById('app');
  const built = buildRoster();
  const S = {
    roster: built.roster,
    group: built.realGroup,
    label: built.realLabel,
    phase: 'intro', // intro | math | math_done | diff | diff_done | link | results
    math: Object.assign({ schedule: null, correctCount: 0, currentProblem: null, lastAnswerResult: null, startAt: null, endAt: null, teams: { A: [], B: [] }, totals: { A: 0, B: 0 } }, freshHelpState()),
    diff: Object.assign({ schedule: null, pairsCompleted: 0, round: null, foundInRound: 0, startAt: null, endAt: null, teams: { A: [], B: [] }, totals: { A: 0, B: 0 }, hintDiffIndex: null }, freshHelpState()),
    link: Object.assign({ schedule: null, board: null, boardsCompleted: 0, selected: null, completionTimestamps: [], startAt: null, endAt: null, teams: { A: [], B: [] }, totals: { A: 0, B: 0 }, hintPair: null }, freshHelpState()),
  };

  // A small fixed toast that lives outside #app so it survives full-screen
  // re-renders when a phase changes; used to surface "who just helped you"
  // even if the participant isn't looking at the help panel right now.
  const helpToastEl = document.createElement('div');
  helpToastEl.id = 'help-toast';
  helpToastEl.className = 'help-toast';
  document.body.appendChild(helpToastEl);
  let helpToastTimer = null;
  function showHelpToast(text) {
    helpToastEl.textContent = text;
    helpToastEl.classList.remove('show');
    void helpToastEl.offsetWidth;
    helpToastEl.classList.add('show');
    if (helpToastTimer) clearTimeout(helpToastTimer);
    helpToastTimer = setTimeout(() => helpToastEl.classList.remove('show'), 4000);
  }

  // =======================================================================
  // Mutual help mechanic (shared across all three tasks)
  // =======================================================================
  function ingroupBots() {
    return S.roster.filter((p) => !p.isReal && p.groupLabel === S.group);
  }
  function taskProgressCount(taskKey) {
    if (taskKey === 'math') return S.math.correctCount;
    if (taskKey === 'diff') return S.diff.pairsCompleted;
    return S.link.boardsCompleted;
  }
  function pushHelpFeed(taskKey, text) {
    const t = S[taskKey];
    t.helpFeed.push(text);
    if (t.helpFeed.length > 6) t.helpFeed.shift();
  }

  // Call after any own-progress increment in a task; grants one help charge
  // for every helpThreshold units of progress reached.
  function maybeGrantHelpCharge(taskKey) {
    if (!CONFIG.helpEnabled) return;
    const t = S[taskKey];
    const earnedNow = Math.floor(taskProgressCount(taskKey) / CONFIG.helpThreshold);
    if (earnedNow > t.helpChargesEarnedTotal) {
      t.helpCharges += earnedNow - t.helpChargesEarnedTotal;
      t.helpChargesEarnedTotal = earnedNow;
    }
  }

  // The participant spends one charge to give a chosen in-group teammate a
  // point "on the house" — implemented by injecting a synthetic completion
  // timestamp into that bot's own schedule, so it flows through the exact
  // same scoreboard/results math as a normally-earned point.
  function giveHelp(taskKey, targetBotId) {
    const t = S[taskKey];
    if (!CONFIG.helpEnabled || S.phase !== taskKey || t.helpCharges <= 0) return;
    const bot = S.roster.find((p) => p.id === targetBotId && !p.isReal && p.groupLabel === S.group);
    if (!bot || !t.schedule) return;
    const elapsedMs = Math.max(0, Math.min(Date.now(), t.endAt) - t.startAt);
    (t.schedule[bot.id] = t.schedule[bot.id] || []).push(elapsedMs);
    t.schedule[bot.id].sort((a, b) => a - b);
    t.helpCharges--;
    t.helpsGiven++;
    pushHelpFeed(taskKey, `You gave Participant ${bot.label} a hint.`);
    showHelpToast(`You helped Participant ${bot.label}!`);
    refreshTaskScoreboardImmediate(taskKey);
    refreshHelpPanel(taskKey);
  }

  function refreshTaskScoreboardImmediate(taskKey) {
    if (taskKey === 'math') return updateMathScoreboardDomImmediate();
    if (taskKey === 'diff') return updateDiffScoreboardDomImmediate();
    return updateLinkScoreboardDomImmediate();
  }

  function scheduleHelpReceive(taskKey) {
    if (!CONFIG.helpEnabled) return;
    const t = S[taskKey];
    const base = CONFIG.helpReceiveIntervalSec || HELP_RECEIVE_INTERVAL_SEC[taskKey];
    const delay = Math.max(2, base * (0.6 + Math.random() * 0.8)) * 1000;
    t.helpReceiveHandle = setTimeout(() => triggerHelpReceive(taskKey), delay);
  }

  function triggerHelpReceive(taskKey) {
    if (S.phase !== taskKey) return; // task already ended — stop the chain
    const bots = ingroupBots();
    if (bots.length === 0) { scheduleHelpReceive(taskKey); return; }
    const helper = bots[randInt(0, bots.length - 1)];
    const applied = applyReceivedHint(taskKey, helper);
    if (applied) {
      const t = S[taskKey];
      t.helpsReceived++;
      pushHelpFeed(taskKey, `Participant ${helper.label} gave you a hint!`);
      showHelpToast(`Participant ${helper.label} gave you a hint!`);
      refreshHelpPanel(taskKey);
    }
    scheduleHelpReceive(taskKey);
  }

  // Applies a task-specific hint and sets t.activeHint (always naming the
  // helper, so the participant can always see who helped them). Returns
  // false if there was nothing useful to hint at right now.
  function applyReceivedHint(taskKey, helper) {
    if (taskKey === 'math') {
      const m = S.math;
      if (!m.currentProblem) return false;
      m.activeHint = `Hint from Participant ${helper.label}: the answer is ${m.currentProblem.answer}.`;
      updateMathHintDom();
      return true;
    }
    if (taskKey === 'diff') {
      const d = S.diff;
      if (!d.round) return false;
      const unfoundIdx = d.round.diffs.reduce((acc, dd, idx) => { if (!dd.found) acc.push(idx); return acc; }, []);
      if (unfoundIdx.length === 0) return false;
      d.hintDiffIndex = unfoundIdx[randInt(0, unfoundIdx.length - 1)];
      d.activeHint = `Hint from Participant ${helper.label}: check the highlighted spot.`;
      drawDiffCanvases();
      updateDiffHintDom();
      return true;
    }
    // link
    const l = S.link;
    if (!l.board) return false;
    const pair = LinkMatch.findValidPair(l.board);
    if (!pair) return false;
    l.hintPair = pair;
    l.activeHint = `Hint from Participant ${helper.label}: try the highlighted tiles.`;
    renderLinkBoardDom();
    updateLinkHintDom();
    return true;
  }

  function renderHelpPanelHtml(taskKey) {
    if (!CONFIG.helpEnabled) return '';
    const t = S[taskKey];
    const bots = ingroupBots();
    let statusHtml;
    if (t.helpCharges > 0 && bots.length > 0) {
      statusHtml = `
        <div class="help-status">You have <strong>${t.helpCharges}</strong> help ${t.helpCharges === 1 ? 'charge' : 'charges'} — choose a teammate to help:</div>
        <div class="help-target-list">
          ${bots.map((b) => `<button type="button" class="help-target-btn" data-help-target="${esc(b.id)}">Help Participant ${esc(b.label)}</button>`).join('')}
        </div>`;
    } else {
      const remaining = CONFIG.helpThreshold - (taskProgressCount(taskKey) % CONFIG.helpThreshold);
      statusHtml = `<div class="help-status muted">Complete ${remaining} more to earn a chance to help a teammate.</div>`;
    }
    const feedHtml = t.helpFeed.length
      ? `<ul class="help-feed">${t.helpFeed.slice().reverse().map((f) => `<li>${esc(f)}</li>`).join('')}</ul>`
      : '';
    return `<div class="card help-panel" id="help-panel-${taskKey}">
        <h2>Mutual Help</h2>
        ${statusHtml}
        <div class="muted" style="font-size:0.82rem; margin-top:8px;">Helped teammates: ${t.helpsGiven} · Hints received: ${t.helpsReceived}</div>
        ${feedHtml}
      </div>`;
  }

  function attachHelpPanelListeners(taskKey) {
    const panel = document.getElementById('help-panel-' + taskKey);
    if (!panel) return;
    panel.querySelectorAll('.help-target-btn').forEach((btn) => {
      btn.addEventListener('click', () => giveHelp(taskKey, btn.dataset.helpTarget));
    });
  }

  function refreshHelpPanel(taskKey) {
    const el = document.getElementById('help-panel-' + taskKey);
    if (!el) return;
    el.outerHTML = renderHelpPanelHtml(taskKey);
    attachHelpPanelListeners(taskKey);
  }

  if (CONFIG.debug) window.__sitDebug = { get state() { return S; }, CONFIG, giveHelp, triggerHelpReceive };

  function render() {
    if (S.phase === 'intro') return renderIntro();
    if (S.phase === 'math') return renderMathPlaying();
    if (S.phase === 'math_done') return renderMathDone();
    if (S.phase === 'diff') return renderDiffPlaying();
    if (S.phase === 'diff_done') return renderDiffDone();
    if (S.phase === 'link') return renderLinkPlaying();
    if (S.phase === 'results') return renderResults();
  }

  function renderRosterColumns() {
    const teamA = S.roster.filter((p) => p.groupLabel === 'A');
    const teamB = S.roster.filter((p) => p.groupLabel === 'B');
    const col = (team, list, cls) => `
      <div class="team-col ${cls}">
        <h3>Group ${team}</h3>
        <ul class="member-list">
          ${list.map((p) => `<li class="member-row ${p.id === 'self' ? 'me' : ''}"><span>Participant ${p.label}${p.id === 'self' ? ' (you)' : ''}</span></li>`).join('')}
        </ul>
      </div>`;
    return `<div class="team-columns">${col('A', teamA, 'a')}${col('B', teamB, 'b')}</div>`;
  }

  function renderIntro() {
    const groupColor = S.group === 'A' ? 'a' : 'b';
    app.innerHTML = `
      <div class="card center">
        <h1>You have been assigned to <span class="badge ${groupColor}">Group ${esc(S.group)}</span></h1>
        <p class="muted">Your ID: Participant ${esc(S.label)}. Below is the team assignment for everyone in this round. Next there are three cooperative tasks: first a calculation challenge, then "Spot the Difference", and finally "Match Pairs".</p>
      </div>
      <div class="card">
        <h2>Team Roster</h2>
        ${renderRosterColumns()}
        <button id="start-btn" class="mt" style="width:100%;">Start Task 1: Cooperative Calculation</button>
      </div>`;
    document.getElementById('start-btn').addEventListener('click', startMathTask);
  }

  // =======================================================================
  // Task 1: math
  // =======================================================================
  function startMathTask() {
    const m = S.math;
    m.schedule = generatePointSchedule(S.roster, S.group, CONFIG.durationSec, MATH_BASE_INTERVAL_SEC[CONFIG.difficulty], CONFIG.bias);
    m.startAt = Date.now();
    m.endAt = m.startAt + CONFIG.durationSec * 1000;
    S.phase = 'math';
    render();
    mathTick();
    requestProblem();
    scheduleHelpReceive('math');
  }

  let mathTickHandle = null;
  function mathTick() {
    if (mathTickHandle) clearInterval(mathTickHandle);
    mathTickHandle = setInterval(() => {
      const m = S.math;
      const elapsedMs = Math.max(0, Math.min(Date.now(), m.endAt) - m.startAt);
      const { teams, totals } = computeScoreboard(S.roster, m.schedule, S.group, m.correctCount, elapsedMs);
      m.teams = teams; m.totals = totals;
      updateMathScoreboardDom();
      updateMathTimerDom();
      if (Date.now() >= m.endAt) {
        clearInterval(mathTickHandle);
        if (m.helpReceiveHandle) clearTimeout(m.helpReceiveHandle);
        S.phase = 'math_done';
        render();
      }
    }, 400);
  }

  function requestProblem() {
    const m = S.math;
    if (S.phase !== 'math') return;
    m.currentProblem = generateProblem(CONFIG.difficulty);
    m.lastAnswerResult = null;
    m.activeHint = null;
    updateProblemDom();
    updateMathHintDom();
    const inp = document.getElementById('answer-input');
    if (inp) { inp.value = ''; inp.focus(); }
  }

  function submitAnswer(value) {
    const m = S.math;
    if (!m.currentProblem || S.phase !== 'math') return;
    const isCorrect = Number(value) === m.currentProblem.answer;
    if (isCorrect) {
      m.correctCount++;
      maybeGrantHelpCharge('math');
      refreshHelpPanel('math');
    }
    m.lastAnswerResult = isCorrect ? 'correct' : 'wrong';
    updateProblemDom();
    setTimeout(requestProblem, 150);
  }

  function renderMathPlaying() {
    const m = S.math;
    const msLeft = Math.max(0, (m.endAt || Date.now() + CONFIG.durationSec * 1000) - Date.now());
    app.innerHTML = `
      <div class="card">
        <div class="timer">Task 1 · Time Remaining <span id="timer-display">${formatTime(Math.ceil(msLeft / 1000))}</span></div>
        <div class="problem-box" id="problem-box">
          <div class="problem-text">${m.currentProblem ? esc(m.currentProblem.text) + ' = ?' : '…'}</div>
          <input type="number" id="answer-input" placeholder="Type your answer and press Enter" autocomplete="off" style="max-width:200px; margin:0 auto; text-align:center; font-size:1.2rem;" />
          <div class="hint-text" id="math-hint">${m.activeHint ? esc(m.activeHint) : ''}</div>
        </div>
      </div>
      <div class="card">
        <h2>Live Scoreboard</h2>
        <div id="scoreboard-slot">${renderScoreboardHtml(m.teams, m.totals)}</div>
      </div>
      ${renderHelpPanelHtml('math')}`;
    const inp = document.getElementById('answer-input');
    if (inp) {
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && inp.value !== '') submitAnswer(inp.value); });
      inp.focus();
    }
    attachHelpPanelListeners('math');
  }

  function updateMathTimerDom() {
    const el = document.getElementById('timer-display');
    if (el) el.textContent = formatTime(Math.ceil(Math.max(0, S.math.endAt - Date.now()) / 1000));
  }
  function updateMathScoreboardDom() {
    const el = document.getElementById('scoreboard-slot');
    if (el) el.innerHTML = renderScoreboardHtml(S.math.teams, S.math.totals);
  }
  function updateMathScoreboardDomImmediate() {
    const m = S.math;
    const elapsedMs = Math.max(0, Math.min(Date.now(), m.endAt) - m.startAt);
    const { teams, totals } = computeScoreboard(S.roster, m.schedule, S.group, m.correctCount, elapsedMs);
    m.teams = teams; m.totals = totals;
    updateMathScoreboardDom();
  }
  function updateMathHintDom() {
    const el = document.getElementById('math-hint');
    if (el) el.textContent = S.math.activeHint || '';
  }
  function updateProblemDom() {
    const box = document.getElementById('problem-box');
    if (!box) return;
    const m = S.math;
    box.querySelector('.problem-text').textContent = m.currentProblem ? `${m.currentProblem.text} = ?` : '…';
    const inp = document.getElementById('answer-input');
    if (inp) inp.value = '';
    if (m.lastAnswerResult) {
      box.classList.remove('flash', 'flash-bad');
      void box.offsetWidth;
      box.classList.add(m.lastAnswerResult === 'correct' ? 'flash' : 'flash-bad');
    }
  }

  function renderScoreboardHtml(teams, totals) {
    const col = (team, cls) => {
      const list = (teams[team] || []).slice().sort((a, b) => a.label - b.label);
      return `
        <div class="team-col ${cls}">
          <h3>Group ${team}${team === S.group ? ' (your team)' : ''}</h3>
          <div class="team-total">${totals[team] || 0}</div>
          <ul class="member-list">
            ${list.map((p) => `<li class="member-row ${p.isReal ? 'me' : ''}"><span>Participant ${p.label}${p.isReal ? ' (you)' : ''}</span><span class="count">${p.correctCount}</span></li>`).join('')}
          </ul>
        </div>`;
    };
    return `<div class="team-columns">${col('A', 'a')}${col('B', 'b')}</div>`;
  }

  function renderMathDone() {
    const m = S.math;
    app.innerHTML = `
      <div class="card center">
        <h1>Task 1 Complete</h1>
        <p class="lead">You answered ${m.correctCount} problems correctly. Next is Task 2: "Spot the Difference" — compete with your teammates against the other team to see who can find all the differences between two pictures fastest.</p>
        ${renderScoreboardHtml(m.teams, m.totals)}
        <button id="start-diff-btn" class="mt" style="width:100%;">Start Task 2: Spot the Difference</button>
      </div>`;
    document.getElementById('start-diff-btn').addEventListener('click', startDiffTask);
  }

  // =======================================================================
  // Task 2: spot the difference (大家来找茬)
  // =======================================================================
  const DIFF_CANVAS_W = 260, DIFF_CANVAS_H = 210;

  function startDiffTask() {
    const d = S.diff;
    d.schedule = generatePointSchedule(S.roster, S.group, CONFIG.diffDurationSec, DIFF_BASE_INTERVAL_SEC[CONFIG.diffDifficulty], CONFIG.bias);
    d.startAt = Date.now();
    d.endAt = d.startAt + CONFIG.diffDurationSec * 1000;
    d.pairsCompleted = 0;
    S.phase = 'diff';
    render();
    diffTick();
    nextDiffRound();
    scheduleHelpReceive('diff');
  }

  let diffTickHandle = null;
  function diffTick() {
    if (diffTickHandle) clearInterval(diffTickHandle);
    diffTickHandle = setInterval(() => {
      const d = S.diff;
      const elapsedMs = Math.max(0, Math.min(Date.now(), d.endAt) - d.startAt);
      const { teams, totals } = computeScoreboard(S.roster, d.schedule, S.group, d.pairsCompleted, elapsedMs);
      d.teams = teams; d.totals = totals;
      updateDiffScoreboardDom();
      updateDiffTimerDom();
      if (Date.now() >= d.endAt) {
        clearInterval(diffTickHandle);
        if (d.helpReceiveHandle) clearTimeout(d.helpReceiveHandle);
        S.phase = 'diff_done';
        render();
      }
    }, 400);
  }

  function nextDiffRound() {
    const d = S.diff;
    if (S.phase !== 'diff') return;
    d.round = SpotDiff.generateRound(DIFF_CANVAS_W, DIFF_CANVAS_H, CONFIG.diffDifficulty);
    d.foundInRound = 0;
    d.hintDiffIndex = null;
    d.activeHint = null;
    drawDiffCanvases();
    updateDiffProgressDom();
    updateDiffHintDom();
  }

  function drawDiffCanvases() {
    const d = S.diff;
    const canvasA = document.getElementById('diff-canvas-a');
    const canvasB = document.getElementById('diff-canvas-b');
    if (canvasA) SpotDiff.render(canvasA, d.round.shapesA, d.round, 'A', d.hintDiffIndex);
    if (canvasB) SpotDiff.render(canvasB, d.round.shapesB, d.round, 'B', d.hintDiffIndex);
  }

  function handleDiffClick(side, evt) {
    const d = S.diff;
    if (S.phase !== 'diff' || !d.round) return;
    const rect = evt.target.getBoundingClientRect();
    const x = evt.clientX - rect.left;
    const y = evt.clientY - rect.top;
    const tolerance = SpotDiff.DIFFICULTY[CONFIG.diffDifficulty].tolerance;
    const hit = SpotDiff.hitTest(d.round, side, x, y, tolerance);
    if (!hit) return;
    hit.found = true;
    d.foundInRound++;
    if (d.hintDiffIndex !== null && d.round.diffs[d.hintDiffIndex] === hit) {
      d.hintDiffIndex = null;
      d.activeHint = null;
      updateDiffHintDom();
    }
    drawDiffCanvases();
    updateDiffProgressDom();
    if (d.foundInRound >= d.round.diffs.length) {
      d.pairsCompleted++;
      maybeGrantHelpCharge('diff');
      refreshHelpPanel('diff');
      updateDiffScoreboardDomImmediate();
      setTimeout(nextDiffRound, 550);
    }
  }

  function updateDiffScoreboardDomImmediate() {
    const d = S.diff;
    const elapsedMs = Math.max(0, Math.min(Date.now(), d.endAt) - d.startAt);
    const { teams, totals } = computeScoreboard(S.roster, d.schedule, S.group, d.pairsCompleted, elapsedMs);
    d.teams = teams; d.totals = totals;
    updateDiffScoreboardDom();
  }

  function renderDiffPlaying() {
    const d = S.diff;
    const msLeft = Math.max(0, (d.endAt || Date.now() + CONFIG.diffDurationSec * 1000) - Date.now());
    app.innerHTML = `
      <div class="card">
        <div class="timer">Task 2 · Time Remaining <span id="timer-display">${formatTime(Math.ceil(msLeft / 1000))}</span></div>
        <p class="center muted" id="diff-progress">Find what's different between the two pictures</p>
        <div style="display:flex; gap:10px; justify-content:center; flex-wrap:wrap;">
          <canvas id="diff-canvas-a" width="${DIFF_CANVAS_W}" height="${DIFF_CANVAS_H}" style="border-radius:8px; cursor:crosshair;"></canvas>
          <canvas id="diff-canvas-b" width="${DIFF_CANVAS_W}" height="${DIFF_CANVAS_H}" style="border-radius:8px; cursor:crosshair;"></canvas>
        </div>
        <p class="center muted mt" style="font-size:0.85rem;">Completed <span id="diff-completed">${d.pairsCompleted}</span> pair(s)</p>
        <div class="hint-text center" id="diff-hint">${d.activeHint ? esc(d.activeHint) : ''}</div>
      </div>
      <div class="card">
        <h2>Live Scoreboard (Pairs Completed)</h2>
        <div id="scoreboard-slot">${renderScoreboardHtml(d.teams, d.totals)}</div>
      </div>
      ${renderHelpPanelHtml('diff')}`;
    const canvasA = document.getElementById('diff-canvas-a');
    const canvasB = document.getElementById('diff-canvas-b');
    canvasA.addEventListener('click', (e) => handleDiffClick('A', e));
    canvasB.addEventListener('click', (e) => handleDiffClick('B', e));
    if (d.round) drawDiffCanvases();
    attachHelpPanelListeners('diff');
  }

  function updateDiffTimerDom() {
    const el = document.getElementById('timer-display');
    if (el) el.textContent = formatTime(Math.ceil(Math.max(0, S.diff.endAt - Date.now()) / 1000));
  }
  function updateDiffScoreboardDom() {
    const el = document.getElementById('scoreboard-slot');
    if (el) el.innerHTML = renderScoreboardHtml(S.diff.teams, S.diff.totals);
  }
  function updateDiffProgressDom() {
    const d = S.diff;
    const p = document.getElementById('diff-progress');
    if (p) p.textContent = d.round ? `Found ${d.foundInRound} / ${d.round.diffs.length} difference(s) this round` : '';
    const c = document.getElementById('diff-completed');
    if (c) c.textContent = d.pairsCompleted;
  }
  function updateDiffHintDom() {
    const el = document.getElementById('diff-hint');
    if (el) el.textContent = S.diff.activeHint || '';
  }

  function renderDiffDone() {
    const d = S.diff;
    app.innerHTML = `
      <div class="card center">
        <h1>Task 2 Complete</h1>
        <p class="lead">You completed ${d.pairsCompleted} pair(s) in "Spot the Difference". Next is Task 3: "Match Pairs" — click two matching tiles; if they can be connected by a path with at most two turns (with nothing blocking in between), they'll be cleared. Clearing the whole board counts as one round — the faster you clear it, the higher your score.</p>
        ${renderScoreboardHtml(d.teams, d.totals)}
        <button id="start-link-btn" class="mt" style="width:100%;">Start Task 3: Match Pairs</button>
      </div>`;
    document.getElementById('start-link-btn').addEventListener('click', startLinkTask);
  }

  // =======================================================================
  // Task 3: tile-pair matching (连连看)
  // =======================================================================
  function startLinkTask() {
    const l = S.link;
    l.schedule = generatePointSchedule(S.roster, S.group, CONFIG.linkDurationSec, LINK_BASE_INTERVAL_SEC[CONFIG.linkDifficulty], CONFIG.bias);
    l.startAt = Date.now();
    l.endAt = l.startAt + CONFIG.linkDurationSec * 1000;
    l.boardsCompleted = 0;
    l.completionTimestamps = [];
    l.selected = null;
    S.phase = 'link';
    render();
    linkTick();
    nextLinkRound();
    scheduleHelpReceive('link');
  }

  let linkTickHandle = null;
  function linkTick() {
    if (linkTickHandle) clearInterval(linkTickHandle);
    linkTickHandle = setInterval(() => {
      const l = S.link;
      const elapsedMs = Math.max(0, Math.min(Date.now(), l.endAt) - l.startAt);
      const { teams, totals } = computeScoreboard(S.roster, l.schedule, S.group, l.boardsCompleted, elapsedMs);
      l.teams = teams; l.totals = totals;
      updateLinkScoreboardDom();
      updateLinkTimerDom();
      if (Date.now() >= l.endAt) {
        clearInterval(linkTickHandle);
        if (l.helpReceiveHandle) clearTimeout(l.helpReceiveHandle);
        S.phase = 'results';
        render();
        reportCompletion();
      }
    }, 400);
  }

  function nextLinkRound() {
    const l = S.link;
    if (S.phase !== 'link') return;
    l.board = LinkMatch.generateBoard(CONFIG.linkDifficulty);
    l.selected = null;
    l.hintPair = null;
    l.activeHint = null;
    renderLinkBoardDom();
    updateLinkProgressDom();
    updateLinkHintDom();
  }

  function remainingCount(board) { return board.cells.filter((v) => v !== null).length; }

  function handleLinkTileClick(idx) {
    const l = S.link;
    if (S.phase !== 'link' || !l.board) return;
    if (l.board.cells[idx] === null) return; // already cleared
    if (l.selected === null) {
      l.selected = idx;
      renderLinkBoardDom();
      return;
    }
    if (l.selected === idx) {
      l.selected = null; // clicked the same tile again — deselect
      renderLinkBoardDom();
      return;
    }
    const a = { r: Math.floor(l.selected / l.board.cols), c: l.selected % l.board.cols };
    const b = { r: Math.floor(idx / l.board.cols), c: idx % l.board.cols };
    const sameSymbol = l.board.cells[l.selected] === l.board.cells[idx];
    const connects = sameSymbol && LinkMatch.canConnect(l.board, a.r, a.c, b.r, b.c);
    if (connects) {
      const clearedA = l.selected, clearedB = idx;
      l.board.cells[l.selected] = null;
      l.board.cells[idx] = null;
      l.selected = null;
      if (l.hintPair && (l.hintPair.includes(clearedA) || l.hintPair.includes(clearedB))) {
        l.hintPair = null;
        l.activeHint = null;
        updateLinkHintDom();
      }
      if (remainingCount(l.board) === 0) {
        l.boardsCompleted++;
        l.completionTimestamps.push(Date.now() - l.startAt);
        maybeGrantHelpCharge('link');
        refreshHelpPanel('link');
        updateLinkScoreboardDomImmediate();
        setTimeout(nextLinkRound, 450);
        return;
      }
      if (!LinkMatch.hasAnyValidMove(l.board)) {
        LinkMatch.reshuffleUntilSolvable(l.board);
        l.hintPair = null;
        l.activeHint = null;
        updateLinkHintDom();
      }
      renderLinkBoardDom();
      updateLinkProgressDom();
    } else {
      // Not a valid match — just move the selection to the newly clicked tile.
      l.selected = idx;
      renderLinkBoardDom();
    }
  }

  function updateLinkScoreboardDomImmediate() {
    const l = S.link;
    const elapsedMs = Math.max(0, Math.min(Date.now(), l.endAt) - l.startAt);
    const { teams, totals } = computeScoreboard(S.roster, l.schedule, S.group, l.boardsCompleted, elapsedMs);
    l.teams = teams; l.totals = totals;
    updateLinkScoreboardDom();
  }

  function renderLinkPlaying() {
    const l = S.link;
    const msLeft = Math.max(0, (l.endAt || Date.now() + CONFIG.linkDurationSec * 1000) - Date.now());
    app.innerHTML = `
      <div class="card">
        <div class="timer">Task 3 · Time Remaining <span id="timer-display">${formatTime(Math.ceil(msLeft / 1000))}</span></div>
        <p class="center muted" id="link-progress">Click two matching tiles to try</p>
        <div id="link-grid-slot"></div>
        <p class="center muted mt" style="font-size:0.85rem;">Completed <span id="link-completed">${l.boardsCompleted}</span> round(s)</p>
        <div class="hint-text center" id="link-hint">${l.activeHint ? esc(l.activeHint) : ''}</div>
      </div>
      <div class="card">
        <h2>Live Scoreboard (Rounds Completed)</h2>
        <div id="scoreboard-slot">${renderScoreboardHtml(l.teams, l.totals)}</div>
      </div>
      ${renderHelpPanelHtml('link')}`;
    if (l.board) renderLinkBoardDom();
    attachHelpPanelListeners('link');
  }

  function renderLinkBoardDom() {
    const l = S.link;
    const slot = document.getElementById('link-grid-slot');
    if (!slot || !l.board) return;
    const { cols, rows, cells } = l.board;
    slot.innerHTML = `<div class="link-grid" style="grid-template-columns: repeat(${cols}, 1fr);">
      ${cells.map((sym, idx) => {
        if (sym === null) return `<div class="link-tile empty" data-idx="${idx}"></div>`;
        const selectedCls = l.selected === idx ? ' selected' : '';
        const hintCls = l.hintPair && l.hintPair.includes(idx) ? ' hint' : '';
        return `<button type="button" class="link-tile${selectedCls}${hintCls}" data-idx="${idx}">${esc(LinkMatch.SYMBOLS[sym % LinkMatch.SYMBOLS.length])}</button>`;
      }).join('')}
    </div>`;
    slot.querySelectorAll('.link-tile:not(.empty)').forEach((el) => {
      el.addEventListener('click', () => handleLinkTileClick(Number(el.dataset.idx)));
    });
  }

  function updateLinkTimerDom() {
    const el = document.getElementById('timer-display');
    if (el) el.textContent = formatTime(Math.ceil(Math.max(0, S.link.endAt - Date.now()) / 1000));
  }
  function updateLinkScoreboardDom() {
    const el = document.getElementById('scoreboard-slot');
    if (el) el.innerHTML = renderScoreboardHtml(S.link.teams, S.link.totals);
  }
  function updateLinkProgressDom() {
    const l = S.link;
    const p = document.getElementById('link-progress');
    if (p && l.board) p.textContent = `${remainingCount(l.board)} / ${l.board.cells.length} tile(s) remaining this round`;
    const c = document.getElementById('link-completed');
    if (c) c.textContent = l.boardsCompleted;
  }
  function updateLinkHintDom() {
    const el = document.getElementById('link-hint');
    if (el) el.textContent = S.link.activeHint || '';
  }

  // Combines each participant's base score (1 point per fully-cleared board)
  // with a speed bonus (up to +LINK_BONUS_WEIGHT extra per board, scaled by
  // how much faster than the difficulty's "par" time that board was
  // cleared). Applied identically to the real participant (from their
  // recorded completion timestamps) and every simulated bot (derived from
  // their point schedule), so the comparison is apples-to-apples.
  function computeLinkCombinedTotals(roster, schedule, realTimestamps, realGroupLabel, parTimeSec) {
    const parMs = parTimeSec * 1000;
    function scoreFromTimestamps(timestamps) {
      let base = 0, bonus = 0, prev = 0;
      for (const t of timestamps) {
        base += 1;
        const gap = t - prev;
        bonus += Math.max(0, (parMs - gap) / parMs) * LINK_BONUS_WEIGHT;
        prev = t;
      }
      return { base, bonus, combined: base + bonus };
    }
    const teams = { A: [], B: [] };
    const totals = { A: 0, B: 0 };
    for (const pt of roster) {
      const timestamps = pt.isReal ? realTimestamps : (schedule[pt.id] || []);
      const score = scoreFromTimestamps(timestamps);
      teams[pt.groupLabel].push({ id: pt.id, label: pt.label, correctCount: Math.round(score.combined * 10) / 10, isReal: !!pt.isReal });
      totals[pt.groupLabel] += score.combined;
    }
    totals.A = Math.round(totals.A * 10) / 10;
    totals.B = Math.round(totals.B * 10) / 10;
    teams.A.sort((a, b) => a.label - b.label);
    teams.B.sort((a, b) => a.label - b.label);
    return { teams, totals };
  }

  // =======================================================================
  // Results + handoff back to Qualtrics
  // =======================================================================
  function outcomeFor(totals, group) {
    const own = totals[group] || 0;
    const other = totals[group === 'A' ? 'B' : 'A'] || 0;
    if (own === other) return 'tie';
    return own > other ? 'win' : 'lose';
  }

  function resultPayload() {
    const m = S.math, d = S.diff, l = S.link;
    const otherGroup = S.group === 'A' ? 'B' : 'A';

    const mathOutcome = outcomeFor(m.totals, S.group);
    const mathTeamTotal = m.totals[S.group] || 0;
    const mathOtherTotal = m.totals[otherGroup] || 0;

    const diffOutcome = outcomeFor(d.totals, S.group);
    const diffTeamTotal = d.totals[S.group] || 0;
    const diffOtherTotal = d.totals[otherGroup] || 0;

    const linkCombined = computeLinkCombinedTotals(S.roster, l.schedule || {}, l.completionTimestamps, S.group, LINK_BASE_INTERVAL_SEC[CONFIG.linkDifficulty]);
    const linkOutcome = outcomeFor(linkCombined.totals, S.group);
    const linkTeamTotal = linkCombined.totals[S.group] || 0;
    const linkOtherTotal = linkCombined.totals[otherGroup] || 0;

    const overallOwnTeamTotal = Math.round((mathTeamTotal + diffTeamTotal + linkTeamTotal) * 10) / 10;
    const overallOtherTeamTotal = Math.round((mathOtherTotal + diffOtherTotal + linkOtherTotal) * 10) / 10;
    let overallOutcome = 'tie';
    if (overallOwnTeamTotal !== overallOtherTeamTotal) overallOutcome = overallOwnTeamTotal > overallOtherTeamTotal ? 'win' : 'lose';

    return {
      pid: CONFIG.pid,
      group: S.group,
      mathOwnCorrect: m.correctCount,
      mathTeamTotal, mathOtherTeamTotal: mathOtherTotal, mathOutcome,
      mathDurationSec: CONFIG.durationSec,
      diffPairsCompleted: d.pairsCompleted,
      diffTeamTotal, diffOtherTeamTotal: diffOtherTotal, diffOutcome,
      diffDurationSec: CONFIG.diffDurationSec,
      linkBoardsCompleted: l.boardsCompleted,
      linkTeamTotal, linkOtherTeamTotal: linkOtherTotal, linkOutcome,
      linkDurationSec: CONFIG.linkDurationSec,
      overallOwnTeamTotal, overallOtherTeamTotal, overallOutcome,
      mathHelpsGiven: m.helpsGiven, mathHelpsReceived: m.helpsReceived,
      diffHelpsGiven: d.helpsGiven, diffHelpsReceived: d.helpsReceived,
      linkHelpsGiven: l.helpsGiven, linkHelpsReceived: l.helpsReceived,
      totalHelpsGiven: m.helpsGiven + d.helpsGiven + l.helpsGiven,
      totalHelpsReceived: m.helpsReceived + d.helpsReceived + l.helpsReceived,
      // Full roster (including each simulated teammate's/opponent's id and
      // label), so an embedding page can reuse the exact same persona
      // labels the participant just saw — e.g. for a post-task allocation
      // task that references "Participant 4", "Participant 7", etc.
      roster: S.roster.map((p) => ({ id: p.id, label: p.label, groupLabel: p.groupLabel, isReal: !!p.isReal })),
    };
  }

  function renderResults() {
    const payload = resultPayload();
    const outcomeLabel = { win: 'Ahead', lose: 'Behind', tie: 'Tied' };
    app.innerHTML = `
      <div class="card center">
        <h1>All Three Tasks Complete!</h1>
        <p class="lead">Task 1 (Calculation): You answered ${payload.mathOwnCorrect} correctly. Your team ${payload.mathTeamTotal} : Other team ${payload.mathOtherTeamTotal} (${outcomeLabel[payload.mathOutcome]})</p>
        <p class="lead">Task 2 (Spot the Difference): You completed ${payload.diffPairsCompleted} pair(s). Your team ${payload.diffTeamTotal} : Other team ${payload.diffOtherTeamTotal} (${outcomeLabel[payload.diffOutcome]})</p>
        <p class="lead">Task 3 (Match Pairs): You cleared ${payload.linkBoardsCompleted} round(s). Your team ${payload.linkTeamTotal} : Other team ${payload.linkOtherTeamTotal} (${outcomeLabel[payload.linkOutcome]}, includes speed bonus)</p>
        ${CONFIG.helpEnabled ? `<p class="lead">Mutual help: you helped teammates ${payload.totalHelpsGiven} time(s), and received ${payload.totalHelpsReceived} hint(s) from teammates.</p>` : ''}
        <div id="continue-slot" class="mt"></div>
      </div>`;

    const slot = document.getElementById('continue-slot');
    if (CONFIG.returnUrl) {
      const btn = document.createElement('button');
      btn.style.width = '100%';
      btn.textContent = 'Continue (Return to Survey)';
      btn.addEventListener('click', () => {
        const url = new URL(CONFIG.returnUrl);
        // Qualtrics Embedded Data fields are flat text, so only hand off
        // primitive values this way; structured fields like `roster` are
        // still delivered in full via postMessage (reportCompletion) for
        // embeds that read it directly, e.g. the full-flow study's
        // Allocation Task re-using the exact same roster.
        Object.entries(payload).forEach(([k, v]) => {
          if (v !== null && typeof v === 'object') return;
          url.searchParams.set('sit_' + k, v);
        });
        location.href = url.toString();
      });
      slot.appendChild(btn);
    } else {
      const notice = document.createElement('div');
      notice.className = 'notice';
      notice.innerHTML = 'No returnUrl is configured for this page. If this page is embedded via an iframe in Qualtrics, the results have already been sent automatically via postMessage — no further action is needed.';
      slot.appendChild(notice);
    }
  }

  function reportCompletion() {
    const payload = resultPayload();
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'sit_task_complete', payload }, CONFIG.targetOrigin);
      }
    } catch (e) { /* cross-origin parent access errors are expected/harmless here */ }
  }

  if (CONFIG.autostart) {
    startMathTask();
  } else {
    render();
  }
})();
