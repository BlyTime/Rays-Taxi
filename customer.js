import { database, ref, push, set, update, onValue } from "./firebase.js";

const button = document.getElementById("sendButton");
const locationButton = document.getElementById("locationButton");
const status = document.getElementById("status");
const requestForm = document.getElementById("requestForm");
const rideStatus = document.getElementById("rideStatus");
const rideStatusTitle = document.getElementById("rideStatusTitle");
const rideStatusMessage = document.getElementById("rideStatusMessage");
const cancelRequestButton = document.getElementById("cancelRequestButton");
const finishRideButton = document.getElementById("finishRideButton");
const savedRequestKey = "raysTaxiRequestId";
const REQUEST_TIMEOUT_MINUTES = 15;

const nameInput = document.getElementById("customerName");
const phoneInput = document.getElementById("phoneNumber");

nameInput.addEventListener("input", function () {
    this.value = this.value.replace(/[^a-zA-ZÀ-ÿ\s'-]/g, "");
});

phoneInput.addEventListener("input", function () {
    this.value = this.value.replace(/\D/g, "");
});

let latitude = "";
let longitude = "";
let accuracy = 0;
let gpsStatus = "";
let stopWatchingRide = null;
let requestTimeoutId = null;
let customerAudioContext = null;
let lastRideState = "";

function showRideStatus(request) {
    requestForm.hidden = true;
    rideStatus.hidden = false;

    const state = String(request.status || "Waiting").toLowerCase();
    const messages = {
        waiting: ["Request sent", "We are looking for an available driver."],
        accepted: ["Driver accepted your request", "Your driver will contact you shortly."],
        "en route": ["Your driver is on the way", "Please stay near your pickup location."],
        arrived: ["Your driver has arrived", "Your taxi is waiting at your pickup location."],
        "picked up": ["You are on your way", "Enjoy your ride!"],
        completed: ["Ride completed", "Thanks for riding with Ray's Taxi."],
        cancelled: ["Request cancelled", "Your driver has not been sent to you."],
        "timed out": ["No driver available", "No driver accepted in time. Please try again later."]
    };
    const [title, message] = messages[state] || ["Ride update", `Status: ${request.status}`];

    rideStatusTitle.textContent = title;
    rideStatusMessage.textContent = message;
    cancelRequestButton.hidden = state !== "waiting";
    finishRideButton.hidden = !["completed", "cancelled", "timed out"].includes(state);
    finishRideButton.textContent = state === "completed"
        ? "✅ Done — Request another taxi"
        : "🚕 Try requesting again";
}

function watchRide(requestId) {
    stopWatchingRide?.();
    stopWatchingRide = onValue(ref(database, `requests/${requestId}`), (snapshot) => {
        const request = snapshot.val();

        if (!request) {
            localStorage.removeItem(savedRequestKey);
            startNewRequest();
            return;
        }

        showRideStatus(request);
        scheduleRequestTimeout(request);

        const state = String(request.status || "Waiting").toLowerCase();
        if (state === "arrived" && lastRideState !== "arrived") playArrivalSound();
        lastRideState = state;
    });
}

function enableCustomerAlerts() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    customerAudioContext ??= new AudioContextClass();
    customerAudioContext.resume();
}

function playArrivalSound() {
    if (!customerAudioContext || customerAudioContext.state !== "running") return;

    [0, 0.2, 0.4].forEach((delay, index) => {
        const oscillator = customerAudioContext.createOscillator();
        const gain = customerAudioContext.createGain();
        oscillator.type = "triangle";
        oscillator.frequency.value = index === 2 ? 1047 : 784;
        gain.gain.setValueAtTime(0.0001, customerAudioContext.currentTime + delay);
        gain.gain.exponentialRampToValueAtTime(0.35, customerAudioContext.currentTime + delay + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, customerAudioContext.currentTime + delay + 0.16);
        oscillator.connect(gain).connect(customerAudioContext.destination);
        oscillator.start(customerAudioContext.currentTime + delay);
        oscillator.stop(customerAudioContext.currentTime + delay + 0.17);
    });
}

function scheduleRequestTimeout(request) {
    clearTimeout(requestTimeoutId);
    if (String(request.status || "Waiting").toLowerCase() !== "waiting") return;

    const expiry = new Date(request.expiresAt || new Date(new Date(request.created).getTime() + REQUEST_TIMEOUT_MINUTES * 60000)).getTime();
    const remaining = expiry - Date.now();
    requestTimeoutId = setTimeout(timeoutRequest, Math.max(0, remaining));
}

async function timeoutRequest() {
    const requestId = localStorage.getItem(savedRequestKey);
    if (!requestId) return;

    try {
        await update(ref(database, `requests/${requestId}`), {
            status: "Timed out",
            timedOutAt: new Date().toISOString()
        });
    } catch (error) {
        console.error("Could not time out request:", error);
    }
}

async function cancelRequest() {
    const requestId = localStorage.getItem(savedRequestKey);
    if (!requestId || !confirm("Cancel this taxi request?")) return;

    cancelRequestButton.disabled = true;
    try {
        await update(ref(database, `requests/${requestId}`), {
            status: "Cancelled",
            cancelledAt: new Date().toISOString()
        });
    } catch (error) {
        console.error("Could not cancel request:", error);
        cancelRequestButton.disabled = false;
        alert("Could not cancel the request. Please try again.");
    }
}

function startNewRequest() {
    stopWatchingRide?.();
    stopWatchingRide = null;
    clearTimeout(requestTimeoutId);
    localStorage.removeItem(savedRequestKey);
    requestForm.hidden = false;
    rideStatus.hidden = true;
    nameInput.value = "";
    phoneInput.value = "";
    latitude = "";
    longitude = "";
    accuracy = 0;
    gpsStatus = "";
    lastRideState = "";
    button.disabled = true;
    button.hidden = true;
    locationButton.hidden = false;
    locationButton.disabled = false;
    locationButton.textContent = "📍 Enable location";
    status.style.color = "white";
    status.textContent = "Tap “Enable location” to continue.";
    prepareLocation();
}

async function prepareLocation() {
    // When the customer has already allowed this site, fetch a fresh pickup
    // location without showing the extra button again.
    if (!navigator.permissions?.query) return;

    try {
        const permission = await navigator.permissions.query({ name: "geolocation" });
        if (permission.state === "granted") {
            locationButton.hidden = true;
            getLocation();
        }
    } catch (error) {
        // Some mobile browsers do not support checking geolocation permission.
        // Those browsers keep the explicit button, which is the safest fallback.
    }
}

function getLocation() {
    locationButton.disabled = true;
    status.style.color = "white";
    status.innerHTML = "📡 Requesting your pickup location…";

    if (!navigator.geolocation) {
        status.innerHTML = "Your browser does not support GPS.";
        locationButton.disabled = false;
        return;
    }

    navigator.geolocation.getCurrentPosition(success, error, {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
    });
}

function success(position) {
    latitude = position.coords.latitude;
    longitude = position.coords.longitude;
    accuracy = Math.round(position.coords.accuracy);

    let gpsColor = "";
    if (accuracy <= 4) {
        gpsStatus = "Excellent";
        gpsColor = "#00ff88";
    } else if (accuracy <= 10) {
        gpsStatus = "Good";
        gpsColor = "#ffd700";
    } else if (accuracy <= 20) {
        gpsStatus = "Fair";
        gpsColor = "#ff9800";
    } else {
        gpsStatus = "Weak";
        gpsColor = "#ff4444";
    }

    status.style.color = gpsColor;
    status.innerHTML = `<b>GPS Signal: ${gpsStatus}</b><br><br>Accuracy: <b>${accuracy} meters</b>`;
    locationButton.hidden = true;
    button.disabled = false;
    button.hidden = false;
    button.textContent = "🚖 Request Taxi";
}

async function sendRequest() {
    let passenger = nameInput.value.trim().replace(/[^a-zA-ZÀ-ÿ\s'-]/g, "");
    const countryCode = document.getElementById("countryCode").value;
    let phoneNumber = phoneInput.value.trim().replace(/\D/g, "");

    if (!passenger) {
        alert("Please enter the passenger's name.");
        return;
    }
    if (!phoneNumber) {
        alert("Please enter your phone number.");
        return;
    }

    button.disabled = true;
    button.textContent = "Sending...";
    enableCustomerAlerts();

    const requestRef = push(ref(database, "requests"));
    const createdAt = new Date();

    try {
        await set(requestRef, {
            passenger,
            phone: countryCode + phoneNumber,
            countryCode,
            latitude,
            longitude,
            accuracy,
            gpsStatus,
            status: "Waiting",
            created: createdAt.toISOString(),
            expiresAt: new Date(createdAt.getTime() + REQUEST_TIMEOUT_MINUTES * 60000).toISOString(),
            version: "0.6.0"
        });

        localStorage.setItem(savedRequestKey, requestRef.key);
        watchRide(requestRef.key);
    } catch (error) {
        console.error("Firebase Error:", error);
        status.style.color = "#ff4444";
        status.textContent = "❌ Unable to send taxi request.";
        button.disabled = false;
        button.textContent = "🚖 Request Taxi";
        alert(error.message);
    }
}

function error(err) {
    button.disabled = true;
    button.hidden = true;
    locationButton.hidden = false;
    locationButton.disabled = false;
    locationButton.textContent = "📍 Try location again";
    status.style.color = "#ff6666";

    switch (err.code) {
        case err.PERMISSION_DENIED:
            status.textContent = "Location is blocked. Allow Location for this site in your browser settings, then tap Try location again.";
            break;
        case err.POSITION_UNAVAILABLE:
            status.textContent = "GPS unavailable.";
            break;
        case err.TIMEOUT:
            status.textContent = "GPS request timed out.";
            break;
        default:
            status.textContent = "Unknown GPS error.";
    }
}

button.addEventListener("click", sendRequest);
locationButton.addEventListener("click", getLocation);
cancelRequestButton.addEventListener("click", cancelRequest);
finishRideButton.addEventListener("click", startNewRequest);

const savedRequestId = localStorage.getItem(savedRequestKey);
if (savedRequestId) {
    watchRide(savedRequestId);
} else {
    startNewRequest();
}
