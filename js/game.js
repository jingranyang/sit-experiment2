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
  //   outcome        Experiment 3 only: 'win' | 'lose' — the result of the
  //                  final round (Round 3, winner takes all), randomized
  //                  upstream.
  //   order          Experiment 3 only: 'WL' | 'LW' — Rounds 1-2 are always
  //                  one win and one loss; this sets which comes first
  //                  (counterbalanced upstream).
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
    contestOutcome: qs.get('outcome') === 'win' ? 'win' : 'lose', // final (Round 3) result
    contestOrder: qs.get('order') === 'LW' ? 'LW' : 'WL',          // Rounds 1-2: win-then-lose or lose-then-win
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
    link: Object.assign({ schedule: null, board: null, boardsCompleted: 0, pairsCleared: 0, selected: null, completionTimestamps: [], startAt: null, endAt: null, teams: { A: [], B: [] }, totals: { A: 0, B: 0 }, hintPair: null }, freshHelpState()),
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
    // Contest: Match Pairs is scored per matched pair (finer-grained, so the
    // rope moves with every match); Experiment 2 keeps per-board scoring.
    return CONFIG.contest ? S.link.pairsCleared : S.link.boardsCompleted;
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
  // CONTEST (Experiment 3): the exact same three tasks, played as three
  // rounds of a zero-sum tug-of-war. Each round is its own rope: the side
  // that solves more in that round (correct answers / completed picture
  // pairs / matched tile pairs) wins the round.
  //
  // Points: everyone starts with STARTING_POINTS. In Rounds 1 and 2 each
  // member of the losing side gives ROUND_STAKE points to the winning side.
  // Round 3 is winner-takes-all: the losing side gives ALL its points to
  // the winning side.
  //
  // Outcomes are assigned in advance (randomized upstream): Rounds 1-2 are
  // one win and one loss (order 'WL' or 'LW'), so both sides are tied at
  // STARTING_POINTS going into Round 3, whose result is the randomized
  // `outcome`. Within each round the opposing side's score is generated
  // relative to the participant's side, following a fixed lead-change
  // script identical for every participant, so the lead swings back and
  // forth before the round goes the assigned way.
  // =======================================================================
  const STARTING_POINTS = 10;
  const ROUND_STAKE = 5;
  const ROUND_TASKS = ['math', 'diff', 'link'];
  const ROUND_NAMES = { math: 'Calculation', diff: 'Spot the Difference', link: 'Match Pairs' };
  // Per-round lead script, in "lead units" (positive = opponent ahead), as
  // a function of the share of the round elapsed. The last 25% depends on
  // the round's assigned outcome: in a win the opposing side stops gaining,
  // in a loss it pulls away.
  const ROUND_SCRIPT = [
    { until: 0.15, lead: 0.5 },   // neck and neck
    { until: 0.40, lead: 1.5 },   // opponent pulls ahead
    { until: 0.62, lead: -1.5 },  // participant's side takes the lead
    { until: 0.75, lead: 0.5 },   // opponent claws back — close again
  ];
  const ROUND_FINAL_LEAD = { lose: 1.5, win: -99 };
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
  // Reaction presets for the team chat on each end-of-round screen, chosen
  // by the round's result. Same rules as above: participant can only pick
  // these, teammates only ever say these, and none mentions the other team.
  const REACTION_PRESETS = {
    win: [
      { id: 'w1', text: 'We did it! 🎉' },
      { id: 'w2', text: 'Great teamwork, everyone!' },
      { id: 'w3', text: 'That was close — but we made it!' },
      { id: 'w4', text: 'Thanks for the help, team!' },
      { id: 'w5', text: "Let's keep it up next round!" },
    ],
    lose: [
      { id: 'l1', text: 'Oh no, we lost this one. 😞' },
      { id: 'l2', text: 'Ugh, that was so close!' },
      { id: 'l3', text: 'That hurts…' },
      { id: 'l4', text: "Don't worry, team — we'll do better next round!" },
      { id: 'l5', text: "Let's stick together." },
    ],
    winFinal: [
      { id: 'fw1', text: 'We did it! 🎉' },
      { id: 'fw2', text: 'Great teamwork, everyone!' },
      { id: 'fw3', text: 'That was close — but we made it!' },
      { id: 'fw4', text: 'Thanks for the help, team!' },
      { id: 'fw5', text: 'We won it all!' },
    ],
    loseFinal: [
      { id: 'fl1', text: 'Oh no, we lost everything. 😞' },
      { id: 'fl2', text: 'Ugh, that was so close!' },
      { id: 'fl3', text: 'That hurts…' },
      { id: 'fl4', text: 'We tried our best, team.' },
      { id: 'fl5', text: 'Thanks for playing together, everyone.' },
    ],
  };
  // Teammates' scripted reactions on the end-of-round screen: which preset
  // (by index in the set) and when (ms after the screen opens).
  const REACTION_SCHEDULE = [{ atMs: 1400, idx: 0 }, { atMs: 3600, idx: 1 }, { atMs: 6500, idx: 3 }];
  const ALL_PRESETS = PRESET_MESSAGES.concat(...Object.values(REACTION_PRESETS));
  const PRESET_TEXT = Object.fromEntries(ALL_PRESETS.map((m) => [m.id, m.text]));
  const PRESET_REPLY = { m1: 'm3', m2: 'm1', m3: 'm5', m4: 'm5', m5: 'm3' };
  // Teammate chat at fixed points of each round, timed to the script so
  // "catch up" only appears while behind and "keep it up" while ahead.
  const ROUND_CHAT_SCHEDULE = [{ at: 0.05, msg: 'm1' }, { at: 0.30, msg: 'm2' }, { at: 0.55, msg: 'm3' }];

  const CONTEST = CONFIG.contest ? (function () {
    const isGroup = CONFIG.contest === 'group';
    const other = S.group === 'A' ? 'B' : 'A';
    const ownSize = S.roster.filter((p) => p.groupLabel === S.group).length;
    const oppMembers = S.roster.filter((p) => p.groupLabel === other);
    const oppSize = Math.max(1, oppMembers.length);
    const durations = { math: CONFIG.durationSec, diff: CONFIG.diffDurationSec, link: CONFIG.linkDurationSec };
    const baseInterval = {
      math: MATH_BASE_INTERVAL_SEC[CONFIG.difficulty],
      diff: DIFF_BASE_INTERVAL_SEC[CONFIG.diffDifficulty],
      link: LINK_BASE_INTERVAL_SEC[CONFIG.linkDifficulty] / linkPairsPerBoard(),
    };
    const order = CONFIG.contestOrder === 'LW' ? ['lose', 'win'] : ['win', 'lose'];
    const assigned = { math: order[0], diff: order[1], link: CONFIG.contestOutcome };
    // One lead unit ~ 8% of what one side typically scores in that round.
    const unit = {};
    const oppBaseRate = {}; // max opposing units / second, before pace scaling
    ROUND_TASKS.forEach((k) => {
      const expectedOwn = ownSize * durations[k] / baseInterval[k];
      unit[k] = Math.max(1, Math.round(expectedOwn * 0.08));
      oppBaseRate[k] = Math.max(1 / baseInterval[k], (oppSize / baseInterval[k]) * 1.6);
    });

    const C = {
      mode: CONFIG.contest,
      order: CONFIG.contestOrder,
      assigned,
      ownUnits: { math: 0, diff: 0, link: 0 },
      oppUnits: { math: 0, diff: 0, link: 0 },
      credit: 0,
      currentRound: null,
      leadChanges: { math: 0, diff: 0, link: 0 }, lastLeader: null,
      points: { own: STARTING_POINTS, opp: STARTING_POINTS },
      rounds: [],
      trajectory: [], lastSample: null,
      chat: [], chatSentCounts: Object.fromEntries(ALL_PRESETS.map((m) => [m.id, 0])), chatIdx: 0,
      reactionSet: null,
      realizedOutcome: null,
    };
    const ownName = isGroup ? `Group ${S.group} (your team)` : 'You';
    const oppName = isGroup ? `Group ${other}` : `Participant ${oppMembers[0] ? oppMembers[0].label : '?'}`;

    function roundNumber(k) { return ROUND_TASKS.indexOf(k) + 1; }
    function scriptedLead(k, p) {
      for (const seg of ROUND_SCRIPT) if (p < seg.until) return seg.lead;
      return ROUND_FINAL_LEAD[assigned[k]];
    }

    // Called on every scoreboard refresh of the current round. Moves the
    // opposing side (only on the timed tick, dtSec > 0), then overwrites the
    // opposing team's scoreboard entries with it.
    function beginRound(k) {
      if (C.currentRound === k) return;
      C.currentRound = k; C.credit = 0; C.chatIdx = 0; C.lastLeader = null;
    }
    function update(k, t, elapsedMs, dtSec) {
      beginRound(k);
      C.ownUnits[k] = t.totals[S.group] || 0;
      if (dtSec > 0) {
        const p = Math.min(1, elapsedMs / (durations[k] * 1000));
        const own = C.ownUnits[k];
        const target = own + scriptedLead(k, p) * unit[k];
        const ownRate = elapsedMs > 5000 ? own / (elapsedMs / 1000) : 0;
        const rate = Math.max(oppBaseRate[k], ownRate * 2);
        if (target > C.oppUnits[k] + 0.5) {
          C.credit += rate * dtSec * randFloat(0.6, 1.4);
          while (C.credit >= 1 && C.oppUnits[k] + 0.5 < target) { C.oppUnits[k]++; C.credit -= 1; }
        } else {
          C.credit = 0;
        }
        if (isGroup && C.chatIdx < ROUND_CHAT_SCHEDULE.length && p >= ROUND_CHAT_SCHEDULE[C.chatIdx].at) {
          botSay(null, ROUND_CHAT_SCHEDULE[C.chatIdx].msg);
          C.chatIdx++;
        }
        const sec = Math.floor(elapsedMs / 1000);
        if (!C.lastSample || C.lastSample.k !== k || C.lastSample.sec !== sec) {
          C.lastSample = { k, sec };
          C.trajectory.push({ round: roundNumber(k), t: sec, own: C.ownUnits[k], opp: C.oppUnits[k] });
        }
      }
      overrideOpposingScoreboard(k, t);
      const diff = C.ownUnits[k] - C.oppUnits[k];
      const leader = diff > 0 ? 'own' : diff < 0 ? 'opp' : null;
      if (leader && C.lastLeader && leader !== C.lastLeader) C.leadChanges[k]++;
      if (leader) C.lastLeader = leader;
      updateRopeDom();
    }

    function overrideOpposingScoreboard(k, t) {
      const n = C.oppUnits[k];
      t.totals[other] = n;
      const list = (t.teams[other] || []).slice().sort((a, b) => a.label - b.label);
      const base = Math.floor(n / Math.max(1, list.length));
      let rem = n - base * list.length;
      list.forEach((m) => { m.correctCount = base + (rem > 0 ? 1 : 0); rem--; });
    }

    // At the end of each round: enforce the assigned result at the buzzer,
    // then transfer points. A loss can always be enforced, and in the group
    // arm so can a win (a teammate scores at the buzzer). In the individual
    // arm a win can't be enforced if the opponent is still ahead of a
    // participant who stopped playing — such a round is recorded as
    // realized 'lose' (or 'tie', with no transfer) and flagged via
    // outcomeManipulationOk.
    function endRound(k, t) {
      if (assigned[k] === 'lose' && C.oppUnits[k] <= C.ownUnits[k]) {
        C.oppUnits[k] = C.ownUnits[k] + unit[k];
        if (t) overrideOpposingScoreboard(k, t);
      }
      // Group arm: an assigned win can always be secured too, by a simulated
      // teammate scoring at the buzzer.
      const mates = ingroupBots();
      if (assigned[k] === 'win' && C.ownUnits[k] <= C.oppUnits[k] && mates.length && t && t.schedule) {
        const need = C.oppUnits[k] - C.ownUnits[k] + 1;
        const bot = mates[randInt(0, mates.length - 1)];
        const atMs = durations[k] * 1000 - 1;
        for (let i = 0; i < need; i++) (t.schedule[bot.id] = t.schedule[bot.id] || []).push(atMs);
        C.ownUnits[k] += need;
        t.totals[S.group] = (t.totals[S.group] || 0) + need;
        const entry = (t.teams[S.group] || []).find((e) => e.id === bot.id);
        if (entry) entry.correctCount += need;
      }
      const d = C.ownUnits[k] - C.oppUnits[k];
      const realized = d > 0 ? 'win' : d < 0 ? 'lose' : 'tie';
      const before = { own: C.points.own, opp: C.points.opp };
      let transfer = 0;
      if (realized !== 'tie') {
        const loserKey = realized === 'win' ? 'opp' : 'own';
        const winnerKey = realized === 'win' ? 'own' : 'opp';
        transfer = k === 'link' ? C.points[loserKey] : Math.min(ROUND_STAKE, C.points[loserKey]);
        C.points[loserKey] -= transfer;
        C.points[winnerKey] += transfer;
      }
      C.rounds.push({
        round: roundNumber(k), task: k,
        assignedOutcome: assigned[k], realizedOutcome: realized,
        ownSideScore: C.ownUnits[k], opposingSideScore: C.oppUnits[k],
        leadChanges: C.leadChanges[k],
        pointsTransferred: transfer,
        pointsBefore: before, pointsAfter: { own: C.points.own, opp: C.points.opp },
      });
      if (k === 'link') C.realizedOutcome = realized;
      updateRopeDom();
    }

    function ropeCardHtml(k) {
      const label = k ? `Round ${roundNumber(k)} of 3 · ${ROUND_NAMES[k]}${k === 'link' ? ' · Winner takes all' : ''}` : '';
      return `<div class="card contest-top">
          <div class="tug">
            ${label ? `<div class="tug-round">${esc(label)}</div>` : ''}
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
            <div class="tug-points" id="tug-points"></div>
          </div>
        </div>`;
    }
    function pointsLine(pts) {
      const p = pts || C.points;
      return isGroup
        ? `Points — each member of your team: <strong>${p.own}</strong> · each member of Group ${esc(other)}: <strong>${p.opp}</strong>`
        : `Points — you: <strong>${p.own}</strong> · ${esc(oppName)}: <strong>${p.opp}</strong>`;
    }
    function updateRopeDom() {
      const k = C.currentRound;
      const own = k ? C.ownUnits[k] : 0, opp = k ? C.oppUnits[k] : 0, diff = own - opp;
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
      if (knot) knot.style.left = `${50 + Math.max(-1, Math.min(1, -diff / ((k ? unit[k] : 1) * 3))) * 42}%`;
      const pts = document.getElementById('tug-points');
      if (pts) pts.innerHTML = pointsLine();
    }

    function chatCardHtml(setKey) {
      if (!isGroup) return '';
      const presets = setKey ? REACTION_PRESETS[setKey] : PRESET_MESSAGES;
      return `<div class="card chat-card">
          <h2>Team Chat</h2>
          <p class="muted chat-sub">${setKey ? 'How does your team feel? Share a reaction with your teammates.' : 'Messages and help from your teammates appear here.'}</p>
          <div class="chat-feed" id="chat-feed"></div>
          <div class="chat-presets">${presets.map((m) => `<button type="button" class="chat-preset-btn" data-msg="${m.id}">${esc(m.text)}</button>`).join('')}</div>
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
      C.chat.push({ round: C.currentRound ? roundNumber(C.currentRound) : null, phase: S.phase, sender: sender.isReal ? 'self' : sender.id, senderLabel: sender.label, msgId, text: PRESET_TEXT[msgId] });
      renderChatFeed();
    }
    function botSay(bot, msgId) {
      if (!isGroup) return;
      const mates = ingroupBots();
      if (!mates.length) return;
      post(bot || mates[randInt(0, mates.length - 1)], msgId);
    }
    function selfSend(msgId) {
      if (!isGroup || !(ROUND_TASKS.includes(S.phase) || C.reactionSet)) return;
      const phaseAtSend = S.phase;
      C.chatSentCounts[msgId]++;
      post(S.roster.find((p) => p.isReal), msgId);
      // During play a teammate answers with the matching preset; on an
      // end-of-round screen with the next reaction in the same set.
      let reply = PRESET_REPLY[msgId];
      if (!reply && C.reactionSet) {
        const set = REACTION_PRESETS[C.reactionSet];
        const said = C.chat.filter((m) => m.phase === phaseAtSend).map((m) => m.msgId);
        let i = (set.findIndex((m) => m.id === msgId) + 1) % set.length;
        for (let k = 0; k < set.length && said.includes(set[i].id); k++) i = (i + 1) % set.length;
        reply = set[i].id;
      }
      setTimeout(() => { if (S.phase === phaseAtSend) botSay(null, reply); }, randInt(1500, 3000));
    }
    // Teammates react on the end-of-round screen on a fixed schedule.
    function startReactions(setKey) {
      C.reactionSet = setKey;
      if (!isGroup) return;
      const phaseAt = S.phase;
      const set = REACTION_PRESETS[setKey];
      // Skip reactions already said on this screen (e.g. the participant
      // just picked the same one), so teammates don't parrot each other.
      const saidHere = () => C.chat.filter((m) => m.phase === phaseAt).map((m) => m.msgId);
      REACTION_SCHEDULE.forEach((r) => setTimeout(() => {
        if (S.phase !== phaseAt) return;
        const said = saidHere();
        let i = r.idx;
        for (let k = 0; k < set.length && said.includes(set[i].id); k++) i = (i + 1) % set.length;
        botSay(null, set[i].id);
      }, r.atMs));
    }
    function stopReactions() { C.reactionSet = null; }
    function attachChat() {
      document.querySelectorAll('.chat-preset-btn').forEach((b) => b.addEventListener('click', () => selfSend(b.dataset.msg)));
      renderChatFeed();
    }

    function summary() {
      return {
        mode: C.mode,
        order: C.order,
        assignedOutcomes: { round1: assigned.math, round2: assigned.diff, round3: assigned.link },
        assignedOutcome: assigned.link,   // final (winner-takes-all) round
        realizedOutcome: C.realizedOutcome,
        outcomeManipulationOk: C.rounds.length === 3 && C.rounds.every((r) => r.realizedOutcome === r.assignedOutcome),
        startingPoints: STARTING_POINTS,
        roundStake: ROUND_STAKE,
        finalPointsOwn: C.points.own,
        finalPointsOpposing: C.points.opp,
        rounds: C.rounds,
        trajectory: C.trajectory,
        chat: isGroup ? { log: C.chat, selfSentTotal: Object.values(C.chatSentCounts).reduce((a, b) => a + b, 0), selfSentByMessage: C.chatSentCounts } : null,
      };
    }

    return { isGroup, other, ownName, oppName, state: C, beginRound, update, endRound, startReactions, stopReactions, playPresets: PRESET_MESSAGES, reactionPresets: REACTION_PRESETS, ropeCardHtml, updateRopeDom, chatCardHtml, attachChat, botSay, summary, pointsLine, roundNumber };
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


  // Contest-mode screens: same three task screens, with the round's rope
  // pinned on top (and the team chat below, group arm only); contest-
  // specific intro, between-round and results screens.
  function renderContest() {
    document.body.classList.toggle('contest-playing', S.phase !== 'intro');
    if (S.phase === 'intro') return renderContestIntro();
    if (S.phase === 'math_done') return renderRoundEnd('math', 'diff', startDiffTask);
    if (S.phase === 'diff_done') return renderRoundEnd('diff', 'link', startLinkTask);
    if (S.phase === 'results') return renderRoundEnd('link', null, null);
    CONTEST.stopReactions();
    if (S.phase === 'math') renderMathPlaying();
    else if (S.phase === 'diff') renderDiffPlaying();
    else if (S.phase === 'link') renderLinkPlaying();
    CONTEST.beginRound(S.phase);
    layoutContestScreen();
    if (CONTEST.isGroup) CONTEST.attachChat();
    CONTEST.updateRopeDom();
  }

  // Fixed, non-scrolling game screen: rope pinned on top; the task in the
  // center; team chat on the left and mutual help + live scoreboard on the
  // right, so the participant sees teammates' encouragement and help out
  // of the corner of their eye while playing. Re-uses the exact task
  // markup rendered by the Experiment 2 task screens, just re-arranged.
  // (Individual arm: no chat/help; the scoreboard sits on the left.)
  function layoutContestScreen() {
    const cards = Array.from(app.children);
    const scoreSlot = document.getElementById('scoreboard-slot');
    const scoreCard = scoreSlot ? scoreSlot.closest('.card') : null;
    const helpCard = document.getElementById('help-panel-' + S.phase);
    const gameCard = cards.find((c) => c !== scoreCard && c !== helpCard) || cards[0];
    if (scoreCard) scoreCard.classList.add('compact-scoreboard');
    app.innerHTML = `
      <div class="contest-layout ${CONTEST.isGroup ? 'group' : 'individual'}">
        <div class="cl-top">${CONTEST.ropeCardHtml(S.phase)}</div>
        <aside class="cl-left" id="cl-left">${CONTEST.isGroup ? CONTEST.chatCardHtml() : ''}</aside>
        <main class="cl-center" id="cl-center"></main>
        <aside class="cl-right" id="cl-right"></aside>
      </div>`;
    document.getElementById('cl-center').appendChild(gameCard);
    const left = document.getElementById('cl-left');
    const right = document.getElementById('cl-right');
    if (CONTEST.isGroup) {
      if (helpCard) right.appendChild(helpCard);
      if (scoreCard) right.appendChild(scoreCard);
    } else if (scoreCard) {
      left.appendChild(scoreCard);
    }
  }

  const ROUND_DESC = {
    math: 'a calculation challenge — solve as many math problems as you can',
    diff: '"Spot the Difference" — find all the differences between two pictures',
    link: '"Match Pairs" — click two matching tiles that can be connected by a path with at most two turns; every pair you match pulls the rope',
  };

  function renderContestIntro() {
    const g = CONTEST.isGroup;
    const opp = S.roster.find((p) => p.groupLabel === CONTEST.other);
    const side = g ? 'team' : 'side';
    app.innerHTML = `
      <div class="card">
        <h1>Tug-of-War Contest</h1>
        ${g
          ? `<p>You have been assigned to <span class="badge ${S.group === 'A' ? 'a' : 'b'}">Group ${esc(S.group)}</span>. Your team will compete against Group ${esc(CONTEST.other)}.</p>`
          : `<p>You will compete one-on-one against another participant (Participant ${esc(opp ? opp.label : '?')}).</p>`}
        <p>The contest has <strong>three rounds</strong>, each its own tug-of-war: Round 1 is a calculation challenge, Round 2 is "Spot the Difference", Round 3 is "Match Pairs". Every problem ${g ? 'your team solves' : 'you solve'} pulls the rope toward ${g ? 'your team' : 'you'}; every problem the other side solves pulls it the other way. Whoever has pulled the rope to their side when the round's time runs out wins that round.</p>
        <div class="notice mt">
          <strong>Points.</strong> ${g ? 'Every participant' : 'You and your opponent each'} start with <strong>10 points</strong>.
          <ul class="rules-list">
            <li><strong>Rounds 1 and 2:</strong> ${g ? 'each member of the losing team gives 5 points to the winning team.' : 'the loser gives 5 points to the winner.'}</li>
            <li><strong>Round 3 — winner takes all:</strong> ${g ? 'the losing team gives <em>all</em> of its points to the winning team.' : 'the loser gives <em>all</em> of their points to the winner.'}</li>
          </ul>
        </div>
        ${g ? `<p class="mt"><strong>Helping your team:</strong> every ${CONFIG.helpThreshold} problems you complete earn you a chance to help a teammate of your choice, and teammates can help you too. You can also send messages to your team with the message buttons.</p>` : ''}
        <p class="muted mt">There is no cooperation between the two ${side}s: any point one ${side} gains is a point the other ${side} loses.</p>
      </div>
      ${g ? `<div class="card"><h2>Team Roster</h2>${renderRosterColumns()}</div>` : ''}
      <div class="card"><button id="start-btn" style="width:100%;">Start Round 1: Calculation</button></div>`;
    document.getElementById('start-btn').addEventListener('click', startMathTask);
  }

  function roundResultText(r) {
    const g = CONTEST.isGroup;
    if (r.realizedOutcome === 'tie') return 'This round was a tie — no points change hands.';
    const won = r.realizedOutcome === 'win';
    const final = r.task === 'link';
    if (g) {
      return won
        ? (final ? `Your team won the final round and takes all of Group ${esc(CONTEST.other)}'s points.` : `Your team won Round ${r.round}! Each member of Group ${esc(CONTEST.other)} gives ${r.pointsTransferred} points to your team.`)
        : (final ? `Your team lost the final round. Group ${esc(CONTEST.other)} takes all of your team's points.` : `Your team lost Round ${r.round}. Each member of your team gives ${r.pointsTransferred} points to Group ${esc(CONTEST.other)}.`);
    }
    return won
      ? (final ? `You won the final round and take all of ${esc(CONTEST.oppName)}'s points.` : `You won Round ${r.round}! ${esc(CONTEST.oppName)} gives you ${r.pointsTransferred} points.`)
      : (final ? `You lost the final round. ${esc(CONTEST.oppName)} takes all of your points.` : `You lost Round ${r.round}. You give ${r.pointsTransferred} points to ${esc(CONTEST.oppName)}.`);
  }

  // End-of-round screen (after each round, including the final one): same
  // fixed layout as play. Center: the round result and an animation of the
  // points moving from the losing side to the winning side, with both
  // counters ticking down/up. Left: team chat with reaction presets (group
  // arm). Right: the round's final scoreboard.
  function renderRoundEnd(doneKey, nextKey, startFn) {
    const r = CONTEST.state.rounds[CONTEST.state.rounds.length - 1];
    const g = CONTEST.isGroup;
    const final = doneKey === 'link';
    const won = r.realizedOutcome === 'win';
    const tie = r.realizedOutcome === 'tie';
    const headline = tie ? `Round ${r.round}: Tie`
      : final ? (g ? (won ? 'Your team won the contest!' : 'Your team lost the contest.') : (won ? 'You won the contest!' : 'You lost the contest.'))
      : (g ? (won ? `Your team won Round ${r.round}!` : `Your team lost Round ${r.round}`) : (won ? `You won Round ${r.round}!` : `You lost Round ${r.round}`));
    const ownLabel = g ? 'Your team' : 'You';
    const oppLabel = g ? `Group ${CONTEST.other}` : CONTEST.oppName;
    const each = g ? '<div class="pt-each">points per member</div>' : '<div class="pt-each">points</div>';
    const nextHtml = final
      ? `<button id="contest-continue-btn" class="mt" style="width:100%;" disabled>Continue</button>`
      : `<p class="mt next-line">Next: <strong>Round ${r.round + 1}</strong> — ${ROUND_DESC[nextKey]}.${nextKey === 'link' ? ' <strong>This is the final round: winner takes all.</strong> The losing side gives all of its points to the winning side.' : ''}</p>
         <button id="next-round-btn" class="mt" style="width:100%;" disabled>Start Round ${r.round + 1}: ${esc(ROUND_NAMES[nextKey])}</button>`;
    app.innerHTML = `
      <div class="card center round-end-card">
        <h1>${headline}</h1>
        <div class="final-score">Round ${r.round}: <span class="tug-own">${esc(CONTEST.ownName)} <strong>${r.ownSideScore}</strong></span> &nbsp;vs&nbsp; <span class="tug-opp">${esc(CONTEST.oppName)} <strong>${r.opposingSideScore}</strong></span></div>
        <p class="lead mt" style="margin-bottom:6px;">${roundResultText(r)}</p>
        <div class="transfer" id="transfer">
          <div class="pt-box own ${tie ? '' : won ? 'winner' : 'loser'}" id="pt-box-own">
            <div class="pt-name">${esc(ownLabel)}</div>
            <div class="pt-num" id="pt-num-own">${r.pointsBefore.own}</div>${each}
            <div class="pt-delta" id="pt-delta-own"></div>
          </div>
          <div class="pt-arrow">${tie ? '=' : won ? '⟵' : '⟶'}</div>
          <div class="pt-box opp ${tie ? '' : won ? 'loser' : 'winner'}" id="pt-box-opp">
            <div class="pt-name">${esc(oppLabel)}</div>
            <div class="pt-num" id="pt-num-opp">${r.pointsBefore.opp}</div>${each}
            <div class="pt-delta" id="pt-delta-opp"></div>
          </div>
        </div>
        ${nextHtml}
      </div>
      <div class="card compact-scoreboard"><h2>Round ${r.round} Final Score</h2><div id="scoreboard-slot">${renderScoreboardHtml(S[doneKey].teams, S[doneKey].totals)}</div></div>`;
    // Arrange into the fixed three-column layout.
    const [resultCard, scoreCard] = Array.from(app.children);
    const setKey = won ? (final ? 'winFinal' : 'win') : (final ? 'loseFinal' : 'lose');
    app.innerHTML = `
      <div class="contest-layout ${g ? 'group' : 'individual'}">
        <div class="cl-top">${CONTEST.ropeCardHtml(doneKey)}</div>
        <aside class="cl-left" id="cl-left">${g && !tie ? CONTEST.chatCardHtml(setKey) : ''}</aside>
        <main class="cl-center" id="cl-center"></main>
        <aside class="cl-right" id="cl-right"></aside>
      </div>`;
    document.getElementById('cl-center').appendChild(resultCard);
    (g ? document.getElementById('cl-right') : document.getElementById('cl-left')).appendChild(scoreCard);
    CONTEST.state.currentRound = doneKey;
    CONTEST.updateRopeDom();
    const ptsLine = document.getElementById('tug-points');
    if (ptsLine) ptsLine.innerHTML = CONTEST.pointsLine(r.pointsBefore);
    if (g && !tie) { CONTEST.attachChat(); CONTEST.startReactions(setKey); }

    const btn = document.getElementById(final ? 'contest-continue-btn' : 'next-round-btn');
    animatePointsTransfer(r, () => {
      if (ptsLine) ptsLine.innerHTML = CONTEST.pointsLine(r.pointsAfter);
      btn.disabled = false;
    });
    btn.addEventListener('click', () => {
      CONTEST.stopReactions();
      if (final) {
        reportCompletion();
        document.body.classList.remove('contest-playing');
        app.innerHTML = '<div class="card center"><p class="muted">Loading the next part…</p></div>';
      } else {
        startFn();
      }
    });
  }

  // Points fly one at a time from the loser's box to the winner's box; each
  // arrival ticks the loser's counter down and the winner's up. Then the
  // totals moved are shown as −N / +N. Calls done() when finished (also
  // immediately-ish for a tie or reduced-motion users).
  function animatePointsTransfer(r, done) {
    const n = r.pointsTransferred;
    const ownNum = document.getElementById('pt-num-own');
    const oppNum = document.getElementById('pt-num-opp');
    const showDeltas = () => {
      if (!n) return;
      const ownD = r.pointsAfter.own - r.pointsBefore.own;
      const oppD = r.pointsAfter.opp - r.pointsBefore.opp;
      const fmt = (d) => (d > 0 ? `+${d}` : `−${-d}`);
      const od = document.getElementById('pt-delta-own'), pd = document.getElementById('pt-delta-opp');
      if (od) { od.textContent = fmt(ownD); od.className = 'pt-delta show ' + (ownD > 0 ? 'up' : 'down'); }
      if (pd) { pd.textContent = fmt(oppD); pd.className = 'pt-delta show ' + (oppD > 0 ? 'up' : 'down'); }
    };
    const finish = () => {
      ownNum.textContent = r.pointsAfter.own;
      oppNum.textContent = r.pointsAfter.opp;
      showDeltas();
      done();
    };
    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!n || reduced) { setTimeout(finish, n ? 600 : 300); return; }

    const wrap = document.getElementById('transfer');
    const ownWins = r.realizedOutcome === 'win';
    const from = document.getElementById(ownWins ? 'pt-box-opp' : 'pt-box-own');
    const to = document.getElementById(ownWins ? 'pt-box-own' : 'pt-box-opp');
    const fromNum = ownWins ? oppNum : ownNum;
    const toNum = ownWins ? ownNum : oppNum;
    let fromVal = Number(fromNum.textContent), toVal = Number(toNum.textContent);
    const step = n > 6 ? 230 : 380;
    const startDelay = 900; // let the result sink in first
    const center = (el) => {
      const a = el.getBoundingClientRect(), w = wrap.getBoundingClientRect();
      return { x: a.left - w.left + a.width / 2, y: a.top - w.top + a.height / 2 };
    };
    for (let i = 0; i < n; i++) {
      setTimeout(() => {
        const s0 = center(from), s1 = center(to);
        const coin = document.createElement('div');
        coin.className = 'pt-coin';
        coin.textContent = 'P';
        coin.style.left = `${s0.x}px`;
        coin.style.top = `${s0.y}px`;
        wrap.appendChild(coin);
        fromVal--; fromNum.textContent = fromVal;
        from.classList.remove('bump'); void from.offsetWidth; from.classList.add('bump');
        requestAnimationFrame(() => requestAnimationFrame(() => {
          coin.style.transform = `translate(calc(-50% + ${s1.x - s0.x}px), calc(-50% + ${s1.y - s0.y}px)) scale(0.9)`;
        }));
        setTimeout(() => {
          coin.remove();
          toVal++; toNum.textContent = toVal;
          to.classList.remove('bump'); void to.offsetWidth; to.classList.add('bump');
          if (i === n - 1) setTimeout(finish, 350);
        }, 620);
      }, startDelay + i * step);
    }
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
        if (CONTEST) CONTEST.endRound('math', m);
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
    // Contest: own side first in the "own" color (matches the rope).
    if (CONTEST) return `<div class="team-columns">${col(S.group, 'a')}${col(CONTEST.other, 'b')}</div>`;
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
        if (CONTEST) CONTEST.endRound('diff', d);
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
    // Contest: bots score per matched pair (board time / pairs per board).
    const linkInterval = CONFIG.contest ? LINK_BASE_INTERVAL_SEC[CONFIG.linkDifficulty] / linkPairsPerBoard() : LINK_BASE_INTERVAL_SEC[CONFIG.linkDifficulty];
    l.schedule = generatePointSchedule(S.roster, S.group, CONFIG.linkDurationSec, linkInterval, CONFIG.bias);
    l.startAt = Date.now();
    l.endAt = l.startAt + CONFIG.linkDurationSec * 1000;
    l.boardsCompleted = 0;
    l.pairsCleared = 0;
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
      const { teams, totals } = computeScoreboard(S.roster, l.schedule, S.group, taskProgressCount('link'), elapsedMs);
      l.teams = teams; l.totals = totals;
      if (CONTEST) CONTEST.update('link', l, elapsedMs, 0.4);
      updateLinkScoreboardDom();
      updateLinkTimerDom();
      if (Date.now() >= l.endAt) {
        clearInterval(linkTickHandle);
        if (l.helpReceiveHandle) clearTimeout(l.helpReceiveHandle);
        S.phase = 'results';
        if (CONTEST) CONTEST.endRound('link', l);
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

  function linkPairsPerBoard() {
    const cfg = LinkMatch.DIFFICULTY[CONFIG.linkDifficulty] || LinkMatch.DIFFICULTY.medium;
    return (cfg.cols * cfg.rows) / 2;
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
      l.pairsCleared++;
      if (CONFIG.contest) {
        maybeGrantHelpCharge('link');
        refreshHelpPanel('link');
        updateLinkScoreboardDomImmediate();
      }
      if (l.hintPair && (l.hintPair.includes(clearedA) || l.hintPair.includes(clearedB))) {
        l.hintPair = null;
        l.activeHint = null;
        updateLinkHintDom();
      }
      if (remainingCount(l.board) === 0) {
        l.boardsCompleted++;
        l.completionTimestamps.push(Date.now() - l.startAt);
        if (!CONFIG.contest) {
          maybeGrantHelpCharge('link');
          refreshHelpPanel('link');
        }
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
    const { teams, totals } = computeScoreboard(S.roster, l.schedule, S.group, taskProgressCount('link'), elapsedMs);
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
        <p class="center muted mt" style="font-size:0.85rem;">${CONFIG.contest ? `Matched <span id="link-completed">${l.pairsCleared}</span> pair(s)` : `Completed <span id="link-completed">${l.boardsCompleted}</span> round(s)`}</p>
        <div class="hint-text center" id="link-hint">${l.activeHint ? esc(l.activeHint) : ''}</div>
      </div>
      <div class="card">
        <h2>Live Scoreboard (${CONFIG.contest ? 'Pairs Matched' : 'Rounds Completed'})</h2>
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
    if (c) c.textContent = CONFIG.contest ? l.pairsCleared : l.boardsCompleted;
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
    // Contest: overall result = the final (winner-takes-all) round.
    if (CONTEST) overallOutcome = CONTEST.state.realizedOutcome;

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
      linkPairsCleared: l.pairsCleared,
      // Contest: Task 3 is scored by matched pairs (no speed bonus), which
      // is what decided the round.
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
