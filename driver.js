import { database, ref, onValue } from "./firebase.js";

const requestsDiv = document.getElementById("requests");

const requestsRef = ref(database, "requests");

onValue(requestsRef, (snapshot) => {

    const data = snapshot.val();

    requestsDiv.innerHTML = "<h1>🚖 Ray's Taxi Driver Dashboard</h1>";

    if (!data) {

        requestsDiv.innerHTML += "<p>No requests yet.</p>";

        return;

    }

    Object.entries(data).reverse().forEach(([key, request]) => {

        requestsDiv.innerHTML += `

        <div class="request">

            <h2>${request.passenger}</h2>

            <p><b>Status:</b> ${request.status}</p>

            <p><b>GPS:</b> ${request.gpsStatus}</p>

            <p><b>Accuracy:</b> ${request.accuracy} m</p>

            <p><b>Latitude:</b> ${request.latitude}</p>

            <p><b>Longitude:</b> ${request.longitude}</p>

            <button class="accept">

                Accept

            </button>

        </div>

        `;

    });

});
