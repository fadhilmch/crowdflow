import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { setupTestApp, teardownTestApp, clearCollections } from './helpers.js';

let app;
beforeAll(async () => { app = await setupTestApp(); });
afterAll(teardownTestApp);
beforeEach(clearCollections);

async function signup(username = 'fadhil') {
  const res = await request(app).post('/api/users/signup').send({ username, password: 'super-secret-1' });
  return res.body.token;
}

describe('presentation routes', () => {
  it('keeps creation intent on empty decks without storing unsaved slides or exposing it publicly', async () => {
    const token = await signup();
    const auth = { authorization: `Bearer ${token}` };
    for (const creationKind of ['quiz', 'presentation', 'blank']) {
      const created = await request(app).post('/api/presentations').set(auth).send({ title: creationKind, creationKind, slides: [] }).expect(201);
      const loaded = await request(app).get(`/api/presentations/${created.body.data._id}`).set(auth).expect(200);
      expect(loaded.body.data.creationKind).toBe(creationKind);
      expect(loaded.body.data.slides).toEqual([]);
      const publicResult = await request(app).get(`/api/presentations/code/${created.body.data.accessCode}`).expect(200);
      expect(publicResult.body.data).not.toHaveProperty('creationKind');
    }
    await request(app).post('/api/presentations').set(auth).send({ title: 'Bad', creationKind: 'unknown' }).expect(400);
  });

  it('creates with a 6-digit access code and joins publicly by code', async () => {
    const token = await signup();
    const created = await request(app)
      .post('/api/presentations')
      .set('authorization', `Bearer ${token}`)
      .send({ title: 'Demo', slides: [{ questionType: 'multiple-choice', question: 'Q?', options: ['a', 'b'] }] })
      .expect(201);
    expect(created.body.data.accessCode).toMatch(/^\d{6}$/);
    expect(created.body.data.slides[0].options).toEqual([
      { id: expect.any(String), text: 'a', votes: [] },
      { id: expect.any(String), text: 'b', votes: [] },
    ]);
    expect(created.body.data.slides[0].id).toEqual(expect.any(String));
    expect(created.body.data.structureRevision).toBe(0);

    const joined = await request(app).get(`/api/presentations/code/${created.body.data.accessCode}`).expect(200);
    expect(joined.body.data.title).toBe('Demo');
    await request(app).get('/api/presentations/code/000000').expect(404);
  });

  it('requires auth and ownership', async () => {
    await request(app).get('/api/presentations').expect(401);
    await request(app).get('/api/presentations').set('authorization', 'Bearer nope').expect(401);

    const mine = await signup('mine');
    const other = await signup('other');
    const created = await request(app)
      .post('/api/presentations')
      .set('authorization', `Bearer ${mine}`)
      .send({ title: 'Mine', slides: [] })
      .expect(201);
    await request(app).get(`/api/presentations/${created.body.data._id}`).set('authorization', `Bearer ${other}`).expect(404);
    await request(app).delete(`/api/presentations/${created.body.data._id}`).set('authorization', `Bearer ${other}`).expect(404);
    await request(app).delete(`/api/presentations/${created.body.data._id}`).set('authorization', `Bearer ${mine}`).expect(200);
  });

  it('edits slides without losing cast votes', async () => {
    const token = await signup();
    const created = await request(app)
      .post('/api/presentations')
      .set('authorization', `Bearer ${token}`)
      .send({ title: 'Demo', slides: [{ questionType: 'multiple-choice', question: 'Q?', options: ['a', 'b'] }] })
      .expect(201);
    const id = created.body.data._id;

    const { Presentation } = await import('../src/models/presentation.js');
    const doc = await Presentation.findById(id);
    doc.slides[0].options[0].votes.push('p1');
    await doc.save();

    const loaded = await request(app).get(`/api/presentations/${id}`).set('authorization', `Bearer ${token}`).expect(200);
    const slide = loaded.body.data.slides[0];
    const updated = await request(app)
      .put(`/api/presentations/${id}`)
      .set('authorization', `Bearer ${token}`)
      .send({
        baseStructureRevision: loaded.body.data.structureRevision,
        slides: [{
          id: slide.id,
          questionType: 'multiple-choice',
          question: 'Q edited?',
          options: [
            { id: slide.options[0].id, text: 'a' },
            { id: slide.options[1].id, text: 'b' },
            { text: 'c' },
          ],
        }],
      })
      .expect(200);
    expect(updated.body.data.slides[0].question).toBe('Q edited?');
    expect(updated.body.data.slides[0].options[0].votes).toEqual(['p1']);
    expect(updated.body.data.slides[0].options[2].votes).toEqual([]);
    expect(updated.body.data.structureRevision).toBe(loaded.body.data.structureRevision + 1);
  });

  it('rejects multiple-choice slides with fewer than two options', async () => {
    const token = await signup();
    const created = await request(app)
      .post('/api/presentations')
      .set('authorization', `Bearer ${token}`)
      .send({ title: 'Demo', slides: [{ questionType: 'multiple-choice', question: 'Q?', options: ['a'] }] })
      .expect(400);
    expect(created.body.message).toBeDefined();
  });

  it('rejects structural edits without identities instead of index-matching', async () => {
    const token = await signup();
    const created = await request(app)
      .post('/api/presentations')
      .set('authorization', `Bearer ${token}`)
      .send({ title: 'Demo', slides: [{ questionType: 'multiple-choice', question: 'Q?', options: ['a', 'b'] }] })
      .expect(201);
    const id = created.body.data._id;
    // Legacy-style client: plain string options, no ids, no revision.
    const res = await request(app)
      .put(`/api/presentations/${id}`)
      .set('authorization', `Bearer ${token}`)
      .send({ slides: [{ questionType: 'multiple-choice', question: 'Q?', options: ['a', 'b'] }] })
      .expect(409);
    expect(res.body.code).toBe('stale');
  });

  it('saves the first slides of a brand-new empty presentation (no ids yet)', async () => {
    const token = await signup();
    const created = await request(app)
      .post('/api/presentations')
      .set('authorization', `Bearer ${token}`)
      .send({ title: 'Untitled presentation' })
      .expect(201);
    const id = created.body.data._id;
    expect(created.body.data.slides).toEqual([]);
    const saved = await request(app)
      .put(`/api/presentations/${id}`)
      .set('authorization', `Bearer ${token}`)
      .send({
        title: 'Fresh',
        baseStructureRevision: created.body.data.structureRevision,
        slides: [{ questionType: 'multiple-choice', question: 'Q?', options: [{ text: 'a' }, { text: 'b' }] }],
      })
      .expect(200);
    expect(saved.body.data.title).toBe('Fresh');
    expect(saved.body.data.slides).toHaveLength(1);
    expect(saved.body.data.slides[0].id).toEqual(expect.any(String));
    expect(saved.body.data.structureRevision).toBe(created.body.data.structureRevision + 1);
    // The saved deck reopens with the slide.
    const reopened = await request(app).get(`/api/presentations/${id}`).set('authorization', `Bearer ${token}`).expect(200);
    expect(reopened.body.data.slides[0].question).toBe('Q?');
  });

  it('still requires the current revision when saving into an empty deck', async () => {
    const token = await signup();
    const created = await request(app).post('/api/presentations').set('authorization', `Bearer ${token}`).send({ title: 'E' }).expect(201);
    await request(app)
      .put(`/api/presentations/${created.body.data._id}`)
      .set('authorization', `Bearer ${token}`)
      .send({ baseStructureRevision: 5, slides: [{ questionType: 'multiple-choice', question: 'Q?', options: [{ text: 'a' }, { text: 'b' }] }] })
      .expect(409);
    await request(app)
      .put(`/api/presentations/${created.body.data._id}`)
      .set('authorization', `Bearer ${token}`)
      .send({ slides: [{ questionType: 'multiple-choice', question: 'Q?', options: [{ text: 'a' }, { text: 'b' }] }] })
      .expect(409);
  });

  it('rejects edits made against an outdated structure revision', async () => {
    const token = await signup();
    const created = await request(app)
      .post('/api/presentations')
      .set('authorization', `Bearer ${token}`)
      .send({ title: 'Demo', slides: [{ questionType: 'multiple-choice', question: 'Q?', options: ['a', 'b'] }] })
      .expect(201);
    const id = created.body.data._id;
    const loaded = await request(app).get(`/api/presentations/${id}`).set('authorization', `Bearer ${token}`).expect(200);
    const slide = loaded.body.data.slides[0];
    const payload = {
      baseStructureRevision: loaded.body.data.structureRevision,
      slides: [{ id: slide.id, questionType: 'multiple-choice', question: 'Edit 1', options: slide.options.map((o) => ({ id: o.id, text: o.text })) }],
    };
    await request(app).put(`/api/presentations/${id}`).set('authorization', `Bearer ${token}`).send(payload).expect(200);
    // Same revision again: a second tab editing from the same load.
    const res = await request(app).put(`/api/presentations/${id}`).set('authorization', `Bearer ${token}`).send(payload).expect(409);
    expect(res.body.code).toBe('conflict');
  });

  it('keeps votes on the right slides when a middle slide is removed, behind count-aware confirmation', async () => {
    const token = await signup();
    const created = await request(app)
      .post('/api/presentations')
      .set('authorization', `Bearer ${token}`)
      .send({
        title: 'Demo',
        slides: [
          { questionType: 'multiple-choice', question: 'First?', options: ['a', 'b'] },
          { questionType: 'multiple-choice', question: 'Middle?', options: ['a', 'b'] },
          { questionType: 'multiple-choice', question: 'Last?', options: ['a', 'b'] },
        ],
      })
      .expect(201);
    const id = created.body.data._id;

    const { Presentation } = await import('../src/models/presentation.js');
    const doc = await Presentation.findById(id);
    doc.slides[0].options[0].votes.push('first-voter');
    doc.slides[1].options[0].votes.push('middle-voter', 'middle-voter-2');
    doc.slides[2].options[1].votes.push('last-voter');
    doc.currentSlide = 2; // presenting the last slide
    await doc.save();

    const loaded = await request(app).get(`/api/presentations/${id}`).set('authorization', `Bearer ${token}`).expect(200);
    const [first, , last] = loaded.body.data.slides;
    const withoutMiddle = {
      baseStructureRevision: loaded.body.data.structureRevision,
      slides: [first, last].map((s) => ({
        id: s.id, questionType: s.questionType, question: s.question,
        options: s.options.map((o) => ({ id: o.id, text: o.text })),
      })),
    };

    // First attempt: the server counts the real loss and asks for confirmation.
    const needsConfirm = await request(app)
      .put(`/api/presentations/${id}`).set('authorization', `Bearer ${token}`).send(withoutMiddle).expect(409);
    expect(needsConfirm.body.code).toBe('requiresConfirmation');
    expect(needsConfirm.body.removedVotes).toBe(2);
    expect(needsConfirm.body.removedResponses).toBe(0);

    // Stale or wrong counts are rejected.
    await request(app)
      .put(`/api/presentations/${id}`).set('authorization', `Bearer ${token}`)
      .send({ ...withoutMiddle, confirmRemove: { votes: 1, responses: 0 } })
      .expect(409);

    // Matching counts go through; votes stay on their own slides, and the
    // active slide follows its identity instead of its old index.
    const saved = await request(app)
      .put(`/api/presentations/${id}`).set('authorization', `Bearer ${token}`)
      .send({ ...withoutMiddle, confirmRemove: { votes: 2, responses: 0 } })
      .expect(200);
    expect(saved.body.data.slides).toHaveLength(2);
    expect(saved.body.data.slides[0].question).toBe('First?');
    expect(saved.body.data.slides[0].options[0].votes).toEqual(['first-voter']);
    expect(saved.body.data.slides[1].question).toBe('Last?');
    expect(saved.body.data.slides[1].options[1].votes).toEqual(['last-voter']);
    expect(saved.body.data.currentSlide).toBe(1); // still the "Last?" slide
  });

  it('upgrades a pre-identity deck additively instead of saving over it', async () => {
    const token = await signup();
    const created = await request(app)
      .post('/api/presentations')
      .set('authorization', `Bearer ${token}`)
      .send({ title: 'Demo', slides: [{ questionType: 'multiple-choice', question: 'Q?', options: ['a', 'b'] }] })
      .expect(201);
    const id = created.body.data._id;

    // Simulate a deck stored before identities existed.
    const { Presentation } = await import('../src/models/presentation.js');
    await Presentation.updateOne({ _id: id }, { $unset: { 'slides.0.id': '', 'slides.0.options.0.id': '', 'slides.0.options.1.id': '' } });
    const legacy = await Presentation.findById(id);
    legacy.slides[0].options[0].votes.push('p1');
    await legacy.save();

    // Owner read stamps ids without losing anything.
    const loaded = await request(app).get(`/api/presentations/${id}`).set('authorization', `Bearer ${token}`).expect(200);
    expect(loaded.body.data.slides[0].id).toEqual(expect.any(String));
    expect(loaded.body.data.slides[0].options[0].votes).toEqual(['p1']);
  });

  it('loses neither votes nor stable ids when stamping races a live vote', async () => {
    const token = await signup();
    const { Presentation } = await import('../src/models/presentation.js');
    const { applyLiveActionByCode } = await import('../src/lib/live.js');

    for (let round = 0; round < 10; round += 1) {
      const created = await request(app)
        .post('/api/presentations')
        .set('authorization', `Bearer ${token}`)
        .send({ title: 'Demo', slides: [{ questionType: 'multiple-choice', question: 'Q?', options: ['a', 'b'] }] })
        .expect(201);
      const id = created.body.data._id;
      const code = created.body.data.accessCode;
      // Simulate a pre-identity deck.
      await Presentation.updateOne({ _id: id }, { $unset: { 'slides.0.id': '', 'slides.0.options.0.id': '', 'slides.0.options.1.id': '' } });

      // Owner read (stamps ids) races an actual audience vote.
      const vote = { type: 'vote:cast', slideIndex: 0, optionIndex: 1, participantId: `voter-${round}` };
      const [read] = await Promise.all([
        request(app).get(`/api/presentations/${id}`).set('authorization', `Bearer ${token}`).expect(200),
        applyLiveActionByCode(code, vote),
      ]);

      const final = await Presentation.findById(id);
      // The vote must never be lost to stamping.
      expect(final.slides[0].options[1].votes).toContain(`voter-${round}`);
      // Ids must be present and identical across the race participants.
      expect(read.body.data.slides[0].id).toEqual(expect.any(String));
      expect(final.slides[0].id).toBe(read.body.data.slides[0].id);
      expect(final.slides[0].options.map((o) => o.id)).toEqual(read.body.data.slides[0].options.map((o) => o.id));
    }
  });

  it('stamps identical ids under concurrent owner reads', async () => {
    const token = await signup();
    const created = await request(app)
      .post('/api/presentations')
      .set('authorization', `Bearer ${token}`)
      .send({ title: 'Demo', slides: [{ questionType: 'multiple-choice', question: 'Q?', options: ['a', 'b'] }] })
      .expect(201);
    const id = created.body.data._id;
    const { Presentation } = await import('../src/models/presentation.js');
    await Presentation.updateOne({ _id: id }, { $unset: { 'slides.0.id': '', 'slides.0.options.0.id': '', 'slides.0.options.1.id': '' } });

    const reads = await Promise.all(
      Array.from({ length: 4 }, () =>
        request(app).get(`/api/presentations/${id}`).set('authorization', `Bearer ${token}`).expect(200),
      ),
    );
    const idSets = reads.map((r) => JSON.stringify([r.body.data.slides[0].id, ...r.body.data.slides[0].options.map((o) => o.id)]));
    for (const ids of idSets) expect(ids).toBe(idSets[0]);
  });
});
