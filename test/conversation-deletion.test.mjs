import test from 'node:test';
import assert from 'node:assert/strict';
import {createConversationClient, conversationBlockReason} from '../public/conversations.js';

// Drain promise work without a real-time sleep; all debounce/lease time is virtual.
const settle = () => new Promise(setImmediate);
function clock() {
  let time = 1000, sequence = 0;
  const jobs = new Map();
  const add = (fn, delay, repeat = 0) => {
    const id = ++sequence;
    jobs.set(id, {fn, at: time + delay, repeat});
    return id;
  };
  return {
    now: () => time,
    setTimeout: (fn, delay) => add(fn, delay),
    clearTimeout: id => jobs.delete(id),
    setInterval: (fn, delay) => add(fn, delay, delay),
    clearInterval: id => jobs.delete(id),
    get size() { return jobs.size; },
    async advance(ms) {
      const end = time + ms;
      for (;;) {
        const next = [...jobs].filter(([, job]) => job.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        const [id, job] = next;
        time = job.at;
        if (job.repeat) job.at += job.repeat;
        else jobs.delete(id);
        job.fn();
        await settle();
      }
      time = end;
      await settle();
    },
  };
}
function record(id, revision, patch = {}) {
  return {title: '新对话', status: 'idle', messages: [], draft: '', settings: {}, pinned: false,
    archived: false, runId: null, leaseUntil: null, ...patch, id, revision};
}
function harness(t) {
  const timers = clock(), calls = [], unread = [];
  const fetcher = (url, options) => new Promise((resolve, reject) => {
    const call = {
      route: url.replace('/api/account/conversations', ''), options,
      body: options.body ? JSON.parse(options.body) : undefined,
      reply(value, status = 200) {
        resolve({ok: status >= 200 && status < 300, status, json: async () => structuredClone(value)});
      },
      invalidJSON(status = 200) {
        resolve({ok: status >= 200 && status < 300, status, json: async () => { throw new SyntaxError('invalid JSON'); }});
      },
      reject,
    };
    calls.push(call);
    unread.push(call);
  });
  const client = createConversationClient({tenantId: 'tenant-a', userId: 'owner-a', fetcher, timers, now: timers.now});
  t.after(() => client.dispose());
  const next = async route => {
    await settle();
    assert.ok(unread.length, `expected request ${route || '(create)'}`);
    const call = unread.shift();
    assert.equal(call.route, route);
    return call;
  };
  const saved = async () => {
    const entry = client.local();
    const work = client.flush(entry, {force: true});
    const create = await next('');
    create.reply(record('saved-1', 1, create.body));
    await work;
    return entry;
  };
  return {client, timers, calls, next, saved};
}
async function assertTombstone(h, entry, previousIds = []) {
  assert.equal(entry.deleted, true);
  assert.equal(entry.deleting, false);
  assert.equal(entry.error, null);
  assert.equal(h.client.readOnly(entry), true);
  assert.match(conversationBlockReason(entry), /已删除/);
  const count = h.calls.length, version = entry.version, draft = entry.draft;
  assert.equal(h.client.change(entry, {draft: '不能复活'}), false);
  await Promise.all([h.client.flush(entry), h.client.flush(entry, {force: true}), h.client.remove(entry)]);
  await h.timers.advance(60000);
  assert.equal(h.calls.length, count);
  assert.equal(h.timers.size, 0);
  assert.equal(entry.version, version);
  assert.equal(entry.draft, draft);
  for (const id of [entry.id, ...previousIds]) assert.equal(h.client.entries.has(id), false);
}

test('空白新会话离页 flush 不 POST，空白字符同样不保存', async t => {
  const h = harness(t);
  for (const draft of ['', ' \n\t ']) {
    const entry = h.client.local(undefined, {draft}), id = entry.id;
    const work = h.client.flush(entry);
    await settle();
    assert.equal(h.calls.length, 0);
    await work;
    assert.equal(entry.id, id);
    assert.equal(entry.isNew, true);
    assert.equal(entry.error, null);
  }
  await h.timers.advance(60000);
  assert.equal(h.calls.length, 0);
});

test('新会话仅 settings 变化，自动保存和离页 flush 均不 POST', async t => {
  const h = harness(t), entry = h.client.local();
  assert.equal(h.client.change(entry, {settings: {...entry.settings, target: 'personal-auto', maxTokens: 1024}}), true);
  assert.equal(h.timers.size, 1);
  await h.timers.advance(500);
  const work = h.client.flush(entry);
  await settle();
  assert.equal(h.calls.length, 0);
  await work;
  assert.equal(entry.isNew, true);
  assert.equal(entry.settings.target, 'personal-auto');
  assert.equal(h.timers.size, 0);
});

test('非空 draft 防抖自动创建一次，创建在途的离页 flush 不重复 POST', async t => {
  const h = harness(t), entry = h.client.local(), localId = entry.id;
  h.client.change(entry, {draft: '第一版'});
  await h.timers.advance(499);
  assert.equal(h.calls.length, 0);
  h.client.change(entry, {draft: '最后一版'});
  await h.timers.advance(499);
  assert.equal(h.calls.length, 0);
  await h.timers.advance(1);
  const create = await h.next('');
  assert.equal(create.options.method, 'POST');
  assert.equal(create.body.draft, '最后一版');
  const leaving = h.client.flush(entry);
  await settle();
  assert.equal(h.calls.length, 1);
  create.reply(record('draft-1', 1, create.body));
  await leaving;
  await h.client.flush(entry);
  await h.timers.advance(60000);
  assert.equal(h.calls.length, 1);
  assert.equal(entry.isNew, false);
  assert.equal(entry.savedVersion, entry.version);
  assert.equal(h.client.entries.has(localId), false);
  assert.equal(h.client.entries.get('draft-1'), entry);
});

test('空白会话首次 start 强制创建，取得 revision 后才发送 run/start', async t => {
  const h = harness(t), entry = h.client.local(), messages = [{role: 'user', content: '首次发送'}];
  const work = h.client.start(entry, {messages});
  const create = await h.next('');
  assert.deepEqual(create.body.messages, []);
  assert.equal(create.body.draft, '');
  assert.equal(entry.starting, true);
  assert.equal(h.calls.length, 1);
  create.reply(record('first-run', 1, create.body));
  const start = await h.next('/run/start');
  assert.equal(start.body.id, 'first-run');
  assert.equal(start.body.expectedRevision, 1);
  assert.deepEqual(start.body.messages, messages);
  start.reply(record('first-run', 2, {...start.body, status: 'running', runId: 'run-1', leaseUntil: h.timers.now() + 120000}));
  const run = await work;
  assert.equal(run.id, 'first-run');
  assert.equal(run.revision, 2);
  assert.equal(entry.starting, false);
  assert.deepEqual(h.calls.map(call => call.route), ['', '/run/start']);
});

test('空白会话显式 update 和 branch 仍创建记录', async t => {
  const h = harness(t), entry = h.client.local();
  const updating = h.client.update(entry, {pinned: true});
  const create = await h.next('');
  create.reply(record('updated', 1, create.body));
  const update = await h.next('/update');
  assert.deepEqual(update.body, {id: 'updated', expectedRevision: 1, pinned: true});
  update.reply(record('updated', 2, {pinned: true}));
  await updating;
  const branching = h.client.branch(h.client.local());
  const branchCreate = await h.next('');
  branchCreate.reply(record('branch', 1, branchCreate.body));
  const branch = await branching;
  assert.equal(branch.isNew, false);
  assert.equal(branch.id, 'branch');
  assert.deepEqual(h.calls.map(call => call.route), ['', '/update', '']);
});

for (const persisted of [false, true]) {
  test(`删除${persisted ? '已存记录' : '本地草稿'}立即取消 pending timer，deleted 后不复活`, async t => {
    const h = harness(t), entry = persisted ? await h.saved() : h.client.local();
    const count = h.calls.length;
    h.client.change(entry, {draft: '尚未到保存时间'});
    assert.equal(h.timers.size, 1);
    const removing = h.client.remove(entry);
    assert.equal(entry.deleting, true);
    assert.equal(entry.draftTimer, null);
    assert.equal(h.timers.size, 0);
    assert.equal(h.client.change(entry, {draft: '禁止编辑'}), false);
    await h.client.flush(entry, {force: true});
    if (persisted) {
      const deletion = await h.next('/delete');
      assert.deepEqual(deletion.body, {id: entry.id, expectedRevision: 1});
      deletion.reply({ok: true});
    }
    await removing;
    assert.equal(h.calls.length, count + Number(persisted));
    await assertTombstone(h, entry);
  });
}

test('尚未发出的排队 create 被 remove 截断，不产生 POST', async t => {
  const h = harness(t), entry = h.client.local(undefined, {draft: '排队中'});
  const saving = h.client.flush(entry, {force: true});
  const removing = h.client.remove(entry);
  assert.equal(entry.deleting, true);
  await Promise.all([saving, removing]);
  assert.equal(h.calls.length, 0);
  await assertTombstone(h, entry);
});

for (const operation of ['create', 'update']) {
  test(`在途 ${operation} 完成后 remove 使用最新 id/revision，排队保存不能越过删除`, async t => {
    const h = harness(t), entry = operation === 'create' ? h.client.local() : await h.saved();
    const oldId = entry.id, count = h.calls.length;
    h.client.change(entry, {draft: '在途内容'});
    const saving = h.client.flush(entry);
    const write = await h.next(operation === 'create' ? '' : '/update');
    if (operation === 'update') assert.equal(write.body.expectedRevision, 1);
    h.client.change(entry, {draft: '较新的本地内容'});
    const queued = h.client.flush(entry);
    // Also leave a live debounce timer when deletion begins.
    h.client.change(entry, {draft: '删除前最后编辑'});
    const removing = h.client.remove(entry);
    let removed = false;
    removing.then(() => { removed = true; });
    assert.equal(entry.deleting, true);
    assert.equal(h.timers.size, 0);
    assert.equal(h.client.change(entry, {draft: '不能编辑'}), false);
    await h.client.flush(entry);
    await h.timers.advance(1000);
    assert.equal(removed, false);
    assert.equal(h.calls.length, count + 1);
    const id = operation === 'create' ? 'created-in-flight' : entry.id;
    const revision = operation === 'create' ? 1 : 2;
    write.reply(record(id, revision, write.body));
    const deletion = await h.next('/delete');
    assert.deepEqual(deletion.body, {id, expectedRevision: revision});
    assert.equal(entry.deleted, undefined);
    assert.equal(removed, false);
    deletion.reply({ok: true});
    await Promise.all([saving, queued, removing]);
    assert.deepEqual(h.calls.slice(count).map(call => call.route), [operation === 'create' ? '' : '/update', '/delete']);
    await assertTombstone(h, entry, [oldId]);
  });
}

test('并发 remove 共享同一 promise，只有一个删除请求', async t => {
  const h = harness(t), entry = await h.saved();
  const first = h.client.remove(entry), second = h.client.remove(entry);
  assert.equal(first, second);
  const deletion = await h.next('/delete');
  assert.equal(h.client.remove(entry), first);
  await h.timers.advance(5000);
  assert.equal(h.calls.filter(call => call.route === '/delete').length, 1);
  deletion.reply({ok: true});
  await Promise.all([first, second]);
  assert.equal(entry.deletePromise, null);
  await assertTombstone(h, entry);
});

for (const status of [409, 503]) {
  test(`已存记录的旧 ${status} 保存错误不阻止删除，不先 flush 未保存内容`, async t => {
    const h = harness(t), entry = await h.saved();
    h.client.change(entry, {draft: '失败后仍可导出'});
    const saving = h.client.flush(entry);
    const rejected = assert.rejects(saving, error => error.status === status);
    const update = await h.next('/update');
    update.reply({error: {message: '旧保存错误'}}, status);
    await rejected;
    assert.ok(entry.error);
    assert.equal(entry.record.revision, 1);
    const removing = h.client.remove(entry);
    const deletion = await h.next('/delete');
    assert.deepEqual(deletion.body, {id: entry.id, expectedRevision: 1});
    deletion.reply({ok: true});
    await removing;
    assert.deepEqual(h.calls.map(call => call.route), ['', '/update', '/delete']);
    await assertTombstone(h, entry);
  });
}

test('删除 404 视为成功并清除本地缓存', async t => {
  const h = harness(t), entry = await h.saved();
  const removing = h.client.remove(entry);
  const deletion = await h.next('/delete');
  deletion.reply({error: {message: '记录不存在'}}, 404);
  await removing;
  await assertTombstone(h, entry);
});

for (const failure of ['409', '503', 'network']) {
  test(`删除 ${failure} 失败保留本地，不自动重试；显式重试遇到 404 才清除`, async t => {
    const h = harness(t), entry = await h.saved(), id = entry.id;
    h.client.change(entry, {draft: '删除失败不能丢失'});
    const removing = h.client.remove(entry);
    const rejected = assert.rejects(removing, failure === 'network' ? /offline/ : error => error.status === Number(failure));
    const deletion = await h.next('/delete');
    if (failure === 'network') deletion.reject(new TypeError('offline'));
    else deletion.reply({error: {message: '删除失败'}}, Number(failure));
    await rejected;
    assert.equal(!!entry.deleted, false);
    assert.equal(entry.deleting, false);
    assert.equal(entry.deletePromise, null);
    assert.equal(h.client.entries.get(id), entry);
    assert.equal(entry.record.revision, 1);
    assert.equal(entry.conflict, failure === '409');
    assert.equal(h.client.exportEntry(entry).draft, '删除失败不能丢失');
    assert.ok(entry.error);
    const count = h.calls.length;
    await h.timers.advance(60000);
    assert.equal(h.calls.length, count);
    const retry = h.client.remove(entry);
    assert.notEqual(retry, removing);
    const retried = await h.next('/delete');
    assert.deepEqual(retried.body, {id, expectedRevision: 1});
    retried.reply({error: {message: '已经不存在'}}, 404);
    await retry;
    await assertTombstone(h, entry);
  });
}

const uncertainCreates = [
  ['network', call => call.reject(new TypeError('connection lost'))],
  ['HTTP 503', call => call.reply({error: {message: 'storage unavailable'}}, 503)],
  ['invalid JSON', call => call.invalidJSON()],
  ['HTTP 502 invalid JSON', call => call.invalidJSON(502)],
  ['null body', call => call.reply(null)],
  ['missing id', call => call.reply({revision: 1})],
  ['missing revision', call => call.reply({id: 'possibly-created'})],
  ['invalid revision', call => call.reply({id: 'possibly-created', revision: '1'})],
];
for (const [name, fail] of uncertainCreates) {
  test(`createUnknown: ${name} 后不能假装服务器已清理，必须提示刷新确认`, async t => {
    const h = harness(t), entry = h.client.local(undefined, {draft: '创建结果不明的本地副本'}), id = entry.id;
    const creating = h.client.flush(entry);
    const creationRejected = assert.rejects(creating);
    const create = await h.next('');
    const removing = h.client.remove(entry);
    const warning = error => {
      assert.match(error.message, /刷新.*核对/);
      assert.match(error.message, /不能确认服务器记录已删除/);
      return true;
    };
    const removalRejected = assert.rejects(removing, warning);
    assert.equal(entry.deleting, true);
    await settle();
    assert.equal(h.calls.length, 1);
    fail(create);
    await Promise.all([creationRejected, removalRejected]);
    assert.equal(entry.createUncertain, true);
    assert.equal(entry.isNew, true);
    assert.equal(!!entry.deleted, false);
    assert.equal(entry.deleting, false);
    assert.equal(h.client.entries.get(id), entry);
    assert.equal(h.client.exportEntry(entry).draft, '创建结果不明的本地副本');
    assert.match(h.client.exportEntry(entry).localSaveError.message, /刷新/);
    // The warning also survives a later discard attempt, not just the in-flight race.
    await assert.rejects(h.client.remove(entry), warning);
    await h.timers.advance(60000);
    assert.equal(h.calls.length, 1);
    assert.equal(h.timers.size, 0);
  });
}

for (const status of [400, 409]) {
  test(`明确的 create ${status} 拒绝允许仅丢弃本地副本，不发送删除请求`, async t => {
    const h = harness(t), entry = h.client.local(undefined, {draft: '未创建成功'});
    const creating = h.client.flush(entry);
    const rejected = assert.rejects(creating, error => error.status === status);
    const create = await h.next('');
    create.reply({error: {message: '创建被拒绝'}}, status);
    await rejected;
    assert.equal(!!entry.createUncertain, false);
    await h.client.remove(entry);
    assert.equal(h.calls.length, 1);
    await assertTombstone(h, entry);
  });
}
