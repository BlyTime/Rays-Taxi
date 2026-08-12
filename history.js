import { database, auth, ref, onValue, onAuthStateChanged } from "./firebase.js";

const historyList = document.getElementById("historyList");
const historySummary = document.getElementById("historySummary");
const TERMINAL_STATUSES = new Set(["completed", "cancelled", "timed out"]);

function escapeHtml(value) {
    const element = document.createElement("div");
    element.textContent = value ?? "";
    return element.innerHTML;
}

function formatDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Not recorded";
    return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short"
    }).format(date);
}

function formatDistance(value) {
    return `${Math.max(0, Number(value) || 0).toFixed(2)} km`;
}

function phoneNumber(request) {
    const countryCode = String(request.countryCode || "").replace(/\D/g, "");
    let phone = String(request.phone || "").replace(/\D/g, "");
    if (countryCode && phone && !phone.startsWith(countryCode)) phone = countryCode + phone;
    return phone ? `+${phone}` : "Phone unavailable";
}

function terminalTime(request, status) {
    if (status === "completed") return request.completedAt || request.statusUpdatedAt;
    if (status === "cancelled") return request.cancelledAt || request.statusUpdatedAt;
    return request.timedOutAt || request.statusUpdatedAt;
}

function renderHistory(data) {
    const rides = Object.entries(data || {})
        .filter(([, request]) => TERMINAL_STATUSES.has(String(request.status || "").toLowerCase()))
        .sort(([, a], [, b]) => new Date(terminalTime(b, String(b.status || "").toLowerCase()) || 0) - new Date(terminalTime(a, String(a.status || "").toLowerCase()) || 0));

    const completed = rides.filter(([, request]) => String(request.status || "").toLowerCase() === "completed");
    const totalKm = completed.reduce((sum, [, request]) => sum + (Number(request.tripDistanceKm) || 0), 0);
    historySummary.textContent = `${rides.length} saved record${rides.length === 1 ? "" : "s"} · ${completed.length} completed · ${totalKm.toFixed(2)} km completed`;

    if (!rides.length) {
        historyList.innerHTML = "<p>No completed or cancelled rides yet.</p>";
        return;
    }

    historyList.innerHTML = rides.map(([, request]) => {
        const status = String(request.status || "").toLowerCase();
        const isCompleted = status === "completed";
        const pickup = request.pickedUpAt;
        const end = terminalTime(request, status);
        return `
            <article class="history-card history-${escapeHtml(status.replace(/\s+/g, "-"))}">
                <div class="history-card-top">
                    <h2>👤 ${escapeHtml(request.passenger || "Passenger")}</h2>
                    <span class="status status-${escapeHtml(status.replace(/\s+/g, "-"))}">${escapeHtml(request.status || "Ride")}</span>
                </div>
                <p>📞 ${escapeHtml(phoneNumber(request))}</p>
                <div class="history-details">
                    <span>🟢 Pickup: ${escapeHtml(formatDateTime(pickup))}</span>
                    <span>🏁 ${isCompleted ? "Drop-off" : "Ended"}: ${escapeHtml(formatDateTime(end))}</span>
                    ${isCompleted ? `<strong>🛣️ ${formatDistance(request.tripDistanceKm)}</strong>` : ""}
                </div>
            </article>`;
    }).join("");
}

onAuthStateChanged(auth, (user) => {
    if (!user || user.isAnonymous) {
        historySummary.textContent = "Driver sign-in required.";
        historyList.innerHTML = '<p><a class="map-page-link" href="driver-login.html">Sign in as driver</a></p>';
        return;
    }
    onValue(ref(database, "requests"), (snapshot) => renderHistory(snapshot.val()));
});
