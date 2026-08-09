import { database, ref, set, onValue } from "./firebase.js";

const DRIVER_ID = "ray";
const ACTIVE_STATUSES = new Set(["accepted", "en route", "arrived"]);
const mapStatus = document.getElementById("mapStatus");
const activePickups = document.getElementById("activePickups");
const centerDriverButton = document.getElementById("centerDriver");
const pickupMarkers = new Map();

const map = L.map("driverMap").setView([6.8013, -58.1551], 13);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap contributors"
}).addTo(map);

const taxiIcon = L.divIcon({
    className: "taxi-map-marker",
    html: "🚕",
    iconSize: [36, 36],
    iconAnchor: [18, 18]
});

const pickupIcon = L.divIcon({
    className: "pickup-map-marker",
    html: "📍",
    iconSize: [32, 32],
    iconAnchor: [16, 32]
});

let driverMarker;
let driverPosition;
let hasSetInitialView = false;

function escapeHtml(value) {
    const element = document.createElement("div");
    element.textContent = value ?? "";
    return element.innerHTML;
}

function updateDriverPosition(position) {
    const { latitude, longitude, accuracy } = position.coords;
    driverPosition = [latitude, longitude];

    if (!driverMarker) {
        driverMarker = L.marker(driverPosition, { icon: taxiIcon, zIndexOffset: 1000 })
            .addTo(map)
            .bindPopup("You are here");
    } else {
        driverMarker.setLatLng(driverPosition);
    }

    mapStatus.textContent = `📡 Sharing live location · GPS accuracy ${Math.round(accuracy)} m`;

    set(ref(database, `drivers/${DRIVER_ID}`), {
        latitude,
        longitude,
        accuracy: Math.round(accuracy),
        updatedAt: new Date().toISOString(),
        sharing: true
    }).catch((error) => {
        console.error("Could not share driver location:", error);
        mapStatus.textContent = "⚠️ Map is open, but live location could not be shared.";
    });

    if (!hasSetInitialView) {
        map.setView(driverPosition, 15);
        hasSetInitialView = true;
    }
}

function showLocationError(error) {
    const messages = {
        1: "Location permission was denied.",
        2: "Your live location is unavailable.",
        3: "Live location request timed out."
    };
    mapStatus.textContent = `⚠️ ${messages[error.code] || "Could not get your location."}`;
}

function validLocation(request) {
    return Number.isFinite(Number(request.latitude)) &&
        Number.isFinite(Number(request.longitude));
}

function renderPickups(data) {
    const activeRequests = Object.entries(data || {})
        .filter(([, request]) => ACTIVE_STATUSES.has(String(request.status || "").toLowerCase()))
        .filter(([, request]) => validLocation(request))
        .sort(([, a], [, b]) => new Date(a.acceptedAt || a.created || 0) - new Date(b.acceptedAt || b.created || 0));

    const activeIds = new Set(activeRequests.map(([id]) => id));
    pickupMarkers.forEach((marker, id) => {
        if (!activeIds.has(id)) {
            map.removeLayer(marker);
            pickupMarkers.delete(id);
        }
    });

    if (!activeRequests.length) {
        activePickups.textContent = "No accepted pickups yet.";
        return;
    }

    activePickups.innerHTML = activeRequests.map(([id, request]) => {
        const passenger = escapeHtml(request.passenger || "Passenger");
        const state = escapeHtml(request.status || "Accepted");
        const point = [Number(request.latitude), Number(request.longitude)];
        let marker = pickupMarkers.get(id);

        if (!marker) {
            marker = L.marker(point, { icon: pickupIcon }).addTo(map);
            pickupMarkers.set(id, marker);
        } else {
            marker.setLatLng(point);
        }

        marker.bindPopup(`<strong>${passenger}</strong><br>${state} pickup`);
        return `<button class="pickup-list-item" type="button" data-request-id="${id}">📍 ${passenger}<span>${state}</span></button>`;
    }).join("");
}

onValue(ref(database, "requests"), (snapshot) => {
    renderPickups(snapshot.val());
});

if (navigator.geolocation) {
    navigator.geolocation.watchPosition(updateDriverPosition, showLocationError, {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 15000
    });
} else {
    mapStatus.textContent = "⚠️ This browser does not support live location.";
}

centerDriverButton.addEventListener("click", () => {
    if (driverPosition) map.setView(driverPosition, 16);
});

activePickups.addEventListener("click", (event) => {
    const button = event.target.closest(".pickup-list-item");
    if (!button) return;

    const marker = pickupMarkers.get(button.dataset.requestId);
    if (marker) {
        map.setView(marker.getLatLng(), 16);
        marker.openPopup();
    }
});
