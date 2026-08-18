// Generates the fake in-group/out-group roster and their simulated performance
// schedules for the cooperative math task. The real participant is randomly
// assigned to Group A or B; the computer plays the role of every other
// "participant" (teammates and opposing team) so a single real person can
// complete the study without waiting for anyone else.
const crypto = require('crypto');

function randFloat(min, max) {
  return min + Math.random() * (max - min);
}

// Build the full roster (real participant + simulated others) with randomized
// label numbers, mirroring the interleaved numbering used in the paper's
// example (e.g. Group B: 1,4,5,6,7 / Group A: 2,3,8,9,10).
function buildRoster(study) {
  const realGroup = crypto.randomInt(0, 2) === 0 ? 'A' : 'B';
  const otherGroup = realGroup === 'A' ? 'B' : 'A';

  const slots = [];
  slots.push({ isReal: true, groupLabel: realGroup });
  for (let i = 0; i < study.fake_ingroup_count; i++) {
    slots.push({ isReal: false, groupLabel: realGroup, botId: `bot_${crypto.randomBytes(4).toString('hex')}` });
  }
  for (let i = 0; i < study.fake_outgroup_count; i++) {
    slots.push({ isReal: false, groupLabel: otherGroup, botId: `bot_${crypto.randomBytes(4).toString('hex')}` });
  }

  // Shuffle to interleave label order between groups (Fisher-Yates).
  for (let i = slots.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }

  let realLabel = null;
  const roster = slots.map((slot, idx) => {
    const label = idx + 1;
    if (slot.isReal) {
      realLabel = label;
      return { id: 'self', label, groupLabel: slot.groupLabel, isReal: true };
    }
    return { id: slot.botId, label, groupLabel: slot.groupLabel, isReal: false };
  });

  return { roster, realGroup, realLabel };
}

const DIFFICULTY_BASE_INTERVAL_SEC = { easy: 4.5, medium: 6, hard: 8.5 };

// Given the study config and the already-assigned roster, generate a timed
// schedule of "correct answer" events for every simulated (bot) participant
// across the full game duration. Applied server-side and cached on the run,
// so the scoreboard can be computed deterministically at any later poll —
// robust to refresh, and not tamperable from the client.
function generateBotSchedule(study, roster, realGroupLabel) {
  const baseInterval = DIFFICULTY_BASE_INTERVAL_SEC[study.difficulty] || DIFFICULTY_BASE_INTERVAL_SEC.medium;
  const durationSec = study.math_duration_sec;
  const bias = study.outcome_bias || 'random';

  let ownGroupMult = 1;
  let otherGroupMult = 1;
  if (bias === 'win') { otherGroupMult = 1.25; ownGroupMult = 0.92; }
  else if (bias === 'lose') { otherGroupMult = 0.8; ownGroupMult = 1.08; }
  else if (bias === 'tie') { otherGroupMult = 1; ownGroupMult = 1; }
  // 'random' -> both multipliers stay at 1 (no artificial bias)

  const schedule = {}; // botId -> [eventMs, ...]
  for (const p of roster) {
    if (p.isReal) continue;
    const groupMult = p.groupLabel === realGroupLabel ? ownGroupMult : otherGroupMult;
    const skill = randFloat(0.75, 1.3); // per-persona ability variance
    const jitterTight = bias === 'tie' ? 0.25 : 0.5; // 'tie' has less variance for a closer match
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

// Compute current scoreboard given elapsed ms into the game.
function computeScoreboard(roster, botSchedule, realGroupLabel, realCorrectCount, elapsedMs) {
  const teams = { A: [], B: [] };
  const totals = { A: 0, B: 0 };
  for (const p of roster) {
    let count;
    if (p.isReal) {
      count = realCorrectCount;
    } else {
      const events = botSchedule[p.id] || [];
      count = events.filter((t) => t <= elapsedMs).length;
    }
    teams[p.groupLabel].push({ id: p.id, label: p.label, correctCount: count, isReal: !!p.isReal });
    totals[p.groupLabel] += count;
  }
  teams.A.sort((a, b) => a.label - b.label);
  teams.B.sort((a, b) => a.label - b.label);
  return { teams, totals };
}

module.exports = { buildRoster, generateBotSchedule, computeScoreboard };
