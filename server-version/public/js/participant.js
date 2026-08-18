(function () {
  'use strict';

  const app = document.getElementById('app');
  const urlParams = new URLSearchParams(location.search);
  const urlStudyId = (urlParams.get('s') || '').toUpperCase().trim();

  const S = {
    studyId: urlStudyId || null,
    runToken: null,
    studyName: '',
    label: null,
    groupLabel: null,
    mathDurationSec: null,
    roster: [],
    teams: { A: [], B: [] },
    totals: { A: 0, B: 0 },
    currentProblem: null,
    lastAnswerResult: null,
    gameEndAt: null,
    correctCount: 0,
    localPhase: 'loading', // loading | error | intro | playing | results | ...survey flow... | debrief | done
    allocNonscarce: {},
    allocScarce: {},
    surveyNonscarce: {},
    surveyScarce: {},
    errorMessage: null,
    submitting: false,
  };

  function storageKey(suffix) { return `sit_${S.studyId}_${suffix}`; }
  function loadPersisted() {
    if (!S.studyId) return;
    try {
      const raw = localStorage.getItem(storageKey('run'));
      if (raw) Object.assign(S, JSON.parse(raw));
    } catch (e) { /* ignore */ }
  }
  function persist() {
    if (!S.studyId) return;
    const toSave = {
      runToken: S.runToken, label: S.label, groupLabel: S.groupLabel, localPhase: S.localPhase,
      allocNonscarce: S.allocNonscarce, allocScarce: S.allocScarce,
      surveyNonscarce: S.surveyNonscarce, surveyScarce: S.surveyScarce,
    };
    try { localStorage.setItem(storageKey('run'), JSON.stringify(toSave)); } catch (e) { /* ignore */ }
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function api(path, opts = {}) {
    const res = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts));
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || '请求失败');
    return data;
  }
  function setPhase(phase) {
    S.localPhase = phase;
    persist();
    if (S.runToken) api(`/api/runs/${S.runToken}/phase`, { method: 'POST', body: JSON.stringify({ phase }) }).catch(() => {});
    render();
  }

  // ---------------------------------------------------------------------
  // Boot / resume
  // ---------------------------------------------------------------------
  async function boot() {
    if (!S.studyId) { S.localPhase = 'need-code'; render(); return; }
    loadPersisted();
    render();
    try {
      if (S.runToken) {
        const state = await api(`/api/runs/${S.runToken}/state`);
        S.label = state.label; S.groupLabel = state.groupLabel; S.roster = state.roster;
        S.mathDurationSec = state.mathDurationSec; S.correctCount = state.correctCount;
        if (state.gameEndAt) S.gameEndAt = state.gameEndAt;
        if (state.scoreboard) { S.teams = state.scoreboard.teams; S.totals = state.scoreboard.totals; }
        if (!S.localPhase || S.localPhase === 'loading') S.localPhase = state.phase;
        persist();
        render();
        resumeRuntimeForPhase();
        return;
      }
      const data = await api('/api/runs/start', { method: 'POST', body: JSON.stringify({ studyId: S.studyId }) });
      S.runToken = data.runToken; S.studyName = data.studyName; S.label = data.label;
      S.groupLabel = data.groupLabel; S.roster = data.roster; S.mathDurationSec = data.mathDurationSec;
      S.localPhase = 'intro';
      persist();
      render();
    } catch (e) {
      S.errorMessage = e.message || '无法连接到实验服务器。';
      render();
    }
  }

  function resumeRuntimeForPhase() {
    if (S.localPhase === 'playing') { startScoreboardPolling(); requestProblem(); }
  }

  // ---------------------------------------------------------------------
  // Game runtime
  // ---------------------------------------------------------------------
  let scoreboardInterval = null;
  function startScoreboardPolling() {
    stopScoreboardPolling();
    pollScoreboard();
    scoreboardInterval = setInterval(pollScoreboard, 900);
  }
  function stopScoreboardPolling() {
    if (scoreboardInterval) clearInterval(scoreboardInterval);
    scoreboardInterval = null;
  }
  async function pollScoreboard() {
    try {
      const data = await api(`/api/runs/${S.runToken}/scoreboard`);
      S.teams = data.teams; S.totals = data.totals;
      renderScoreboardOnly();
      renderTimerOnly(data.msRemaining);
      if (data.finished) {
        stopScoreboardPolling();
        if (S.localPhase === 'playing') { S.localPhase = 'results'; persist(); render(); }
      }
    } catch (e) { /* transient network error, ignore this tick */ }
  }

  async function requestProblem() {
    try {
      const data = await api(`/api/runs/${S.runToken}/problem`);
      if (data.finished) return;
      S.currentProblem = { id: data.problemId, text: data.text };
      S.lastAnswerResult = null;
      renderProblemOnly();
      focusAnswerInput();
    } catch (e) { /* ignore, will retry on next user action */ }
  }

  async function submitAnswer(value) {
    if (!S.currentProblem) return;
    try {
      const data = await api(`/api/runs/${S.runToken}/answer`, {
        method: 'POST', body: JSON.stringify({ problemId: S.currentProblem.id, answer: Number(value) }),
      });
      if (data.finished) return;
      if (data.stale) { requestProblem(); return; }
      S.correctCount = data.correctCount;
      S.lastAnswerResult = data.correct ? 'correct' : 'wrong';
      renderProblemOnly();
      setTimeout(requestProblem, 150);
    } catch (e) { /* ignore transient error */ }
  }

  function focusAnswerInput() {
    requestAnimationFrame(() => { const inp = document.getElementById('answer-input'); if (inp) inp.focus(); });
  }
  function formatTime(totalSeconds) {
    const m = Math.floor(totalSeconds / 60); const s = totalSeconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }
  function renderTimerOnly(msRemaining) {
    const el = document.getElementById('timer-display');
    if (el) el.textContent = formatTime(Math.ceil(msRemaining / 1000));
  }
  function renderScoreboardOnly() {
    const el = document.getElementById('scoreboard-slot');
    if (el) el.innerHTML = renderScoreboardHtml();
  }
  function renderProblemOnly() {
    const el = document.getElementById('problem-box');
    if (!el) return;
    el.querySelector('.problem-text').textContent = S.currentProblem ? `${S.currentProblem.text} = ?` : '…';
    if (S.lastAnswerResult) {
      el.classList.remove('flash', 'flash-bad');
      void el.offsetWidth;
      el.classList.add(S.lastAnswerResult === 'correct' ? 'flash' : 'flash-bad');
    }
    const inp = document.getElementById('answer-input');
    if (inp) inp.value = '';
  }

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------
  function render() {
    if (S.errorMessage) {
      app.innerHTML = `<div class="card"><h1>无法继续</h1><div class="notice error">${esc(S.errorMessage)}</div></div>`;
      return;
    }
    switch (S.localPhase) {
      case 'need-code': return renderNeedCode();
      case 'loading': return renderLoading();
      case 'intro': return renderIntro();
      case 'playing': return renderPlaying();
      case 'results': return renderResults();
      case 'instructions_nonscarce': return renderInstructionsNonscarce();
      case 'comprehension_nonscarce': return renderComprehension('nonscarce');
      case 'allocate_nonscarce': return renderAllocate('nonscarce');
      case 'survey_nonscarce': return renderSurvey('nonscarce');
      case 'instructions_scarce': return renderInstructionsScarce();
      case 'comprehension_scarce': return renderComprehension('scarce');
      case 'allocate_scarce': return renderAllocate('scarce');
      case 'survey_scarce': return renderSurvey('scarce');
      case 'debrief': return renderDebrief();
      case 'done': return renderDone();
      default: return renderLoading();
    }
  }

  function renderNeedCode() {
    app.innerHTML = `
      <div class="card">
        <h1>加入实验</h1>
        <p class="lead">请输入研究者提供的6位研究代码。</p>
        <input type="text" id="code-input" maxlength="6" placeholder="例如 AB12CD" style="text-transform:uppercase; letter-spacing:0.2em; font-size:1.3rem; text-align:center;" />
        <button id="join-btn" class="mt" style="width:100%;">开始</button>
      </div>`;
    const input = document.getElementById('code-input');
    const btn = document.getElementById('join-btn');
    input.addEventListener('input', () => { input.value = input.value.toUpperCase(); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') btn.click(); });
    btn.addEventListener('click', () => {
      const code = input.value.trim().toUpperCase();
      if (code.length < 4) return;
      S.studyId = code;
      const url = new URL(location.href);
      url.searchParams.set('s', code);
      history.replaceState(null, '', url);
      S.localPhase = 'loading';
      boot();
    });
  }

  function renderLoading() {
    app.innerHTML = `<div class="card center"><p class="muted">正在准备实验…</p></div>`;
  }

  function renderRosterColumns() {
    const teamA = S.roster.filter((p) => p.groupLabel === 'A');
    const teamB = S.roster.filter((p) => p.groupLabel === 'B');
    const col = (team, list, cls) => `
      <div class="team-col ${cls}">
        <h3>Group ${team}</h3>
        <ul class="member-list">
          ${list.map((p) => `<li class="member-row ${p.id === 'self' ? 'me' : ''}">
            <span>Participant ${p.label}${p.id === 'self' ? '（你）' : ''}</span>
          </li>`).join('')}
        </ul>
      </div>`;
    return `<div class="team-columns">${col('A', teamA, 'a')}${col('B', teamB, 'b')}</div>`;
  }

  function renderIntro() {
    const groupColor = S.groupLabel === 'A' ? 'a' : 'b';
    app.innerHTML = `
      <div class="card center">
        <p class="lead">${esc(S.studyName || '小组任务实验')}</p>
        <h1>你被随机分配到 <span class="badge ${groupColor}">Group ${esc(S.groupLabel || '?')}</span></h1>
        <p class="muted">你的编号：Participant ${esc(S.label)}。以下是本轮所有参与者的分组情况。</p>
      </div>
      <div class="card">
        <h2>队伍名单</h2>
        ${renderRosterColumns()}
        <button id="start-btn" class="mt" style="width:100%;">开始合作计算任务</button>
      </div>`;
    document.getElementById('start-btn').addEventListener('click', async () => {
      try {
        const data = await api(`/api/runs/${S.runToken}/game/start`, { method: 'POST' });
        S.gameEndAt = data.gameEndAt; S.roster = data.roster;
        S.localPhase = 'playing';
        persist();
        render();
        startScoreboardPolling();
        requestProblem();
      } catch (e) { S.errorMessage = e.message; render(); }
    });
  }

  function renderPlaying() {
    const msLeft = Math.max(0, (S.gameEndAt || 0) - Date.now());
    app.innerHTML = `
      <div class="card">
        <div class="timer">剩余时间 <span id="timer-display">${formatTime(Math.ceil(msLeft / 1000))}</span></div>
        <div class="problem-box" id="problem-box">
          <div class="problem-text">${S.currentProblem ? esc(S.currentProblem.text) + ' = ?' : '…'}</div>
          <input type="number" id="answer-input" placeholder="输入答案后按回车" autocomplete="off" style="max-width:220px; margin:0 auto; text-align:center; font-size:1.3rem;" />
        </div>
      </div>
      <div class="card">
        <h2>实时计分板</h2>
        <div id="scoreboard-slot">${renderScoreboardHtml()}</div>
      </div>`;
    const inp = document.getElementById('answer-input');
    if (inp) {
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && S.currentProblem && inp.value !== '') { submitAnswer(inp.value); }
      });
      inp.focus();
    }
  }

  function renderScoreboardHtml() {
    const col = (team, cls) => {
      const list = (S.teams[team] || []).slice().sort((a, b) => a.label - b.label);
      return `
        <div class="team-col ${cls}">
          <h3>Group ${team}${team === S.groupLabel ? '（你的队伍）' : ''}</h3>
          <div class="team-total">${S.totals[team] || 0}</div>
          <ul class="member-list">
            ${list.map((p) => `<li class="member-row ${p.isReal ? 'me' : ''}">
              <span>Participant ${p.label}${p.isReal ? '（你）' : ''}</span>
              <span class="count">${p.correctCount}</span>
            </li>`).join('')}
          </ul>
        </div>`;
    };
    return `<div class="team-columns">${col('A', 'a')}${col('B', 'b')}</div>`;
  }

  function renderResults() {
    const a = S.totals.A || 0, b = S.totals.B || 0;
    let resultText;
    if (a === b) resultText = '双方打成平手！';
    else {
      const won = (a > b && S.groupLabel === 'A') || (b > a && S.groupLabel === 'B');
      resultText = won ? '恭喜，你的队伍获胜！' : '很遗憾，你的队伍这局落后了。';
    }
    app.innerHTML = `
      <div class="card center">
        <h1>计算任务结束</h1>
        <p class="lead">${esc(resultText)}</p>
        ${renderScoreboardHtml()}
        <button class="mt" id="continue-btn" style="width:100%;">继续下一部分</button>
      </div>`;
    document.getElementById('continue-btn').addEventListener('click', () => setPhase('instructions_nonscarce'));
  }

  function renderInstructionsNonscarce() {
    app.innerHTML = `
      <div class="card">
        <h1>说明</h1>
        <p>在这个任务中，我们想了解你在分配资源时的个人偏好。</p>
        <p>你和你的队友在探险中发现了一个山洞，里面有<strong>取之不尽</strong>的金币。</p>
        <p>现在，你需要为所有参与者（包括你自己）分配金币。由于金币数量是无限的，你给某位参与者分配多少金币，<strong>不会影响</strong>其他人能获得多少。</p>
        <p class="muted">请按照你的真实偏好进行分配，没有对错之分。</p>
        <button id="next-btn" style="width:100%;">下一步：理解检查</button>
      </div>`;
    document.getElementById('next-btn').addEventListener('click', () => setPhase('comprehension_nonscarce'));
  }

  function renderInstructionsScarce() {
    app.innerHTML = `
      <div class="card">
        <h1>新的情况</h1>
        <p>在上一轮之后，发生了一件新的事情：</p>
        <p>一群海盗突然出现，偷走了山洞里几乎所有的金币，<strong>只剩下 10 枚金币</strong>可供分配。</p>
        <p>这意味着金币总数现在是<strong>固定的</strong>。当你给某些参与者分配更多金币时，其他人获得的金币会相应减少。</p>
        <p>现在，请重新为所有参与者（包括你自己）分配这 10 枚金币。</p>
        <button id="next-btn" style="width:100%;">下一步：理解检查</button>
      </div>`;
    document.getElementById('next-btn').addEventListener('click', () => setPhase('comprehension_scarce'));
  }

  const COMPREHENSION = {
    nonscarce: [
      { q: '在这个任务中，金币的数量是：', options: ['有限的', '无限的', '不确定'], correct: 1 },
      { q: '在这个任务中，如果你给某位参与者分配更多金币：', options: ['其他参与者获得的金币会减少', '其他参与者获得的金币不会受到影响', '无法确定'], correct: 1 },
    ],
    scarce: [
      { q: '在当前任务中，金币总数是：', options: ['固定为 10 枚', '无限的', '不确定'], correct: 0 },
      { q: '在当前任务中，你分配给所有参与者的金币总和：', options: ['可以超过 10 枚', '不能超过 10 枚', '没有限制'], correct: 1 },
      { q: '在当前任务中，当你给某些参与者分配更多金币时：', options: ['不会影响分配给其他人的金币', '一定会减少你自己获得的金币', '可能需要减少分配给其他人的金币'], correct: 2 },
      { q: '以下哪一项最能描述参与者之间的关系：', options: ['每个人的金币是相互独立的', '由于总数有限，参与者之间可能需要权衡', '你的金币完全取决于其他人获得多少'], correct: 1 },
    ],
  };

  function renderComprehension(phase) {
    const questions = COMPREHENSION[phase];
    app.innerHTML = `
      <div class="card">
        <h1>理解检查</h1>
        <p class="lead">请回答以下问题，确认你理解了本轮任务的规则。</p>
        <form id="comp-form">
          ${questions.map((item, qi) => `
            <div class="mt">
              <label style="color:var(--color-text); font-weight:600;">Q${qi + 1}: ${esc(item.q)}</label>
              ${item.options.map((opt, oi) => `
                <label class="token-choices" style="display:flex; margin:4px 0;">
                  <input type="radio" name="q${qi}" value="${oi}" /> ${esc(opt)}
                </label>`).join('')}
            </div>`).join('')}
        </form>
        <div id="comp-error" class="notice error hidden mt"></div>
        <button id="comp-submit" class="mt" style="width:100%;">提交</button>
      </div>`;
    document.getElementById('comp-submit').addEventListener('click', () => {
      const form = document.getElementById('comp-form');
      let allCorrect = true, allAnswered = true;
      questions.forEach((item, qi) => {
        const checked = form.querySelector(`input[name="q${qi}"]:checked`);
        if (!checked) { allAnswered = false; return; }
        if (Number(checked.value) !== item.correct) allCorrect = false;
      });
      const errEl = document.getElementById('comp-error');
      if (!allAnswered) { errEl.textContent = '请回答所有问题。'; errEl.classList.remove('hidden'); return; }
      if (!allCorrect) { errEl.textContent = '有答案不正确，请再检查一下并重新提交。'; errEl.classList.remove('hidden'); return; }
      setPhase(phase === 'nonscarce' ? 'allocate_nonscarce' : 'allocate_scarce');
    });
  }

  function renderAllocate(phase) {
    const store = phase === 'nonscarce' ? S.allocNonscarce : S.allocScarce;
    const isScarce = phase === 'scarce';
    const roster = S.roster.length ? S.roster : [{ id: 'self', label: S.label, groupLabel: S.groupLabel }];
    app.innerHTML = `
      <div class="card">
        <h1>${isScarce ? '重新分配金币（共 10 枚）' : '分配金币'}</h1>
        <p class="lead">${isScarce ? '请为每位参与者选择分配的金币数，总和不能超过 10 枚。' : '金币数量无限，请为每位参与者分配 0-2 枚金币。'}</p>
        ${isScarce ? `<div class="notice mt" id="total-indicator">已分配：0 / 10</div>` : ''}
        <table class="alloc-table mt">
          <thead><tr><th>参与者</th><th>分组</th><th>金币</th></tr></thead>
          <tbody>
            ${roster.map((p) => `
              <tr>
                <td>Participant ${p.label}${p.id === 'self' ? '（你）' : ''}</td>
                <td><span class="badge ${p.groupLabel === 'A' ? 'a' : 'b'}">${p.groupLabel}</span></td>
                <td>
                  <div class="token-choices" data-target="${p.id}">
                    ${['0', '1', '2', 'cannot_decide'].map((v) => `
                      <label><input type="radio" name="alloc_${p.id}" value="${v}" ${store[p.id] === v ? 'checked' : ''}/> ${v === 'cannot_decide' ? '无法决定' : v}</label>
                    `).join('')}
                  </div>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
        <div id="alloc-error" class="notice error hidden mt"></div>
        <button id="alloc-submit" class="mt" style="width:100%;" ${S.submitting ? 'disabled' : ''}>提交</button>
      </div>`;

    function recomputeTotal() {
      if (!isScarce) return;
      let total = 0;
      roster.forEach((p) => {
        const checked = document.querySelector(`input[name="alloc_${p.id}"]:checked`);
        if (checked && checked.value !== 'cannot_decide') total += Number(checked.value);
      });
      const ind = document.getElementById('total-indicator');
      if (ind) { ind.textContent = `已分配：${total} / 10`; ind.classList.toggle('warn', total > 10); }
      return total;
    }
    app.querySelectorAll('input[type="radio"]').forEach((r) => r.addEventListener('change', recomputeTotal));
    recomputeTotal();

    document.getElementById('alloc-submit').addEventListener('click', async () => {
      const allocations = []; let allAnswered = true;
      roster.forEach((p) => {
        const checked = document.querySelector(`input[name="alloc_${p.id}"]:checked`);
        if (!checked) { allAnswered = false; return; }
        store[p.id] = checked.value;
        allocations.push({ targetId: p.id, tokens: checked.value });
      });
      const errEl = document.getElementById('alloc-error');
      if (!allAnswered) { errEl.textContent = '请为每位参与者选择一个分配值。'; errEl.classList.remove('hidden'); return; }
      if (isScarce) {
        const total = allocations.reduce((sum, a) => sum + (a.tokens === 'cannot_decide' ? 0 : Number(a.tokens)), 0);
        if (total > 10) { errEl.textContent = `分配总和为 ${total}，不能超过 10 枚，请重新调整。`; errEl.classList.remove('hidden'); return; }
      }
      errEl.classList.add('hidden');
      S.submitting = true; persist(); render();
      try {
        await api(`/api/runs/${S.runToken}/allocation`, { method: 'POST', body: JSON.stringify({ phase, allocations }) });
        S.submitting = false;
        setPhase(phase === 'nonscarce' ? 'survey_nonscarce' : 'survey_scarce');
      } catch (e) {
        S.submitting = false; render();
        alert('提交失败，请重试：' + e.message);
      }
    });
  }

  function renderSurvey(phase) {
    const store = phase === 'nonscarce' ? S.surveyNonscarce : S.surveyScarce;
    if (store.identification === undefined) store.identification = 0;
    if (store.ingroupFeeling === undefined) store.ingroupFeeling = 0;
    if (store.outgroupFeeling === undefined) store.outgroupFeeling = 0;
    const slider = (id, label, lowLabel, highLabel, value) => `
      <div class="slider-wrap">
        <label style="color:var(--color-text); font-weight:600;">${esc(label)}</label>
        <input type="range" id="${id}" min="-50" max="50" step="1" value="${value}" />
        <div class="slider-labels"><span>${esc(lowLabel)} (-50)</span><span id="${id}-val">${value}</span><span>${esc(highLabel)} (50)</span></div>
      </div>`;
    app.innerHTML = `
      <div class="card">
        <h1>几个问题</h1>
        <p class="lead">你所在的分组：<span class="badge ${S.groupLabel === 'A' ? 'a' : 'b'}">Group ${S.groupLabel}</span></p>
        ${slider('q-ident', 'Q1: 你在多大程度上认同自己的小组？', '完全不认同', '非常强烈认同', store.identification)}
        ${slider('q-in', `Q2: 你对本组（Group ${S.groupLabel}）成员的感觉如何？`, '非常不favorable', '非常favorable', store.ingroupFeeling)}
        ${slider('q-out', `Q3: 你对另一组成员的感觉如何？`, '非常不favorable', '非常favorable', store.outgroupFeeling)}
        <button id="survey-submit" class="mt" style="width:100%;" ${S.submitting ? 'disabled' : ''}>提交</button>
      </div>`;
    ['q-ident', 'q-in', 'q-out'].forEach((id) => {
      const el = document.getElementById(id); const out = document.getElementById(id + '-val');
      el.addEventListener('input', () => { out.textContent = el.value; });
    });
    document.getElementById('survey-submit').addEventListener('click', async () => {
      store.identification = Number(document.getElementById('q-ident').value);
      store.ingroupFeeling = Number(document.getElementById('q-in').value);
      store.outgroupFeeling = Number(document.getElementById('q-out').value);
      S.submitting = true; persist(); render();
      try {
        await api(`/api/runs/${S.runToken}/survey`, {
          method: 'POST',
          body: JSON.stringify({ phase, identification: store.identification, ingroupFeeling: store.ingroupFeeling, outgroupFeeling: store.outgroupFeeling }),
        });
        S.submitting = false;
        setPhase(phase === 'nonscarce' ? 'instructions_scarce' : 'debrief');
      } catch (e) {
        S.submitting = false; render();
        alert('提交失败，请重试：' + e.message);
      }
    });
  }

  function renderDebrief() {
    app.innerHTML = `
      <div class="card">
        <h1>研究说明（Debriefing）</h1>
        <p>感谢你的参与。在正式结束前，我们需要告诉你一件事：</p>
        <p><strong>本次实验中，你的"队友"和"对方队伍成员"实际上并不是真实的其他参与者，而是由计算机程序模拟生成的。</strong>这是社会认同理论相关研究中常用的实验设计方法，目的是在排除真实人际互动的情况下，观察你对"内群体"与"外群体"的真实反应。</p>
        <p class="muted">[研究者：请在此处替换为你们机构 IRB 批准的正式 debrief 文案。]</p>
        <button id="debrief-continue" class="mt" style="width:100%;">我已了解，继续</button>
      </div>`;
    document.getElementById('debrief-continue').addEventListener('click', () => setPhase('done'));
  }

  function renderDone() {
    const code = (S.runToken || '').slice(0, 8).toUpperCase();
    app.innerHTML = `
      <div class="card center">
        <h1>感谢你的参与！</h1>
        <p class="lead">本次实验的所有环节已经完成。</p>
        <div class="notice mt">完成码：<code class="join-code">${esc(code)}</code></div>
        <p class="muted mt">请将此完成码提供给研究者，或按照研究者的指示进行下一步操作。</p>
      </div>`;
  }

  boot();
})();
