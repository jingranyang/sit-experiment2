(function () {
  'use strict';
  const root = document.getElementById('admin-app');

  const A = {
    token: sessionStorage.getItem('sit_admin_token') || null,
    studies: [],
    detailId: null,
    detail: null,
    pollHandle: null,
  };

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function api(path, opts = {}) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    if (A.token) headers['x-admin-token'] = A.token;
    const res = await fetch(path, Object.assign({}, opts, { headers }));
    if (res.status === 401) {
      A.token = null;
      sessionStorage.removeItem('sit_admin_token');
      render();
      throw new Error('未授权，请重新登录');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || '请求失败');
    return data;
  }

  const PHASE_LABEL = {
    intro: '刚进入', playing: '答题中', results: '看结果', instructions_nonscarce: '非稀缺说明',
    comprehension_nonscarce: '理解检查1', allocate_nonscarce: '非稀缺分配', survey_nonscarce: '问卷1',
    instructions_scarce: '稀缺说明', comprehension_scarce: '理解检查2', allocate_scarce: '稀缺分配',
    survey_scarce: '问卷2', debrief: 'Debrief', done: '已完成',
  };
  const BIAS_LABEL = { win: '本队倾向获胜', lose: '本队倾向落后', tie: '势均力敌', random: '完全随机（不干预）' };

  function render() {
    if (!A.token) return renderLogin();
    if (A.detailId) return renderDetail();
    return renderList();
  }

  function renderLogin() {
    root.innerHTML = `
      <div class="card">
        <h1>研究者后台</h1>
        <p class="lead">请输入管理密码登录。</p>
        <input type="password" id="pw" placeholder="管理密码" />
        <div id="login-err" class="notice error hidden mt"></div>
        <button id="login-btn" class="mt" style="width:100%;">登录</button>
      </div>`;
    const pw = document.getElementById('pw');
    const btn = document.getElementById('login-btn');
    const doLogin = async () => {
      try {
        const res = await fetch('/api/admin/login', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw.value }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.message || '登录失败');
        A.token = data.token;
        sessionStorage.setItem('sit_admin_token', A.token);
        await loadStudies();
        render();
      } catch (e) {
        document.getElementById('login-err').textContent = e.message;
        document.getElementById('login-err').classList.remove('hidden');
      }
    };
    btn.addEventListener('click', doLogin);
    pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
  }

  async function loadStudies() {
    const data = await api('/api/admin/studies');
    A.studies = data.studies;
  }

  function renderList() {
    root.innerHTML = `
      <div class="card">
        <h1>创建新研究</h1>
        <p class="lead">参与者打开链接后立即开始，无需等待其他人——"队友"和"对方队伍"由系统模拟生成。</p>
        <div class="row">
          <div>
            <label>研究名称</label>
            <input type="text" id="f-name" placeholder="例如：预实验 A 组" />
          </div>
        </div>
        <div class="row">
          <div>
            <label>模拟队友人数（不含参与者本人）</label>
            <input type="number" id="f-ingroup" value="4" min="0" max="50" />
          </div>
          <div>
            <label>模拟对方队伍人数</label>
            <input type="number" id="f-outgroup" value="5" min="0" max="50" />
          </div>
        </div>
        <div class="row">
          <div>
            <label>数学任务时长（秒）</label>
            <input type="number" id="f-dur" value="180" min="15" max="1800" />
          </div>
          <div>
            <label>题目难度</label>
            <select id="f-diff">
              <option value="easy">简单</option>
              <option value="medium" selected>中等</option>
              <option value="hard">困难</option>
            </select>
          </div>
        </div>
        <div class="row">
          <div>
            <label>结果倾向（模拟对方/队友进度的偏向，概率性而非精确保证）</label>
            <select id="f-bias">
              <option value="random" selected>完全随机（不干预）</option>
              <option value="win">本队倾向获胜</option>
              <option value="lose">本队倾向落后</option>
              <option value="tie">势均力敌</option>
            </select>
          </div>
        </div>
        <button id="create-btn" class="mt" style="width:100%;">创建研究</button>
      </div>
      <div class="card">
        <h1>已有研究</h1>
        <div id="study-list"><p class="muted">加载中…</p></div>
      </div>`;

    document.getElementById('create-btn').addEventListener('click', async () => {
      const name = document.getElementById('f-name').value || '未命名研究';
      const fakeInGroupCount = Number(document.getElementById('f-ingroup').value);
      const fakeOutGroupCount = Number(document.getElementById('f-outgroup').value);
      const mathDurationSec = Number(document.getElementById('f-dur').value);
      const difficulty = document.getElementById('f-diff').value;
      const outcomeBias = document.getElementById('f-bias').value;
      try {
        await api('/api/admin/studies', {
          method: 'POST',
          body: JSON.stringify({ name, fakeInGroupCount, fakeOutGroupCount, mathDurationSec, difficulty, outcomeBias }),
        });
        await loadStudies();
        renderStudyList();
      } catch (e) { alert(e.message); }
    });

    renderStudyList();
    if (A.pollHandle) clearInterval(A.pollHandle);
    A.pollHandle = setInterval(async () => {
      if (A.detailId) return;
      try { await loadStudies(); renderStudyList(); } catch (e) { /* ignore transient */ }
    }, 4000);
  }

  function renderStudyList() {
    const el = document.getElementById('study-list');
    if (!el) return;
    if (!A.studies.length) { el.innerHTML = '<p class="muted">还没有创建任何研究。</p>'; return; }
    el.innerHTML = A.studies.map((s) => {
      const joinUrl = `${location.origin}/?s=${s.id}`;
      return `
      <div class="session-item">
        <div>
          <div><strong>${esc(s.name)}</strong> <span class="status-chip">${BIAS_LABEL[s.outcome_bias] || s.outcome_bias}</span></div>
          <div class="muted" style="font-size:0.85rem;">代码 <code class="join-code" style="font-size:0.95rem; padding:2px 6px;">${s.id}</code> · ${s.completedCount}/${s.runCount} 人已完成 · 每队虚拟人数 ${s.fake_ingroup_count}/${s.fake_outgroup_count} · <a href="${joinUrl}" target="_blank">加入链接</a></div>
        </div>
        <div class="row" style="max-width:220px;">
          <button class="secondary" data-detail="${s.id}">详情</button>
          <a class="btn secondary" style="text-align:center; text-decoration:none;" href="/api/admin/studies/${s.id}/export.csv" data-export="${s.id}">导出CSV</a>
        </div>
      </div>`;
    }).join('');
    el.querySelectorAll('[data-detail]').forEach((btn) => {
      btn.addEventListener('click', () => { A.detailId = btn.getAttribute('data-detail'); loadDetail(); });
    });
    el.querySelectorAll('[data-export]').forEach((a) => {
      a.addEventListener('click', (e) => { e.preventDefault(); downloadCsv(a.getAttribute('data-export')); });
    });
  }

  function downloadCsv(id) {
    fetch(`/api/admin/studies/${id}/export.csv`, { headers: { 'x-admin-token': A.token } })
      .then((r) => r.blob())
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url; link.download = `study_${id}.csv`;
        document.body.appendChild(link); link.click(); link.remove();
        URL.revokeObjectURL(url);
      });
  }

  async function loadDetail() {
    try { A.detail = await api(`/api/admin/studies/${A.detailId}`); renderDetail(); }
    catch (e) { A.detailId = null; alert(e.message); render(); }
  }

  function renderDetail() {
    if (!A.detail) { root.innerHTML = `<div class="card center"><p class="muted">加载中…</p></div>`; return; }
    const { study, runs } = A.detail;
    const joinUrl = `${location.origin}/?s=${study.id}`;
    root.innerHTML = `
      <div class="card">
        <button class="secondary" id="back-btn">← 返回列表</button>
        <h1 class="mt">${esc(study.name)}</h1>
        <p class="muted">加入代码 <code class="join-code" style="font-size:1rem; padding:2px 8px;">${study.id}</code> · ${BIAS_LABEL[study.outcome_bias] || study.outcome_bias}</p>
        <div class="notice">加入链接（可反复分享，每人打开后独立开始）：<a href="${joinUrl}" target="_blank">${joinUrl}</a></div>
        <div class="row mt">
          <div class="notice">模拟队友/对方人数：${study.fake_ingroup_count} / ${study.fake_outgroup_count}</div>
          <div class="notice">数学任务时长：${study.math_duration_sec}s</div>
          <div class="notice">已开始人次：${runs.length}</div>
        </div>
        <a class="btn mt" style="display:block; text-align:center; text-decoration:none; width:100%;" href="/api/admin/studies/${study.id}/export.csv" id="detail-export">导出本研究数据 CSV</a>
      </div>
      <div class="card">
        <h2>参与记录</h2>
        ${runs.length ? `
          <table class="alloc-table">
            <thead><tr><th>编号</th><th>分组</th><th>正确题数</th><th>当前阶段</th></tr></thead>
            <tbody>
              ${runs.map((r) => `<tr>
                <td>P${r.label}</td>
                <td><span class="badge ${r.groupLabel === 'A' ? 'a' : 'b'}">${r.groupLabel}</span></td>
                <td>${r.correctCount}</td>
                <td>${PHASE_LABEL[r.phase] || r.phase}</td>
              </tr>`).join('')}
            </tbody>
          </table>` : '<p class="muted">还没有人开始这项研究。</p>'}
      </div>`;
    document.getElementById('back-btn').addEventListener('click', () => { A.detailId = null; A.detail = null; render(); });
    document.getElementById('detail-export').addEventListener('click', (e) => { e.preventDefault(); downloadCsv(study.id); });

    if (A.pollHandle) clearInterval(A.pollHandle);
    A.pollHandle = setInterval(async () => {
      if (!A.detailId) return;
      try { A.detail = await api(`/api/admin/studies/${A.detailId}`); renderDetail(); } catch (e) { /* ignore */ }
    }, 3000);
  }

  if (A.token) { loadStudies().then(render).catch(() => { A.token = null; render(); }); }
  else { render(); }
})();
