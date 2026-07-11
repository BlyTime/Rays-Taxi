
const phone = "5927563720";

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

function sendWhatsApp() {

    const passenger = document.getElementById("customerName").value.trim();

    if (passenger === "") {

        alert("Please enter the passenger's name.");

        return;

    }

    const mapsLink = `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;

    let warning = "";

    if (accuracy > 20) {

        warning = `

GPS signal is weak.

Please reply with a nearby landmark photo to help your driver locate you faster.`;

    }

    const message = encodeURIComponent(

`Ray's Taxi Pickup Request

Passenger's Name:
${passenger}

Google Maps:
${mapsLink}

GPS Signal:
${gpsStatus}

GPS Accuracy:
${accuracy} meters

${warning}`

    );

    window.location.href = `https://wa.me/${phone}?text=${message}`;

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

button.addEventListener("click", sendWhatsApp);
