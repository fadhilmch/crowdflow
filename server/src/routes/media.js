import express, { Router } from 'express';
import mongoose from 'mongoose';
import { Media } from '../models/media.js';
import { Presentation } from '../models/presentation.js';
import { LiveSession } from '../models/liveSession.js';
import { authenticate } from '../middleware/authenticate.js';
import { cloudinaryEnabled, deleteImage, deliveryUrl, remoteIdFor, uploadImage, ImageStoreError } from '../lib/imageStore.js';
import { MAX_IMAGE_BYTES, MAX_IMAGES_PER_USER, sniffImageType } from '../lib/media.js';

export const mediaRouter = Router();

const PUBLIC_ID = /^[a-f0-9]{32}$/;
const urlFor = (publicId) => `/api/media/${publicId}`;

/** Decks (any owner) and saved live sessions whose slides still show this image. */
async function usageOf(url) {
  const [decks, sessions] = await Promise.all([
    Presentation.find({ 'slides.design.imageUrl': url }).select('title owner').lean(),
    LiveSession.countDocuments({ 'slides.design.imageUrl': url }),
  ]);
  return { decks, sessions };
}

/** Owner uploads one image (raw bytes: jpeg, png or webp, up to 600 KB). Returns the path to use as a slide image. */
mediaRouter.post(
  '/',
  authenticate,
  express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: MAX_IMAGE_BYTES }),
  async (req, res, next) => {
    try {
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(415).json({ message: 'Send a JPEG, PNG or WebP image.' });
      }
      const contentType = sniffImageType(req.body);
      if (!contentType) return res.status(415).json({ message: 'That file is not a JPEG, PNG or WebP image.' });
      const owner = new mongoose.Types.ObjectId(req.auth.userId);
      if ((await Media.countDocuments({ owner })) >= MAX_IMAGES_PER_USER) {
        return res.status(429).json({ message: `You have reached the limit of ${MAX_IMAGES_PER_USER} uploaded images. Delete some you no longer use, then try again.`, code: 'upload_limit' });
      }
      let media;
      if (cloudinaryEnabled()) {
        const doc = new Media({ owner, contentType, storage: 'cloudinary', bytes: req.body.length });
        doc.remoteId = remoteIdFor(doc.publicId);
        await uploadImage({ remoteId: doc.remoteId, buffer: req.body, contentType });
        try {
          media = await doc.save();
        } catch (err) {
          await deleteImage(doc.remoteId).catch(() => {}); // do not leave an orphan file behind
          throw err;
        }
      } else {
        media = await Media.create({ owner, contentType, data: req.body });
      }
      return res.status(201).json({ data: { url: urlFor(media.publicId), bytes: req.body.length } });
    } catch (err) {
      if (err instanceof ImageStoreError) return res.status(err.status).json({ message: err.message, code: 'storage_unavailable' });
      if (err.type === 'entity.too.large') return res.status(413).json({ message: 'That image is too large (600 KB maximum).' });
      return next(err);
    }
  },
);

/** The owner's own uploads, newest first, with how many of their decks use each. Never includes the bytes. */
mediaRouter.get('/', authenticate, async (req, res, next) => {
  try {
    const owner = new mongoose.Types.ObjectId(req.auth.userId);
    // Size is computed inside MongoDB ($binarySize), so the image bytes are never read into the app.
    const items = await Media.aggregate([
      { $match: { owner } },
      { $sort: { createdAt: -1 } },
      { $project: { publicId: 1, createdAt: 1, bytes: { $ifNull: ['$bytes', { $binarySize: '$data' }] } } },
    ]);
    const decks = await Presentation.find({ owner, 'slides.design.imageUrl': { $regex: '^/api/media/' } }).select('title slides.design.imageUrl').lean();
    const data = items.map((item) => {
      const url = urlFor(item.publicId);
      const usedIn = decks.filter((d) => d.slides.some((s) => s.design?.imageUrl === url)).map((d) => ({ id: String(d._id), title: d.title }));
      return { url, bytes: item.bytes, createdAt: item.createdAt, usedIn };
    });
    res.set('Cache-Control', 'private, no-store');
    return res.json({ data, limit: MAX_IMAGES_PER_USER });
  } catch (err) {
    return next(err);
  }
});

/** Public by design: audience phones load slide images without an account. Anyone with the link can view it. */
mediaRouter.get('/:id', async (req, res, next) => {
  try {
    if (!PUBLIC_ID.test(req.params.id)) return res.status(404).json({ message: 'Image not found' });
    const media = await Media.findOne({ publicId: req.params.id }).lean();
    if (!media) return res.status(404).json({ message: 'Image not found' });
    if (media.storage === 'cloudinary') {
      // Bytes live at Cloudinary's CDN. Our link stays the same, so slides never hold a provider URL.
      res.set({ 'Cache-Control': 'public, max-age=86400', 'Cross-Origin-Resource-Policy': 'cross-origin' });
      return res.redirect(302, deliveryUrl(media.remoteId));
    }
    res.set({
      'Content-Type': media.contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    });
    return res.send(Buffer.from(media.data.buffer ?? media.data));
  } catch (err) {
    return next(err);
  }
});

/**
 * Owner deletes the file itself. Refused (409) while any deck or saved session still shows it, so a slide
 * never ends up with a silently broken picture. Someone else's id looks the same as a missing one.
 */
mediaRouter.delete('/:id', authenticate, async (req, res, next) => {
  try {
    if (!PUBLIC_ID.test(req.params.id)) return res.status(404).json({ message: 'Image not found' });
    const owner = new mongoose.Types.ObjectId(req.auth.userId);
    const media = await Media.findOne({ publicId: req.params.id, owner }).select('_id storage remoteId').lean();
    if (!media) return res.status(404).json({ message: 'Image not found' });
    const { decks, sessions } = await usageOf(urlFor(req.params.id));
    if (decks.length || sessions) {
      const own = decks.filter((d) => String(d.owner) === String(owner)).map((d) => d.title);
      const others = decks.length - own.length;
      return res.status(409).json({
        message: 'This image is still used on a slide. Remove it from the slide first, then delete the file.',
        code: 'image_in_use',
        usedIn: own,
        otherUses: others + sessions,
      });
    }
    if (media.storage === 'cloudinary') await deleteImage(media.remoteId);
    await Media.deleteOne({ _id: media._id });
    return res.status(204).end();
  } catch (err) {
    if (err instanceof ImageStoreError) return res.status(err.status).json({ message: err.message, code: 'storage_unavailable' });
    return next(err);
  }
});
