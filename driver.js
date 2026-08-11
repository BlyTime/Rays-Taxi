import { database, auth, ref, onValue, onAuthStateChanged, update } from "./firebase.js";
import { getDefaultDriverProfile, normaliseDriverProfile } from "./driver-profiles.js";

const requestsDiv = document.getElementById("requests");
const requestList = document.getElementById("requestList");
const requestsRef = ref(database, "requests");
const mapStatus = document.getElementById("mapStatus");
const displayModeButton = document.getElementById("displayModeButton");
const shareGpsButton = document.getElementById("shareGpsButton");
const centerDriverButton = document.getElementById("centerDriver");

const TRACKED_RIDE_STATUSES = new Set(["en route", "arrived"]);
const MAP_VISIBLE_STATUSES = new Set(["waiting", "accepted", "en route", "arrived"]);
const DEVICE_MODE_KEY = "raysTaxiDriverDeviceMode";
const PIN_COLOURS = ["#f26b38", "#2b83c6", "#8c5bd8", "#d95374", "#00a878", "#e29b17"];

let knownRequestIds = null;
let alertsEnabled = false;
let audioContext;
let dashboardStarted = false;
let activeRideIds = new Set();
let dashboardLocationWatchId = null;
let lastDashboardSignature = "";
let currentDriverProfile = null;
let stopWatchingDriverProfile = null;
let stopWatchingDriverLocation = null;
let deviceMode = localStorage.getItem(DEVICE_MODE_KEY) || "display";
let latestRequests = {};

let map;
let driverMarker;
let lastDriverLocation;
let hasSetInitialMapView = false;
const pickupMarkers = new Map();

function escapeHtml(value) {
    const element = document.createElement("div");
    element.textContent = value ?? "";
    return element.innerHTML;
}

function isSharingGps() {
    return deviceMode === "share";
}

function requestColour(requestId) {
    let hash = 0;
    for (const character of String(requestId)) hash = ((hash << 5) - hash) + character.charCodeAt(0);
    return PIN_COLOURS[Math.abs(hash) % PIN_COLOURS.length];
}

function phoneNumber(request) {
    const countryCode = String(request.countryCode || "").replace(/\D/g, "");
    let phone = String(request.phone || "").replace(/\D/g, "");
    if (countryCode && phone && !phone.startsWith(countryCode)) phone = countryCode + phone;
    return phone;
}

function waitingText(created, endedAt = "") {
    const createdAt = new Date(created).getTime();
    if (Number.isNaN(createdAt)) return "Waiting time unavailable";
    const savedEndTime = endedAt ? new Date(endedAt).getTime() : NaN;
    const endTime = Number.isNaN(savedEndTime) ? Date.now() : savedEndTime;
    const elapsedSeconds = Math.max(0, Math.floor((endTime - createdAt) / 1000));
    return `${endedAt ? "Waited" : "Waiting"} ${Math.floor(elapsedSeconds / 60)}m ${String(elapsedSeconds % 60).padStart(2, "0")}s`;
}

function refreshWaitingTimes() {
    document.querySelectorAll("[data-created]").forEach((element) => {
        element.textContent = waitingText(element.dataset.created, element.dataset.ended);
    });
}

function validLocation(request) {
    return Number.isFinite(Number(request?.latitude)) && Number.isFinite(Number(request?.longitude));
}

function validDriverLocation(location) {
    return Number.isFinite(Number(location?.latitude)) && Number.isFinite(Number(location?.longitude));
}

function nextRideStep(status) {
    const steps = {
        waiting: { label: "🚕 Accept", nextStatus: "Accepted", timestamp: "acceptedAt" },
        accepted: { label: "🛣️ En route", nextStatus: "En route", timestamp: "enRouteAt" },
        "en route": { label: "📍 Arrived", nextStatus: "Arrived", timestamp: "arrivedAt" },
        arrived: { label: "🚖 Passenger onboard", nextStatus: "Picked up", timestamp: "pickedUpAt" },
        "picked up": { label: "✅ Complete ride", nextStatus: "Completed", timestamp: "completedAt" }
    };
    return steps[String(status || "").toLowerCase()] || null;
}

function requestIsExpired(request) {
    return String(request.status || "").toLowerCase() === "waiting" && request.expiresAt && new Date(request.expiresAt).getTime() <= Date.now();
}

function directionsUrl(request) {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${request.latitude},${request.longitude}`)}&travelmode=driving`;
}

function playNewRequestSound() {
    if (!alertsEnabled || !audioContext) return;
    [0, 0.22].forEach((delay, index) => {
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        oscillator.type = "square";
        oscillator.frequency.value = index === 0 ? 880 : 1175;
        gain.gain.setValueAtTime(0.2, audioContext.currentTime + delay);
        gain.gain.exponentialRampToValueAtTime(3, audioContext.currentTime + delay + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + delay + 0.16);
        oscillator.connect(gain).connect(audioContext.destination);
        oscillator.start(audioContext.currentTime + delay);
        oscillator.stop(audioContext.currentTime + delay + 0.17);
    });
}

function renderRequests(data, newRequestIds = new Set()) {
    if (!data || !Object.keys(data).length) {
        requestList.innerHTML = "<p>No requests yet.</p>";
        return;
    }

    requestList.innerHTML = Object.entries(data)
        .sort(([, a], [, b]) => new Date(b.created || 0) - new Date(a.created || 0))
        .map(([key, request]) => {
            const phone = phoneNumber(request);
            const hasLocation = validLocation(request);
            const currentStatus = String(request.status || "Waiting");
            const statusKey = currentStatus.toLowerCase().replace(/\s+/g, "-");
            const expired = requestIsExpired(request);
            const step = expired ? null : nextRideStep(currentStatus);
            const waitingEndedAt = ["picked up", "completed"].includes(currentStatus.toLowerCase())
                ? request.pickedUpAt || request.statusUpdatedAt || ""
                : "";
            const colour = requestColour(key);
            const passenger = escapeHtml(request.passenger || "Passenger");
            const status = escapeHtml(currentStatus);
            const gpsStatus = escapeHtml(request.gpsStatus || "Unavailable");
            const accuracy = Number.isFinite(Number(request.accuracy)) ? `${Math.round(Number(request.accuracy))} m` : "Unavailable";
            const isNew = newRequestIds.has(key);

            return `
                <article class="request ${isNew ? "new-request" : ""}" data-request-id="${escapeHtml(key)}" style="--ride-colour:${colour}">
                    <div class="request-card-top">
                        ${isNew ? "<span class=\"new-request-label\">New request</span>" : "<span></span>"}
                        <span class="status status-${expired ? "timed-out" : statusKey}">${expired ? "Timed out" : status}</span>
                    </div>
                    <div class="request-heading request-name-row">
                        <h2><span class="ride-colour-dot" aria-hidden="true"></span>👤 ${passenger}</h2>
                    </div>
                    <div class="request-meta">
                        <span>📞 ${phone ? `+${phone}` : "Phone unavailable"}</span>
                        <span>⏱️ <span data-created="${escapeHtml(request.created || "")}" data-ended="${escapeHtml(waitingEndedAt)}">${waitingText(request.created, waitingEndedAt)}</span></span>
                        <span>📡 <strong>${gpsStatus}</strong> · ${accuracy}</span>
                    </div>
                    <div class="request-footer">
                        <div class="request-actions">
                            <a class="action ${hasLocation ? "" : "is-disabled"}" href="${hasLocation ? directionsUrl(request) : "#"}" target="_blank" rel="noopener" aria-label="Navigate to pickup" ${hasLocation ? "" : "aria-disabled=\"true\""}>🧭</a>
                            <a class="action ${phone ? "" : "is-disabled"}" href="${phone ? `https://wa.me/${phone}` : "#"}" target="_blank" rel="noopener" aria-label="Open WhatsApp" ${phone ? "" : "aria-disabled=\"true\""}>💬</a>
                            <a class="action ${phone ? "" : "is-disabled"}" href="${phone ? `tel:+${phone}` : "#"}" aria-label="Call passenger" ${phone ? "" : "aria-disabled=\"true\""}>📞</a>
                        </div>
                        <button class="ride-step" type="button" data-request-id="${escapeHtml(key)}" data-next-status="${step ? step.nextStatus : ""}" data-timestamp-field="${step ? step.timestamp : ""}" ${step ? "" : "disabled"}>
                            ${step ? step.label : expired ? "⌛ Request timed out" : currentStatus.toLowerCase() === "cancelled" ? "✕ Request cancelled" : "✓ Ride completed"}
                        </button>
                    </div>
                </article>`;
        }).join("");
}

function initMap() {
    if (map) return;
    map = L.map("driverMap").setView([6.8013, -58.1551], 13);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© OpenStreetMap contributors"
    }).addTo(map);
    setTimeout(() => map.invalidateSize(), 300);
    window.addEventListener("resize", () => map.invalidateSize());
}

function showDriverMarker(location) {
    if (!map || !validDriverLocation(location)) return;
    const point = [Number(location.latitude), Number(location.longitude)];
    const taxiIcon = L.icon({ iconUrl: "taxi-ipsum.png", iconSize: [70, 47], iconAnchor: [35, 24] });
    if (!driverMarker) {
        driverMarker = L.marker(point, { icon: taxiIcon, zIndexOffset: 1000 }).addTo(map).bindPopup("🚕 Your taxi");
    } else {
        driverMarker.setLatLng(point);
    }
}

function updateMap(data) {
    initMap();
    const mapRequests = Object.entries(data || {}).filter(([, request]) =>
        MAP_VISIBLE_STATUSES.has(String(request.status || "").toLowerCase()) && validLocation(request)
    );
    const visibleIds = new Set(mapRequests.map(([id]) => id));

    pickupMarkers.forEach((marker, requestId) => {
        if (!visibleIds.has(requestId)) {
            map.removeLayer(marker);
            pickupMarkers.delete(requestId);
        }
    });

    mapRequests.forEach(([requestId, request]) => {
        const point = [Number(request.latitude), Number(request.longitude)];
        const colour = requestColour(requestId);
        let marker = pickupMarkers.get(requestId);
        if (!marker) {
            marker = L.circleMarker(point, { radius: 10, color: "#ffffff", weight: 2, fillColor: colour, fillOpacity: 1 }).addTo(map);
            pickupMarkers.set(requestId, marker);
        } else {
            marker.setLatLng(point);
            marker.setStyle({ fillColor: colour });
        }
        marker.bindPopup(`<strong>${escapeHtml(request.passenger || "Passenger")}</strong><br>${escapeHtml(request.status || "Waiting")}<br><a href="${directionsUrl(request)}" target="_blank" rel="noopener">Navigate</a>`);
    });

    const sharedLocation = Object.values(data || {})
        .map((request) => request.driverLocation)
        .filter(validDriverLocation)
        .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))[0];
    if (sharedLocation) {
        lastDriverLocation = sharedLocation;
        showDriverMarker(sharedLocation);
    }

    if (!hasSetInitialMapView && mapRequests.length) {
        const bounds = L.latLngBounds(mapRequests.map(([, request]) => [Number(request.latitude), Number(request.longitude)]));
        if (sharedLocation) bounds.extend([Number(sharedLocation.latitude), Number(sharedLocation.longitude)]);
        map.fitBounds(bounds, { padding: [28, 28], maxZoom: 15 });
        hasSetInitialMapView = true;
    }
}

function focusRequest(requestId) {
    const marker = pickupMarkers.get(requestId);
    if (!marker) return;
    map.setView(marker.getLatLng(), 16);
    marker.openPopup();
}

function updateDeviceModeUi() {
    const sharing = isSharingGps();
    displayModeButton.classList.toggle("is-active", !sharing);
    shareGpsButton.classList.toggle("is-active", sharing);
    displayModeButton.setAttribute("aria-pressed", String(!sharing));
    shareGpsButton.setAttribute("aria-pressed", String(sharing));

    if (!sharing) {
        mapStatus.textContent = "🖥️ Display only · this device will not share GPS";
    } else if (!lastDriverLocation) {
        mapStatus.textContent = "📡 GPS sharing is armed · tap En route to begin ride tracking";
    }
}

function setDeviceMode(mode) {
    deviceMode = mode;
    localStorage.setItem(DEVICE_MODE_KEY, mode);
    updateDeviceModeUi();

    if (isSharingGps()) {
        beginDriverLocationSharing();
        syncDriverLocationSharing(latestRequests);
    } else {
        activeRideIds = new Set();
        stopDriverLocationSharing();
    }
}

function dashboardSignature(data) {
    return JSON.stringify(Object.entries(data || {}).map(([requestId, request]) => {
        const { driverLocation, ...dashboardRequest } = request;
        return [requestId, dashboardRequest];
    }));
}

function startDashboard() {
    if (dashboardStarted) return;
    dashboardStarted = true;
    initMap();
    updateDeviceModeUi();

    onValue(requestsRef, (snapshot) => {
        const data = snapshot.val() || {};
        latestRequests = data;
        const currentRequestIds = new Set(Object.keys(data));
        const newRequestIds = knownRequestIds ? new Set([...currentRequestIds].filter((id) => !knownRequestIds.has(id))) : new Set();
        knownRequestIds = currentRequestIds;

        const signature = dashboardSignature(data);
        if (signature !== lastDashboardSignature) {
            lastDashboardSignature = signature;
            renderRequests(data, newRequestIds);
            refreshWaitingTimes();
        }
        updateMap(data);
        syncDriverLocationSharing(data);
        if (newRequestIds.size) playNewRequestSound();
    });
}

function watchDriverProfile(user) {
    stopWatchingDriverProfile?.();
    const profileRef = ref(database, "drivers/ray/profile");
    stopWatchingDriverProfile = onValue(profileRef, (snapshot) => {
        const savedProfile = snapshot.val();
        currentDriverProfile = normaliseDriverProfile(savedProfile, user.uid);
        if (!savedProfile) {
            update(ref(database, "drivers/ray"), { profile: currentDriverProfile })
                .catch((error) => console.error("Could not create driver profile:", error));
        }
    });
}

function watchDriverLiveLocation() {
    stopWatchingDriverLocation?.();
    stopWatchingDriverLocation = onValue(ref(database, "drivers/ray/liveLocation"), (snapshot) => {
        const sharedLocation = snapshot.val();
        if (!validDriverLocation(sharedLocation)) return;
        lastDriverLocation = sharedLocation;
        showDriverMarker(sharedLocation);
    });
}

function syncDriverLocationSharing(data) {
    if (!isSharingGps()) return;
    activeRideIds = new Set(Object.entries(data || {})
        .filter(([, request]) => TRACKED_RIDE_STATUSES.has(String(request.status || "").toLowerCase()))
        .map(([requestId]) => requestId));
    if (activeRideIds.size) beginDriverLocationSharing();
}

function beginDriverLocationSharing() {
    if (!isSharingGps() || dashboardLocationWatchId !== null || !navigator.geolocation) return;
    dashboardLocationWatchId = navigator.geolocation.watchPosition((position) => {
        const driverLocation = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: Math.round(position.coords.accuracy),
            updatedAt: new Date().toISOString()
        };
        lastDriverLocation = driverLocation;
        showDriverMarker(driverLocation);
        mapStatus.textContent = `📡 Sharing live GPS · accuracy ${driverLocation.accuracy} m`;
        // This private driver record powers the Chromebook's My location
        // button even before a customer has been accepted.
        update(ref(database, "drivers/ray"), { liveLocation: driverLocation })
            .catch((error) => console.error("Could not share private driver location:", error));
        activeRideIds.forEach((requestId) => {
            update(ref(database, `requests/${requestId}`), { driverLocation })
                .catch((error) => console.error("Could not share driver location:", error));
        });
    }, (error) => {
        const messages = { 1: "Location permission was denied.", 2: "GPS is unavailable.", 3: "GPS request timed out." };
        mapStatus.textContent = `⚠️ ${messages[error.code] || "Could not get location."}`;
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 });
}

function stopDriverLocationSharing() {
    if (dashboardLocationWatchId !== null) navigator.geolocation.clearWatch(dashboardLocationWatchId);
    dashboardLocationWatchId = null;
}

onAuthStateChanged(auth, (user) => {
    if (!user || user.isAnonymous) {
        requestList.innerHTML = '<p>Driver sign-in is required. <a class="map-page-link" href="driver-login.html">Sign in as driver</a></p>';
        mapStatus.textContent = "🔒 Driver sign-in required";
        return;
    }
    watchDriverProfile(user);
    watchDriverLiveLocation();
    startDashboard();
});

requestsDiv.addEventListener("click", async (event) => {
    const disabledLink = event.target.closest("a.is-disabled");
    if (disabledLink) {
        event.preventDefault();
        return;
    }
    if (!event.target.closest("a, button")) {
        const card = event.target.closest(".request[data-request-id]");
        if (card) focusRequest(card.dataset.requestId);
    }

    const button = event.target.closest(".ride-step");
    if (!button || button.disabled) return;
    button.disabled = true;
    button.textContent = "Updating…";

    try {
        const timestamp = new Date().toISOString();
        const changes = { status: button.dataset.nextStatus, [button.dataset.timestampField]: timestamp, statusUpdatedAt: timestamp };
        if (button.dataset.nextStatus === "Accepted") {
            changes.driverUid = auth.currentUser.uid;
            changes.driverId = "ray";
            const { driverUid, ...profileForCustomer } = currentDriverProfile || getDefaultDriverProfile(auth.currentUser.uid);
            changes.driverProfile = profileForCustomer;
        }
        if (button.dataset.nextStatus === "En route" && isSharingGps()) beginDriverLocationSharing();
        if (button.dataset.nextStatus === "Picked up") {
            changes.driverLocation = null;
            activeRideIds.delete(button.dataset.requestId);
        }
        await update(ref(database, `requests/${button.dataset.requestId}`), changes);
    } catch (error) {
        console.error("Could not update ride status:", error);
        button.disabled = false;
        button.textContent = "Try again";
        alert("Could not update this ride. Please try again.");
    }
});

displayModeButton.addEventListener("click", () => setDeviceMode("display"));
shareGpsButton.addEventListener("click", () => setDeviceMode("share"));
centerDriverButton.addEventListener("click", () => {
    if (lastDriverLocation && map) map.setView([Number(lastDriverLocation.latitude), Number(lastDriverLocation.longitude)], 16);
});

function enableDriverAlerts() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    audioContext ??= new AudioContextClass();
    audioContext.resume();
    alertsEnabled = true;
}

document.addEventListener("pointerdown", enableDriverAlerts, { once: true });
document.addEventListener("keydown", enableDriverAlerts, { once: true });
setInterval(refreshWaitingTimes, 1000);
