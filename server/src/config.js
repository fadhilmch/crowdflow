import 'dotenv/config';

const requiredInProduction = ['JWT_SECRET', 'MONGODB_URI'];

for (const key of requiredInProduction) {
  if (process.env.NODE_ENV === 'production' && !process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

/** CLOUDINARY_URL (cloudinary://key:secret@cloud) or the three separate variables. Empty means images stay in MongoDB. */
function cloudinaryFromEnv() {
  const url = process.env.CLOUDINARY_URL;
  if (url) {
    try {
      const u = new URL(url);
      if (u.protocol === 'cloudinary:') return { cloudName: u.hostname, apiKey: decodeURIComponent(u.username), apiSecret: decodeURIComponent(u.password) };
    } catch { /* fall through to the separate variables */ }
  }
  return {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME ?? '',
    apiKey: process.env.CLOUDINARY_API_KEY ?? '',
    apiSecret: process.env.CLOUDINARY_API_SECRET ?? '',
  };
}

export const config = {
  cloudinary: cloudinaryFromEnv(),
  port: Number(process.env.PORT ?? 3000),
  mongoUri: process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/livepoll',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-only-insecure-secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  clientOrigin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID ?? '',
    authDomain: process.env.FIREBASE_AUTH_DOMAIN ?? '',
    serviceAccountJson: process.env.FIREBASE_SERVICE_ACCOUNT ?? '',
    // The public web API key (the same one the browser uses). Lets the server check revocation without a service account.
    webApiKey: process.env.FIREBASE_API_KEY ?? '',
    // How recently the user must have typed their password to delete the account.
    recentSignInSeconds: Number(process.env.FIREBASE_RECENT_SIGN_IN_SECONDS ?? 300),
  },
  accessCode: {
    length: Number(process.env.ACCESS_CODE_LENGTH ?? 6),
    alphabet: process.env.ACCESS_CODE_ALPHABET ?? '0123456789',
    maxAttempts: Number(process.env.ACCESS_CODE_MAX_ATTEMPTS ?? 25),
  },
};
