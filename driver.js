import { database, ref, onValue, update } from "./firebase.js";

const requestsDiv = document.getElementById("requests");
const requestsRef = ref(database, "requests");
let knownRequestIds = null;
let alertsEnabled = false;
let audioContext;

function escapeHtml(value) {
    const element = document.createElement("div");
    element.textContent = value ?? "";
    return element.innerHTML;
}

function phoneNumber(request) {
    const countryCode = String(request.countryCode || "").replace(/\D/g, "");
    let phone = String(request.phone || "").replace(/\D/g, "");

    // Existing customer requests already include the country code in `phone`.
    if (countryCode && phone && !phone.startsWith(countryCode)) {
        phone = countryCode + phone;
    }

    return phone;
}

function waitingText(created) {
    const createdAt = new Date(created).getTime();
    if (Number.isNaN(createdAt)) return "Waiting time unavailable";

    const minutes = Math.max(0, Math.floor((Date.now() - createdAt) / 60000));
    return minutes < 1 ? "Waiting less than 1 min" : `Waiting ${minutes} min`;
}

function refreshWaitingTimes() {
    document.querySelectorAll("[data-created]").forEach((element) => {
        element.textContent = waitingText(element.dataset.created);
    });
}

function validLocation(request) {
    return Number.isFinite(Number(request.latitude)) &&
        Number.isFinite(Number(request.longitude));
}

function nextRideStep(status) {
    const steps = {
        waiting: { label: "🚕 Accept", nextStatus: "Accepted", timestamp: "acceptedAt" },
        accepted: { label: "🛣️ En route", nextStatus: "En route", timestamp: "enRouteAt" },
        "en route": { label: "📍 Arrived", nextStatus: "Arrived", timestamp: "arrivedAt" },
        arrived: { label: "🚖 Passenger onboard", nextStatus: "Picked up", timestamp: "pickedUpAt" },
        "picked up": { label: "✅ Complete ride", nextStatus: "Completed", timestamp: "completedAt" }
    };

    return steps[status.toLowerCase()] || null;
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
    requestsDiv.innerHTML = `
        <div class="dashboard-heading">
            <h1>🚖 Ray's Taxi Driver Dashboard</h1>
            <button id="alertToggle" class="alert-toggle" type="button" aria-pressed="${alertsEnabled}">
                ${alertsEnabled ? "🔔 Alerts on" : "🔕 Enable alerts"}
            </button>
        </div>`;

    if (!data) {
        requestsDiv.innerHTML += "<p>No requests yet.</p>";
        return;
    }

    Object.entries(data)
        .sort(([, a], [, b]) => new Date(b.created || 0) - new Date(a.created || 0))
        .forEach(([key, request]) => {
            const phone = phoneNumber(request);
            const hasLocation = validLocation(request);
            const mapUrl = hasLocation
                ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${request.latitude},${request.longitude}`)}`
                : "#";
            const status = escapeHtml(request.status || "Waiting");
            const passenger = escapeHtml(request.passenger || "Passenger");
            const gpsStatus = escapeHtml(request.gpsStatus || "Unavailable");
            const accuracy = Number.isFinite(Number(request.accuracy))
                ? `${Math.round(Number(request.accuracy))} m`
                : "Unavailable";
            const currentStatus = String(request.status || "Waiting");
            const step = nextRideStep(currentStatus);
            const isNew = newRequestIds.has(key);

            requestsDiv.innerHTML += `
                <article class="request ${isNew ? "new-request" : ""}">
                    ${isNew ? "<span class=\"new-request-label\">New request</span>" : ""}
                    <div class="request-heading">
                        <h2>👤 ${passenger}</h2>
                        <span class="status status-${status.toLowerCase()}">${status}</span>
                    </div>
                    <p class="phone">📞 ${phone ? `+${phone}` : "Phone unavailable"}</p>
                    <p class="waiting">⏱️ <span data-created="${escapeHtml(request.created || "")}">${waitingText(request.created)}</span></p>
                    <p class="gps">📡 GPS: <strong>${gpsStatus}</strong> · ${accuracy}</p>
                    <div class="request-actions">
                        <a class="action ${hasLocation ? "" : "is-disabled"}" href="${mapUrl}" target="_blank" rel="noopener" aria-label="Open map" ${hasLocation ? "" : "aria-disabled=\"true\""}>🧭</a>
                        <a class="action ${phone ? "" : "is-disabled"}" href="${phone ? `https://wa.me/${phone}` : "#"}" target="_blank" rel="noopener" aria-label="Open WhatsApp" ${phone ? "" : "aria-disabled=\"true\""}>💬</a>
                        <a class="action ${phone ? "" : "is-disabled"}" href="${phone ? `tel:+${phone}` : "#"}" aria-label="Call passenger" ${phone ? "" : "aria-disabled=\"true\""}>📞</a>
                    </div>
                    <button class="ride-step" type="button" data-request-id="${escapeHtml(key)}" data-next-status="${step ? step.nextStatus : ""}" data-timestamp-field="${step ? step.timestamp : ""}" ${step ? "" : "disabled"}>
                        ${step ? step.label : "✓ Ride completed"}
                    </button>
                </article>`;
        });
}

onValue(requestsRef, (snapshot) => {
    const data = snapshot.val() || {};
    const currentRequestIds = new Set(Object.keys(data));
    const newRequestIds = knownRequestIds
        ? new Set([...currentRequestIds].filter((id) => !knownRequestIds.has(id)))
        : new Set();

    knownRequestIds = currentRequestIds;
    renderRequests(data, newRequestIds);
    refreshWaitingTimes();

    if (newRequestIds.size) playNewRequestSound();
});

requestsDiv.addEventListener("click", async (event) => {
    const disabledLink = event.target.closest("a.is-disabled");
    const alertToggle = event.target.closest("#alertToggle");
    const button = event.target.closest(".ride-step");

    if (disabledLink) {
        event.preventDefault();
        return;
    }

    if (alertToggle) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) {
            alert("This browser does not support sound alerts.");
            return;
        }
        audioContext ??= new AudioContextClass();
        await audioContext.resume();
        alertsEnabled = !alertsEnabled;
        alertToggle.setAttribute("aria-pressed", alertsEnabled);
        alertToggle.textContent = alertsEnabled ? "🔔 Alerts on" : "🔕 Enable alerts";
        if (alertsEnabled) playNewRequestSound();
        return;
    }

    if (!button || button.disabled) return;
    button.disabled = true;
    button.textContent = "Updating...";

    try {
        const timestamp = new Date().toISOString();
        await update(ref(database, `requests/${button.dataset.requestId}`), {
            status: button.dataset.nextStatus,
            [button.dataset.timestampField]: timestamp,
            statusUpdatedAt: timestamp
        });
    } catch (error) {
        console.error("Could not update ride status:", error);
        button.disabled = false;
        button.textContent = "Try again";
        alert("Could not update this ride. Please try again.");
    }
});

setInterval(refreshWaitingTimes, 30000);
