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

  function comprehensionFor(mode) {
    return mode === 'fixed10' ? FIXED10_COMPREHENSION : UNLIMITED_COMPREHENSION;
  }

  // Own-group members first (self first within that), then the other
  // group — matches the ordering used in the PDF's Table 3 (treatment
  // group) allocation table.
  function orderedRoster(roster) {
    const self = roster.find((p) => p.isReal);
    const ownGroup = self ? self.groupLabel : null;
    const mine = roster.filter((p) => p.groupLabel === ownGroup).sort((a, b) => (a.isReal ? -1 : b.isReal ? 1 : a.label - b.label));
    const others = roster.filter((p) => p.groupLabel !== ownGroup).sort((a, b) => a.label - b.label);
    return mine.concat(others);
  }

  function renderHtml(mode, ctx) {
    const { roster, group } = ctx;
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
      const name = `Participant ${esc(p.label)}${p.isReal ? ' (you)' : ''}`;
      const groupText = `Group ${esc(p.groupLabel)}${p.groupLabel === group ? ' (your group)' : ''}`;
      return `<tr>
        <td>${name}</td>
        <td>${groupText}</td>
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

    const comprehensionHtml = comprehensionFor(mode).map((q) => `
      <div class="measure-block">
        <h3>${esc(q.prompt)}</h3>
        <div class="radio-group" data-comp-id="${q.id}">
          ${q.options.map((o) => `<label class="radio-option"><input type="radio" name="comp-${q.id}" value="${esc(o)}" /> ${esc(o)}</label>`).join('')}
        </div>
      </div>`).join('');

    return `
      <div class="card">
        <h2>Question 1 — Allocation Task</h2>
        <p>Your ID: Participant ${esc(self.label)} &nbsp;·&nbsp; Your assigned group: Group ${esc(group)}</p>
        <p class="muted">There are ${roster.length} participants in this task (including yourself). Your group (Group ${esc(group)}) consists of ${ownCount} member(s) (including yourself), and the other ${otherCount} participant(s) belong to Group ${esc(otherGroup)}.</p>
        <p>${esc(allocIntro)}</p>
        <div style="overflow-x:auto;">
        <table class="alloc-table">
          <thead><tr><th>Participant</th><th>Group</th><th>Allocation</th></tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
        </div>
        ${mode === 'fixed10' ? `<p class="mt" id="alloc-total-line">Total allocated so far: <strong id="alloc-total">0</strong> / 10</p>` : ''}
        <p class="error-text hidden" id="alloc-error">Please answer for every participant${mode === 'fixed10' ? ', and keep the total at 10 or below' : ''}.</p>
      </div>
      <div class="card">
        <h2>Question 2 — Group Identification</h2>
        ${sliderBlock('identification', `To what extent do you identify with your group (Group ${group})?`, '"Identify" means that you feel you belong to this group and associate yourself with it to some extent. Please rate based on your true feelings.', 'Do not identify at all', 'Very strong identification')}
      </div>
      <div class="card">
        <h2>Question 3 — In-Group Affect</h2>
        ${sliderBlock('ingroupAffect', `How do you feel toward members of your own group (Group ${group})?`, 'Please rate based on your true feelings.', 'Very unfavorable', 'Very favorable')}
      </div>
      <div class="card">
        <h2>Question 4 — Out-Group Affect</h2>
        ${sliderBlock('outgroupAffect', `How do you feel toward members of the other group (Group ${otherGroup})?`, 'Please rate based on your true feelings.', 'Very unfavorable', 'Very favorable')}
      </div>
      <div class="card">
        <h2>Comprehension Check</h2>
        <p class="muted">To confirm that you understand the rules of this task, please answer the following questions.</p>
        ${comprehensionHtml}
      </div>
      <div class="card center">
        <button type="button" id="measures-continue-btn" style="width:100%;">Continue</button>
      </div>`;
  }

  function attachListeners(mode, ctx, state, onContinue) {
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

    const btn = document.getElementById('measures-continue-btn');
    const err = document.getElementById('alloc-error');
    btn.addEventListener('click', () => {
      const allAllocated = roster.every((p) => state.allocations[p.label] !== undefined);
      const total = recomputeTotal();
      const totalOk = mode !== 'fixed10' || total <= 10;
      if (!allAllocated || !totalOk) {
        if (err) err.classList.remove('hidden');
        return;
      }
      if (err) err.classList.add('hidden');
      const allSlidersTouched = state.identificationTouched && state.ingroupAffectTouched && state.outgroupAffectTouched;
      if (!allSlidersTouched) {
        alert('Please move each slider (Questions 2-4) to record your answer before continuing.');
        return;
      }
      const allComprehension = comprehensionFor(mode).every((q) => state.comprehension[q.id] !== undefined);
      if (!allComprehension) {
        alert('Please answer the comprehension-check questions before continuing.');
        return;
      }
      onContinue();
    });
  }

  function correctness(mode, comprehension) {
    const out = {};
    comprehensionFor(mode).forEach((q) => {
      const answer = comprehension[q.id];
      out[q.id] = { prompt: q.prompt, answer: answer || null, correct: answer === q.correct };
    });
    return out;
  }

  return { renderHtml, attachListeners, comprehensionFor, correctness, orderedRoster };
})();
