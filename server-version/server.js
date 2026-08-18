'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./lib/db');
const { generateProblem } = require('./lib/mathgen');
const { buildRoster, generateBotSchedule, computeScoreboard } = require('./lib/botgen');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'sit-admin-2026';
const PUBLIC_DIR = path.join(__dirname, 'public');

if (!process.env.ADMIN_PASSWORD) {
  console.warn(
    '[warn] ADMIN_PASSWORD env var not set — using default admin password. ' +
      'Set ADMIN_PASSWORD before deploying for real data collection.'
  );
}

const adminTokens = new Set();
const pendingProblems = new Map(); // runId -> { problemId, answer, createdAt }
const botScheduleCache = new Map(); // runId -> schedule object (also could be recomputed from a seed; cached for speed)

function shortId(len = 8) {
  return crypto.randomBytes(len).toString('hex');
}
function studyCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += alphabet[crypto.randomInt(0, alphabet.length)];
  return s;
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------
function getStudy(id) {
  return db.get('SELECT * FROM studies WHERE id = ?', [id]);
}
function getRun(id) {
  return db.get('SELECT * FROM runs WHERE id = ?', [id]);
}
function listRuns(studyId) {
  return db.all('SELECT * FROM runs WHERE study_id = ? ORDER BY created_at ASC', [studyId]);
}
function parseRoster(run) {
  return JSON.parse(run.roster_json);
}
function touchRun(runId) {
  db.run("UPDATE runs SET updated_at = datetime('now') WHERE id = ?", [runId]);
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}
function requireAdmin(req) {
  const token = req.headers['x-admin-token'];
  return token && adminTokens.has(token);
}
function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// ---------------------------------------------------------------------------
// Admin API
// ---------------------------------------------------------------------------
async function handleApi(req, res, urlObj) {
  const p = urlObj.pathname;

  if (p === '/api/admin/login' && req.method === 'POST') {
    const body = await readJsonBody(req).catch(() => ({}));
    if (body.password === ADMIN_PASSWORD) {
      const token = shortId(24);
      adminTokens.add(token);
      return sendJson(res, 200, { ok: true, token });
    }
    return sendJson(res, 401, { ok: false, message: '密码错误' });
  }

  if (p === '/api/admin/studies' && req.method === 'POST') {
    if (!requireAdmin(req)) return sendJson(res, 401, { message: '未授权' });
    const body = await readJsonBody(req).catch(() => ({}));
    const name = (body.name || '未命名研究').toString().slice(0, 200);
    const fakeInGroupCount = Math.max(0, Math.min(50, parseInt(body.fakeInGroupCount, 10) ?? 4));
    const fakeOutGroupCount = Math.max(0, Math.min(50, parseInt(body.fakeOutGroupCount, 10) ?? 5));
    const mathDurationSec = Math.max(15, Math.min(1800, parseInt(body.mathDurationSec, 10) || 180));
    const difficulty = ['easy', 'medium', 'hard'].includes(body.difficulty) ? body.difficulty : 'medium';
    const outcomeBias = ['win', 'lose', 'tie', 'random'].includes(body.outcomeBias) ? body.outcomeBias : 'random';
    const id = studyCode();
    db.run(
      `INSERT INTO studies (id, name, fake_ingroup_count, fake_outgroup_count, math_duration_sec, difficulty, outcome_bias)
       VALUES (?,?,?,?,?,?,?)`,
      [id, name, fakeInGroupCount, fakeOutGroupCount, mathDurationSec, difficulty, outcomeBias]
    );
    return sendJson(res, 200, { id, name, fakeInGroupCount, fakeOutGroupCount, mathDurationSec, difficulty, outcomeBias });
  }

  if (p === '/api/admin/studies' && req.method === 'GET') {
    if (!requireAdmin(req)) return sendJson(res, 401, { message: '未授权' });
    const studies = db.all('SELECT * FROM studies ORDER BY created_at DESC');
    const withCounts = studies.map((s) => {
      const runs = listRuns(s.id);
      const completed = runs.filter((r) => r.phase === 'done').length;
      return { ...s, runCount: runs.length, completedCount: completed };
    });
    return sendJson(res, 200, { studies: withCounts });
  }

  const detailMatch = p.match(/^\/api\/admin\/studies\/([A-Z0-9]+)$/);
  if (detailMatch && req.method === 'GET') {
    if (!requireAdmin(req)) return sendJson(res, 401, { message: '未授权' });
    const study = getStudy(detailMatch[1]);
    if (!study) return sendJson(res, 404, { message: '未找到该研究' });
    const runs = listRuns(study.id).map((r) => ({
      id: r.id, label: r.label, groupLabel: r.group_label, correctCount: r.correct_count,
      phase: r.phase, createdAt: r.created_at,
    }));
    return sendJson(res, 200, { study, runs });
  }

  const exportMatch = p.match(/^\/api\/admin\/studies\/([A-Z0-9]+)\/export\.csv$/);
  if (exportMatch && req.method === 'GET') {
    if (!requireAdmin(req)) return sendJson(res, 401, { message: '未授权' });
    const study = getStudy(exportMatch[1]);
    if (!study) return sendJson(res, 404, { message: '未找到该研究' });
    const csv = buildExportCsv(study.id);
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="study_${study.id}.csv"`,
    });
    return res.end('﻿' + csv);
  }

  const publicStudyMatch = p.match(/^\/api\/study\/([A-Z0-9]+)\/public$/);
  if (publicStudyMatch && req.method === 'GET') {
    const study = getStudy(publicStudyMatch[1]);
    if (!study) return sendJson(res, 404, { message: '未找到该研究，请确认链接是否正确。' });
    return sendJson(res, 200, { id: study.id, name: study.name });
  }

  // ---- Participant-facing run API ----

  if (p === '/api/runs/start' && req.method === 'POST') {
    const body = await readJsonBody(req).catch(() => ({}));
    const study = getStudy((body.studyId || '').toUpperCase());
    if (!study) return sendJson(res, 404, { message: '未找到该研究，请确认链接是否正确。' });
    const { roster, realGroup, realLabel } = buildRoster(study);
    const runId = crypto.randomUUID();
    db.run(
      `INSERT INTO runs (id, study_id, label, group_label, roster_json, correct_count, phase)
       VALUES (?,?,?,?,?,0,'intro')`,
      [runId, study.id, realLabel, realGroup, JSON.stringify(roster)]
    );
    return sendJson(res, 200, {
      runToken: runId,
      studyId: study.id,
      studyName: study.name,
      label: realLabel,
      groupLabel: realGroup,
      roster,
      mathDurationSec: study.math_duration_sec,
    });
  }

  const runTokenMatch = p.match(/^\/api\/runs\/([a-f0-9-]+)(\/.*)?$/);
  if (runTokenMatch) {
    const runId = runTokenMatch[1];
    const sub = runTokenMatch[2] || '';
    const run = getRun(runId);
    if (!run) return sendJson(res, 404, { message: '找不到你的实验记录，链接可能已失效。' });
    const study = getStudy(run.study_id);

    if (sub === '/state' && req.method === 'GET') {
      const roster = parseRoster(run);
      let scoreboard = null;
      if (run.game_start_at) {
        scoreboard = computeCurrentScoreboard(run, study, roster);
      }
      return sendJson(res, 200, {
        phase: run.phase,
        label: run.label,
        groupLabel: run.group_label,
        roster,
        mathDurationSec: study.math_duration_sec,
        correctCount: run.correct_count,
        gameEndAt: run.game_end_at ? new Date(run.game_end_at).getTime() : null,
        scoreboard,
      });
    }

    if (sub === '/game/start' && req.method === 'POST') {
      const roster = parseRoster(run);
      const schedule = generateBotSchedule(study, roster, run.group_label);
      botScheduleCache.set(runId, schedule);
      const startAt = Date.now();
      const endAt = startAt + study.math_duration_sec * 1000;
      db.run(
        "UPDATE runs SET phase = 'playing', game_start_at = ?, game_end_at = ? WHERE id = ?",
        [new Date(startAt).toISOString(), new Date(endAt).toISOString(), runId]
      );
      return sendJson(res, 200, { gameEndAt: endAt, roster });
    }

    if (sub === '/problem' && req.method === 'GET') {
      if (run.phase !== 'playing' || (run.game_end_at && Date.now() > new Date(run.game_end_at).getTime())) {
        return sendJson(res, 200, { finished: true });
      }
      const problem = generateProblem(study.difficulty);
      pendingProblems.set(runId, { problemId: problem.id, answer: problem.answer, createdAt: Date.now() });
      return sendJson(res, 200, { problemId: problem.id, text: problem.text });
    }

    if (sub === '/answer' && req.method === 'POST') {
      const body = await readJsonBody(req).catch(() => ({}));
      const pending = pendingProblems.get(runId);
      if (!pending || pending.problemId !== body.problemId) {
        return sendJson(res, 200, { stale: true });
      }
      pendingProblems.delete(runId);
      if (run.phase !== 'playing' || (run.game_end_at && Date.now() > new Date(run.game_end_at).getTime())) {
        return sendJson(res, 200, { finished: true });
      }
      const isCorrect = Number(body.answer) === Number(pending.answer);
      db.run(
        'INSERT INTO math_events (run_id, problem, given_answer, correct) VALUES (?,?,?,?)',
        [runId, pending.problemId, String(body.answer), isCorrect ? 1 : 0]
      );
      if (isCorrect) {
        db.run('UPDATE runs SET correct_count = correct_count + 1 WHERE id = ?', [runId]);
      }
      const updated = getRun(runId);
      return sendJson(res, 200, { correct: isCorrect, correctCount: updated.correct_count });
    }

    if (sub === '/scoreboard' && req.method === 'GET') {
      const roster = parseRoster(run);
      const result = computeCurrentScoreboard(run, study, roster);
      return sendJson(res, 200, result);
    }

    if (sub === '/phase' && req.method === 'POST') {
      const body = await readJsonBody(req).catch(() => ({}));
      const allowed = new Set([
        'intro', 'playing', 'results', 'instructions_nonscarce', 'comprehension_nonscarce',
        'allocate_nonscarce', 'survey_nonscarce', 'instructions_scarce', 'comprehension_scarce',
        'allocate_scarce', 'survey_scarce', 'debrief', 'done',
      ]);
      if (!allowed.has(body.phase)) return sendJson(res, 400, { message: '无效阶段' });
      db.run('UPDATE runs SET phase = ? WHERE id = ?', [body.phase, runId]);
      touchRun(runId);
      return sendJson(res, 200, { ok: true });
    }

    if (sub === '/allocation' && req.method === 'POST') {
      const body = await readJsonBody(req).catch(() => ({}));
      const roster = parseRoster(run);
      const byId = Object.fromEntries(roster.map((p) => [p.id, p]));
      if (!['nonscarce', 'scarce'].includes(body.phase)) return sendJson(res, 400, { message: '无效的阶段' });
      if (!Array.isArray(body.allocations) || body.allocations.length !== roster.length) {
        return sendJson(res, 400, { message: '必须为名单上的每一位参与者提交一个分配值' });
      }
      const VALID_TOKENS = new Set(['0', '1', '2', 'cannot_decide']);
      let numericSum = 0;
      for (const a of body.allocations) {
        if (!byId[a.targetId]) return sendJson(res, 400, { message: '分配目标无效' });
        const tokenStr = String(a.tokens);
        if (!VALID_TOKENS.has(tokenStr)) return sendJson(res, 400, { message: '分配数值必须是 0、1、2 或"无法决定"' });
        if (tokenStr !== 'cannot_decide') numericSum += Number(tokenStr);
      }
      if (body.phase === 'scarce' && numericSum > 10) {
        return sendJson(res, 400, { message: `分配总和为 ${numericSum}，不能超过 10 枚` });
      }
      for (const a of body.allocations) {
        const target = byId[a.targetId];
        const label = `Participant ${target.label} (${target.groupLabel})`;
        db.run(
          'INSERT INTO allocations (run_id, target_id, target_label, phase, tokens) VALUES (?,?,?,?,?)',
          [runId, a.targetId, label, body.phase, String(a.tokens)]
        );
      }
      touchRun(runId);
      return sendJson(res, 200, { ok: true });
    }

    if (sub === '/survey' && req.method === 'POST') {
      const body = await readJsonBody(req).catch(() => ({}));
      if (!['nonscarce', 'scarce'].includes(body.phase)) return sendJson(res, 400, { message: '无效的阶段' });
      const fields = [body.identification, body.ingroupFeeling, body.outgroupFeeling];
      if (fields.some((v) => typeof v !== 'number' || v < -50 || v > 50 || Number.isNaN(v))) {
        return sendJson(res, 400, { message: '问卷数值必须在 -50 到 50 之间' });
      }
      db.run(
        'INSERT INTO survey_responses (run_id, phase, identification, ingroup_feeling, outgroup_feeling) VALUES (?,?,?,?,?)',
        [runId, body.phase, body.identification, body.ingroupFeeling, body.outgroupFeeling]
      );
      touchRun(runId);
      return sendJson(res, 200, { ok: true });
    }
  }

  sendJson(res, 404, { message: 'Not found' });
}

function computeCurrentScoreboard(run, study, roster) {
  const schedule = botScheduleCache.get(run.id) || {};
  const startMs = run.game_start_at ? new Date(run.game_start_at).getTime() : Date.now();
  const endMs = run.game_end_at ? new Date(run.game_end_at).getTime() : Date.now();
  const nowMs = Math.min(Date.now(), endMs);
  const elapsedMs = Math.max(0, nowMs - startMs);
  const finished = Date.now() >= endMs;
  const fresh = getRun(run.id);
  const { teams, totals } = computeScoreboard(roster, schedule, run.group_label, fresh.correct_count, elapsedMs);
  if (finished && fresh.phase === 'playing') {
    db.run("UPDATE runs SET phase = 'results' WHERE id = ?", [run.id]);
  }
  return { teams, totals, finished, msRemaining: Math.max(0, endMs - Date.now()) };
}

function buildExportCsv(studyId) {
  const rows = [];
  rows.push(['study_id', 'run_id', 'run_label', 'group_label', 'correct_count', 'phase', 'record_type', 'sub_phase', 'field_or_target', 'value']);

  const runs = listRuns(studyId);
  for (const r of runs) {
    rows.push([studyId, r.id, r.label, r.group_label, r.correct_count, r.phase, 'summary', '', '', '']);
    const allocations = db.all('SELECT * FROM allocations WHERE run_id = ?', [r.id]);
    for (const a of allocations) {
      rows.push([studyId, r.id, r.label, r.group_label, '', r.phase, 'allocation', a.phase, a.target_label, a.tokens]);
    }
    const surveys = db.all('SELECT * FROM survey_responses WHERE run_id = ?', [r.id]);
    for (const s of surveys) {
      rows.push([studyId, r.id, r.label, r.group_label, '', r.phase, 'survey', s.phase, 'identification', s.identification]);
      rows.push([studyId, r.id, r.label, r.group_label, '', r.phase, 'survey', s.phase, 'ingroup_feeling', s.ingroup_feeling]);
      rows.push([studyId, r.id, r.label, r.group_label, '', r.phase, 'survey', s.phase, 'outgroup_feeling', s.outgroup_feeling]);
    }
  }
  return rows.map((row) => row.map(csvEscape).join(',')).join('\n');
}

// ---------------------------------------------------------------------------
// Static file server
// ---------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png',
};
function serveStatic(req, res, urlObj) {
  let reqPath = decodeURIComponent(urlObj.pathname);
  if (reqPath === '/') reqPath = '/index.html';
  if (reqPath === '/admin') reqPath = '/admin.html';
  const safeSuffix = path.normalize(reqPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, safeSuffix);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(400); return res.end('Bad request'); }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Not found'); }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (urlObj.pathname.startsWith('/api/')) {
    handleApi(req, res, urlObj).catch((e) => {
      console.error(e);
      sendJson(res, 500, { message: 'Server error' });
    });
    return;
  }
  serveStatic(req, res, urlObj);
});

server.listen(PORT, () => {
  console.log(`SIT experiment platform (bot-simulated groupmates) listening on port ${PORT}`);
  console.log(`Database file: ${db.DB_PATH}`);
});

module.exports = { server };
