import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { getAuth, setPersistence, browserLocalPersistence } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

function requireEnv(name: string): string {
  const v = (import.meta as any).env[`VITE_${name}`];
  if (!v) throw new Error(`Missing environment variable: VITE_${name}`);
  return v as string;
}

export function initFirebase(): { app: FirebaseApp } {
  const config = {
    apiKey: requireEnv('FIREBASE_API_KEY'),
    authDomain: requireEnv('FIREBASE_AUTH_DOMAIN'),
    projectId: requireEnv('FIREBASE_PROJECT_ID'),
    storageBucket: requireEnv('FIREBASE_STORAGE_BUCKET'),
    messagingSenderId: requireEnv('FIREBASE_MESSAGING_SENDER_ID'),
    appId: requireEnv('FIREBASE_APP_ID'),
  };
  const apps = getApps();
  const app = apps.length ? apps[0]! : initializeApp(config);
  const auth = getAuth(app);
  setPersistence(auth, browserLocalPersistence);
  getFirestore(app);
  return { app };
}
