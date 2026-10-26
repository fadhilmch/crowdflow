import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { clearCollections, setupTestApp, teardownTestApp } from './helpers.js';

let app;
beforeAll(async () => { process.env.SESSIONS_ENABLED = 'true'; app = await setupTestApp(); });
afterAll(async () => { delete process.env.SESSIONS_ENABLED; await teardownTestApp(); });
beforeEach(clearCollections);

const auth = (t) => ({ authorization: `Bearer ${t}` });

describe('moderation on a session run', () => {
  it('inherits approval mode, holds text, and the owner approves it by session id', async () => {
    const t = (await request(app).post('/api/users/signup').send({ username: 'smod', password: 'super-secret-1' })).body.token;
    const deck = (await request(app).post('/api/presentations').set(auth(t)).send({ title: 'M', slides: [{ questionType: 'open-ended', question: 'Why?' }] })).body.data;
    await request(app).post(`/api/presentations/${deck._id}/moderation/mode`).set(auth(t)).send({ mode: 'approve' });
    const run = (await request(app).post(`/api/presentations/${deck._id}/sessions`).set(auth(t))).body.data;

    const cred = (await request(app).post(`/api/live/${run.code}/credential`).send({ participantId: 'p-aaaaaa' })).body;
    await request(app).post(`/api/live/${run.code}/action`).set('x-participant-token', cred.token).send({ type: 'response:add', slideIndex: 0, text: 'held-in-run', participantId: 'p-aaaaaa' }).expect(200);
    const pub = async () => JSON.stringify((await request(app).get(`/api/live/${run.code}/state`)).body.data);
    expect(await pub()).not.toContain('held-in-run');

    const q = (await request(app).get(`/api/presentations/${run.id}/moderation`).set(auth(t))).body.data;
    expect(q.items.map((i) => i.text)).toEqual(['held-in-run']);
    const ok = await request(app).post(`/api/presentations/${run.id}/moderation/${q.items[0].slideId}/${q.items[0].id}`).set(auth(t)).send({ action: 'approve' });
    expect(ok.status).toBe(200);
    expect(await pub()).toContain('held-in-run');

    // The deck's own queue was never involved.
    expect((await request(app).get(`/api/presentations/${deck._id}/moderation`).set(auth(t))).body.data.items).toHaveLength(0);
    // Another owner cannot reach the run.
    const o = (await request(app).post('/api/users/signup').send({ username: 'smod2', password: 'super-secret-1' })).body.token;
    expect((await request(app).get(`/api/presentations/${run.id}/moderation`).set(auth(o))).status).toBe(404);
  });
});
