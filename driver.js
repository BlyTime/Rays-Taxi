import { database, auth, ref, onValue, onAuthStateChanged, update, runTransaction, signOut } from "./firebase.js";
import { getDefaultDriverProfile, normaliseDriverProfile } from "./driver-profiles.js";

const requestsDiv = document.getElementById("requests");
const requestList = document.getElementById("requestList");
const requestsRef = ref(database, "requests");
const mapStatus = document.getElementById("mapStatus");
const logoutButton = document.getElementById("logoutButton");
const centerDriverButton = document.getElementById("centerDriver");
const serviceAvailableInput = document.getElementById("serviceAvailable");
const serviceMessageInput = document.getElementById("serviceMessage");
const saveServiceStatusButton = document.getElementById("saveServiceStatus");
const serviceStatusSaved = document.getElementById("serviceStatusSaved");

const MAP_VISIBLE_STATUSES = new Set(["waiting", "accepted", "en route", "arrived"]);
const PIN_COLOURS = ["#f26b38", "#2b83c6", "#8c5bd8", "#d95374", "#00a878", "#e29b17"];

let knownRequestIds = null;
let alertsEnabled = false;
let audioContext;
let dashboardStarted = false;
let lastDashboardSignature = "";
let currentDriverProfile = null;
let stopWatchingDriverProfile = null;
let stopWatchingDriverLocation = null;
let stopWatchingServiceStatus = null;
let stopWatchingDriverAccount = null;
let currentDriverAccount = null;

let map;
let lastDriverLocation;
let hasSetInitialMapView = false;
const pickupMarkers = new Map();
const driverMarkers = new Map();

function escapeHtml(value) {
    const element = document.createElement("div");
    element.textContent = value ?? "";
    return element.innerHTML;
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

function formatKilometres(distance) {
    return `${Math.max(0, Number(distance) || 0).toFixed(2)} km`;
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
        .filter(([, request]) => currentDriverAccount?.role === "operator" ||
            String(request.status || "").toLowerCase() === "waiting" ||
            request.driverUid === auth.currentUser?.uid)
        .sort(([, a], [, b]) => new Date(b.created || 0) - new Date(a.created || 0))
        .map(([key, request]) => {
            const phone = phoneNumber(request);
            const hasLocation = validLocation(request);
            const currentStatus = String(request.status || "Waiting");
            const statusKey = currentStatus.toLowerCase().replace(/\s+/g, "-");
            const expired = requestIsExpired(request);
            const belongsToThisDriver = request.driverUid === auth.currentUser?.uid;
            const canAdvance = currentStatus.toLowerCase() === "waiting" || belongsToThisDriver;
            const step = expired || !canAdvance ? null : nextRideStep(currentStatus);
            const waitingEndedAt = ["picked up", "completed"].includes(currentStatus.toLowerCase())
                ? request.pickedUpAt || request.statusUpdatedAt || ""
                : "";
            const colour = requestColour(key);
            const passenger = escapeHtml(request.passenger || "Passenger");
            const status = escapeHtml(currentStatus);
            const gpsStatus = escapeHtml(request.gpsStatus || "Unavailable");
            const accuracy = Number.isFinite(Number(request.accuracy)) ? `${Math.round(Number(request.accuracy))} m` : "Unavailable";
            const isNew = newRequestIds.has(key);
            const showTripMeter = ["picked up", "completed"].includes(currentStatus.toLowerCase());

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
                        ${showTripMeter ? `<span class="trip-meter">🛣️ Trip: <strong>${formatKilometres(request.tripDistanceKm)}</strong></span>` : ""}
                    </div>
                    <div class="request-footer">
                        <div class="request-actions">
                            <a class="action ${hasLocation ? "" : "is-disabled"}" href="${hasLocation ? directionsUrl(request) : "#"}" target="_blank" rel="noopener" aria-label="Navigate to pickup" ${hasLocation ? "" : "aria-disabled=\"true\""}>🧭</a>
                            <a class="action ${phone ? "" : "is-disabled"}" href="${phone ? `https://wa.me/${phone}` : "#"}" target="_blank" rel="noopener" aria-label="Open WhatsApp" ${phone ? "" : "aria-disabled=\"true\""}>💬</a>
                            <a class="action ${phone ? "" : "is-disabled"}" href="${phone ? `tel:+${phone}` : "#"}" aria-label="Call passenger" ${phone ? "" : "aria-disabled=\"true\""}>📞</a>
                        </div>
                        <button class="ride-step" type="button" data-request-id="${escapeHtml(key)}" data-next-status="${step ? step.nextStatus : ""}" data-timestamp-field="${step ? step.timestamp : ""}" ${step ? "" : "disabled"}>
                            ${step ? step.label : expired ? "⌛ Request timed out" : currentStatus.toLowerCase() === "cancelled" ? "✕ Request cancelled" : belongsToThisDriver ? "✓ Ride completed" : "🚕 Taken by another driver"}
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

function showDriverMarker(driverId, location, driverName = driverId, mapIcon = "taxi-ipsum.png") {
    if (!map || !validDriverLocation(location)) return;
    const point = [Number(location.latitude), Number(location.longitude)];
    const name = String(driverName || driverId || "Driver");
    const taxiIcon = L.divIcon({
        className: "fleet-driver-icon",
        html: `<img class="fleet-driver-car" src="${escapeHtml(mapIcon)}" alt=""><span class="fleet-driver-name">${escapeHtml(name)}</span>`,
        iconSize: [96, 64],
        iconAnchor: [48, 32]
    });
    let marker = driverMarkers.get(driverId);
    if (!marker) {
        marker = L.marker(point, { icon: taxiIcon, zIndexOffset: 1000 }).addTo(map);
        driverMarkers.set(driverId, marker);
    } else {
        marker.setLatLng(point);
        marker.setIcon(taxiIcon);
    }
    marker.bindPopup(`<strong>🚕 ${escapeHtml(name)}</strong>`);
}

function renderDriverMarkers(drivers) {
    const visibleDrivers = Object.entries(drivers || {}).filter(([, driver]) => validDriverLocation(driver?.liveLocation));
    const visibleIds = new Set(visibleDrivers.map(([driverId]) => driverId));
    driverMarkers.forEach((marker, driverId) => {
        if (!visibleIds.has(driverId)) {
            map.removeLayer(marker);
            driverMarkers.delete(driverId);
        }
    });
    visibleDrivers.forEach(([driverId, driver], index) => {
        const name = driver.profile?.driverName || driver.name || driverId;
        const isDenzel = /denzel/i.test(`${driverId} ${name}`);
        const fallbackIcon = isDenzel || index > 0 ? "2nd_drive.png" : "taxi-ipsum.png";
        showDriverMarker(driverId, driver.liveLocation, name, driver.profile?.mapIcon || fallbackIcon);
    });
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

    if (!hasSetInitialMapView && mapRequests.length) {
        const bounds = L.latLngBounds(mapRequests.map(([, request]) => [Number(request.latitude), Number(request.longitude)]));
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
    mapStatus.textContent = "🖥️ Dispatch view · GPS supplied by BLY RIDE Beacon";

    onValue(ref(database, "drivers"), (snapshot) => renderDriverMarkers(snapshot.val()));

    onValue(requestsRef, (snapshot) => {
        const data = snapshot.val() || {};
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
        if (newRequestIds.size) playNewRequestSound();
    });
}

function watchDriverProfile(user) {
    stopWatchingDriverProfile?.();
    const profileRef = ref(database, `drivers/${currentDriverAccount.driverId}/profile`);
    stopWatchingDriverProfile = onValue(profileRef, (snapshot) => {
        const savedProfile = snapshot.val();
        currentDriverProfile = normaliseDriverProfile(savedProfile, user.uid);
        if (!savedProfile) {
            update(ref(database, `drivers/${currentDriverAccount.driverId}`), { profile: currentDriverProfile })
                .catch((error) => console.error("Could not create driver profile:", error));
        }
    });
}

function watchDriverLiveLocation() {
    stopWatchingDriverLocation?.();
    stopWatchingDriverLocation = onValue(ref(database, `drivers/${currentDriverAccount.driverId}/liveLocation`), (snapshot) => {
        const sharedLocation = snapshot.val();
        if (!validDriverLocation(sharedLocation)) return;
        lastDriverLocation = sharedLocation;
        showDriverMarker(
            currentDriverAccount.driverId,
            sharedLocation,
            currentDriverProfile?.driverName || currentDriverAccount.driverId,
            currentDriverProfile?.mapIcon || (/denzel/i.test(`${currentDriverAccount.driverId} ${currentDriverProfile?.driverName || ""}`) ? "2nd_drive.png" : "taxi-ipsum.png")
        );
    });
}

function watchServiceStatus() {
    stopWatchingServiceStatus?.();
    stopWatchingServiceStatus = onValue(ref(database, "serviceStatus"), (snapshot) => {
        const saved = snapshot.val() || {};
        serviceAvailableInput.checked = saved.isAvailable !== false;
        serviceMessageInput.value = String(saved.message || "");
    });
}

onAuthStateChanged(auth, (user) => {
    if (!user || user.isAnonymous) {
        requestList.innerHTML = '<p>Driver sign-in is required. <a class="map-page-link" href="driver-login.html">Sign in as driver</a></p>';
        mapStatus.textContent = "🔒 Driver sign-in required";
        return;
    }
    stopWatchingDriverAccount?.();
    stopWatchingDriverAccount = onValue(ref(database, `driverAccounts/${user.uid}`), (snapshot) => {
        const account = snapshot.val();
        if (!account?.driverId) {
            requestList.innerHTML = "<p>This sign-in has not been added as a BLY RIDE driver yet.</p>";
            mapStatus.textContent = "🔒 Driver account setup required";
            return;
        }
        currentDriverAccount = { driverId: String(account.driverId), role: account.role === "operator" ? "operator" : "driver" };
        watchDriverProfile(user);
        watchDriverLiveLocation();
        if (currentDriverAccount.role === "operator") watchServiceStatus();
        else document.querySelector(".service-control").hidden = true;
        startDashboard();
    });
});

saveServiceStatusButton.addEventListener("click", async () => {
    if (currentDriverAccount?.role !== "operator") return;
    saveServiceStatusButton.disabled = true;
    serviceStatusSaved.textContent = "Saving…";
    try {
        await update(ref(database, "serviceStatus"), {
            isAvailable: serviceAvailableInput.checked,
            message: serviceMessageInput.value.trim(),
            updatedAt: new Date().toISOString(),
            updatedBy: auth.currentUser.uid
        });
        serviceStatusSaved.textContent = "✓ Customer page updated";
    } catch (error) {
        console.error("Could not save service status:", error);
        serviceStatusSaved.textContent = "Could not save. Check Firebase rules.";
    } finally {
        saveServiceStatusButton.disabled = false;
    }
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
        const requestRef = ref(database, `requests/${button.dataset.requestId}`);
        if (button.dataset.nextStatus === "Accepted") {
            const { driverUid, ...profileForCustomer } = currentDriverProfile || getDefaultDriverProfile(auth.currentUser.uid);
            const result = await runTransaction(requestRef, (request) => {
                if (!request || String(request.status || "").toLowerCase() !== "waiting") return;
                return { ...request, status: "Accepted", acceptedAt: timestamp, statusUpdatedAt: timestamp,
                    driverUid: auth.currentUser.uid, driverId: currentDriverAccount.driverId, driverProfile: profileForCustomer };
            });
            if (!result.committed) alert("Another driver accepted this request first.");
        } else {
            const changes = { status: button.dataset.nextStatus, [button.dataset.timestampField]: timestamp, statusUpdatedAt: timestamp };
            if (button.dataset.nextStatus === "Picked up") changes.driverLocation = null;
            await update(requestRef, changes);
        }
    } catch (error) {
        console.error("Could not update ride status:", error);
        button.disabled = false;
        button.textContent = "Try again";
        alert("Could not update this ride. Please try again.");
    }
});

logoutButton.addEventListener("click", async () => {
    if (!confirm("Log out of the driver dashboard on this device?")) return;
    await signOut(auth);
    window.location.replace("driver-login.html");
});
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
