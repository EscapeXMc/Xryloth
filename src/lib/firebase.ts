// @ts-ignore
import { initializeApp } from "firebase/app";
// @ts-ignore
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile, type User } from "firebase/auth";
// @ts-ignore
import { getDatabase, ref, set, get, push, onValue, onChildAdded, onChildChanged, serverTimestamp, query, orderByChild, limitToLast, update, remove, off, equalTo } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyC7Jb2CuVT-sku8Yw-1AlnxPf0uqr5Hj74",
  authDomain: "xryloth-mc.firebaseapp.com",
  databaseURL: "https://xryloth-mc-default-rtdb.firebaseio.com",
  projectId: "xryloth-mc",
  storageBucket: "xryloth-mc.firebasestorage.app",
  messagingSenderId: "526889634406",
  appId: "1:526889634406:web:a398cc871b48d18c343ba7"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

export { app, auth, db };
export {
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile,
  ref, set, get, push, onValue, onChildAdded, onChildChanged, serverTimestamp, query, orderByChild, limitToLast, update, remove, equalTo,
};
export type { User };
