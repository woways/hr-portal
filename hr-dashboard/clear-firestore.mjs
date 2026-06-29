import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, deleteDoc } from "firebase/firestore";

const app = initializeApp({
  apiKey: "AIzaSyAzz8Fun5V45SH3fdUZg5IrKJWjW_ngq9U",
  authDomain: "hrmanagement-6b903.firebaseapp.com",
  projectId: "hrmanagement-6b903",
  storageBucket: "hrmanagement-6b903.firebasestorage.app",
  messagingSenderId: "965185081559",
  appId: "1:965185081559:web:c05c8acefc215e31c3e092",
});
const db = getFirestore(app);

const COLLECTIONS = ["employees","leaveRequests","goals","attendance","payroll","notifications","regularization","clockRecords"];

async function clearAll() {
  console.log("\n🗑  Clearing all Firestore collections...\n");
  for (const col of COLLECTIONS) {
    const snap = await getDocs(collection(db, col));
    for (const d of snap.docs) await deleteDoc(d.ref);
    console.log(`  ✓ ${col.padEnd(18)} → ${snap.size} documents deleted`);
  }
  console.log("\n✅ All collections are empty. Ready for real data.\n");
  process.exit(0);
}

clearAll().catch(e => { console.error(e); process.exit(1); });
