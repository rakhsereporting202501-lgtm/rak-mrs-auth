## RAK MRS Auth – Setup (Login Only)

React + TypeScript (Vite) login-only UI using Firebase Authentication + Firestore (roles) with i18n (AR/EN) and RTL/LTR. Free plan friendly (no Cloud Functions/Storage).

### Firebase config
- Copy your `firebaseConfig` JSON: Firebase Console → Project settings → Your apps (Web) → Config
- Create `.env.local` with:

```
VITE_FIREBASE_API_KEY=AIzaSyCsA_tvgGymEmVSIELEZBIZwFaDcBlw6SE
VITE_FIREBASE_AUTH_DOMAIN=rak-material-requests.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=rak-material-requests
VITE_FIREBASE_STORAGE_BUCKET=rak-material-requests.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=797655912645
VITE_FIREBASE_APP_ID=1:797655912645:web:fb50562a97ac96a98d60ac
```

This project requires `.env.local`; the runtime Settings modal has been removed.

### Provisioning checklist
- Authentication → Sign-in method → enable Email/Password
- Authentication → Settings → Authorized domains: add `localhost` and `127.0.0.1`
- Provision users via Console (email + temp password)
- Firestore roles doc for each user: `roles/{uid}` → `{ roles: { requester:true, storeOfficer:false, deptManager:false, admin:false }, departmentIds:["HSE","VRP","TRP","Store"] }`
- Username login mapping (optional): `usernames/{usernameLower}` → `{ uid: '<UID>', email: '<email>' }`

### Install & run

```
npm install
npm run dev
```

Open the printed local URL. The app reads `.env.local` for Firebase configuration.

### Environment setup\n\n- This app relies solely on .env.local for Firebase configuration.\n- The runtime Settings modal has been removed; missing envs will throw at startup.\n- Ensure Vite env vars (VITE_*) are present before running.\n\n### Notes\n- Login-only: No sign-up/reset/verify routes are exposed.\n- Do not import firebase/analytics; only app/auth/firestore are used.

### Usernames collection (public read)
- The usernames collection is public-read for login resolution only.
- Document ID must be the lowercase username.
- Document fields: { uid: '<UID>', email: 'user@example.com' }.
