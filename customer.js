import { database, ref, push, set } from "./firebase.js";

const button = document.getElementById("sendButton");
const status = document.getElementById("status");

let latitude = "";
let longitude = "";
let accuracy = 0;
let gpsStatus = "";

window.onload = function () {

    getLocation();

};

function getLocation() {

    status.style.color = "white";
    status.innerHTML = "📡 Finding your GPS location...";

    if (!navigator.geolocation) {

        status.innerHTML = "Your browser does not support GPS.";
        return;

    }

    navigator.geolocation.getCurrentPosition(

        success,
        error,

        {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
        }

    );

}

function success(position) {

    latitude = position.coords.latitude;
    longitude = position.coords.longitude;
    accuracy = Math.round(position.coords.accuracy);

    let gpsColor = "";

    if (accuracy <= 4) {

        gpsStatus = "Excellent";
        gpsColor = "#00ff88";

    }
    else if (accuracy <= 10) {

        gpsStatus = "Good";
        gpsColor = "#ffd700";

    }
    else if (accuracy <= 20) {

        gpsStatus = "Fair";
        gpsColor = "#ff9800";

    }
    else {

        gpsStatus = "Weak";
        gpsColor = "#ff4444";

    }

    status.style.color = gpsColor;

    status.innerHTML =

    `<b>GPS Signal: ${gpsStatus}</b>

    <br><br>

    Accuracy:

    <b>${accuracy} meters</b>`;

    button.disabled = false;

    button.innerHTML = "🚖 Request Taxi";

}

function sendRequest() {

    const passenger =
        document.getElementById("customerName").value.trim()
        || "Not Provided";

    const countryCode =
        document.getElementById("countryCode").value;

    const phoneNumber =
        document.getElementById("phoneNumber").value.trim();

    if (phoneNumber === "") {

        alert("Please enter your phone number.");

        return;

    }

    const fullPhoneNumber =
        countryCode + phoneNumber;

    const requestRef =
        push(ref(database, "requests"));

    set(requestRef, {

        passenger: passenger,

        phone: fullPhoneNumber,

        countryCode: countryCode,

        latitude: latitude,

        longitude: longitude,

        accuracy: accuracy,

        gpsStatus: gpsStatus,

        status: "Waiting",

        created: new Date().toISOString(),

        version: "0.3.0"

    })

    .then(() => {

        status.style.color = "#00ff88";

        status.innerHTML =

        `<b>✅ Taxi request sent!</b>

        <br><br>

        Your driver will contact you shortly.`;

        button.disabled = true;

        button.innerHTML = "Request Sent";

        console.log("Taxi request saved.");

    })

    .catch((error) => {

        console.error("Firebase Error:", error);

        status.style.color = "#ff4444";

        status.innerHTML =
            "❌ Unable to send taxi request.";

        alert(error.message);

    });

}

function error(err) {

    button.disabled = true;

    status.style.color = "#ff6666";

    switch (err.code) {

        case err.PERMISSION_DENIED:

            status.innerHTML = "Location permission denied.";
            break;

        case err.POSITION_UNAVAILABLE:

            status.innerHTML = "GPS unavailable.";
            break;

        case err.TIMEOUT:

            status.innerHTML = "GPS request timed out.";
            break;

        default:

            status.innerHTML = "Unknown GPS error.";

    }

}

button.addEventListener("click", sendRequest);
