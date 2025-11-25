// Common JS, shared across pages

const apiBase = ""; // Same domain, leave empty

function getCurrentClientId() {
    const raw = window.localStorage.getItem("currentClientId");
    if (!raw) return null;
    const num = Number(raw);
    return Number.isFinite(num) ? num : null;
}

function setCurrentClientId(id) {
    if (id == null) {
        window.localStorage.removeItem("currentClientId");
    } else {
        window.localStorage.setItem("currentClientId", String(id));
    }
    updateCurrentClientBadge();
}

function updateCurrentClientBadge() {
    const badge = document.getElementById("currentClientBadge");
    if (!badge) return;
    const cid = getCurrentClientId();
    if (!cid) {
        badge.textContent = "Current Client: None";
    } else {
        badge.textContent = `Current Client: #${cid}`;
    }
}

// Generic API call + Output
async function callApi(path, options = {}) {
    const out = document.getElementById("output");
    if (out) {
        out.textContent = `Request: ${options.method || "GET"} ${path}\n\n…`;
    }

    try {
        const res = await fetch(apiBase + path, {
            headers: {
                "Content-Type": "application/json",
                ...(options.headers || {}),
            },
            ...options,
        });
        const text = await res.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch {
            data = text;
        }

        if (out) {
            out.textContent =
                `HTTP ${res.status}\n\n` + JSON.stringify(data, null, 2);
        }
        return { res, data };
    } catch (err) {
        if (out) {
            out.textContent = `Request Failed: ${err.message}`;
        }
        console.error(err);
        return null;
    }
}

// Highlight Navigation (based on data-page attribute)
function initNav(pageKey) {
    const links = document.querySelectorAll(".app-bar nav a");
    links.forEach((a) => {
        if (a.dataset.page === pageKey) {
            a.classList.add("active");
        } else {
            a.classList.remove("active");
        }
    });
    updateCurrentClientBadge();
}