const lobbyOverlay = document.getElementById("lobby-overlay"); // Находим оверлей лобби на странице
const lobbyForm = document.getElementById("lobby-form"); // Находим форму ввода ника
const nicknameInput = document.getElementById("nickname-input"); // Находим поле для ввода ника
const lobbyStatus = document.getElementById("lobby-status"); // Находим элемент статуса лобби
const lobbyEnterScreen = document.getElementById("lobby-enter-screen"); // Экран ввода имени
const lobbyMenuScreen = document.getElementById("lobby-menu-screen"); // Главное меню после соединения
const lobbyRulesScreen = document.getElementById("lobby-rules-screen"); // Экран правил
const menuPlayer1 = document.getElementById("menu-player-1"); // Отображает имя первого игрока
const menuPlayer2 = document.getElementById("menu-player-2"); // Отображает имя второго игрока
const colorPlayerAName = document.getElementById("color-player-a-name");
const colorPlayerBName = document.getElementById("color-player-b-name");
const firstPlayerAName = document.getElementById("first-player-a-name");
const firstPlayerBName = document.getElementById("first-player-b-name");
const statusPlayerAName = document.getElementById("status-player-a-name");
const statusPlayerBName = document.getElementById("status-player-b-name");
const startGameButton = document.getElementById("start-game-button"); // Кнопка запуска игры
const showRulesButton = document.getElementById("show-rules-button"); // Кнопка показа правил
const backToMenuButton = document.getElementById("back-to-menu-button"); // Кнопка возврата в меню из правил
const disconnectButton = document.getElementById("disconnect-button"); // Кнопка отключения
const lobbyToast = document.createElement("div");

export let socket = null;
export let selfRole = "";
export let playerNames = { A: "", B: "" };
const socketListeners = [];
let lobbyToastTimer = null;
let lobbyResetTimer = null;

lobbyToast.className = "json-import-toast";
lobbyToast.hidden = true;
document.body.appendChild(lobbyToast);

export function addSocketMessageListener(listener) {
    if (typeof listener !== "function") return;
    socketListeners.push(listener);
    if (socket) {
        socket.addEventListener("message", listener);
    }
}

export function getPlayerNames() {
    return { ...playerNames };
}

function notifyPlayerNamesUpdated() {
    window.dispatchEvent(
        new CustomEvent("playerNamesUpdated", {
            detail: {
                playerNames,
                selfRole,
            },
        }),
    );
}

function setText(element, value) {
    if (element) element.textContent = value || "";
}

function updatePlayerNameLabels() {
    setText(menuPlayer1, playerNames.A);
    setText(menuPlayer2, playerNames.B);
    setText(colorPlayerAName, playerNames.A);
    setText(colorPlayerBName, playerNames.B);
    setText(firstPlayerAName, playerNames.A);
    setText(firstPlayerBName, playerNames.B);
    setText(statusPlayerAName, playerNames.A);
    setText(statusPlayerBName, playerNames.B);
}

function showLobbyToast(message) {
    window.clearTimeout(lobbyToastTimer);
    lobbyToast.textContent = message;
    lobbyToast.hidden = false;
    lobbyToast.classList.add("is-visible");
    lobbyToastTimer = window.setTimeout(() => {
        lobbyToast.classList.remove("is-visible");
        lobbyToast.hidden = true;
    }, 3500);
}

function createSocket() {
    const ws = new WebSocket("ws://localhost:3000");

    ws.addEventListener("open", () => {
        if (lobbyStatus) {
            lobbyStatus.textContent =
                "Pripojenie je nadviazané. Zadajte meno a kliknite Vstúpiť.";
        }
    });

    ws.addEventListener("message", (event) => {
        let data;
        try {
            data = JSON.parse(event.data);
        } catch (error) {
            return;
        }

        if (data.type === "waitingForOpponent") {
            if (lobbyStatus)
                lobbyStatus.textContent = "Čakáme na druhého hráča...";
        }

        if (data.type === "roomReady") {
            selfRole = data.selfRole || "";
            playerNames = {
                A: data.playerAName || "",
                B: data.playerBName || "",
            };
            updatePlayerNameLabels();
            notifyPlayerNamesUpdated();
            showScreen("menu");
            if (lobbyStatus)
                lobbyStatus.textContent = "Hra je pripravená. Vyberte akciu.";
        }

        if (data.type === "opponentDisconnected") {
            const message =
                data.message ||
                `Hráč ${data.playerName || "súper"} odišiel.`;
            showLobbyToast(message);
            if (lobbyStatus)
                lobbyStatus.textContent =
                    `${message} Návrat na začiatok o 5 sekúnd.`;
            window.clearTimeout(lobbyResetTimer);
            lobbyResetTimer = window.setTimeout(resetToEnter, 5000);
        }
    });

    ws.addEventListener("close", () => {
        if (lobbyStatus)
            lobbyStatus.textContent = "Pripojenie k serveru bolo ukončené.";
        resetToEnter();
    });

    ws.addEventListener("error", () => {
        if (lobbyStatus)
            lobbyStatus.textContent = "Chyba pripojenia k serveru.";
    });

    socketListeners.forEach((listener) => {
        ws.addEventListener("message", listener);
    });

    return ws;
}

export function showScreen(screen) {
    const configOverlay = document.getElementById("config-overlay");
    const shouldShowLobby = screen !== "config";
    const shouldShowConfig = screen === "config";

    if (lobbyOverlay)
        lobbyOverlay.style.display = shouldShowLobby ? "flex" : "none";
    if (configOverlay)
        configOverlay.style.display = shouldShowConfig ? "flex" : "none";

    if (lobbyEnterScreen) lobbyEnterScreen.hidden = screen !== "enter";
    if (lobbyMenuScreen) lobbyMenuScreen.hidden = screen !== "menu";
    if (lobbyRulesScreen) lobbyRulesScreen.hidden = screen !== "rules";
    if (configOverlay) configOverlay.hidden = !shouldShowConfig;
}

function resetToEnter() {
    // Сбрасываем интерфейс обратно на ввод имени
    selfRole = "";
    playerNames = { A: "", B: "" };
    updatePlayerNameLabels();
    notifyPlayerNamesUpdated();
    showScreen("enter");
    if (nicknameInput) nicknameInput.value = "";
    if (lobbyStatus)
        lobbyStatus.textContent = "Zadajte svoje meno a kliknite Vstúpiť.";
    if (lobbyOverlay) lobbyOverlay.style.display = "flex";
    if (!socket || socket.readyState === WebSocket.CLOSED) {
        socket = createSocket();
    }
}

socket = createSocket();

if (lobbyForm) {
    // Если форма существует
    lobbyForm.addEventListener("submit", (event) => {
        // Обработчик отправки формы
        event.preventDefault(); // Отменяем отправку формы

        const name = nicknameInput.value.trim(); // Читаем ник из поля
        if (!name) {
            if (lobbyStatus)
                lobbyStatus.textContent = "Zadajte, prosím, svoje meno."; // Просим ввести имя
            return; // Прекращаем выполнение
        }

        const payload = { type: "joinLobby", name }; // Формируем запрос для сервера
        socket.send(JSON.stringify(payload)); // Отправляем запрос на сервер
        if (lobbyStatus)
            lobbyStatus.textContent = "Odosielam požiadavku do lobby..."; // Обновляем статус
    });
}

if (showRulesButton) {
    showRulesButton.addEventListener("click", () => {
        // Обработчик кнопки просмотра правил
        showScreen("rules"); // Переходим на экран правил
    });
}

if (backToMenuButton) {
    backToMenuButton.addEventListener("click", () => {
        // Обработчик кнопки возврата в главное меню
        showScreen("menu"); // Возвращаемся в меню
    });
}

if (disconnectButton) {
    disconnectButton.addEventListener("click", () => {
        // Обработчик кнопки отключения
        if (socket.readyState === WebSocket.OPEN) {
            socket.close(); // Закрываем WebSocket-соединение
        }
        resetToEnter(); // Возвращаемся к вводу имени
    });
}

if (startGameButton) {
    startGameButton.addEventListener("click", () => {
        updatePlayerNameLabels();
        showScreen("config");
        if (lobbyStatus) lobbyStatus.textContent = "Úprava parametrov hry.";
        window.dispatchEvent(new CustomEvent("configOpened"));
    });
}

showScreen("enter"); // Изначально показываем экран ввода имени
