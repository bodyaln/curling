import {
    showScreen,
    addSocketMessageListener,
    socket,
    playerNames,
    getPlayerNames,
} from "./lobby.js";

const configOverlay = document.getElementById("config-overlay");
const importJsonButton = document.getElementById("import-json-button");
const jsonFileInput = document.getElementById("json-file-input");
const confirmSettingsButton = document.getElementById(
    "confirm-settings-button",
);
const configBackButton = document.getElementById("config-back-button");
const configConfirmMessage = document.getElementById("config-confirm-message");
const importErrorToast = document.createElement("div");
const firstPlayerRadios = document.querySelectorAll(
    'input[name="first-player"]',
);
const playerNameLabels = {
    colorA: document.getElementById("color-player-a-name"),
    colorB: document.getElementById("color-player-b-name"),
    firstA: document.getElementById("first-player-a-name"),
    firstB: document.getElementById("first-player-b-name"),
};

const configInputs = {
    field: {
        width: {
            input: document.getElementById("field-width"),
            value: document.getElementById("field-width-value"),
            path: ["field", "width"],
            parse: Number,
        },
        height: {
            input: document.getElementById("field-height"),
            value: document.getElementById("field-height-value"),
            path: ["field", "height"],
            parse: Number,
        },
    },
    target: {
        x: {
            input: document.getElementById("target-x"),
            value: document.getElementById("target-x-value"),
            path: ["target", "x"],
            parse: Number,
        },
        y: {
            input: document.getElementById("target-y"),
            value: document.getElementById("target-y-value"),
            path: ["target", "y"],
            parse: Number,
        },
        radius: {
            input: document.getElementById("target-radius"),
            value: document.getElementById("target-radius-value"),
            path: ["target", "radius"],
            parse: Number,
        },
    },
    stones: {
        perPlayer: {
            input: document.getElementById("stones-per-player"),
            value: document.getElementById("stones-per-player-value"),
            path: ["stonesPerPlayer"],
            parse: Number,
        },
    },
    colors: {
        playerA: {
            input: document.getElementById("color-player-a"),
            path: ["colors", "playerA"],
        },
        playerB: {
            input: document.getElementById("color-player-b"),
            path: ["colors", "playerB"],
        },
    },
    stone: {
        radius: {
            input: document.getElementById("stone-radius"),
            value: document.getElementById("stone-radius-value"),
            path: ["stone", "radius"],
            parse: Number,
        },
        baseX: {
            input: document.getElementById("stone-base-x"),
            value: document.getElementById("stone-base-x-value"),
            path: ["stone", "baseX"],
            parse: Number,
        },
        rowY: {
            input: document.getElementById("stone-row-y"),
            value: document.getElementById("stone-row-y-value"),
            path: ["stone", "rowY"],
            parse: Number,
        },
        powerMultiplier: {
            input: document.getElementById("stone-power-multiplier"),
            value: document.getElementById("stone-power-multiplier-value"),
            path: ["stone", "powerMultiplier"],
            parse: Number,
        },
    },
    physics: {
        restitution: {
            input: document.getElementById("physics-restitution"),
            value: document.getElementById("physics-restitution-value"),
            path: ["physics", "restitution"],
            parse: Number,
        },
        frictionAir: {
            input: document.getElementById("physics-friction-air"),
            value: document.getElementById("physics-friction-air-value"),
            path: ["physics", "frictionAir"],
            parse: Number,
        },
        friction: {
            input: document.getElementById("physics-friction"),
            value: document.getElementById("physics-friction-value"),
            path: ["physics", "friction"],
            parse: Number,
        },
        frictionStatic: {
            input: document.getElementById("physics-friction-static"),
            value: document.getElementById("physics-friction-static-value"),
            path: ["physics", "frictionStatic"],
            parse: Number,
        },
    },
};

let isUpdatingForm = false;
let importErrorToastTimer = null;
let selfPlayerName = "";
let opponentPlayerName = "";
let playerAName = "";
let playerBName = "";
let localConfirmed = false;

importErrorToast.className = "json-import-toast";
importErrorToast.textContent = "CHYBA pri načítaní JSON";
importErrorToast.hidden = true;
document.body.appendChild(importErrorToast);

function getConfigValue(group, key) {
    const config = configInputs[group]?.[key];
    if (!config?.input) return null;
    return config.parse ? config.parse(config.input.value) : config.input.value;
}

function getNestedValue(source, path) {
    return path.reduce((value, key) => value?.[key], source);
}

function getConfigControls() {
    return Object.values(configInputs).flatMap((group) => Object.values(group));
}

function isValidControlValue(control, value) {
    const input = control.input;
    if (!input) return false;

    if (input.type === "color") {
        return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
    }

    if (input.type !== "range") return true;
    if (typeof value !== "number" || !Number.isFinite(value)) return false;

    const min = Number(input.min);
    const max = Number(input.max);

    return value >= min && value <= max;
}

function updateConfigValue(group, key, value) {
    const config = configInputs[group]?.[key];
    if (!config?.input) return;

    config.input.value = value;
    config.input.setAttribute("value", value);

    if (config.value) {
        config.value.textContent = value;
    }
}

function getConfigFromForm() {
    return {
        field: {
            width: getConfigValue("field", "width"),
            height: getConfigValue("field", "height"),
        },
        target: {
            x: getConfigValue("target", "x"),
            y: getConfigValue("target", "y"),
            radius: getConfigValue("target", "radius"),
        },
        stonesPerPlayer: getConfigValue("stones", "perPlayer"),
        colors: {
            playerA: getConfigValue("colors", "playerA"),
            playerB: getConfigValue("colors", "playerB"),
        },
        firstPlayer: getFirstPlayerValue(),
        stone: {
            radius: getConfigValue("stone", "radius"),
            baseX: getConfigValue("stone", "baseX"),
            rowY: getConfigValue("stone", "rowY"),
            powerMultiplier: getConfigValue("stone", "powerMultiplier"),
        },
        physics: {
            restitution: getConfigValue("physics", "restitution"),
            frictionAir: getConfigValue("physics", "frictionAir"),
            friction: getConfigValue("physics", "friction"),
            frictionStatic: getConfigValue("physics", "frictionStatic"),
        },
    };
}

function applyConfigToForm(config) {
    if (!config) return;
    isUpdatingForm = true;

    Object.entries(configInputs).forEach(([group, values]) => {
        Object.entries(values).forEach(([key, control]) => {
            const value = getNestedValue(config, control.path);
            if (value === undefined || value === null) return;
            updateConfigValue(group, key, value);
        });
    });

    setFirstPlayerValue(config.firstPlayer || "A");
    isUpdatingForm = false;
}

function sendConfigUpdate() {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    localConfirmed = false;
    hideConfirmMessage();
    socket.send(
        JSON.stringify({
            type: "configUpdate",
            config: getConfigFromForm(),
        }),
    );
}

function sendConfirmStart() {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    localConfirmed = true;
    showConfirmMessage(`Čakáte na hráča ${opponentPlayerName || "súper"}.`);
    socket.send(
        JSON.stringify({
            type: "confirmStart",
            config: getConfigFromForm(),
        }),
    );
}

function getFirstPlayerValue() {
    return (
        document.querySelector('input[name="first-player"]:checked')?.value ||
        "A"
    );
}

function setFirstPlayerValue(player) {
    const selectedPlayer = player === "B" ? "B" : "A";
    const radio = document.querySelector(
        `input[name="first-player"][value="${selectedPlayer}"]`,
    );
    if (radio) radio.checked = true;
}

function updatePlayerLabels(event) {
    const names = event?.detail?.playerNames || getPlayerNames() || playerNames;
    const firstName = names.A || playerAName;
    const secondName = names.B || playerBName;
    if (playerNameLabels.colorA) {
        playerNameLabels.colorA.textContent = firstName;
    }
    if (playerNameLabels.colorB) {
        playerNameLabels.colorB.textContent = secondName;
    }
    if (playerNameLabels.firstA) {
        playerNameLabels.firstA.textContent = firstName;
    }
    if (playerNameLabels.firstB) {
        playerNameLabels.firstB.textContent = secondName;
    }
}

function validateConfig(config) {
    if (!config || typeof config !== "object") return false;
    const hasValidControls = getConfigControls().every((control) => {
        const value = getNestedValue(config, control.path);
        if (value === undefined || value === null) return false;
        return isValidControlValue(control, value);
    });
    const hasValidFirstPlayer =
        config.firstPlayer === undefined ||
        config.firstPlayer === "A" ||
        config.firstPlayer === "B";

    return hasValidControls && hasValidFirstPlayer;
}

function showImportErrorToast() {
    window.clearTimeout(importErrorToastTimer);
    importErrorToast.hidden = false;
    importErrorToast.classList.add("is-visible");
    importErrorToastTimer = window.setTimeout(() => {
        importErrorToast.classList.remove("is-visible");
        importErrorToast.hidden = true;
    }, 3500);
}

function showConfirmMessage(message) {
    if (!configConfirmMessage) return;
    configConfirmMessage.textContent = message;
    configConfirmMessage.hidden = false;
}

function hideConfirmMessage() {
    if (!configConfirmMessage) return;
    configConfirmMessage.textContent = "";
    configConfirmMessage.hidden = true;
}

function handleFileImport(file) {
    const reader = new FileReader();
    reader.onload = () => {
        try {
            const json = JSON.parse(reader.result);
            if (!validateConfig(json)) {
                showImportErrorToast();
                return;
            }
            applyConfigToForm(json);
            sendConfigUpdate();
        } catch (error) {
            showImportErrorToast();
        }
    };
    reader.readAsText(file);
}

function attachFormListeners() {
    Object.entries(configInputs).forEach(([group, values]) => {
        Object.entries(values).forEach(([key, config]) => {
            const input = config.input;
            if (!input) return;

            const eventType =
                input.type === "range" || input.type === "color"
                    ? "input"
                    : "change";

            input.addEventListener(eventType, () => {
                if (isUpdatingForm) return;
                updateConfigValue(group, key, input.value);
                sendConfigUpdate();
            });
        });
    });

    firstPlayerRadios.forEach((input) => {
        input.addEventListener("change", () => {
            if (isUpdatingForm) return;
            sendConfigUpdate();
        });
    });
}

function handleSocketMessage(event) {
    let payload;
    try {
        payload = JSON.parse(event.data);
    } catch (error) {
        return;
    }

    if (payload.type === "configUpdated" || payload.type === "currentConfig") {
        if (payload.config) {
            applyConfigToForm(payload.config);
            localConfirmed = false;
            hideConfirmMessage();
        }
    }

    if (payload.type === "configConfirmStatus") {
        const confirmedBy = Array.isArray(payload.confirmedBy)
            ? payload.confirmedBy
            : [];
        const selfIsConfirmed = confirmedBy.includes(selfPlayerName);
        const opponentIsConfirmed = confirmedBy.includes(opponentPlayerName);

        if (selfIsConfirmed && opponentIsConfirmed) {
            showConfirmMessage("Hra sa spúšťa...");
            return;
        }

        if (opponentIsConfirmed && !localConfirmed) {
            showConfirmMessage(
                `Hráč ${opponentPlayerName || "súper"} na vás čaká.`,
            );
            return;
        }

        if (selfIsConfirmed) {
            showConfirmMessage(
                `Čakáte na hráča ${opponentPlayerName || "súper"}.`,
            );
            return;
        }

        hideConfirmMessage();
    }

    if (payload.type === "roomReady") {
        selfPlayerName = payload.selfName || "";
        opponentPlayerName = payload.opponentName || "";
        playerAName = payload.playerAName || "";
        playerBName = payload.playerBName || "";
        localConfirmed = false;
        updatePlayerLabels();
        hideConfirmMessage();
    }

    if (payload.type === "roomStart") {
        window.dispatchEvent(
            new CustomEvent("startGameWithConfig", {
                detail: {
                    config: payload.config || getConfigFromForm(),
                    turnPlayer: payload.turnPlayer,
                },
            }),
        );
        if (configOverlay) {
            configOverlay.hidden = true;
            configOverlay.style.display = "none";
        }
        hideConfirmMessage();
    }
}

function initializeStartGameModule() {
    updatePlayerLabels();
    attachFormListeners();
    window.addEventListener("playerNamesUpdated", updatePlayerLabels);
    window.addEventListener("configOpened", updatePlayerLabels);
    window.addEventListener("open-game-settings", (event) => {
        localConfirmed = false;
        hideConfirmMessage();
        updatePlayerLabels();
        if (event.detail?.config) {
            applyConfigToForm(event.detail.config);
        }
        showScreen("config");
    });

    if (importJsonButton) {
        importJsonButton.addEventListener("click", () => {
            if (jsonFileInput) jsonFileInput.click();
        });
    }

    if (jsonFileInput) {
        jsonFileInput.addEventListener("change", (event) => {
            const files = event.target.files;
            if (!files || files.length === 0) return;
            handleFileImport(files[0]);
            event.target.value = "";
        });
    }

    if (confirmSettingsButton) {
        confirmSettingsButton.addEventListener("click", () => {
            sendConfirmStart();
        });
    }

    if (configBackButton) {
        configBackButton.addEventListener("click", () => {
            showScreen("menu");
        });
    }

    addSocketMessageListener(handleSocketMessage);
}

initializeStartGameModule();
