(function () {
  'use strict';

  // =========================================================================
  // Full-flow study controller. This drives the whole participant journey on
  // ONE site (no Qualtrics hand-off required): Entry (consent + eligibility)
  // -> Pre-treatment demographics -> Random assignment to one of three
  // experimental conditions -> the condition's task -> the shared "Common
  // Outcome Measurements" (Allocation Task / Identification / In-group
  // Affect / Out-group Affect + comprehension check) -> Debrief -> data
  // submission.
  //
  // Condition 1 "Group Label" and Condition 3 "Conflict Moderator" reuse the
  // exact wording from the KU POLS Annual Survey Proposal (Jingran Yang,
  // July 2026) — Condition 1 = the proposal's "Control" (unlimited
  // resources) arm, Condition 3 = its "Treatment 1" (fixed 10 gold coins)
  // arm. Condition 2 "Enhanced Belonging" is the three cooperative
  // mini-games (with the mutual-help mechanic) already built in game.html —
  // it is embedded here via <iframe> + postMessage, the same mechanism
  // documented for Qualtrics in QUALTRICS_INTEGRATION.md, so none of that
  // already-tested game code has to be touched or duplicated.
  //
  // NOTE on content that is still a draft pending the researcher's review:
  //   - The consent text and eligibility screen in the Entry stage are
  //     placeholder language, NOT yet IRB-approved wording. Replace before
  //     fielding a real study.
  //   - Condition 2 uses the "unlimited resources" (same as Condition 1)
  //     framing for its Allocation Task, since Enhanced Belonging is not a
  //     resource-scarcity manipulation. Change EXP2_ALLOCATION_MODE below if
  //     that assumption is wrong.
  //
  // URL parameters:
  //   pid              participant/response ID (default: random)
  //   condition        force '1' | '2' | '3' instead of random assignment
  //   group            force 'A' | 'B' for the real participant's team
  //   ingroup/outgroup simulated-teammate/opponent counts (default 4 / 5,
  //                    i.e. a 5-vs-5 roster of 10 total, matching the PDF)
  //   duration / diffDuration / linkDuration / difficulty / diffDifficulty /
  //   linkDifficulty / bias / help / helpThreshold
  //                    passed straight through to the embedded game.html
  //                    for Condition 2 — see QUALTRICS_INTEGRATION.md
  //   dataEndpoint     a Google Apps Script Web App URL results are POSTed
  //                    to on completion (see GOOGLE_SHEETS_SETUP.md). If
  //                    omitted, results are only kept in-page (and, in
  //                    debug mode, downloadable) — nothing is lost silently,
  //                    but nothing is saved anywhere durable either.
  //   returnUrl        if set, a button on the final debrief screen
  //                    navigates here (e.g. back to a panel vendor)
  //   disqualifyUrl    if set, participants who fail the eligibility screen
  //                    are redirected here instead of seeing an in-page
  //                    message
  //   debug            '1' exposes window.__studyDebug with internal state
  // =========================================================================

  const EXP2_ALLOCATION_MODE = 'unlimited';

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function nowIso() { return new Date().toISOString(); }
  function randInt(min, max) {
    const range = max - min + 1;
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return min + (buf[0] % range);
  }

  const qs = new URLSearchParams(location.search);
  function clampInt(v, def, min, max) {
    const n = parseInt(v, 10);
    if (Number.isNaN(n)) return def;
    return Math.max(min, Math.min(max, n));
  }
  const CONFIG = {
    pid: qs.get('pid') || ('anon_' + Math.random().toString(36).slice(2, 10)),
    forceCondition: ['1', '2', '3'].includes(qs.get('condition')) ? Number(qs.get('condition')) : null,
    forceGroup: (qs.get('group') || '').toUpperCase(),
    inGroupCount: clampInt(qs.get('ingroup'), 4, 0, 50),
    outGroupCount: clampInt(qs.get('outgroup'), 5, 0, 50),
    durationSec: clampInt(qs.get('duration'), 120, 10, 1800),
    difficulty: ['easy', 'medium', 'hard'].includes(qs.get('difficulty')) ? qs.get('difficulty') : 'medium',
    diffDurationSec: clampInt(qs.get('diffDuration'), 90, 10, 1800),
    diffDifficulty: ['easy', 'medium', 'hard'].includes(qs.get('diffDifficulty')) ? qs.get('diffDifficulty') : 'medium',
    linkDurationSec: clampInt(qs.get('linkDuration'), 90, 10, 1800),
    linkDifficulty: ['easy', 'medium', 'hard'].includes(qs.get('linkDifficulty')) ? qs.get('linkDifficulty') : 'medium',
    bias: ['win', 'lose', 'tie', 'random'].includes(qs.get('bias')) ? qs.get('bias') : 'random',
    helpEnabled: qs.get('help') !== '0',
    helpThreshold: clampInt(qs.get('helpThreshold'), 5, 1, 100),
    dataEndpoint: qs.get('dataEndpoint') || '',
    returnUrl: qs.get('returnUrl') || '',
    disqualifyUrl: qs.get('disqualifyUrl') || '',
    debug: qs.get('debug') === '1',
  };

  const app = document.getElementById('app');

  const S = {
    stage: 'entry',
    pid: CONFIG.pid,
    consent: { agreed: false, agreedAt: null },
    eligibility: { adult: false, usResident: false },
    demographics: { gender: null, age: null, education: null, party: null },
    condition: null,
    conditionName: null,
    group: null,
    label: null,
    roster: null,
    gamePayload: null,
    allocMode: null,
    measures: {
      allocations: {},
      identification: 0, identificationTouched: false,
      ingroupAffect: 0, ingroupAffectTouched: false,
      outgroupAffect: 0, outgroupAffectTouched: false,
      comprehension: {},
    },
    finalPayload: null,
    submitted: false,
    timestamps: { enteredAt: nowIso() },
  };
  if (CONFIG.debug) window.__studyDebug = { get state() { return S; }, CONFIG };

  const STEP_LABELS = {
    entry: 'Step 1 of 6 · Consent &amp; Eligibility',
    demographics: 'Step 2 of 6 · About You',
    assigning: 'Step 3 of 6 · Group Assignment',
    task_intro: 'Step 4 of 6 · Task',
    task_game: 'Step 4 of 6 · Task',
    measures: 'Step 5 of 6 · Questions',
    debrief: 'Step 6 of 6 · Debrief',
  };
  function progressBarHtml() {
    const label = STEP_LABELS[S.stage];
    return label ? `<div class="stage-progress">${label}</div>` : '';
  }

  // ---------------------------------------------------------------------
  // Shared 10-person roster builder (self + inCount in-group bots + outCount
  // out-group bots, randomized group assignment and shuffled labels) — used
  // directly by Conditions 1 and 3. Condition 2 instead gets its roster from
  // the embedded game's own (independently generated, same-size) roster,
  // reported back via postMessage, so the Allocation Task afterward lists
  // the exact same teammates/opponents the participant just played with.
  // =========================================================================
  function buildTenPersonRoster(inCount, outCount, forcedGroup) {
    const realGroup = forcedGroup === 'A' || forcedGroup === 'B' ? forcedGroup : (randInt(0, 1) === 0 ? 'A' : 'B');
    const otherGroup = realGroup === 'A' ? 'B' : 'A';
    const slots = [{ isReal: true, groupLabel: realGroup }];
    for (let i = 0; i < inCount; i++) slots.push({ isReal: false, groupLabel: realGroup, botId: 'bot_' + Math.random().toString(36).slice(2, 10) });
    for (let i = 0; i < outCount; i++) slots.push({ isReal: false, groupLabel: otherGroup, botId: 'bot_' + Math.random().toString(36).slice(2, 10) });
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
    return { roster, group: realGroup, label: realLabel };
  }

  function renderRosterColumns(roster, group) {
    const teamA = roster.filter((p) => p.groupLabel === 'A');
    const teamB = roster.filter((p) => p.groupLabel === 'B');
    const col = (team, list, cls) => `
      <div class="team-col ${cls}">
        <h3>Group ${team}${team === group ? ' (your group)' : ''}</h3>
        <ul class="member-list">
          ${list.map((p) => `<li class="member-row ${p.id === 'self' ? 'me' : ''}"><span>Participant ${p.label}${p.id === 'self' ? ' (you)' : ''}</span></li>`).join('')}
        </ul>
      </div>`;
    return `<div class="team-columns">${col('A', teamA, 'a')}${col('B', teamB, 'b')}</div>`;
  }

  function render() {
    if (S.stage === 'entry') return renderEntry();
    if (S.stage === 'ineligible') return renderIneligible();
    if (S.stage === 'demographics') return renderDemographics();
    if (S.stage === 'assigning') return renderAssigning();
    if (S.stage === 'task_intro') return renderTaskIntro();
    if (S.stage === 'task_game') return renderTaskGame();
    if (S.stage === 'measures') return renderMeasures();
    if (S.stage === 'debrief') return renderDebrief();
  }

  // =======================================================================
  // Entry: consent + eligibility
  // =======================================================================
  function renderEntry() {
    app.innerHTML = `
      ${progressBarHtml()}
      <div class="card">
        <h1>Welcome</h1>
        <div class="notice warn">
          <strong>Draft content.</strong> The consent text below is placeholder language for development/testing — it has not been reviewed or approved by an IRB. Replace it with your approved consent language before fielding a real study.
        </div>
        <div class="consent-text mt">
          <p>You are invited to participate in a research study about how people make decisions involving members of different social and political groups. Participation is completely voluntary — you may stop at any time without penalty.</p>
          <p>The study takes about 2-10 minutes, depending on the task you are assigned to. There are no anticipated risks beyond those of everyday life. Your responses will be kept confidential and reported only in aggregate.</p>
          <p><strong>Please note:</strong> this study involves incomplete disclosure. We will not inform you in advance of the specific research question being tested, because doing so could influence your responses and affect the validity of the study. All information provided to you about the task itself, your group assignment, and the allocation rules will be accurate — there is no deception about the tasks themselves. You will receive a full explanation at the end of the study.</p>
          <p class="muted">Questions about this research may be directed to [researcher contact — add before fielding]. Questions about your rights as a research participant may be directed to [IRB contact — add before fielding].</p>
        </div>
        <div class="consent-checks mt">
          <label class="radio-option"><input type="checkbox" id="chk-adult" /> I am 18 years of age or older.</label>
          <label class="radio-option"><input type="checkbox" id="chk-us" /> I currently reside in the United States.</label>
          <label class="radio-option"><input type="checkbox" id="chk-agree" /> I have read the information above and I agree to participate in this study.</label>
        </div>
        <p class="error-text hidden" id="entry-error">Please check all three boxes to continue.</p>
        <button type="button" id="entry-continue-btn" class="mt" style="width:100%;">Continue</button>
      </div>`;
    document.getElementById('entry-continue-btn').addEventListener('click', () => {
      const adult = document.getElementById('chk-adult').checked;
      const us = document.getElementById('chk-us').checked;
      const agree = document.getElementById('chk-agree').checked;
      S.eligibility.adult = adult;
      S.eligibility.usResident = us;
      if (!adult || !us) {
        S.stage = 'ineligible';
        render();
        return;
      }
      if (!agree) {
        document.getElementById('entry-error').classList.remove('hidden');
        return;
      }
      S.consent.agreed = true;
      S.consent.agreedAt = nowIso();
      S.timestamps.demographicsAt = nowIso();
      S.stage = 'demographics';
      render();
    });
  }

  function renderIneligible() {
    if (CONFIG.disqualifyUrl) {
      location.href = CONFIG.disqualifyUrl;
      return;
    }
    app.innerHTML = `
      <div class="card center">
        <h1>Thank you for your interest</h1>
        <p class="lead">Based on your responses, you are not eligible to participate in this study. Thank you for your time.</p>
      </div>`;
  }

  // =======================================================================
  // Pre-treatment demographics (exact wording/options from the KU POLS
  // proposal, section 5.3 — asked once, before random assignment, so
  // condition balance on these characteristics can be checked later).
  // =======================================================================
  const DEMOGRAPHIC_QUESTIONS = [
    { id: 'gender', prompt: 'What is your gender?', options: ['Male', 'Female', 'Non-binary / Other', 'Prefer not to say'] },
    { id: 'age', prompt: 'What is your age?', options: ['Under 18', '18-24', '25-34', '35-44', '45-54', '55-64', '65 or older', 'Prefer not to say'] },
    { id: 'education', prompt: 'What is the highest level of education you have completed?', options: ['Less than high school', 'High school graduate', 'Some college', 'Associate degree', "Bachelor's degree", 'Graduate degree', 'Prefer not to say'] },
    { id: 'party', prompt: 'Generally speaking, do you usually think of yourself as a:', options: ['Strong Democrat', 'Democrat', 'Independent', 'Lean Democrat', 'Lean Republican', 'Republican', 'Strong Republican', 'Other', 'Prefer not to say'] },
  ];

  function renderDemographics() {
    app.innerHTML = `
      ${progressBarHtml()}
      <div class="card">
        <h1>About You</h1>
        <p class="muted">A few background questions before we begin.</p>
        ${DEMOGRAPHIC_QUESTIONS.map((q) => `
          <div class="measure-block">
            <h3>${esc(q.prompt)}</h3>
            <div class="radio-group" data-demo-id="${q.id}">
              ${q.options.map((o) => `<label class="radio-option"><input type="radio" name="demo-${q.id}" value="${esc(o)}" /> ${esc(o)}</label>`).join('')}
            </div>
          </div>`).join('')}
        <p class="error-text hidden" id="demo-error">Please answer every question to continue.</p>
        <button type="button" id="demo-continue-btn" class="mt" style="width:100%;">Continue</button>
      </div>`;
    document.querySelectorAll('.radio-group').forEach((grp) => {
      const id = grp.dataset.demoId;
      grp.querySelectorAll('input[type="radio"]').forEach((input) => {
        input.addEventListener('change', () => { S.demographics[id] = input.value; });
      });
    });
    document.getElementById('demo-continue-btn').addEventListener('click', () => {
      const allAnswered = DEMOGRAPHIC_QUESTIONS.every((q) => S.demographics[q.id]);
      if (!allAnswered) {
        document.getElementById('demo-error').classList.remove('hidden');
        return;
      }
      S.timestamps.assignedAt = nowIso();
      S.stage = 'assigning';
      render();
      setTimeout(assignConditionAndRoute, 650);
    });
  }

  // =======================================================================
  // Random assignment (equal thirds unless forced via ?condition=)
  // =======================================================================
  function renderAssigning() {
    app.innerHTML = `
      ${progressBarHtml()}
      <div class="card center">
        <h1>One moment…</h1>
        <p class="muted">You are being randomly assigned to a task.</p>
      </div>`;
  }

  const CONDITION_NAMES = { 1: 'group_label_control', 2: 'enhanced_belonging', 3: 'conflict_moderator_treatment1' };

  function assignConditionAndRoute() {
    S.condition = CONFIG.forceCondition || randInt(1, 3);
    S.conditionName = CONDITION_NAMES[S.condition];
    S.timestamps.taskStartAt = nowIso();

    if (S.condition === 2) {
      S.group = CONFIG.forceGroup === 'A' || CONFIG.forceGroup === 'B' ? CONFIG.forceGroup : (randInt(0, 1) === 0 ? 'A' : 'B');
      S.allocMode = EXP2_ALLOCATION_MODE;
      S.stage = 'task_game';
    } else {
      const built = buildTenPersonRoster(CONFIG.inGroupCount, CONFIG.outGroupCount, CONFIG.forceGroup);
      S.roster = built.roster;
      S.group = built.group;
      S.label = built.label;
      S.allocMode = S.condition === 1 ? 'unlimited' : 'fixed10';
      S.stage = 'task_intro';
    }
    render();
  }

  // =======================================================================
  // Condition 1 (Group Label / Control) and Condition 3 (Conflict Moderator
  // / Treatment 1) task-intro screens — exact wording from KU POLS proposal
  // sections 5.1 and 5.2 respectively.
  // =======================================================================
  function renderTaskIntro() {
    const unlimited = S.allocMode === 'unlimited';
    const resourceParagraph = unlimited
      ? 'During this task, you and members of your group are participating in a community decision-making process. You have discovered an unlimited supply of gold coins that can be used to support individuals and improve people’s well-being. Please pay attention, other participants are not informed about the total number of gold coins available. Since the number of gold coins is unlimited, how many gold coins you allocate to one participant does not affect how many gold coins other participants receive.'
      : 'During this task, you and members of your group are participating in a community decision-making process. You have discovered 10 gold coins that can be used to support individuals and improve people’s well-being. Because the total number of gold coins is fixed, allocating more gold coins to one participant reduces the number of gold coins available to other participants. Please pay attention, other participants are not informed about the total number of gold coins available.';

    app.innerHTML = `
      ${progressBarHtml()}
      <div class="card">
        <h1>Task Instructions</h1>
        <p>In this task, we want to understand how people make decisions involving members of different groups in society.</p>
        <p>People often form social and political groups based on shared identities, values, or experiences. Understanding how group membership influences cooperation and resource allocation can help us better understand the foundations of social divisions and political polarization.</p>
        <p>You have been randomly assigned to one of two citizen groups. You belong to: <span class="badge ${S.group === 'A' ? 'a' : 'b'}">Group ${esc(S.group)}</span></p>
        <p>${esc(resourceParagraph)}</p>
      </div>
      <div class="card">
        <h2>Your Group</h2>
        ${renderRosterColumns(S.roster, S.group)}
        <button type="button" id="task-intro-continue-btn" class="mt" style="width:100%;">Continue to Allocation Task</button>
      </div>`;
    document.getElementById('task-intro-continue-btn').addEventListener('click', () => {
      S.timestamps.measuresStartAt = nowIso();
      S.stage = 'measures';
      render();
    });
  }

  // =======================================================================
  // Condition 2 (Enhanced Belonging) — embed the already-built, already-
  // tested three-game experience via iframe + postMessage, exactly as
  // documented for Qualtrics in QUALTRICS_INTEGRATION.md.
  // =======================================================================
  function renderTaskGame() {
    const params = new URLSearchParams({
      pid: S.pid,
      group: S.group,
      ingroup: String(CONFIG.inGroupCount),
      outgroup: String(CONFIG.outGroupCount),
      duration: String(CONFIG.durationSec),
      difficulty: CONFIG.difficulty,
      diffDuration: String(CONFIG.diffDurationSec),
      diffDifficulty: CONFIG.diffDifficulty,
      linkDuration: String(CONFIG.linkDurationSec),
      linkDifficulty: CONFIG.linkDifficulty,
      bias: CONFIG.bias,
      helpThreshold: String(CONFIG.helpThreshold),
      autostart: '1',
      origin: location.origin,
    });
    if (!CONFIG.helpEnabled) params.set('help', '0');

    app.innerHTML = `
      ${progressBarHtml()}
      <div class="card">
        <h1>Task</h1>
        <p class="muted">Complete the three cooperative tasks below, then you will continue automatically.</p>
        <iframe id="game-frame" src="game.html?${params.toString()}" width="100%" height="780" style="border:none; border-radius:10px; background:var(--color-panel-2);"></iframe>
      </div>`;
  }

  // One persistent listener for the whole page lifetime; only acts while
  // we're actually on the task_game stage and the message really is a
  // completion payload from our own iframe.
  window.addEventListener('message', (event) => {
    if (S.stage !== 'task_game') return;
    if (!event.data || event.data.type !== 'sit_task_complete') return;
    const frame = document.getElementById('game-frame');
    if (frame && event.source !== frame.contentWindow) return;
    const payload = event.data.payload;
    S.gamePayload = payload;
    S.roster = Array.isArray(payload.roster) && payload.roster.length
      ? payload.roster
      : buildTenPersonRoster(CONFIG.inGroupCount, CONFIG.outGroupCount, S.group).roster;
    const self = S.roster.find((p) => p.isReal);
    S.label = self ? self.label : null;
    S.timestamps.measuresStartAt = nowIso();
    S.stage = 'measures';
    render();
  });

  // =======================================================================
  // Shared Outcome Measures stage (all three conditions converge here)
  // =======================================================================
  function renderMeasures() {
    app.innerHTML = progressBarHtml() + window.OutcomeMeasures.renderHtml(S.allocMode, { roster: S.roster, group: S.group });
    window.OutcomeMeasures.attachListeners(S.allocMode, { roster: S.roster, group: S.group }, S.measures, () => {
      S.timestamps.debriefAt = nowIso();
      S.stage = 'debrief';
      submitResults();
      render();
    });
  }

  // =======================================================================
  // Debrief — exact statement from the KU POLS proposal, section 7, plus an
  // added disclosure for Condition 2 that teammates/opponents were
  // computer-simulated (consistent with game.html's own deception design).
  // =======================================================================
  function renderDebrief() {
    const botNote = S.condition === 2
      ? '<p>In the task you just completed, your teammates and opponents ("Participant 2", "Participant 3", etc.) were simulated by the computer, not real people. This was necessary so that every participant could have the same experience regardless of when they took part.</p>'
      : '';
    app.innerHTML = `
      ${progressBarHtml()}
      <div class="card">
        <h1>Debriefing Statement</h1>
        <p>The purpose of this study was to examine how group membership and resource conditions influence people's decisions toward members of different groups.</p>
        <p>At the beginning of the survey, we did not disclose the specific research purpose, because knowing the purpose of the study could influence participants' responses and affect the validity of the experiment.</p>
        <p>The groups in this study were randomly assigned and do not represent meaningful social or political categories. The resource allocation scenarios were designed to examine general patterns of decision-making rather than to evaluate individual participants.</p>
        ${botNote}
        <p class="muted">If you have questions about this study, please contact [researcher contact — add before fielding].</p>
        <div id="debrief-continue-slot" class="mt"></div>
      </div>`;
    const slot = document.getElementById('debrief-continue-slot');
    if (CONFIG.returnUrl) {
      const btn = document.createElement('button');
      btn.style.width = '100%';
      btn.textContent = 'Continue';
      btn.addEventListener('click', () => {
        const url = new URL(CONFIG.returnUrl);
        url.searchParams.set('sit_pid', S.pid);
        url.searchParams.set('sit_condition', String(S.condition));
        location.href = url.toString();
      });
      slot.appendChild(btn);
    } else {
      const notice = document.createElement('div');
      notice.className = 'notice';
      notice.textContent = 'Thank you for participating. Your responses have been recorded.';
      slot.appendChild(notice);
    }
  }

  // =======================================================================
  // Data submission
  // =======================================================================
  function buildFinalPayload() {
    const comprehension = window.OutcomeMeasures.correctness(S.allocMode, S.measures.comprehension);
    const allocEntries = (S.roster || []).map((p) => ({
      label: p.label, groupLabel: p.groupLabel, isSelf: !!p.isReal,
      allocation: Object.prototype.hasOwnProperty.call(S.measures.allocations, p.label) ? S.measures.allocations[p.label] : null,
    }));
    const allocTotal = allocEntries.reduce((sum, e) => sum + (e.allocation === '0' || e.allocation === '1' || e.allocation === '2' ? Number(e.allocation) : 0), 0);
    return {
      pid: S.pid,
      condition: S.condition,
      conditionName: S.conditionName,
      group: S.group,
      participantLabel: S.label,
      rosterSize: {
        total: (S.roster || []).length,
        inGroup: (S.roster || []).filter((p) => p.groupLabel === S.group).length,
        outGroup: (S.roster || []).filter((p) => p.groupLabel !== S.group).length,
      },
      consentAgreedAt: S.consent.agreedAt,
      eligibility: S.eligibility,
      demographics: S.demographics,
      game: S.gamePayload,
      allocationMode: S.allocMode,
      allocation: { entries: allocEntries, total: allocTotal },
      identification: S.measures.identification,
      ingroupAffect: S.measures.ingroupAffect,
      outgroupAffect: S.measures.outgroupAffect,
      comprehension,
      timestamps: S.timestamps,
      userAgent: navigator.userAgent,
    };
  }

  function submitResults() {
    const payload = buildFinalPayload();
    S.finalPayload = payload;
    if (CONFIG.dataEndpoint) {
      try {
        fetch(CONFIG.dataEndpoint, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(payload),
        }).catch(() => {});
      } catch (e) { /* best-effort — a blocked/failed POST should never break the debrief screen */ }
    }
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'sit_study_complete', payload }, '*');
      }
    } catch (e) { /* cross-origin parent access errors are expected/harmless here */ }
    S.submitted = true;
  }

  render();
})();
