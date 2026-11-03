import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { setupTestApp, teardownTestApp, clearCollections } from './helpers.js';
import { config } from '../src/config.js';
import { Media } from '../src/models/media.js';
import { User } from '../src/models/user.js';

let app;
beforeAll(async () => { app = await setupTestApp(); });
afterAll(teardownTestApp);
beforeEach(async () => {
  await clearCollections();
  Object.assign(config.cloudinary, { cloudName: 'democloud', apiKey: 'key123', apiSecret: 'secret456' });
});
afterEach(() => {
  Object.assign(config.cloudinary, { cloudName: '', apiKey: '', apiSecret: '' });
  vi.unstubAllGlobals();
});

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]);
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

async function signedIn() {
  const username = `u${Date.now()}${Math.random().toString(16).slice(2, 6)}`;
  const res = await request(app).post('/api/users/signup').send({ username, password: 'super-secret-1' });
  return res.body.token;
}
const upload = (token) => request(app).post('/api/media').set('Authorization', `Bearer ${token}`).set('Content-Type', 'image/png').send(png);

describe('Cloudinary image storage', () => {
  it('uploads to Cloudinary with basic auth, keeps no bytes in MongoDB, and redirects the public link', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ public_id: 'x' }));
    vi.stubGlobal('fetch', fetchMock);
    const token = await signedIn();
    const up = await upload(token);
    expect(up.status).toBe(201);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.cloudinary.com/v1_1/democloud/image/upload');
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from('key123:secret456').toString('base64')}`);
    const stored = await Media.findOne({}).lean();
    expect(stored.storage).toBe('cloudinary');
    expect(stored.data).toBeUndefined();
    expect(stored.bytes).toBe(png.length);

    const got = await request(app).get(up.body.data.url).redirects(0);
    expect(got.status).toBe(302);
    expect(got.headers.location).toBe(`https://res.cloudinary.com/democloud/image/upload/f_auto,q_auto,c_limit,w_1600/${stored.remoteId}`);
    expect(JSON.stringify(got.headers)).not.toContain('secret456');

    const list = await request(app).get('/api/media').set('Authorization', `Bearer ${token}`);
    expect(list.body.data[0].bytes).toBe(png.length);
  });

  it('shows a clear error and stores nothing when Cloudinary rejects the upload', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: { message: 'secret456 leaked?' } }, 420)));
    const up = await upload(await signedIn());
    expect(up.status).toBe(502);
    expect(up.body.message).toMatch(/limit/i);
    expect(JSON.stringify(up.body)).not.toContain('secret456');
    expect(await Media.countDocuments()).toBe(0);
  });

  it('deletes the remote file before the record, and keeps the record when the remote delete fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ result: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);
    const token = await signedIn();
    const up = await upload(token);
    const id = up.body.data.url.split('/').pop();
    fetchMock.mockResolvedValueOnce(json({}, 500));
    const failed = await request(app).delete(`/api/media/${id}`).set('Authorization', `Bearer ${token}`);
    expect(failed.status).toBe(502);
    expect(await Media.countDocuments()).toBe(1);
    const ok = await request(app).delete(`/api/media/${id}`).set('Authorization', `Bearer ${token}`);
    expect(ok.status).toBe(204);
    expect(fetchMock.mock.calls.at(-1)[0]).toBe('https://api.cloudinary.com/v1_1/democloud/image/destroy');
    expect(await Media.countDocuments()).toBe(0);
  });

  it('treats "not found" at Cloudinary as already deleted', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ result: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);
    const token = await signedIn();
    const id = (await upload(token)).body.data.url.split('/').pop();
    fetchMock.mockResolvedValueOnce(json({ result: 'not found' }));
    expect((await request(app).delete(`/api/media/${id}`).set('Authorization', `Bearer ${token}`)).status).toBe(204);
  });

  it('account deletion removes the files at Cloudinary too', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ result: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);
    const username = 'delme';
    const signup = await request(app).post('/api/users/signup').send({ username, password: 'super-secret-1' });
    await upload(signup.body.token);
    await request(app).delete('/api/users/me').set('Authorization', `Bearer ${signup.body.token}`).send({ password: 'super-secret-1' }).expect(200);
    expect(fetchMock.mock.calls.some(([u]) => u.endsWith('/image/destroy'))).toBe(true);
    expect(await Media.countDocuments()).toBe(0);
    expect(await User.countDocuments({ username })).toBe(0);
  });

  it('keeps using MongoDB when no Cloudinary credentials are set', async () => {
    Object.assign(config.cloudinary, { cloudName: '', apiKey: '', apiSecret: '' });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const up = await upload(await signedIn());
    expect(up.status).toBe(201);
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await Media.findOne({}).lean()).storage).toBe('mongo');
  });
});
