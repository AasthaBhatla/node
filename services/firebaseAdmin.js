// services/firebaseAdmin.js
const admin = require("firebase-admin");

let initialized = false;

function initFirebaseAdmin() {
  if (initialized) return admin;

  const jsonString = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || null;

  if (!jsonString) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_JSON is missing. Add it in .env (service account JSON as a string).",
    );
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(jsonString);
  } catch (e) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON.");
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  initialized = true;

  console.log(
    "✅ Firebase Admin initialized. project_id:",
    serviceAccount.project_id,
  );

  return admin;
}

module.exports = { admin, initFirebaseAdmin };
