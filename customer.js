import { database, ref, push, set, onValue } from "./firebase.js";

const button = document.getElementById("sendButton");
const status = document.getElementById("status");
const requestForm = document.getElementById("requestForm");
const rideStatus = document.getElementById("rideStatus");
const rideStatusTitle = document.getElementById("rideStatusTitle");
const rideStatusMessage = document.getElementById("rideStatusMessage");
const savedRequestKey = "raysTaxiRequestId";

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
        cancelled: ["Request cancelled", "Please contact Ray's Taxi if you still need a ride."]
    };
    const [title, message] = messages[state] || ["Ride update", `Status: ${request.status}`];

    rideStatusTitle.textContent = title;
    rideStatusMessage.textContent = message;
}

function watchRide(requestId) {
    onValue(ref(database, `requests/${requestId}`), (snapshot) => {
        const request = snapshot.val();

        if (!request) {
            localStorage.removeItem(savedRequestKey);
            return;
        }

        showRideStatus(request);
    });
}

function getLocation() {
    status.style.color = "white";
    status.innerHTML = "📡 Finding your GPS location...";

    if (!navigator.geolocation) {
        status.innerHTML = "Your browser does not support GPS.";
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
    button.disabled = false;
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

    const requestRef = push(ref(database, "requests"));

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
            created: new Date().toISOString(),
            version: "0.5.0"
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
    status.style.color = "#ff6666";

    switch (err.code) {
        case err.PERMISSION_DENIED:
            status.textContent = "Location permission denied.";
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

const savedRequestId = localStorage.getItem(savedRequestKey);
if (savedRequestId) {
    watchRide(savedRequestId);
} else {
    getLocation();
}
