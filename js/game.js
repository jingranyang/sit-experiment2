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
  //   contest        Experiment 3 only. 'group' | 'individual' turns the
  //                  three tasks into a zero-sum tug-of-war contest (see the
  //                  CONTEST section below). Omit for Experiment 2 — the
  //                  page then behaves exactly as before.
  //   outcome        Experiment 3 only: 'win' | 'lose' — the contest result
  //                  the participant will experience (randomized upstream).
  //   selfLabel / oppLabel  Experiment 3 individual arm only: the
  //                  participant's and the opponent's "Participant N"
  //                  labels, so they match the outer study's roster.
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
    contest: ['group', 'individual'].includes(qs.get('contest')) ? qs.get('contest') : null,
    contestOutcome: qs.get('outcome') === 'win' ? 'win' : 'lose',
    selfLabel: clampInt(qs.get('selfLabel'), 0, 0, 999),
    oppLabel: clampInt(qs.get('oppLabel'), 0, 0, 999),
  };
  // Experiment 3 individual arm: one-on-one, no teammates, no help, no chat.
  if (CONFIG.contest === 'individual') {
    CONFIG.inGroupCount = 0;
    CONFIG.outGroupCount = 1;
    CONFIG.helpEnabled = false;
  }
  // In a contest the opposing side is driven by the contest script, not by
  // the probabilistic bias; own-side teammates play at a neutral pace.
  if (CONFIG.contest) CONFIG.bias = 'tie';

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
    if (CONFIG.contest === 'individual' && CONFIG.selfLabel && CONFIG.oppLabel) {
      roster.forEach((p) => { p.label = p.isReal ? CONFIG.selfLabel : CONFIG.oppLabel; });
      realLabel = CONFIG.selfLabel;
    }
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
    if (CONTEST) setTimeout(() => { if (S.phase === taskKey) CONTEST.botSay(bot, 'm5'); }, randInt(1200, 2400));
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
      if (CONTEST) CONTEST.botSay(helper, 'm4');
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


  // =======================================================================
  // CONTEST (Experiment 3): a zero-sum tug-of-war layered on top of the
  // exact same three tasks. Each side's pull = its correct answers in
  // Task 1 + completed picture pairs in Task 2 + cleared boards in Task 3,
  // each weighted (PULL_WEIGHT) so one unit of work in each task moves the
  // rope a comparable amount. One rope spans all three tasks; whoever has
  // pulled it to their side at the end of Task 3 wins the whole reward.
  //
  // The opposing side's score is generated relative to the participant's
  // own side, following a fixed lead-change script (identical for every
  // participant, only the final stretch differs by assigned outcome), so
  // the lead swings back and forth and ends in a close win or close loss.
  // =======================================================================
  const PULL_WEIGHT = { math: 1, diff: 4, link: 6 };
  const CONTEST_SCRIPT = [
    { until: 0.12, lead: 0.5 },   // neck and neck
    { until: 0.32, lead: 2.0 },   // opponent pulls ahead
    { until: 0.52, lead: -2.0 },  // participant's side takes the lead
    { until: 0.72, lead: 2.2 },   // opponent comes back
    { until: 0.86, lead: -0.6 },  // participant's side edges back in front
  ];
  const CONTEST_FINAL_LEAD = { lose: 1.6, win: -1.6 };
  // The five preset messages. Participants can only send these (no free
  // text); simulated teammates only ever send these. All are in-group
  // encouragement / thanks — none mentions or disparages the other team.
  const PRESET_MESSAGES = [
    { id: 'm1', text: "Let's go, team! We can do this together!" },
    { id: 'm2', text: "Don't give up — we can catch up!" },
    { id: 'm3', text: 'Great job, keep it up!' },
    { id: 'm4', text: 'I just helped you — keep going!' },
    { id: 'm5', text: 'Thanks for the help!' },
  ];
  const PRESET_TEXT = Object.fromEntries(PRESET_MESSAGES.map((m) => [m.id, m.text]));
  const PRESET_REPLY = { m1: 'm3', m2: 'm1', m3: 'm5', m4: 'm5', m5: 'm3' };
  // Teammate chat at fixed points of the contest, timed to the script so
  // "catch up" only appears while behind and "keep it up" while ahead.
  const TEAM_CHAT_SCHEDULE = [
    { at: 0.04, msg: 'm1' }, { at: 0.24, msg: 'm2' }, { at: 0.44, msg: 'm3' },
    { at: 0.64, msg: 'm2' }, { at: 0.80, msg: 'm3' }, { at: 0.92, msg: 'm1' },
  ];

  const CONTEST = CONFIG.contest ? (function () {
    const isGroup = CONFIG.contest === 'group';
    const other = S.group === 'A' ? 'B' : 'A';
    const ownSize = S.roster.filter((p) => p.groupLabel === S.group).length;
    const oppMembers = S.roster.filter((p) => p.groupLabel === other);
    const oppSize = Math.max(1, oppMembers.length);
    const durations = { math: CONFIG.durationSec, diff: CONFIG.diffDurationSec, link: CONFIG.linkDurationSec };
    const totalMs = (durations.math + durations.diff + durations.link) * 1000;
    const before = { math: 0, diff: durations.math * 1000, link: (durations.math + durations.diff) * 1000 };
    const unit = Math.max(2, Math.round(ownSize * 1.2)); // one "lead unit", in pull points
    const oppBaseRate = Math.max(0.9, oppSize * 0.5);     // max opposing pull per second
    const C = {
      mode: CONFIG.contest,
      assignedOutcome: CONFIG.contestOutcome,
      ownUnits: { math: 0, diff: 0, link: 0 },
      oppUnits: { math: 0, diff: 0, link: 0 },
      credit: 0,
      leadChanges: 0, lastLeader: null,
      trajectory: [], lastSampleSec: -1,
      chat: [], chatSentCounts: Object.fromEntries(PRESET_MESSAGES.map((m) => [m.id, 0])), chatIdx: 0,
      realizedOutcome: null,
    };
    const ownName = isGroup ? `Group ${S.group} (your team)` : 'You';
    const oppName = isGroup ? `Group ${other}` : `Participant ${oppMembers[0] ? oppMembers[0].label : '?'}`;

    function pull(units) { return units.math * PULL_WEIGHT.math + units.diff * PULL_WEIGHT.diff + units.link * PULL_WEIGHT.link; }
    function ownPull() { return pull(C.ownUnits); }
    function oppPull() { return pull(C.oppUnits); }
    function scriptedLead(p) {
      for (const seg of CONTEST_SCRIPT) if (p < seg.until) return seg.lead;
      return CONTEST_FINAL_LEAD[C.assignedOutcome];
    }

    // Called on every scoreboard refresh for the current task. Updates the
    // opposing side (only when dtSec > 0, i.e. on the timed tick), then
    // overwrites the opposing team's scoreboard entries with it.
    function update(taskKey, t, elapsedMs, dtSec) {
      C.ownUnits[taskKey] = t.totals[S.group] || 0;
      const globalMs = before[taskKey] + elapsedMs;
      if (dtSec > 0) {
        const p = Math.min(1, globalMs / totalMs);
        const own = ownPull();
        const target = own + scriptedLead(p) * unit;
        const ownRate = globalMs > 5000 ? own / (globalMs / 1000) : 0;
        const rate = Math.max(oppBaseRate, ownRate * 2);
        const w = PULL_WEIGHT[taskKey];
        if (target > oppPull() + w / 2) {
          C.credit += (rate * dtSec * randFloat(0.6, 1.4)) / w;
          while (C.credit >= 1 && oppPull() + w / 2 < target) { C.oppUnits[taskKey]++; C.credit -= 1; }
        } else {
          C.credit = 0;
        }
        if (isGroup && C.chatIdx < TEAM_CHAT_SCHEDULE.length && p >= TEAM_CHAT_SCHEDULE[C.chatIdx].at) {
          botSay(null, TEAM_CHAT_SCHEDULE[C.chatIdx].msg);
          C.chatIdx++;
        }
        const sec = Math.floor(globalMs / 1000);
        if (sec !== C.lastSampleSec) { C.lastSampleSec = sec; C.trajectory.push({ t: sec, task: taskKey, own: ownPull(), opp: oppPull() }); }
      }
      overrideOpposingScoreboard(taskKey, t);
      const diff = ownPull() - oppPull();
      const leader = diff > 0 ? 'own' : diff < 0 ? 'opp' : null;
      if (leader && C.lastLeader && leader !== C.lastLeader) C.leadChanges++;
      if (leader) C.lastLeader = leader;
      updateRopeDom();
    }

    function overrideOpposingScoreboard(taskKey, t) {
      const n = C.oppUnits[taskKey];
      t.totals[other] = n;
      const list = (t.teams[other] || []).slice().sort((a, b) => a.label - b.label);
      const base = Math.floor(n / Math.max(1, list.length));
      let rem = n - base * list.length;
      list.forEach((m) => { m.correctCount = base + (rem > 0 ? 1 : 0); rem--; });
    }

    // At the end of Task 3: make sure the assigned outcome holds at the
    // buzzer. A loss can always be forced; a win can't be if the opposing
    // side already passed a participant's side that stopped playing — that
    // rare case is flagged via outcomeManipulationOk = false.
    function finalize() {
      if (C.assignedOutcome === 'lose' && oppPull() <= ownPull()) {
        while (oppPull() <= ownPull() + unit / 2) C.oppUnits.link++;
      }
      const d = ownPull() - oppPull();
      C.realizedOutcome = d > 0 ? 'win' : d < 0 ? 'lose' : 'tie';
    }

    function ropeCardHtml() {
      return `<div class="card contest-top">
          <div class="tug">
            <div class="tug-labels"><span class="tug-own">${esc(ownName)}</span><span class="tug-opp">${esc(oppName)}</span></div>
            <div class="tug-track">
              <div class="tug-zone own"></div><div class="tug-zone opp"></div>
              <div class="tug-center"></div><div class="tug-rope"></div>
              <div class="tug-knot" id="tug-knot"></div>
            </div>
            <div class="tug-scores">
              <span class="tug-score own" id="pull-own">0</span>
              <span class="tug-status" id="tug-status">Tied</span>
              <span class="tug-score opp" id="pull-opp">0</span>
            </div>
          </div>
        </div>`;
    }
    function updateRopeDom() {
      const own = ownPull(), opp = oppPull(), diff = own - opp;
      const o = document.getElementById('pull-own'), q = document.getElementById('pull-opp');
      if (o) o.textContent = String(own);
      if (q) q.textContent = String(opp);
      const st = document.getElementById('tug-status');
      if (st) {
        const who = isGroup ? 'Your team is' : 'You are';
        st.textContent = diff > 0 ? `${who} ahead by ${diff}` : diff < 0 ? `${who} behind by ${-diff}` : 'Tied';
        st.className = 'tug-status ' + (diff > 0 ? 'ahead' : diff < 0 ? 'behind' : '');
      }
      const knot = document.getElementById('tug-knot');
      if (knot) knot.style.left = `${50 + Math.max(-1, Math.min(1, -diff / (unit * 3))) * 42}%`;
    }

    function chatCardHtml() {
      if (!isGroup) return '';
      return `<div class="card chat-card">
          <h2>Team Chat</h2>
          <div class="chat-feed" id="chat-feed"></div>
          <div class="chat-presets">${PRESET_MESSAGES.map((m) => `<button type="button" class="chat-preset-btn" data-msg="${m.id}">${esc(m.text)}</button>`).join('')}</div>
          <p class="muted" style="font-size:0.78rem; margin:8px 0 0;">Tap a message to send it to your team.</p>
        </div>`;
    }
    function renderChatFeed() {
      const el = document.getElementById('chat-feed');
      if (!el) return;
      el.innerHTML = C.chat.length
        ? C.chat.map((m) => `<div class="chat-msg ${m.sender === 'self' ? 'me' : ''}"><span class="chat-who">Participant ${esc(m.senderLabel)}${m.sender === 'self' ? ' (you)' : ''}</span><span class="chat-text">${esc(m.text)}</span></div>`).join('')
        : '<div class="muted" style="font-size:0.85rem;">No messages yet.</div>';
      el.scrollTop = el.scrollHeight;
    }
    function post(sender, msgId) {
      C.chat.push({ phase: S.phase, sender: sender.isReal ? 'self' : sender.id, senderLabel: sender.label, msgId, text: PRESET_TEXT[msgId] });
      renderChatFeed();
    }
    function botSay(bot, msgId) {
      if (!isGroup) return;
      const mates = ingroupBots();
      if (!mates.length) return;
      post(bot || mates[randInt(0, mates.length - 1)], msgId);
    }
    function selfSend(msgId) {
      if (!isGroup || !['math', 'diff', 'link'].includes(S.phase)) return;
      C.chatSentCounts[msgId]++;
      post(S.roster.find((p) => p.isReal), msgId);
      const phaseAtSend = S.phase;
      setTimeout(() => { if (S.phase === phaseAtSend) botSay(null, PRESET_REPLY[msgId]); }, randInt(1500, 3000));
    }
    function attachChat() {
      document.querySelectorAll('.chat-preset-btn').forEach((b) => b.addEventListener('click', () => selfSend(b.dataset.msg)));
      renderChatFeed();
    }

    function summary() {
      return {
        mode: C.mode,
        assignedOutcome: C.assignedOutcome,
        realizedOutcome: C.realizedOutcome,
        outcomeManipulationOk: C.realizedOutcome === C.assignedOutcome,
        pullWeights: PULL_WEIGHT,
        finalPullOwnSide: ownPull(),
        finalPullOpposingSide: oppPull(),
        ownSideUnits: C.ownUnits,
        opposingSideUnits: C.oppUnits,
        leadChanges: C.leadChanges,
        trajectory: C.trajectory,
        chat: isGroup ? { log: C.chat, selfSentTotal: Object.values(C.chatSentCounts).reduce((a, b) => a + b, 0), selfSentByMessage: C.chatSentCounts } : null,
      };
    }

    return { isGroup, other, ownName, oppName, state: C, update, finalize, ropeCardHtml, updateRopeDom, chatCardHtml, attachChat, botSay, summary, ownPull, oppPull };
  })() : null;

  if (CONFIG.debug) window.__sitDebug = { get state() { return S; }, CONFIG, giveHelp, triggerHelpReceive, contest: CONTEST };

  function render() {
    if (CONTEST) return renderContest();
    if (S.phase === 'intro') return renderIntro();
    if (S.phase === 'math') return renderMathPlaying();
    if (S.phase === 'math_done') return renderMathDone();
    if (S.phase === 'diff') return renderDiffPlaying();
    if (S.phase === 'diff_done') return renderDiffDone();
    if (S.phase === 'link') return renderLinkPlaying();
    if (S.phase === 'results') return renderResults();
  }


  // Contest-mode screens: same three task screens, with the rope pinned on
  // top (and the team chat below, group arm only); contest-specific intro,
  // between-task and results screens.
  function renderContest() {
    if (S.phase === 'intro') return renderContestIntro();
    if (S.phase === 'math_done') return renderContestBetween(1, 'Task 2: Spot the Difference', 'find all the differences between two pictures', startDiffTask);
    if (S.phase === 'diff_done') return renderContestBetween(2, 'Task 3: Match Pairs', 'click two matching tiles that can be connected by a path with at most two turns; clearing a whole board counts as one round', startLinkTask);
    if (S.phase === 'results') return renderContestResults();
    if (S.phase === 'math') renderMathPlaying();
    else if (S.phase === 'diff') renderDiffPlaying();
    else if (S.phase === 'link') renderLinkPlaying();
    app.insertAdjacentHTML('afterbegin', CONTEST.ropeCardHtml());
    if (CONTEST.isGroup) {
      const scoreCard = document.getElementById('scoreboard-slot');
      (scoreCard ? scoreCard.closest('.card') : app.lastElementChild).insertAdjacentHTML('afterend', CONTEST.chatCardHtml());
      CONTEST.attachChat();
    }
    CONTEST.updateRopeDom();
  }

  function renderContestIntro() {
    const g = CONTEST.isGroup;
    const opp = S.roster.find((p) => p.groupLabel === CONTEST.other);
    app.innerHTML = `
      <div class="card">
        <h1>Tug-of-War Contest</h1>
        ${g
          ? `<p>You have been assigned to <span class="badge ${S.group === 'A' ? 'a' : 'b'}">Group ${esc(S.group)}</span>. Your team will compete against Group ${esc(CONTEST.other)}.</p>`
          : `<p>You will compete one-on-one against another participant (Participant ${esc(opp ? opp.label : '?')}).</p>`}
        <p>The contest has three rounds: a calculation challenge, then "Spot the Difference", then "Match Pairs". Every problem ${g ? 'your team solves' : 'you solve'} pulls the rope toward ${g ? 'your team' : 'you'}; every problem the other side solves pulls it the other way. You can watch the rope and both sides' scores at all times.</p>
        <p><strong>${g ? 'The team that has pulled the rope to its side at the end of Round 3 wins. Every member of the winning team receives a bonus reward; members of the losing team receive nothing.' : 'Whoever has pulled the rope to their side at the end of Round 3 wins. The winner receives a bonus reward; the loser receives nothing.'}</strong></p>
        ${g ? `<p><strong>Helping your team:</strong> every ${CONFIG.helpThreshold} problems you complete earn you a chance to help a teammate of your choice, and teammates can help you too. You can also send messages to your team with the message buttons.</p>` : ''}
        <p class="muted">There is no cooperation between the two sides: any point one side gains is a point the other side has to make up.</p>
      </div>
      ${g ? `<div class="card"><h2>Team Roster</h2>${renderRosterColumns()}</div>` : ''}
      <div class="card"><button id="start-btn" style="width:100%;">Start Round 1: Calculation</button></div>`;
    document.getElementById('start-btn').addEventListener('click', startMathTask);
  }

  function renderContestBetween(doneNum, nextName, nextDesc, startFn) {
    app.innerHTML = `
      <div class="card center">
        <h1>Round ${doneNum} Complete</h1>
        <p class="lead">The contest continues. Next is ${esc(nextName)} — ${esc(nextDesc)}. The rope carries over from where it is now.</p>
        <button id="next-round-btn" class="mt" style="width:100%;">Start ${esc(nextName)}</button>
      </div>`;
    app.insertAdjacentHTML('afterbegin', CONTEST.ropeCardHtml());
    CONTEST.updateRopeDom();
    document.getElementById('next-round-btn').addEventListener('click', startFn);
  }

  function renderContestResults() {
    const g = CONTEST.isGroup;
    const won = CONTEST.state.realizedOutcome === 'win';
    const headline = g ? (won ? 'Your team won!' : 'Your team lost.') : (won ? 'You won!' : 'You lost.');
    const reward = g
      ? (won ? 'Every member of your team receives the bonus reward.' : `Group ${esc(CONTEST.other)} receives the bonus reward. Your team receives nothing.`)
      : (won ? 'You receive the bonus reward.' : `${esc(CONTEST.oppName)} receives the bonus reward. You receive nothing.`);
    app.innerHTML = `
      <div class="card center">
        <h1>${headline}</h1>
        <div class="final-score"><span class="tug-own">${esc(CONTEST.ownName)}: <strong>${CONTEST.ownPull()}</strong></span> &nbsp;vs&nbsp; <span class="tug-opp">${esc(CONTEST.oppName)}: <strong>${CONTEST.oppPull()}</strong></span></div>
        <p class="lead mt">${reward}</p>
        <button id="contest-continue-btn" class="mt" style="width:100%;">Continue</button>
      </div>`;
    app.insertAdjacentHTML('afterbegin', CONTEST.ropeCardHtml());
    CONTEST.updateRopeDom();
    document.getElementById('contest-continue-btn').addEventListener('click', () => {
      reportCompletion();
      app.innerHTML = '<div class="card center"><p class="muted">Loading the next part…</p></div>';
    });
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
      if (CONTEST) CONTEST.update('math', m, elapsedMs, 0.4);
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
    if (CONTEST) CONTEST.update('math', m, elapsedMs, 0);
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
          <h3>${CONTEST && !CONTEST.isGroup ? (team === S.group ? 'You' : 'Your opponent') : `Group ${team}${team === S.group ? ' (your team)' : ''}`}</h3>
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
      if (CONTEST) CONTEST.update('diff', d, elapsedMs, 0.4);
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
    if (CONTEST) CONTEST.update('diff', d, elapsedMs, 0);
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
      if (CONTEST) CONTEST.update('link', l, elapsedMs, 0.4);
      updateLinkScoreboardDom();
      updateLinkTimerDom();
      if (Date.now() >= l.endAt) {
        clearInterval(linkTickHandle);
        if (l.helpReceiveHandle) clearTimeout(l.helpReceiveHandle);
        S.phase = 'results';
        if (CONTEST) CONTEST.finalize();
        render();
        if (!CONTEST) reportCompletion(); // contest: reported when the participant clicks Continue
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
    if (CONTEST) CONTEST.update('link', l, elapsedMs, 0);
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

    let overallOwnTeamTotal = Math.round((mathTeamTotal + diffTeamTotal + linkTeamTotal) * 10) / 10;
    let overallOtherTeamTotal = Math.round((mathOtherTotal + diffOtherTotal + linkOtherTotal) * 10) / 10;
    let overallOutcome = 'tie';
    if (overallOwnTeamTotal !== overallOtherTeamTotal) overallOutcome = overallOwnTeamTotal > overallOtherTeamTotal ? 'win' : 'lose';
    // Contest: the winner is decided by the rope (weighted pull), and Task 3
    // is scored by boards cleared (no speed bonus), consistent with the rope.
    if (CONTEST) {
      overallOwnTeamTotal = CONTEST.ownPull();
      overallOtherTeamTotal = CONTEST.oppPull();
      overallOutcome = CONTEST.state.realizedOutcome;
    }

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
      linkTeamTotal: CONTEST ? CONTEST.state.ownUnits.link : linkTeamTotal,
      linkOtherTeamTotal: CONTEST ? CONTEST.state.oppUnits.link : linkOtherTotal,
      linkOutcome: CONTEST ? outcomeFor({ [S.group]: CONTEST.state.ownUnits.link, [CONTEST.other]: CONTEST.state.oppUnits.link }, S.group) : linkOutcome,
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
      contest: CONTEST ? CONTEST.summary() : null,
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
