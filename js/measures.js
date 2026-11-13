// Shared "Common Outcome Measurements" module, used after all three
// experimental conditions converge: an Allocation Task (Question 1), a
// group-identification slider (Question 2), an in-group affect slider
// (Question 3), an out-group affect slider (Question 4), and a set of
// comprehension-check questions whose exact wording depends on whether the
// participant was in an "unlimited resources" condition (Experiment 1 /
// Group Label) or a "fixed 50 coins" condition (Experiment 3 / Conflict
// Moderator). Wording below is taken verbatim from the KU POLS Annual
// Survey Proposal (Jingran Yang, July 2026), sections 5.1/5.2 (Questions
// 1-4) and the per-condition comprehension-check blocks.
window.OutcomeMeasures = (function () {
  'use strict';

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // mode: 'unlimited' (Experiment 1 / Experiment 2) or 'fixed50' (Experiment 3)
  //
  // Allocation scale: 0-10 gold coins per participant. In 'fixed50' the
  // budget is half of the maximum possible total (5 x roster size = 50 for
  // the default 10-person roster) and must be allocated exactly, so every
  // extra coin for one participant is a coin taken from another.
  const MAX_EACH = 10;
  function budgetFor(roster) { return 5 * roster.length; }
  const UNLIMITED_COMPREHENSION = [
    {
      id: 'qp',
      prompt: 'In this task, who knows about the gold coins and how you allocate them?',
      options: ['Only me', 'All participants', 'Some of the other participants'],
      correct: 'Only me',
    },
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

  const FIXED50_COMPREHENSION = (B) => [
    {
      id: 'qp',
      prompt: 'In this task, who knows about the gold coins and how you allocate them?',
      options: ['Only me', 'All participants', 'Some of the other participants'],
      correct: 'Only me',
    },
    {
      id: 'q5',
      prompt: 'In the current task, what is the total number of gold coins?',
      options: [`Fixed at ${B} coins`, 'Unlimited', 'Uncertain'],
      correct: `Fixed at ${B} coins`,
    },
    {
      id: 'q6',
      prompt: 'In the current task, the total gold coins you allocate to all participants:',
      options: [`Can be more or less than ${B} coins`, `Must be exactly ${B} coins`, 'Has no limit'],
      correct: `Must be exactly ${B} coins`,
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
    const base = mode === 'fixed50' ? FIXED50_COMPREHENSION(budgetFor((ctx && ctx.roster) || new Array(10))) : UNLIMITED_COMPREHENSION;
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
  // Allocation scenario: deliberately abstract (no community, political or
  // real-world framing). It establishes that ONLY the participant knows
  // about the gold coins, that they alone decide how to allocate them, and
  // that no one else will see the allocation — to isolate allocation from
  // social pressure and social comparison. Same text in all experiments;
  // the only difference is unlimited vs. a fixed total.
  function scenarioText(mode, individual, afterContest, B) {
    const privacy = 'Only you know about these gold coins: no other participant knows they exist, and no one else will see how you allocate them. You alone decide how to allocate them among the participants in this study, including yourself.';
    const sep = afterContest ? ' These gold coins have nothing to do with the points in the contest you just played.' : '';
    return mode === 'fixed50'
      ? `You have found ${B} gold coins. ${privacy} The total is fixed at ${B} gold coins, so giving more gold coins to one participant leaves fewer to share among the other participants — some of them may then receive fewer.${sep}`
      : `You have found a supply of gold coins. ${privacy} The supply is unlimited: how many gold coins you give to one participant does not affect how many the others can receive.${sep}`;
  }

  function renderHtml(mode, ctx) {
    const { roster, group } = ctx;
    const individual = !!ctx.individual;
    const self = roster.find((p) => p.isReal);
    const otherGroup = group === 'A' ? 'B' : 'A';
    const ownCount = roster.filter((p) => p.groupLabel === group).length;
    const otherCount = roster.filter((p) => p.groupLabel === otherGroup).length;
    const rows = orderedRoster(roster);

    const allocIntro = mode === 'fixed50'
      ? `Now, you will distribute the ${budgetFor(roster)} gold coins among all participants, including yourself. Please note that the total number of gold coins is fixed — allocating more gold coins to some participants leaves fewer to share among the others, which may mean that some participants receive fewer. Please follow these rules: for each participant, you can allocate between 0 and ${MAX_EACH} gold coins (inclusive). You need to make allocation decisions for each participant separately, and you must allocate all ${budgetFor(roster)} gold coins — no more and no less. Please complete the allocation according to your true preferences.`
      : 'Now, you need to allocate gold coins to all participants, including yourself. Please follow these rules: for each participant, you can allocate between 0 and 10 gold coins (inclusive). You need to make allocation decisions for each participant separately. Please allocate according to your true preferences — there is no right or wrong answer.';

    // Each participant gets a − / number / + stepper (0-10). Every row
    // starts unset ("–"): pressing − sets it to 0, + to 1, so each row is
    // an explicit decision and no default value anchors the answer.
    const rowsHtml = rows.map((p) => {
      const name = `Participant ${esc(p.label)}${p.isReal ? ' (you)' : p.isOpponent ? ' (your opponent in the contest)' : ''}`;
      const groupText = `Group ${esc(p.groupLabel)}${p.groupLabel === group ? ' (your group)' : ''}`;
      const cls = individual ? '' : (p.groupLabel === group ? 'own' : 'other');
      return `<tr class="alloc-row ${cls}">
        <td>${name}</td>
        ${individual ? '' : `<td>${groupText}</td>`}
        <td>
          <div class="stepper" data-alloc-label="${p.label}">
            <button type="button" class="step-btn minus" data-step="-1" aria-label="One fewer gold coin for Participant ${esc(p.label)}">−</button>
            <input type="text" inputmode="numeric" maxlength="2" autocomplete="off" class="step-val unset" id="alloc-val-${p.label}" placeholder="–" aria-label="Gold coins for Participant ${esc(p.label)} (0–${MAX_EACH})" />
            <button type="button" class="step-btn plus" data-step="1" aria-label="One more gold coin for Participant ${esc(p.label)}">+</button>
          </div>
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
        ${ctx.showScenario ? `<div class="notice scenario mt" style="margin-bottom:14px;">${esc(scenarioText(mode, individual, !!ctx.contest, budgetFor(roster)))}</div>` : ''}
        ${individual
          ? `<p>Your ID: Participant ${esc(self.label)}</p>
        <p class="muted">In this task you allocate gold coins to two participants: yourself and Participant ${esc(ctx.individual.opponentLabel)}, your opponent in the contest.</p>`
          : `<p>Your ID: Participant ${esc(self.label)} &nbsp;·&nbsp; Your assigned group: Group ${esc(group)}</p>
        <p class="muted">There are ${roster.length} participants in this task (including yourself). Your group (Group ${esc(group)}) consists of ${ownCount} member(s) (including yourself), and the other ${otherCount} participant(s) belong to Group ${esc(otherGroup)}.</p>`}
        <p>${esc(allocIntro)}</p>
        ${mode === 'fixed50' ? `<div class="alloc-counter" id="alloc-total-line">Allocated: <strong id="alloc-total">0</strong> / ${budgetFor(roster)} &nbsp;·&nbsp; Remaining: <strong id="alloc-remaining">${budgetFor(roster)}</strong></div>` : ''}
        <div style="overflow-x:auto;">
        <table class="alloc-table">
          <thead><tr><th>Participant</th>${individual ? '' : '<th>Group</th>'}<th>Gold coins (0–10)</th></tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
        </div>
        <p class="muted step-help">Type a number from 0 to ${MAX_EACH} in each box, or use − and +. (Pressing − on an empty box gives 0.)</p>`);

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
    const remainingEl = document.getElementById('alloc-remaining');
    const fixed = mode === 'fixed50';
    const BUDGET = budgetFor(roster);

    function recomputeTotal() {
      let sum = 0;
      roster.forEach((p) => {
        const v = state.allocations[p.label];
        if (typeof v === 'number') sum += v;
      });
      if (totalEl) totalEl.textContent = String(sum);
      if (remainingEl) remainingEl.textContent = String(BUDGET - sum);
      const counter = document.getElementById('alloc-total-line');
      if (counter) counter.classList.toggle('done', sum === BUDGET);
      return sum;
    }
    // Enable/disable buttons so an invalid value can't be entered:
    // never below 0, never above 10, and (fixed budget) never past 50.
    function refreshSteppers() {
      const sum = recomputeTotal();
      document.querySelectorAll('.stepper').forEach((st) => {
        const v = state.allocations[st.dataset.allocLabel];
        const set = typeof v === 'number';
        const valEl = st.querySelector('.step-val');
        const shown = set ? String(v) : '';
        if (valEl.value !== shown) valEl.value = shown;
        valEl.classList.toggle('unset', !set);
        st.querySelector('.minus').disabled = set && v <= 0;
        st.querySelector('.plus').disabled = (set && v >= MAX_EACH) || (fixed && sum >= BUDGET);
      });
    }
    document.querySelectorAll('.stepper').forEach((st) => {
      const label = st.dataset.allocLabel;
      st.querySelectorAll('.step-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const cur = state.allocations[label];
          const step = Number(btn.dataset.step);
          let next;
          if (typeof cur !== 'number') next = step > 0 ? 1 : 0;
          else next = Math.max(0, Math.min(MAX_EACH, cur + step));
          if (fixed && step > 0 && recomputeTotal() >= BUDGET) return;
          state.allocations[label] = next;
          state.allocationClicks = (state.allocationClicks || 0) + 1;
          refreshSteppers();
        });
      });
      // Typing: digits only, 0-10; in the fixed budget, never more than
      // what is left (the value is lowered to the maximum still available,
      // with a short note). An empty box means "not set yet".
      const input = st.querySelector('.step-val');
      const note = document.createElement('span');
      note.className = 'step-note';
      st.appendChild(note);
      let noteTimer = null;
      const flash = (msg) => {
        note.textContent = msg;
        note.classList.add('show');
        if (noteTimer) clearTimeout(noteTimer);
        noteTimer = setTimeout(() => note.classList.remove('show'), 2200);
      };
      input.addEventListener('input', () => {
        const digits = input.value.replace(/[^0-9]/g, '');
        if (digits === '') { delete state.allocations[label]; input.value = ''; refreshSteppers(); return; }
        let n = parseInt(digits, 10);
        if (n > MAX_EACH) { n = MAX_EACH; flash(`Max ${MAX_EACH}`); }
        if (fixed) {
          const cur = typeof state.allocations[label] === 'number' ? state.allocations[label] : 0;
          const allowed = cur + (BUDGET - recomputeTotal());
          if (n > allowed) { n = allowed; flash(`Only ${allowed} left`); }
        }
        state.allocations[label] = n;
        state.allocationTyped = (state.allocationTyped || 0) + 1;
        input.value = String(n);
        refreshSteppers();
      });
      input.addEventListener('focus', () => input.select());
    });
    refreshSteppers();

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
        const allAllocated = roster.every((p) => typeof state.allocations[p.label] === 'number');
        if (!allAllocated) return 'Please set the gold coins for every participant (press − once to give 0).';
        if (fixed) {
          const sum = recomputeTotal();
          if (sum !== BUDGET) return `You must allocate exactly ${BUDGET} gold coins. You have ${BUDGET - sum} left to allocate.`;
        }
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

  return { renderHtml, attachListeners, comprehensionFor, correctness, orderedRoster, budgetFor, MAX_EACH };
})();
