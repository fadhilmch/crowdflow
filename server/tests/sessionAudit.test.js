import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { io as clientIo } from 'socket.io-client';
import { setupTestApp, teardownTestApp, clearCollections } from './helpers.js';
import { Presentation } from '../src/models/presentation.js';
import { LiveSession } from '../src/models/liveSession.js';
import { migrateLegacySessions } from '../src/lib/sessionMigration.js';
import { publicState, applyLiveActionByCode } from '../src/lib/live.js';
import { registerPresentationSockets } from '../src/sockets/presentation.js';
let app, owner, deck, http, io, port;
const auth = () => ({ authorization: `Bearer ${owner}` });
const start = async () => (await request(app).post(`/api/presentations/${deck._id}/sessions`).set(auth())).body.data;
const issue = async (code, body = {}) => (await request(app).post(`/api/live/${code}/credential`).send(body)).body;
const vote = (code, cred) => request(app).post(`/api/live/${code}/action`).set(cred ? { 'x-participant-token': cred.token } : {}).send({type:'vote:cast',slideIndex:2,optionIndex:0,participantId:cred?.participantId ?? 'legacy-browser'});
beforeAll(async()=>{process.env.SESSIONS_ENABLED='true';app=await setupTestApp();await LiveSession.init();http=createServer(app);io=new Server(http);registerPresentationSockets(io);await new Promise(r=>http.listen(0,r));port=http.address().port;});
afterAll(async()=>{io.close();http.close();delete process.env.SESSIONS_ENABLED;await teardownTestApp();});
afterEach(()=>{delete process.env.REQUIRE_PARTICIPANT_TOKEN;});
beforeEach(async()=>{
 await clearCollections();
 owner=(await request(app).post('/api/users/signup').send({username:'audit-owner',password:'local-test-only'})).body.token;
 deck=(await request(app).post('/api/presentations').set(auth()).send({title:'Complete snapshot',quizScoring:'speed',slides:[{questionType:'title',question:'Welcome',body:'Keep this subtitle',options:[]},{questionType:'columns',question:'Plan',columns:[{title:'Now',text:'Ship safely'},{title:'Next',text:'Learn'}],options:[]},{questionType:'quiz',question:'Pick',options:['Yes','No'],timeLimit:10}]})).body.data;
});
describe('current-session audit regressions',()=>{
 it('snapshots newer slide content and scoring, clears answers/runtime state, leaves deck untouched',async()=>{
  const source=await Presentation.findById(deck._id);source.slides[2].correctOptionId=source.slides[2].options[0].id;source.slides[2].options[0].votes=['old-voter'];source.slides[2].revealed=true;source.slides[2].answerTimes=[{participantId:'old-voter',ms:42}];source.finale=true;source.questionStartedAt=new Date();await source.save();
  const before=source.toObject();const run=await start();const s=await LiveSession.findById(run.id);
  expect(s.quizScoring).toBe('speed');expect(s.slides[0].body).toBe('Keep this subtitle');expect(s.slides[1].columns.map(x=>x.toObject())).toEqual(before.slides[1].columns);
  expect(s.slides[2].timeLimit).toBe(10);expect(s.slides[2].correctOptionId).toBe(s.slides[2].options[0].id);expect(s.slides[2].correctOptionId).not.toBe(before.slides[2].correctOptionId);
  expect(s.slides[2].options.flatMap(o=>o.votes)).toEqual([]);expect(s.slides[2].answerTimes).toHaveLength(0);expect(s.slides[2].revealed).toBe(false);expect(s.finale).toBe(false);expect(s.questionStartedAt).toBeUndefined();
  expect((await Presentation.findById(deck._id)).toObject()).toEqual(before);
 });
 it('migration preserves ended state, newer settings, slide answers and moderation history without changing deck',async()=>{
  const source=await Presentation.findById(deck._id);source.endedAt=new Date();source.quizScoring='speed';source.finale=true;source.questionStartedAt=new Date();source.moderationLog=[{owner:String(source.owner),action:'approve',at:new Date()}];await source.save();const before=source.toObject();
  expect((await migrateLegacySessions()).wouldCreate).toBe(1);expect(await LiveSession.countDocuments()).toBe(0);
  expect((await migrateLegacySessions({apply:true})).created).toBe(1);const s=await LiveSession.findOne({legacyOf:deck._id});
  expect(s.status).toBe('ended');expect(publicState(s).ended).toBe(true);expect(s.endedAt).toEqual(source.endedAt);expect(s.quizScoring).toBe('speed');expect(s.finale).toBe(true);expect(s.questionStartedAt).toEqual(source.questionStartedAt);expect(s.slides.map(x=>x.toObject())).toEqual(before.slides);expect(s.moderationLog.map(x=>x.toObject())).toEqual(before.moderationLog);
  expect((await migrateLegacySessions({apply:true})).alreadyMigrated).toBe(1);expect((await Presentation.findById(deck._id)).toObject()).toEqual(before);
 });
 async function reused(){const old=await start();const cred=await issue(old.code);await request(app).post(`/api/sessions/${old.id}/end`).set(auth());const fresh=await start();await LiveSession.updateOne({_id:fresh.id},{$set:{code:old.code,currentSlide:2,'slides.2.timeLimit':null}});return {old,fresh,cred};}
 it.each([false,true])('rejects old code-bound run credentials on HTTP actions and own-answer reads, strict=%s',async(strict)=>{
  if(strict)process.env.REQUIRE_PARTICIPANT_TOKEN='true';const {old,cred}=await reused();
  expect((await vote(old.code,cred)).status).toBe(401);expect((await request(app).get(`/api/live/${old.code}/me`).set('x-participant-token',cred.token)).status).toBe(401);expect((await vote(old.code)).status).toBe(401);
  const next=await issue(old.code,{participantId:cred.participantId,token:cred.token});expect((await vote(old.code,next)).status).toBe(200);expect((await request(app).get(`/api/live/${old.code}/me`).set('x-participant-token',next.token)).status).toBe(200);
 });
 it('rejects the previous run credential on sockets and accepts a newly joined credential',async()=>{
  const {old,cred}=await reused();const socket=clientIo(`http://127.0.0.1:${port}`,{transports:['websocket']});
  try {const emit=(event,payload)=>new Promise(r=>socket.emit(event,payload,r));await emit('presentation:join',{accessCode:old.code});const action={type:'participant:identify',participantId:cred.participantId,nickname:'Returning browser'};
   expect((await emit('live:action',{...action,token:cred.token})).code).toBe('invalid_credential');
   const next=await issue(old.code,{participantId:cred.participantId});expect((await emit('live:action',{...action,token:next.token})).ok).toBe(true);
  }finally{socket.disconnect();}
 });
 it('migration keeps an active timed run active with its clock and scoring',async()=>{
  const source=await Presentation.findById(deck._id);source.currentSlide=2;source.questionStartedAt=new Date();await source.save();await migrateLegacySessions({apply:true});const s=await LiveSession.findOne({legacyOf:deck._id});expect(s.status).toBe('active');expect(publicState(s).ended).toBe(false);expect(s.questionStartedAt).toEqual(source.questionStartedAt);expect(s.quizScoring).toBe('speed');expect(s.slides[2].timeLimit).toBe(10);
 });
 it('does not apply a queued action after its checked target was replaced',async()=>{
  const old=await start();await request(app).post(`/api/sessions/${old.id}/end`).set(auth());const fresh=await start();await LiveSession.updateOne({_id:fresh.id},{$set:{code:old.code}});
  await expect(applyLiveActionByCode(old.code,{type:'participant:identify',participantId:'old-browser',nickname:'Stale'},{targetId:old.id})).rejects.toMatchObject({code:'invalid_credential'});
  expect((await LiveSession.findById(fresh.id)).participants).toHaveLength(0);
 });
});
