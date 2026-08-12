import { database, auth, ref, onValue, onAuthStateChanged, update } from "./firebase.js";

const map = L.map("driveMap").setView([6.8013, -58.1551], 13);
const driveStatus = document.getElementById("driveStatus");
const centerDriverButton = document.getElementById("centerDriver");
const manualTripButton = document.getElementById("manualTripButton");
const manualTripDistance = document.getElementById("manualTripDistance");
const manualTripStatus = document.getElementById("manualTripStatus");
const requestMarkers = new Map();
const PIN_COLOURS = ["#f26b38", "#2b83c6", "#8c5bd8", "#d95374", "#00a878", "#e29b17"];

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap contributors"
}).addTo(map);

const taxiIcon = L.icon({ iconUrl: "taxi-ipsum.png", iconSize: [70, 47], iconAnchor: [35, 24] });
let driverMarker;
let driverLocation;
let manualTrip = { active: false, distanceKm: 0 };
let currentDriverId;

function validLocation(location) {
    return Number.isFinite(Number(location?.latitude)) && Number.isFinite(Number(location?.longitude));
}

function requestColour(requestId) {
    let hash = 0;
    for (const character of String(requestId)) hash = ((hash << 5) - hash) + character.charCodeAt(0);
    return PIN_COLOURS[Math.abs(hash) % PIN_COLOURS.length];
}

function showDriverLocation(location) {
    if (!validLocation(location)) return;
    driverLocation = location;
    const point = [Number(location.latitude), Number(location.longitude)];
    if (!driverMarker) driverMarker = L.marker(point, { icon: taxiIcon, zIndexOffset: 1000 }).addTo(map);
    else driverMarker.setLatLng(point);
    driveStatus.textContent = `📡 Beacon GPS · accuracy ${Math.round(Number(location.accuracy) || 0)} m`;
}

function renderRequestDots(data) {
    const visibleRequests = Object.entries(data || {}).filter(([, request]) => {
        const status = String(request.status || "").toLowerCase();
        return ["waiting", "accepted", "en route", "arrived"].includes(status) && validLocation(request);
    });
    const visibleIds = new Set(visibleRequests.map(([id]) => id));
    requestMarkers.forEach((marker, id) => {
        if (!visibleIds.has(id)) {
            map.removeLayer(marker);
            requestMarkers.delete(id);
        }
    });
    visibleRequests.forEach(([id, request]) => {
        const point = [Number(request.latitude), Number(request.longitude)];
        let marker = requestMarkers.get(id);
        if (!marker) {
            marker = L.circleMarker(point, { radius: 9, color: "#ffffff", weight: 2, fillColor: requestColour(id), fillOpacity: 1 }).addTo(map);
            requestMarkers.set(id, marker);
        } else marker.setLatLng(point);
    });
}

function renderManualTrip(value) {
    manualTrip = { active: Boolean(value?.active), distanceKm: Number(value?.distanceKm) || 0 };
    manualTripDistance.textContent = `${manualTrip.distanceKm.toFixed(2)} km`;
    manualTripButton.textContent = manualTrip.active ? "■ Stop trip" : "▶ Start trip";
    manualTripButton.classList.toggle("manual-trip-stop", manualTrip.active);
    manualTripStatus.textContent = manualTrip.active
        ? "Trip is running from the BLY RIDE Beacon GPS."
        : manualTrip.distanceKm > 0 ? "Trip stopped. Final distance is saved above." : "Start when the passenger enters your taxi.";
}

onAuthStateChanged(auth, (user) => {
    if (!user || user.isAnonymous) {
        driveStatus.textContent = "🔒 Driver sign-in required";
        return;
    }
    onValue(ref(database, `driverAccounts/${user.uid}`), (snapshot) => {
        currentDriverId = snapshot.val()?.driverId;
        if (!currentDriverId) {
            driveStatus.textContent = "🔒 Driver account setup required";
            return;
        }
        onValue(ref(database, `drivers/${currentDriverId}/liveLocation`), (locationSnapshot) => showDriverLocation(locationSnapshot.val()));
        onValue(ref(database, `drivers/${currentDriverId}/manualTrip`), (tripSnapshot) => renderManualTrip(tripSnapshot.val()));
        onValue(ref(database, "requests"), (requestsSnapshot) => renderRequestDots(requestsSnapshot.val()));
    });
});

manualTripButton.addEventListener("click", async () => {
    manualTripButton.disabled = true;
    try {
        if (!currentDriverId) throw new Error("Driver account setup required");
        if (manualTrip.active) {
            await update(ref(database, `drivers/${currentDriverId}/manualTrip`), { active: false, completedAt: new Date().toISOString() });
        } else {
            await update(ref(database, `drivers/${currentDriverId}/manualTrip`), { active: true, distanceKm: 0, startedAt: new Date().toISOString(), completedAt: null });
        }
    } catch (error) {
        console.error("Could not update manual trip:", error);
        alert("Could not update the trip. Please try again.");
    } finally {
        manualTripButton.disabled = false;
    }
});

centerDriverButton.addEventListener("click", () => {
    if (validLocation(driverLocation)) map.setView([Number(driverLocation.latitude), Number(driverLocation.longitude)], 16);
});

setTimeout(() => map.invalidateSize(), 300);
window.addEventListener("resize", () => map.invalidateSize());
