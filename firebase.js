
// Firebase Configuration

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";

import {
    getDatabase,
    ref,
    push,
    set,
    update,
    onValue
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js";

import {
    getAuth,
    signInAnonymously,
    onAuthStateChanged,
    signInWithEmailAndPassword,
    signOut
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";

const firebaseConfig = {

    apiKey: "AIzaSyCkxcHldzvMJun6lAcZuI5ZwKr1fsmjYv8",

    authDomain: "rays-taxi.firebaseapp.com",

    databaseURL: "https://rays-taxi-default-rtdb.firebaseio.com",

    projectId: "rays-taxi",

    storageBucket: "rays-taxi.firebasestorage.app",

    messagingSenderId: "676032335281",

    appId: "1:676032335281:web:e20b5063db12bdc3f18190"

};

const app = initializeApp(firebaseConfig);

const database = getDatabase(app);

const auth = getAuth(app);

export {

    database,

    auth,

    ref,

    push,

    set,

    update,

    onValue,

    signInAnonymously,

    onAuthStateChanged,

    signInWithEmailAndPassword,

    signOut

};
