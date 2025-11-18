// 公共 JS，所有页面共用

const apiBase = ""; // 同域，空就行

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
        badge.textContent = "当前客户：未选择";
    } else {
        badge.textContent = `当前客户：#${cid}`;
    }
}

// 通用 API 调用 + 输出
async function callApi(path, options = {}) {
    const out = document.getElementById("output");
    if (out) {
        out.textContent = `请求：${options.method || "GET"} ${path}\n\n…`;
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
            out.textContent = `请求失败：${err.message}`;
        }
        console.error(err);
        return null;
    }
}

// 高亮导航（根据 data-page 属性）
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
