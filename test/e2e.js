'use strict';
// 端到端 API 冒烟测试。用法：先启动服务，再 E2E_BASE=http://127.0.0.1:PORT node test/e2e.js
const base = process.env.E2E_BASE || 'http://127.0.0.1:3998';

let pass = 0;
function ok(cond, msg) {
  if (!cond) {
    console.error('✗ ' + msg);
    process.exit(1);
  }
  pass++;
  console.log('  ✓ ' + msg);
}

async function call(method, p, body, expected = 200) {
  const res = await fetch(base + p, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (res.status !== expected) {
    console.error(`✗ ${method} ${p} expected ${expected}, got ${res.status}:`, JSON.stringify(data));
    process.exit(1);
  }
  return data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // 全新库：未初始化
  let ov = await call('GET', '/api/overview');
  ok(ov.initialized === false, '空库未初始化');

  // 首版校验：悬空引用拒绝
  let rejected = await call('POST', '/api/initialize', {
    charter_title: '测试章程',
    clauses: [{ key: 'A', title: '一', body: '正文A' }],
    refs: [{ source: 'A', target: 'X', label: '' }],
  }, 400);
  ok(rejected.error === 'VALIDATION', '首版含悬空引用被拒绝');

  const init = await call('POST', '/api/initialize', {
    charter_title: '测试章程',
    clauses: [
      { key: 'A', title: '总则', body: 'AAA' },
      { key: 'B', title: '会员', body: 'BBB' },
      { key: 'C', title: '附则', body: 'CCC' },
    ],
    refs: [{ source: 'B', target: 'A', label: '参见' }],
  }, 201);
  ok(init.version_id === 1, '首版发布为 v1');

  await call('POST', '/api/initialize', {}, 409).catch(() => {});
  const again = await fetch(base + '/api/initialize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  ok(again.status === 409, '不能重复初始化');

  // 草案1：新增 D + 移动 C 到 B 前（A,C,B），改 A 正文
  const d1 = await call('POST', '/api/drafts', { name: 'd1' }, 201);
  await call('POST', `/api/drafts/${d1.id}/clauses`, { key: 'D', title: '新条', body: 'DDD' });
  await call('PUT', `/api/drafts/${d1.id}/clauses/A`, { title: '总则', body: 'AAA-改' });
  await call('POST', `/api/drafts/${d1.id}/clauses/C/move`, { after: 'A' });
  let det = await call('GET', `/api/drafts/${d1.id}?diff=1`);
  ok(JSON.stringify(det.clauses.map((c) => c.key)) === JSON.stringify(['A', 'C', 'B', 'D']), 'd1 顺序为 A,C,B,D');
  ok(det.diff.added.includes('D') && det.diff.changed.some((c) => c.key === 'A'), 'd1 差异含新增D与修改A');
  // 发布 -> v2
  const pub2 = await call('POST', `/api/drafts/${d1.id}/publish`, { note: 'v2' }, 201);
  ok(pub2.version_id === 2 && pub2.replayed === false, 'd1 发布为 v2');
  det = await call('GET', `/api/drafts/${d1.id}`);
  ok(det.status === 'published', 'd1 状态变为 published');
  // 已发布草案不可再改
  const closed = await fetch(base + `/api/drafts/${d1.id}/clauses/B`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'x', body: 'y' }),
  });
  ok(closed.status === 409, '已发布草案禁止修改');

  // 草案2：基于 v1，改 B（v2 没动 B 的正文）→ 应重放成功
  const d2 = await call('POST', '/api/drafts', { name: 'd2', baseline_id: 1 }, 201);
  await call('PUT', `/api/drafts/${d2.id}/clauses/B`, { title: '会员', body: 'BBB-改' });
  const pub3 = await call('POST', `/api/drafts/${d2.id}/publish`, { note: 'v3' }, 201);
  ok(pub3.version_id === 3 && pub3.replayed === true, 'd2 不相交改动重放发布为 v3');
  const v3 = await call('GET', '/api/versions/3');
  ok(JSON.stringify(v3.clauses.map((c) => c.key)) === JSON.stringify(['A', 'C', 'B', 'D']), 'v3 顺序重放正确 A,C,B,D');
  ok(v3.clauses.find((c) => c.key === 'A').body === 'AAA-改', 'v3 保留 v2 的 A 修改');
  ok(v3.clauses.find((c) => c.key === 'B').body === 'BBB-改', 'v3 含 d2 的 B 修改');
  ok(v3.clauses.find((c) => c.key === 'D').body === 'DDD', 'v3 含 v2 新增的 D');

  // 草案3：基于 v1 改 A（A 已在 v2 被改）→ 冲突拒绝，草案保留
  const d3 = await call('POST', '/api/drafts', { name: 'd3', baseline_id: 1 }, 201);
  await call('PUT', `/api/drafts/${d3.id}/clauses/A`, { title: '总则', body: 'AAA-另改' });
  const conflict = await call('POST', `/api/drafts/${d3.id}/publish`, {}, 409);
  ok(conflict.error === 'CONFLICT' && conflict.conflicts[0].kind === 'modify-modify', '同条款双方改动被拒绝');
  det = await call('GET', `/api/drafts/${d3.id}`);
  ok(det.status === 'open', '冲突后草案保留为 open');

  // 草案4：基于 v3 删除 C，发布（没有入边指向 C）-> v4
  const d4 = await call('POST', '/api/drafts', { name: 'd4', baseline_id: 3 }, 201);
  // B->A 仍有效，删 C 不影响；C 无入边
  await call('DELETE', `/api/drafts/${d4.id}/clauses/C`);
  det = await call('GET', `/api/drafts/${d4.id}`);
  ok(det.publishable === true && det.clauses.length === 3, '删除无入边条款后仍可发布');
  const pub4 = await call('POST', `/api/drafts/${d4.id}/publish`, { note: 'v4' }, 201);
  ok(pub4.version_id === 4, 'd4 发布为 v4');

  // 草案5：删除 B（B 有入边吗？引用是 B->A：删 B 后 source 缺失 → 悬空暂存）
  const d5 = await call('POST', '/api/drafts', { name: 'd5', baseline_id: 4 }, 201);
  det = await call('DELETE', `/api/drafts/${d5.id}/clauses/B`);
  ok(det.publishable === false, '删 B 后引用 B->A 悬空，不可发布');
  ok(det.issues.some((i) => i.code === 'dangling-ref'), '问题清单标注悬空引用');
  const badPub = await call('POST', `/api/drafts/${d5.id}/publish`, {}, 409);
  ok(badPub.error === 'DRAFT_INVALID', '悬空草案发布被拒绝');

  // 暂存指向不存在目标的引用
  const d6 = await call('POST', '/api/drafts', { name: 'd6', baseline_id: 4 }, 201);
  await call('POST', `/api/drafts/${d6.id}/refs`, { source: 'A', target: 'ZZZ', label: '未来条款' });
  det = await call('GET', `/api/drafts/${d6.id}`);
  ok(det.issues.some((i) => i.code === 'dangling-ref' && i.target === 'ZZZ'), '可暂存指向缺失目标的引用并标红');

  // 重建同标识条款 ZZZ 后悬空消除
  await call('POST', `/api/drafts/${d6.id}/clauses`, { key: 'ZZZ', title: '未来', body: 'zzz' });
  det = await call('GET', `/api/drafts/${d6.id}`);
  ok(!det.issues.some((i) => i.level === 'error'), '建立同标识条款后悬空消除');

  // 草案删除与已发布版完全相同的改动 -> NO_CHANGES（改动已全部包含在最新版）
  const d7 = await call('POST', '/api/drafts', { name: 'd7', baseline_id: 3 }, 201);
  await call('DELETE', `/api/drafts/${d7.id}/clauses/C`);
  const samePub = await call('POST', `/api/drafts/${d7.id}/publish`, {}, 400);
  ok(samePub.error === 'NO_CHANGES', '双方都已删除 C 且无其他差异时返回无改动');

  // 历史还原：v1 顺序与引用
  const v1 = await call('GET', '/api/versions/1');
  ok(JSON.stringify(v1.clauses.map((c) => c.key)) === JSON.stringify(['A', 'B', 'C']), 'v1 历史顺序还原 A,B,C');
  ok(v1.clauses.find((c) => c.key === 'A').body === 'AAA', 'v1 正文还原（不可变）');
  ok(v1.refs.length === 1 && v1.refs[0].source === 'B' && v1.refs[0].target === 'A', 'v1 引用还原');

  // 版本对比 v1 -> v3
  const cmp = await call('GET', '/api/versions/3?compare=1');
  ok(cmp.diff.added.includes('D') && cmp.diff.moved.includes('C'), '版本对比检测新增 D 与移动 C');
  ok(Array.isArray(cmp.changed_detail) && cmp.changed_detail.some((c) => c.bodySegments), '版本对比含正文逐字差异');

  // 无改动发布
  const d8 = await call('POST', '/api/drafts', { name: 'd8-noop', baseline_id: 1 }, 201);
  const noop = await call('POST', `/api/drafts/${d8.id}/publish`, {}, 400);
  ok(noop.error === 'NO_CHANGES', '与最新版无差异时拒绝发布');

  // ===========================================================================
  // 定时生效排程（锚定时间线，避免漂移）
  // T0 为排程段开始时刻；v5@T0+20s，v6 原 @T0+60s，改期后 @T0+40s
  // ===========================================================================
  // 当前（v4）即时生效中
  let eff = await call('GET', '/api/effective');
  ok(eff.version_id === 4 && eff.version.clauses.length === 3, '默认时点查询返回当前生效版 v4 及其完整条款');

  const T0 = Date.now();
  const at = (relMs) => new Date(T0 + relMs).toISOString();
  const waitUntil = async (relMs) => {
    const delay = T0 + relMs - Date.now() + 200;
    if (delay > 0) await sleep(delay);
  };

  // 新建草案：新增条款 Z（v5 将基于当前最新 v4，无重放）
  async function newDraftWithClause(name, key, body) {
    const d = await call('POST', '/api/drafts', { name }, 201);
    await call('POST', `/api/drafts/${d.id}/clauses`, { key, title: key, body });
    return d;
  }

  // v5：定时 T0+20s
  const ds5 = await newDraftWithClause('定时v5', 'Z', 'z-body');
  const t5 = at(20000);
  const pub5 = await call('POST', `/api/drafts/${ds5.id}/publish`, { note: 'v5定时', effective_at: t5 }, 201);
  ok(pub5.version_id === 5 && pub5.schedule_status === 'scheduled' && pub5.effective_at === t5, 'v5 定时发布入队');
  ok(pub5.schedule.current_version_id === 4 && pub5.schedule.pending.map((p) => p.id).join() === '5', '发布响应返回排程：当前 v4、待生效 [5]');
  let rev = pub5.schedule.schedule_revision;

  ov = await call('GET', '/api/overview');
  ok(ov.current_version_id === 4 && ov.latest_version_id === 5 && ov.schedule_revision === rev, 'overview 区分最新版 v5 与当前生效版 v4');

  // 队列未清空：未指定时刻的即时发布被拒绝
  const dImmediate = await newDraftWithClause('想即时', 'Y', 'y');
  const queued = await call('POST', `/api/drafts/${dImmediate.id}/publish`, {}, 409);
  ok(queued.error === 'QUEUE_NOT_EMPTY' && queued.schedule.pending.length === 1, '队列非空时即时发布被拒并返回当前排程');

  // 队列非空时草案仍可创建与编辑（草案操作保持可用）
  ok(dImmediate.id > 0, '队列期间草案可创建');

  // 乱序入队：时刻不晚于队列末尾 → 拒绝
  const dBadOrder = await newDraftWithClause('乱序', 'X', 'x');
  const orderErr = await call('POST', `/api/drafts/${dBadOrder.id}/publish`, { effective_at: at(5000) }, 409);
  ok(orderErr.error === 'SCHEDULE_ORDER_VIOLATION', '未来生效时刻未按发布版顺序严格递增时拒绝入队');

  // v6：定时 T0+60s 入队成功（严格晚于 v5）
  const t6 = at(60000);
  const pub6 = await call('POST', `/api/drafts/${dImmediate.id}/publish`, { note: 'v6定时', effective_at: t6 }, 201);
  ok(pub6.version_id === 6, '严格递增时刻可继续入队 v6');
  rev = pub6.schedule.schedule_revision;

  // 改期：落到过去拒绝；越过相邻版本拒绝；窗口内成功
  const pastErr = await call('POST', '/api/versions/6/schedule', { effective_at: '2020-01-01T00:00:00Z', schedule_revision: rev }, 400);
  ok(pastErr.error === 'PAST_EFFECTIVE_AT', '改期到过去被拒绝');
  const crossErr = await call('POST', '/api/versions/6/schedule', { effective_at: at(5000), schedule_revision: rev }, 409);
  ok(crossErr.error === 'SCHEDULE_ORDER_VIOLATION', '改期越过相邻的前一版本 v5 被拒绝');
  // 改期 v5 不能晚于后继 v6
  const crossErr2 = await call('POST', '/api/versions/5/schedule', { effective_at: at(120000), schedule_revision: rev }, 409);
  ok(crossErr2.error === 'SCHEDULE_ORDER_VIOLATION', '改期越过相邻的后一版本 v6 被拒绝');
  // v6 改期到 T0+40s（v5@+20s 与原 v6@+60s 之间）成功
  const t6b = at(40000);
  const rs = await call('POST', '/api/versions/6/schedule', { effective_at: t6b, schedule_revision: rev }, 200);
  ok(rs.effective_at === t6b && rs.schedule_revision === rev + 1, '改期成功并返回新修订号');
  rev = rs.schedule_revision;

  // 修订号过期：整次拒绝并返回当前排程
  const stale = await call('POST', '/api/versions/6/schedule', { effective_at: at(50000), schedule_revision: rev - 1 }, 409);
  ok(stale.error === 'STALE_SCHEDULE_REVISION' && stale.schedule.schedule_revision === rev, '过期修订号改期被拒并返回当前排程');

  // 时点查询：T0+30s 时 v5 已生效、v6 未生效
  const q1 = await call('GET', `/api/effective?at=${encodeURIComponent(at(30000))}`);
  ok(q1.version_id === 5 && q1.version.clauses.some((c) => c.key === 'Z'), '未来时点查询：v5 生效并含其完整条款顺序引用');

  // 等待 v5（T0+20s）惰性生效
  await waitUntil(20000);
  eff = await call('GET', '/api/effective');
  ok(eff.version_id === 5, 'v5 到点后自动成为当前生效版（惰性生效）');
  const already = await call('POST', '/api/versions/5/cancel', { schedule_revision: rev }, 409);
  ok(already.error === 'ALREADY_EFFECTIVE', '版本已生效后取消被拒绝');

  // 已发生时点的结果不随后续取消变化：取消 v6（原定 T0+40s）后，
  // T0+50s 的时点回落 v5；而 v5 生效区间内的结果（T0+30s）永远为 v5。
  const cancel6 = await call('POST', '/api/versions/6/cancel', { schedule_revision: rev }, 200);
  ok(cancel6.ok && cancel6.schedule.queue_open === false, '生效前取消 v6 成功，队列清空');
  rev = cancel6.schedule_revision;
  const q1again = await call('GET', `/api/effective?at=${encodeURIComponent(at(30000))}`);
  ok(q1again.version_id === 5, '已发生时点（T0+30s）的结果不随 v6 取消而变化');
  const qAfterCancel = await call('GET', `/api/effective?at=${encodeURIComponent(at(50000))}`);
  ok(qAfterCancel.version_id === 5, '取消 v6 后其原定时刻不再切换，仍为 v5');

  // 队列清空：未指定时刻的发布沿用即时生效
  const dNow = await newDraftWithClause('即时v7', 'W', 'w');
  const pub7 = await call('POST', `/api/drafts/${dNow.id}/publish`, {}, 201);
  ok(pub7.version_id === 7 && pub7.schedule_status === 'immediate', '队列清空后无时刻发布即时生效为 v7');
  eff = await call('GET', '/api/effective');
  ok(eff.version_id === 7, '即时发布后当前生效版为 v7');

  // 草案基线仍是“最新发布版” v7（快照发布即生成）
  const dFromLatest = await call('POST', '/api/drafts', { name: '基线跟随最新发布版' }, 201);
  ok(dFromLatest.baseline_id === 7, '新草案以最新发布版 v7 为基线（含未生效/已取消时也可作基线）');

  // 取消/改期目标版本不存在或非待生效
  const notFound = await fetch(base + '/api/versions/999/cancel', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ schedule_revision: rev }),
  }).then((r) => r.json());
  ok(notFound.error === 'NOT_FOUND', '取消不存在的版本返回 404');
  const cancelImmediate = await call('POST', '/api/versions/1/cancel', { schedule_revision: rev }, 409);
  ok(cancelImmediate.error === 'ALREADY_EFFECTIVE', '不能取消即时生效版本');

  // 缺修订号 / 缺时区设计符
  const noRev = await call('POST', '/api/versions/5/schedule', { effective_at: at(120000) }, 400);
  ok(noRev.error === 'VALIDATION', '改期缺少 schedule_revision 被拒绝');
  const dNaive = await newDraftWithClause('朴素时间', 'V', 'v');
  const naive = await call('POST', `/api/drafts/${dNaive.id}/publish`, { effective_at: '2027-01-01T00:00:00' }, 400);
  ok(naive.error === 'VALIDATION', '不带时区设计符的时刻被拒绝');

  // 历史快照：已取消的 v6 仍可完整查看（不可变版本快照保持可用）
  const v6snap = await call('GET', '/api/versions/6');
  ok(v6snap.schedule_status === 'cancelled' && v6snap.clauses.some((c) => c.key === 'Y'), '已取消版本快照仍可完整还原');

  // ===========================================================================
  // 发布预览 + 凭据确认（本轮新增）
  // 当前：v7 即时生效、队列为空
  // ===========================================================================
  // 1) 预览成功：返回凭据、差异与最终内容；不写版本、草案保持 open
  const dp1 = await call('POST', '/api/drafts', { name: '预览dp1' }, 201);
  await call('POST', `/api/drafts/${dp1.id}/clauses`, { key: 'P1', title: '预览新增', body: 'p1-body' });
  const pv1 = await call('POST', `/api/drafts/${dp1.id}/preview`, { note: 'v8预览' }, 200);
  ok(typeof pv1.token === 'string' && pv1.token.length > 20, '预览成功返回确认凭据');
  ok(pv1.schedule_status === 'immediate' && pv1.effective_at === null, '即时预览生效安排为 immediate / null');
  ok(pv1.replayed === false && pv1.latest_version_id === 7, '预览基于最新 v7 且无需重放');
  ok(pv1.version.order.includes('P1') && pv1.version.clauses.some((c) => c.key === 'P1'), '预览给出将要落库的条款正文与顺序');
  ok(pv1.diff.added.includes('P1'), '预览给出相对最新发布版的差异（新增 P1）');
  ov = await call('GET', '/api/overview');
  ok(ov.latest_version_id === 7, '预览不写版本（最新版仍为 v7）');
  det = await call('GET', `/api/drafts/${dp1.id}`);
  ok(det.status === 'open', '预览不关闭草案');

  // 凭据可查看：usable=true
  const pvGet = await call('GET', `/api/drafts/${dp1.id}/previews/${pv1.token}`);
  ok(pvGet.usable === true && pvGet.status === 'open', 'GET 预览显示凭据可用');

  // 2) 持凭据确认：同一事务发布与预览完全一致的内容 -> v8
  const conf1 = await call('POST', `/api/drafts/${dp1.id}/publish`, { preview_token: pv1.token }, 201);
  ok(conf1.version_id === 8 && conf1.confirmed_preview === true, '凭据确认发布为 v8');
  const v8 = await call('GET', '/api/versions/8');
  ok(v8.clauses.some((c) => c.key === 'P1' && c.body === 'p1-body'), 'v8 落库内容与预览一致');
  // 凭据不可重复使用
  const reuse = await call('POST', `/api/drafts/${dp1.id}/publish`, { preview_token: pv1.token }, 409);
  ok(reuse.error === 'CLOSED', '凭据不可重复使用且草案已关闭');
  // GET 凭据：consumed / 不可用
  const pvGetUsed = await call('GET', `/api/drafts/${dp1.id}/previews/${pv1.token}`);
  ok(pvGetUsed.usable === false && pvGetUsed.status === 'consumed', '已消费凭据显示不可用');

  // 3) 草案被编辑 -> 凭据失效，草案保留
  const dp2 = await call('POST', '/api/drafts', { name: '预览dp2' }, 201);
  await call('PUT', `/api/drafts/${dp2.id}/clauses/A`, { title: '总则', body: 'AAA-preview' });
  const pv2 = await call('POST', `/api/drafts/${dp2.id}/preview`, { note: 'editA' }, 200);
  await call('PUT', `/api/drafts/${dp2.id}/clauses/A`, { title: '总则', body: 'AAA-preview-2' });
  const staleEdit = await call('POST', `/api/drafts/${dp2.id}/publish`, { preview_token: pv2.token }, 409);
  ok(staleEdit.error === 'PREVIEW_STALE' && staleEdit.reason === 'draft-edited' && staleEdit.repreview === true, '草案被编辑使凭据失效并要求重新预览');
  det = await call('GET', `/api/drafts/${dp2.id}`);
  ok(det.status === 'open', '凭据失效后草案原样保留');

  // 4) 重新预览后，其他草案先发布 -> 凭据失效；再次预览可确认（不相交重放）
  let pv2b = await call('POST', `/api/drafts/${dp2.id}/preview`, { note: 'editA2' }, 200);
  const dp3 = await call('POST', '/api/drafts', { name: '直接插队v9' }, 201);
  await call('POST', `/api/drafts/${dp3.id}/clauses`, { key: 'Q3', title: '插队条款', body: 'q3' });
  await call('POST', `/api/drafts/${dp3.id}/publish`, { note: 'v9直接' }, 201);
  const staleNewer = await call('POST', `/api/drafts/${dp2.id}/publish`, { preview_token: pv2b.token }, 409);
  ok(staleNewer.reason === 'newer-version-published', '其他草案先发布使凭据失效');
  pv2b = await call('POST', `/api/drafts/${dp2.id}/preview`, { note: 'editA3' }, 200);
  const conf2 = await call('POST', `/api/drafts/${dp2.id}/publish`, { preview_token: pv2b.token }, 201);
  ok(conf2.version_id === 10 && conf2.replayed === true, '重新预览后凭据确认发布为 v10（重放）');
  const v10 = await call('GET', '/api/versions/10');
  ok(v10.clauses.some((c) => c.key === 'A' && c.body === 'AAA-preview-2') && v10.clauses.some((c) => c.key === 'Q3'),
    'v10 同时含草案 A 修改与他人先发布的 Q3（不相交重放）');

  // 5) 确认时回显与预览不同的说明 / 时刻 -> 400 CONFIRM_MISMATCH
  const dpM = await call('POST', '/api/drafts', { name: '回显校验' }, 201);
  await call('POST', `/api/drafts/${dpM.id}/clauses`, { key: 'MM', title: 'M', body: 'm' });
  const pvM = await call('POST', `/api/drafts/${dpM.id}/preview`, { note: '锁定说明' }, 200);
  const mm = await call('POST', `/api/drafts/${dpM.id}/publish`, { preview_token: pvM.token, note: '另一个说明' }, 400);
  ok(mm.error === 'CONFIRM_MISMATCH', '确认携带不同发布说明被拒绝');

  // 6) 预览冲突 / 草案无效：不发凭据、草案保留
  const dc = await call('POST', '/api/drafts', { name: '冲突预览', baseline_id: 9 }, 201);
  await call('PUT', `/api/drafts/${dc.id}/clauses/A`, { title: '总则', body: 'AAA-conflict' });
  const pvConflict = await call('POST', `/api/drafts/${dc.id}/preview`, { note: 'x' }, 409);
  ok(pvConflict.error === 'CONFLICT' && pvConflict.token === undefined, '预览遇三方冲突被拒且不返回凭据');
  det = await call('GET', `/api/drafts/${dc.id}`);
  ok(det.status === 'open', '冲突预览后草案保留');
  const di = await call('POST', '/api/drafts', { name: '无效预览' }, 201);
  await call('POST', `/api/drafts/${di.id}/refs`, { source: 'A', target: 'NOPE', label: '' });
  const pvInvalid = await call('POST', `/api/drafts/${di.id}/preview`, { note: 'x' }, 409);
  ok(pvInvalid.error === 'DRAFT_INVALID' && pvInvalid.token === undefined, '草案含悬空引用时预览被拒且不返回凭据');

  // 7) 不存在/不属于该草案的凭据 -> 404
  const noTok = await call('POST', `/api/drafts/${di.id}/publish`, { preview_token: 'not-a-real-token' }, 404);
  ok(noTok.error === 'PREVIEW_NOT_FOUND' && noTok.repreview === true, '未知凭据 404 并提示重新预览');

  // 8) 现有直接发布调用与错误语义继续可用
  const dd = await call('POST', '/api/drafts', { name: '直接发布' }, 201);
  await call('POST', `/api/drafts/${dd.id}/clauses`, { key: 'DD', title: '直接', body: 'dd' });
  const directPub = await call('POST', `/api/drafts/${dd.id}/publish`, { note: 'v11直接' }, 201);
  ok(directPub.version_id === 11 && directPub.confirmed_preview === undefined, '直接发布仍返回 201 且语义不变');
  const dnoop = await call('POST', '/api/drafts', { name: '预览无改动' }, 201);
  const pvNoop = await call('POST', `/api/drafts/${dnoop.id}/preview`, {}, 400);
  ok(pvNoop.error === 'NO_CHANGES', '无改动预览沿用 NO_CHANGES 错误语义');
  const pvNaive = await call('POST', `/api/drafts/${dnoop.id}/preview`, { effective_at: '2027-01-01T00:00:00' }, 400);
  ok(pvNaive.error === 'VALIDATION', '预览同样拒绝不带时区设计符的时刻');

  // 9) 定时预览不入队；确认后入队；改期/取消使凭据失效
  const ds1 = await call('POST', '/api/drafts', { name: '定时预览' }, 201);
  await call('POST', `/api/drafts/${ds1.id}/clauses`, { key: 'S1', title: '定时', body: 's1' });
  const tSched = new Date(Date.now() + 3600_000).toISOString();
  const pvSched = await call('POST', `/api/drafts/${ds1.id}/preview`, { note: 'v12定时', effective_at: tSched }, 200);
  ok(pvSched.schedule_status === 'scheduled' && pvSched.effective_at === tSched && pvSched.would_enqueue.position_after === 0, '定时预览锁定未来时刻与队列位置');
  let sch = await call('GET', '/api/schedule');
  ok(sch.pending.length === 0, '定时预览不入队（排程不变）');
  const confSched = await call('POST', `/api/drafts/${ds1.id}/publish`, { preview_token: pvSched.token }, 201);
  ok(confSched.version_id === 12 && confSched.schedule_status === 'scheduled' && confSched.schedule.pending.map((p) => p.id).join() === '12', '凭据确认定时发布并入队 v12');
  rev = confSched.schedule.schedule_revision;

  // 队列非空：即时预览拒绝；乱序时刻预览拒绝
  const ds2 = await call('POST', '/api/drafts', { name: '队列中预览' }, 201);
  await call('POST', `/api/drafts/${ds2.id}/clauses`, { key: 'S2', title: 'S2', body: 's2' });
  const pvQueued = await call('POST', `/api/drafts/${ds2.id}/preview`, { note: 'imm' }, 409);
  ok(pvQueued.error === 'QUEUE_NOT_EMPTY', '队列非空时即时预览被拒并返回当前排程');
  const pvOrder = await call('POST', `/api/drafts/${ds2.id}/preview`, { note: 'bad', effective_at: tSched }, 409);
  ok(pvOrder.error === 'SCHEDULE_ORDER_VIOLATION', '预览时刻不晚于队列末尾被拒');

  // 合法定时预览后取消队列中的版本 -> schedule-changed
  const tSched2 = new Date(Date.now() + 7200_000).toISOString();
  const pvS2 = await call('POST', `/api/drafts/${ds2.id}/preview`, { note: 'ok', effective_at: tSched2 }, 200);
  const cancel12 = await call('POST', '/api/versions/12/cancel', { schedule_revision: rev }, 200);
  rev = cancel12.schedule_revision;
  const pvS2Get = await call('GET', `/api/drafts/${ds2.id}/previews/${pvS2.token}`);
  ok(pvS2Get.usable === false && pvS2Get.stale_reason === 'schedule-changed', 'GET 预览反映排程变化导致的失效');
  const staleCancel = await call('POST', `/api/drafts/${ds2.id}/publish`, { preview_token: pvS2.token }, 409);
  ok(staleCancel.reason === 'schedule-changed' && staleCancel.schedule.pending.length === 0, '取消排程使凭据失效并返回当前排程');

  // 预定时刻已过 -> effective-time-passed（队列已空）
  const tSoon = new Date(Date.now() + 2000).toISOString();
  const pvSoon = await call('POST', `/api/drafts/${ds2.id}/preview`, { note: 'soon', effective_at: tSoon }, 200);
  await sleep(2500);
  const stalePassed = await call('POST', `/api/drafts/${ds2.id}/publish`, { preview_token: pvSoon.token }, 409);
  ok(stalePassed.reason === 'effective-time-passed', '预定时刻已过使凭据失效');
  det = await call('GET', `/api/drafts/${ds2.id}`);
  ok(det.status === 'open', '时刻过期后草案保留，可重新预览');

  console.log(`\n${pass} 项端到端断言全部通过`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
