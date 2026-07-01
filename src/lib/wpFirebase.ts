import { initializeApp, getApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAuth, setPersistence, browserLocalPersistence } from 'firebase/auth';
import { getDatabase } from 'firebase/database';
import { getFirestore } from 'firebase/firestore';

const WP_APP_NAME = 'work-plan-rak';

const wpFirebaseConfig = {
  apiKey: 'AIzaSyBWWLuXWOybyn1dNs9ryxO1cnFDkQWZKVE',
  authDomain: 'work-plan-rak.firebaseapp.com',
  databaseURL: 'https://work-plan-rak-default-rtdb.firebaseio.com',
  projectId: 'work-plan-rak',
  storageBucket: 'work-plan-rak.firebasestorage.app',
  messagingSenderId: '210989405455',
  appId: '1:210989405455:web:0df52dfea8c4b406209a7a',
  measurementId: 'G-RZ99D5SP8Z',
};

export const WP_FIREBASE_API_KEY = wpFirebaseConfig.apiKey;

export function initWpFirebase(): { app: FirebaseApp } {
  const app = getApps().some((entry) => entry.name === WP_APP_NAME)
    ? getApp(WP_APP_NAME)
    : initializeApp(wpFirebaseConfig, WP_APP_NAME);
  setPersistence(getAuth(app), browserLocalPersistence);
  getFirestore(app);
  getDatabase(app);
  return { app };
}

export function getWpAuth() {
  return getAuth(initWpFirebase().app);
}

export function getWpDb() {
  return getFirestore(initWpFirebase().app);
}

export function getWpRealtimeDb() {
  return getDatabase(initWpFirebase().app);
}
