import { config } from '../config.js';

/** True when Cloudinary credentials are configured. Otherwise uploads stay in MongoDB. */
export const cloudinaryEnabled = () => Boolean(config.cloudinary.cloudName && config.cloudinary.apiKey && config.cloudinary.apiSecret);

export class ImageStoreError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = 'ImageStoreError';
    this.status = status;
  }
}

const apiUrl = (action) => `https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloudinary.cloudName)}/image/${action}`;
const basicAuth = () => `Basic ${Buffer.from(`${config.cloudinary.apiKey}:${config.cloudinary.apiSecret}`).toString('base64')}`;

/** Storage name at Cloudinary for one of our images. */
export const remoteIdFor = (publicId) => `crowdflow/${publicId}`;

/** Uploads one image. Never logs the credentials. Throws ImageStoreError with a message safe to show. */
export async function uploadImage({ remoteId, buffer, contentType }) {
  const body = new FormData();
  body.set('file', `data:${contentType};base64,${buffer.toString('base64')}`);
  body.set('public_id', remoteId);
  body.set('overwrite', 'false');
  let res;
  try {
    res = await fetch(apiUrl('upload'), { method: 'POST', headers: { Authorization: basicAuth() }, body });
  } catch {
    throw new ImageStoreError('Image storage is not reachable right now. Try again in a minute.');
  }
  if (!res.ok) {
    console.error('Cloudinary upload failed with status', res.status);
    throw new ImageStoreError(res.status === 420 || res.status === 429
      ? 'The image storage limit has been reached. Try again later.'
      : 'The image could not be stored. Try again in a minute.');
  }
  return res.json();
}

/** Deletes an image. "Not found" counts as deleted so a repeat after a partial failure finishes the job. */
export async function deleteImage(remoteId) {
  let res;
  try {
    res = await fetch(apiUrl('destroy'), {
      method: 'POST',
      headers: { Authorization: basicAuth(), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ public_id: remoteId, invalidate: 'true' }),
    });
  } catch {
    throw new ImageStoreError('Image storage is not reachable right now. Try again in a minute.');
  }
  if (!res.ok) {
    console.error('Cloudinary delete failed with status', res.status);
    throw new ImageStoreError('The image file could not be deleted. Try again in a minute.');
  }
  const json = await res.json().catch(() => ({}));
  if (json.result && !['ok', 'not found'].includes(json.result)) throw new ImageStoreError('The image file could not be deleted. Try again in a minute.');
}

/** Public delivery link. f_auto and q_auto let Cloudinary send the smallest good format; width caps phone downloads. */
export const deliveryUrl = (remoteId, { width = 1600 } = {}) =>
  `https://res.cloudinary.com/${encodeURIComponent(config.cloudinary.cloudName)}/image/upload/f_auto,q_auto,c_limit,w_${width}/${remoteId}`;
