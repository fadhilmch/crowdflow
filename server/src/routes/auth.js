import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { User, syntheticUsername } from '../models/user.js';
import { Presentation } from '../models/presentation.js';
import { authenticate, identifyFirebase, isLegacyToken, bearerToken } from '../middleware/authenticate.js';
import { config } from '../config.js';
import { deleteImage } from '../lib/imageStore.js';
import { Media } from '../models/media.js';
import { LiveSession } from '../models/liveSession.js';
import { firebaseEnabled, deleteFirebaseUser } from '../lib/firebase.js';
import { signUserToken } from '../lib/tokens.js';
import { validate } from '../middleware/validate.js';

const credentialsSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  username: z.string().trim().toLowerCase().min(3).max(30).regex(/^[a-z0-9_.-]+$/),
  password: z.string().min(8).max(128),
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 50,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});

export const authRouter = Router();

// With Firebase on, new accounts and sign-ins go through Firebase, so the built-in endpoints close.
const legacyOnly = (req, res, next) =>
  firebaseEnabled() ? res.status(410).json({ message: 'This sign-in method has been replaced. Use your email address.', code: 'LEGACY_AUTH_CLOSED' }) : next();

authRouter.post('/signup', legacyOnly, authLimiter, validate(credentialsSchema), async (req, res, next) => {
  try {
    const { name, username, password } = req.body;
    if (await User.exists({ username })) {
      return res.status(409).json({ message: 'Username is already taken' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ name: name ?? username, username, passwordHash });
    return res.status(201).json({ token: signUserToken(user._id), user: user.toPublicJSON() });
  } catch (err) {
    return next(err);
  }
});

authRouter.post('/login', legacyOnly, authLimiter, validate(credentialsSchema), async (req, res, next) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    const matches = user && (await bcrypt.compare(password, user.passwordHash));
    if (!matches) {
      return res.status(401).json({ message: 'Wrong username or password' });
    }
    return res.json({ token: signUserToken(user._id), user: user.toPublicJSON() });
  } catch (err) {
    return next(err);
  }
});

const deleteAccountSchema = z.object({ password: z.string().min(1).max(128).optional() });

const profileSchema = z.object({ name: z.string().trim().min(1).max(80) });
const claimSchema = z.object({
  username: z.string().trim().toLowerCase().min(3).max(30),
  password: z.string().min(1).max(128),
});

// Firebase sign-in, step 2: the person has a Firebase login and now gets an app profile.
// Safe to repeat: an existing profile for the same Firebase user is returned unchanged.
authRouter.post('/profile', authLimiter, identifyFirebase({ checkRevoked: true }), validate(profileSchema), async (req, res, next) => {
  try {
    const { uid, email } = req.firebase;
    if (!email) return res.status(400).json({ message: 'This sign-in has no email address' });
    const existing = await User.findOne({ firebaseUid: uid });
    if (existing) return res.json({ user: existing.toPublicJSON() });
    try {
      const user = await User.create({ name: req.body.name, email, firebaseUid: uid, username: syntheticUsername(uid) });
      return res.status(201).json({ user: user.toPublicJSON() });
    } catch (err) {
      if (err?.code === 11000) {
        // Two requests for the same login can race (two tabs, or a repeat after a lost answer). If this
        // login's profile now exists, that is success; only a different login holding the email is a conflict.
        const own = await User.findOne({ firebaseUid: uid });
        if (own) return res.json({ user: own.toPublicJSON() });
        return res.status(409).json({ message: 'An account with this email already exists' });
      }
      throw err;
    }
  } catch (err) {
    return next(err);
  }
});

// Who am I? Also tells the client whether the profile step is still missing.
authRouter.get('/me', identifyFirebase(), async (req, res, next) => {
  try {
    const user = await User.findOne({ firebaseUid: req.firebase.uid });
    if (!user) return res.status(404).json({ message: 'Finish setting up your account', code: 'PROFILE_REQUIRED' });
    return res.json({ user: user.toPublicJSON() });
  } catch (err) {
    return next(err);
  }
});

// Moves an account made before Firebase sign-in onto a Firebase login. The old password proves the
// account is theirs; presentations keep the same owner id, so nothing is copied or lost.
authRouter.post('/claim-legacy', authLimiter, identifyFirebase({ checkRevoked: true }), validate(claimSchema), async (req, res, next) => {
  try {
    const { uid, email } = req.firebase;
    if (!email) return res.status(400).json({ message: 'This sign-in has no email address' });
    const mine = await User.findOne({ firebaseUid: uid });
    if (mine) {
      // A repeat of a move that already succeeded (for example, the first answer was lost) is fine.
      if (mine.username === req.body.username && mine.username !== syntheticUsername(uid) && mine.passwordHash === undefined) {
        return res.json({ user: mine.toPublicJSON() });
      }
      return res.status(409).json({ message: 'This login already has an account', code: 'ALREADY_LINKED' });
    }
    const legacy = await User.findOne({ username: req.body.username });
    // Same answer for an unknown username and a wrong password.
    const ok = legacy?.passwordHash && !legacy.firebaseUid && (await bcrypt.compare(req.body.password, legacy.passwordHash));
    if (!ok) return res.status(403).json({ message: 'Wrong username or password', code: 'LEGACY_CREDENTIALS' });
    // Only an account that is still unlinked can be claimed, even if two requests race.
    try {
      const claimed = await User.findOneAndUpdate(
        { _id: legacy._id, firebaseUid: { $exists: false } },
        { $set: { firebaseUid: uid, email }, $unset: { passwordHash: 1 } },
        { returnDocument: 'after' },
      );
      if (!claimed) return res.status(409).json({ message: 'This account was already moved', code: 'ALREADY_LINKED' });
      return res.json({ user: claimed.toPublicJSON() });
    } catch (err) {
      if (err?.code === 11000) return res.status(409).json({ message: 'An account with this email already exists' });
      throw err;
    }
  } catch (err) {
    return next(err);
  }
});

const chooseSession = (req, res, next) => {
  const token = bearerToken(req);
  if (token && !isLegacyToken(token)) return identifyFirebase({ checkRevoked: true })(req, res, next);
  return authenticate(req, res, next);
};

// Permanently deletes the signed-in account and every presentation it owns, including their votes,
// answers and audience nicknames. A stolen session alone must not be enough: the old login asks for
// the password again, a Firebase login must have typed its password in the last few minutes.
authRouter.delete('/me', authLimiter, chooseSession, validate(deleteAccountSchema), async (req, res, next) => {
  try {
    if (req.firebase) return await deleteFirebaseAccount(req, res);
    const user = await User.findById(req.auth.userId);
    if (!user) return res.status(404).json({ message: 'Account not found' });
    if (!req.body.password || !user.passwordHash || !(await bcrypt.compare(req.body.password, user.passwordHash))) {
      return res.status(403).json({ message: 'Wrong password' });
    }
    // Two steps without a transaction (so no replica set is required). Presentations go first so
    // none are left without an owner. If the second step fails, the presentations are already
    // gone but the account remains, and repeating the request finishes the job.
    const { deletedCount } = await removeOwnedData(user._id);
    try {
      await User.deleteOne({ _id: user._id });
    } catch (err) {
      console.error('Account deletion: presentations removed, account removal failed', err);
      return res.status(500).json({
        message: 'Your presentations were deleted, but the account could not be removed yet. Please try again.',
        code: 'ACCOUNT_DELETE_INCOMPLETE',
      });
    }
    return res.json({ ok: true, deletedPresentations: deletedCount });
  } catch (err) {
    return next(err);
  }
});

// Everything an account owns: live sessions and uploaded images as well as decks. Repeatable.
async function removeOwnedData(ownerId) {
  const presentations = await Presentation.deleteMany({ owner: ownerId });
  await LiveSession.deleteMany({ owner: ownerId });
  // Files held at Cloudinary go first; if one fails the request stops and can be repeated.
  const remote = await Media.find({ owner: ownerId, storage: 'cloudinary' }).select('remoteId').lean();
  for (const item of remote) await deleteImage(item.remoteId);
  await Media.deleteMany({ owner: ownerId });
  return presentations;
}

// Three steps, no transaction, in an order that can always be repeated: presentations, then the
// profile, then the Firebase login. If a step fails the Firebase login still works, so the person
// can run the same request again (a missing profile is fine, it just skips that step).
async function deleteFirebaseAccount(req, res) {
  const { uid, authTime } = req.firebase;
  const age = Math.floor(Date.now() / 1000) - Number(authTime ?? 0);
  if (!Number.isFinite(age) || age > config.firebase.recentSignInSeconds) {
    return res.status(403).json({ message: 'Confirm your password to delete your account', code: 'REAUTH_REQUIRED' });
  }
  const user = await User.findOne({ firebaseUid: uid });
  let deletedPresentations = 0;
  let firebaseLoginRemoved = false;
  try {
    if (user) {
      ({ deletedCount: deletedPresentations } = await removeOwnedData(user._id));
      await User.deleteOne({ _id: user._id });
    }
    firebaseLoginRemoved = await deleteFirebaseUser(uid);
  } catch (err) {
    console.error('Account deletion incomplete', err);
    return res.status(500).json({
      message: 'Your account could not be fully removed yet. Please try again.',
      code: 'ACCOUNT_DELETE_INCOMPLETE',
    });
  }
  // false means this server holds no service account: the browser must delete its own login next.
  return res.json({ ok: true, deletedPresentations, firebaseLoginRemoved });
}
