if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("sw.js")
            .catch((error) => console.error("PWA service worker could not start:", error));
    });
}
