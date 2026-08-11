import { auth, authPersistenceReady, onAuthStateChanged, signInWithEmailAndPassword } from "./firebase.js";

const emailInput = document.getElementById("driverEmail");
const passwordInput = document.getElementById("driverPassword");
const loginButton = document.getElementById("driverLoginButton");
const loginStatus = document.getElementById("loginStatus");

const savedDriverEmail = localStorage.getItem("raysTaxiDriverEmail");
if (savedDriverEmail) emailInput.value = savedDriverEmail;

authPersistenceReady.finally(() => {
    onAuthStateChanged(auth, (user) => {
        if (user && !user.isAnonymous) {
            window.location.replace("driver.html");
        }
    });
});

loginButton.addEventListener("click", async () => {
    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (!email || !password) {
        loginStatus.textContent = "Enter your driver email and password.";
        return;
    }

    loginButton.disabled = true;
    loginButton.textContent = "Signing in...";

    try {
        const credential = await signInWithEmailAndPassword(auth, email, password);
        localStorage.setItem("raysTaxiDriverEmail", credential.user.email || email);
        loginStatus.textContent = "Signed in. Opening dashboard…";
        window.location.replace("driver.html");
    } catch (error) {
        console.error("Driver sign-in failed:", error);
        loginStatus.textContent = "Sign-in failed. Check your email and password.";
        loginButton.disabled = false;
        loginButton.textContent = "Sign in";
    }
});
