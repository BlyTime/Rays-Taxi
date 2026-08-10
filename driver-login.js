import { auth, signInWithEmailAndPassword } from "./firebase.js";

const emailInput = document.getElementById("driverEmail");
const passwordInput = document.getElementById("driverPassword");
const loginButton = document.getElementById("driverLoginButton");
const loginStatus = document.getElementById("loginStatus");

if (auth.currentUser && !auth.currentUser.isAnonymous) {
    window.location.replace("driver.html");
}

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
        loginStatus.innerHTML = `Signed in.<br>Copy this Driver ID for the security rules:<br><code>${credential.user.uid}</code><br><br>Opening dashboard…`;
        setTimeout(() => window.location.replace("driver.html"), 4000);
    } catch (error) {
        console.error("Driver sign-in failed:", error);
        loginStatus.textContent = "Sign-in failed. Check your email and password.";
        loginButton.disabled = false;
        loginButton.textContent = "Sign in";
    }
});
