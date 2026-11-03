// Shared "Common Outcome Measurements" module, used after all three
// experimental conditions converge: an Allocation Task (Question 1), a
// group-identification slider (Question 2), an in-group affect slider
// (Question 3), an out-group affect slider (Question 4), and a set of
// comprehension-check questions whose exact wording depends on whether the
// participant was in an "unlimited resources" condition (Experiment 1 /
// Group Label) or a "fixed 10 coins" condition (Experiment 3 / Conflict
// Moderator). Wording below is taken verbatim from the KU POLS Annual
// Survey Proposal (Jingran Yang, July 2026), sections 5.1/5.2 (Questions
// 1-4) and the per-condition comprehension-check blocks.
window.OutcomeMeasures = (function () {
  'use strict';

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // mode: 'unlimited' (Experiment 1 / Experiment 2) or 'fixed10' (Experiment 3)
  const UNLIMITED_COMPREHENSION = [
    {
      id: 'q5',
      prompt: 'In this task, the number of gold coins is:',
      options: ['Limited', 'Unlimited', 'Uncertain'],
      correct: 'Unlimited',
    },
    {
      id: 'q6',
      prompt: 'In this task, if you allocate more gold coins to a participant:',
      options: [
        'The gold coins other participants receive will decrease',
        'The gold coins other participants receive will not be affected',
        'Cannot determine',
      ],
      correct: 'The gold coins other participants receive will not be affected',
    },
  ];

  const FIXED10_COMPREHENSION = [
    {
      id: 'q5',
      prompt: 'In the current task, what is the total number of gold coins?',
      options: ['Fixed at 10 coins', 'Unlimited', 'Uncertain'],
      correct: 'Fixed at 10 coins',
    },
    {
      id: 'q6',
      prompt: 'In the current task, the total gold coins you allocate to all participants:',
      options: ['Can exceed 10 coins', 'Cannot exceed 10 coins', 'No limit'],
      correct: 'Cannot exceed 10 coins',
    },
    {
      id: 'q7',
      prompt: 'In the current task, when you allocate more gold coins to some participants:',
      options: [
        'Will not affect allocations to others',
        'Will definitely reduce the gold coins you receive',
        'May require reducing gold coins allocated to others',
      ],
      correct: 'May require reducing gold coins allocated to others',
    },
    {
      id: 'q8',
      prompt: 'In the current task, which best describes the relationship between participants?',
      options: [
        "Each person's coins are independent",
        'Since the total is limited, trade-offs between participants may be needed',
        'Your coins depend entirely on what others receive',
      ],
      correct: 'Since the total is limited, trade-offs between participants may be needed',
    },
  ];

  // Extra checks appended in Experiment 3 (tug-of-war contest): the
  // winner-takes-all rule of the final round, and recall of the final
  // round's result (a manipulation check for the randomized outcome).
  function contestComprehension(contest) {
    const outcomeText = contest.outcome === 'win' ? 'Won' : 'Lost';
    return [
      {
        id: 'qc1',
        prompt: 'In the final round of the contest, what happened to the losing side\'s points?',
        options: ['The winning side took all of them', 'The losing side kept them', 'They were shared equally between both sides'],
        correct: 'The winning side took all of them',
      },
      {
        id: 'qc2',
        prompt: contest.mode === 'group' ? 'In the final round of the contest, your team:' : 'In the final round of the contest, you:',
        options: ['Won', 'Lost', 'Not sure'],
        correct: outcomeText,
      },
    ];
  }

  function comprehensionFor(mode, ctx) {
    const base = mode === 'fixed10' ? FIXED10_COMPREHENSION : UNLIMITED_COMPREHENSION;
    return ctx && ctx.contest ? base.concat(contestComprehension(ctx.contest)) : base;
  }

  // Own-group members first (self first within that), then the other
  // group — matches the ordering used in the PDF's Table 3 (treatment
  // group) allocation table.
  function orderedRoster(roster) {
    const self = roster.find((p) => p.isReal);
    if (roster.every((p) => !p.groupLabel)) {
      // Ungrouped roster (Experiment 3 individual-contest arm): self, then
      // the contest opponent, then everyone else.
      const rank = (p) => (p.isReal ? 0 : p.isOpponent ? 1 : 2);
      return roster.slice().sort((a, b) => rank(a) - rank(b) || a.label - b.label);
    }
    const ownGroup = self ? self.groupLabel : null;
    const mine = roster.filter((p) => p.groupLabel === ownGroup).sort((a, b) => (a.isReal ? -1 : b.isReal ? 1 : a.label - b.label));
    const others = roster.filter((p) => p.groupLabel !== ownGroup).sort((a, b) => a.label - b.label);
    return mine.concat(others);
  }

  // The allocation scenario. Experiment 1 shows it on its task-instructions
  // screen (same wording, KU POLS proposal 5.1/5.2); Experiments 2 and 3
  // show it here, right before the allocation, once the games are over.
  // The group assignment is the one made at the start of the study and used
  // throughout the games — nothing is re-randomized here.
  function scenarioText(mode, individual, afterContest) {
    const who = individual ? 'you and the other participants in this study are' : 'you and members of your group are';
    const sep = afterContest ? ' These gold coins are separate from the points in the contest you just played.' : '';
    return mode === 'fixed10'
      ? `During this task, ${who} participating in a community decision-making process. You have discovered 10 gold coins that can be used to support individuals and improve people’s well-being. Because the total number of gold coins is fixed, allocating more gold coins to one participant reduces the number of gold coins available to other participants. Please pay attention, other participants are not informed about the total number of gold coins available.${sep}`
      : `During this task, ${who} participating in a community decision-making process. You have discovered an unlimited supply of gold coins that can be used to support individuals and improve people’s well-being. Please pay attention, other participants are not informed about the total number of gold coins available. Since the number of gold coins is unlimited, how many gold coins you allocate to one participant does not affect how many gold coins other participants receive.${sep}`;
  }

  function renderHtml(mode, ctx) {
    const { roster, group } = ctx;
    const individual = !!ctx.individual;
    const self = roster.find((p) => p.isReal);
    const otherGroup = group === 'A' ? 'B' : 'A';
    const ownCount = roster.filter((p) => p.groupLabel === group).length;
    const otherCount = roster.filter((p) => p.groupLabel === otherGroup).length;
    const rows = orderedRoster(roster);

    const allocIntro = mode === 'fixed10'
      ? 'Now, you will distribute the 10 gold coins. Please note that the total number of gold coins available is fixed — when you allocate more gold coins to some participants, fewer gold coins will be available for other participants. Please follow these rules: for each participant, you can choose one of the following: 0 gold coins, 1 gold coin, 2 gold coins, or Cannot decide. You need to make allocation decisions for each participant separately, and the total number of gold coins allocated cannot exceed 10. Please complete the allocation according to your true preferences.'
      : 'Now, you need to allocate gold coins to all participants, including yourself. Please follow these rules: for each participant, you can allocate between 0 and 2 gold coins (inclusive). You need to make allocation decisions for each participant separately. Please allocate according to your true preferences — there is no right or wrong answer.';

    const optLabels = { '0': '0 gold coins', '1': '1 gold coin', '2': '2 gold coins', cannot: 'Cannot decide' };
    const rowsHtml = rows.map((p) => {
      const name = `Participant ${esc(p.label)}${p.isReal ? ' (you)' : p.isOpponent ? ' (your opponent in the contest)' : ''}`;
      const groupText = `Group ${esc(p.groupLabel)}${p.groupLabel === group ? ' (your group)' : ''}`;
      return `<tr>
        <td>${name}</td>
        ${individual ? '' : `<td>${groupText}</td>`}
        <td class="alloc-options">
          ${['0', '1', '2', 'cannot'].map((o) => `<label class="alloc-opt"><input type="radio" name="alloc-${p.label}" value="${o}" data-alloc-label="${p.label}" /> ${optLabels[o]}</label>`).join('')}
        </td>
      </tr>`;
    }).join('');

    const sliderBlock = (id, prompt, note, leftLabel, rightLabel) => `
      <div class="measure-block">
        <h3>${esc(prompt)}</h3>
        <p class="muted" style="font-size:0.85rem;">${esc(note)}</p>
        <input type="range" min="-50" max="50" value="0" class="affect-slider" id="${id}" data-touched="0" />
        <div class="slider-readout">Your answer: <span id="${id}-value">(move the slider to answer)</span></div>
        <div class="slider-anchors"><span>${esc(leftLabel)} (-50)</span><span>Neutral (0)</span><span>${esc(rightLabel)} (50)</span></div>
      </div>`;

    // One question per page. Each page is a <section class="q-page"> with a
    // data-qid; the pager (study.js) shows one at a time, and validate()
    // (returned by attachListeners) checks the current page before moving on.
    const page = (qid, inner) => `<section class="card q-page hidden" data-qid="${qid}">${inner}</section>`;
    const compPages = comprehensionFor(mode, ctx).map((q, i, arr) => page('comp-' + q.id, `
        <h2>Comprehension Check <span class="muted q-sub">(${i + 1} of ${arr.length})</span></h2>
        <p class="muted">To confirm that you understand the rules of this task, please answer the following question.</p>
        <div class="measure-block">
          <h3>${esc(q.prompt)}</h3>
          <div class="radio-group" data-comp-id="${q.id}">
            ${q.options.map((o) => `<label class="radio-option"><input type="radio" name="comp-${q.id}" value="${esc(o)}" /> ${esc(o)}</label>`).join('')}
          </div>
        </div>`)).join('');

    const allocPage = page('alloc', `
        <h2>Allocation Task</h2>
        ${ctx.showScenario ? `<div class="notice scenario mt" style="margin-bottom:14px;">${esc(scenarioText(mode, individual, !!ctx.contest))}</div>` : ''}
        ${individual
          ? `<p>Your ID: Participant ${esc(self.label)}</p>
        <p class="muted">There are ${roster.length} participants in this task (including yourself). Participant ${esc(ctx.individual.opponentLabel)} was your opponent in the contest.</p>`
          : `<p>Your ID: Participant ${esc(self.label)} &nbsp;·&nbsp; Your assigned group: Group ${esc(group)}</p>
        <p class="muted">There are ${roster.length} participants in this task (including yourself). Your group (Group ${esc(group)}) consists of ${ownCount} member(s) (including yourself), and the other ${otherCount} participant(s) belong to Group ${esc(otherGroup)}.</p>`}
        <p>${esc(allocIntro)}</p>
        <div style="overflow-x:auto;">
        <table class="alloc-table">
          <thead><tr><th>Participant</th>${individual ? '' : '<th>Group</th>'}<th>Allocation</th></tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
        </div>
        ${mode === 'fixed10' ? `<p class="mt" id="alloc-total-line">Total allocated so far: <strong id="alloc-total">0</strong> / 10</p>` : ''}`);

    const sliderPages = individual
      ? page('ingroupAffect', `<h2>Feelings Toward Other Participants</h2>${sliderBlock('ingroupAffect', 'How do you feel toward the other participants in this study (other than your contest opponent)?', 'Please rate based on your true feelings.', 'Very unfavorable', 'Very favorable')}`)
        + page('outgroupAffect', `<h2>Feelings Toward Your Opponent</h2>${sliderBlock('outgroupAffect', `How do you feel toward your opponent in the contest (Participant ${ctx.individual.opponentLabel})?`, 'Please rate based on your true feelings.', 'Very unfavorable', 'Very favorable')}`)
      : page('identification', `<h2>Group Identification</h2>${sliderBlock('identification', `To what extent do you identify with your group (Group ${group})?`, '"Identify" means that you feel you belong to this group and associate yourself with it to some extent. Please rate based on your true feelings.', 'Do not identify at all', 'Very strong identification')}`)
        + page('ingroupAffect', `<h2>In-Group Affect</h2>${sliderBlock('ingroupAffect', `How do you feel toward members of your own group (Group ${group})?`, 'Please rate based on your true feelings.', 'Very unfavorable', 'Very favorable')}`)
        + page('outgroupAffect', `<h2>Out-Group Affect</h2>${sliderBlock('outgroupAffect', `How do you feel toward members of the other group (Group ${otherGroup})?`, 'Please rate based on your true feelings.', 'Very unfavorable', 'Very favorable')}`);

    return allocPage + sliderPages + compPages;
  }

  function attachListeners(mode, ctx, state) {
    const { roster } = ctx;
    const totalEl = document.getElementById('alloc-total');

    function recomputeTotal() {
      let sum = 0;
      roster.forEach((p) => {
        const v = state.allocations[p.label];
        if (v === '0' || v === '1' || v === '2') sum += Number(v);
      });
      if (totalEl) totalEl.textContent = String(sum);
      return sum;
    }

    document.querySelectorAll('.alloc-options input[type="radio"]').forEach((input) => {
      input.addEventListener('change', () => {
        state.allocations[input.dataset.allocLabel] = input.value;
        recomputeTotal();
      });
    });
    recomputeTotal();

    ['identification', 'ingroupAffect', 'outgroupAffect'].forEach((id) => {
      const slider = document.getElementById(id);
      const readout = document.getElementById(id + '-value');
      if (!slider) return;
      slider.addEventListener('input', () => {
        state[id] = Number(slider.value);
        state[id + 'Touched'] = true;
        slider.dataset.touched = '1';
        if (readout) readout.textContent = slider.value;
      });
    });

    document.querySelectorAll('.radio-group').forEach((grp) => {
      const compId = grp.dataset.compId;
      grp.querySelectorAll('input[type="radio"]').forEach((input) => {
        input.addEventListener('change', () => {
          state.comprehension[compId] = input.value;
        });
      });
    });

    // Per-page validation for the pager: returns an error message, or null
    // if the page is complete.
    return function validate(qid) {
      if (qid === 'alloc') {
        const allAllocated = roster.every((p) => state.allocations[p.label] !== undefined);
        if (!allAllocated) return 'Please choose an allocation for every participant.';
        if (mode === 'fixed10' && recomputeTotal() > 10) return 'The total number of gold coins allocated cannot exceed 10.';
        return null;
      }
      if (qid === 'identification' || qid === 'ingroupAffect' || qid === 'outgroupAffect') {
        return state[qid + 'Touched'] ? null : 'Please move the slider to record your answer. (If your answer is neutral, move it and set it back to 0.)';
      }
      if (qid.startsWith('comp-')) {
        return state.comprehension[qid.slice(5)] !== undefined ? null : 'Please choose an answer.';
      }
      return null;
    };
  }

  function correctness(mode, comprehension, ctx) {
    const out = {};
    comprehensionFor(mode, ctx).forEach((q) => {
      const answer = comprehension[q.id];
      out[q.id] = { prompt: q.prompt, answer: answer || null, correct: answer === q.correct };
    });
    return out;
  }

  return { renderHtml, attachListeners, comprehensionFor, correctness, orderedRoster };
})();
