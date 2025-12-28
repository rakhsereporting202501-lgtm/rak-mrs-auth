const admin = require('firebase-admin');
const functions = require('firebase-functions');

admin.initializeApp();

exports.adminSetUserPassword = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  }

  const callerUid = context.auth.uid;
  const roleSnap = await admin.firestore().doc(`roles/${callerUid}`).get();
  const isAdmin = !!roleSnap.data()?.roles?.admin;
  if (!isAdmin) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only.');
  }

  const targetUid = (data?.uid || '').toString();
  const password = (data?.password || '').toString();
  if (!targetUid || !password) {
    throw new functions.https.HttpsError('invalid-argument', 'uid and password are required.');
  }
  if (password.length < 8) {
    throw new functions.https.HttpsError('invalid-argument', 'Password must be at least 8 characters.');
  }

  await admin.auth().updateUser(targetUid, { password });
  return { ok: true };
});
