// Импортируем WebSocket библиотеку ws для создания WebSocket сервера
import WebSocket, { WebSocketServer } from "ws";

const PORT = process.env.PORT || 3000; // Порт, на котором будет слушать сервер
const wss = new WebSocketServer({ port: PORT }); // Создаём WebSocket сервер
let waitingClient = null; // Клиент, который ожидает второго игрока
let clientIdCounter = 0; // Счётчик для генерации идентификаторов игроков
const roomStates = {}; // Храним состояние комнаты и подтверждения

function sendToRoom(roomId, payload) {
    const message = JSON.stringify(payload);
    wss.clients.forEach((client) => {
        if (client.roomId === roomId && client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

function getNextTurnPlayer(state, currentPlayer) {
    const players = ["A", "B"];
    const startIndex = players.indexOf(currentPlayer);
    const stonesPerPlayer = state.config?.stonesPerPlayer || 0;

    for (let i = 1; i <= players.length; i += 1) {
        const player = players[(startIndex + i) % players.length];
        if ((state.stonesThrown[player] || 0) < stonesPerPlayer) {
            return player;
        }
    }

    return null;
}

function resetGameRound(state) {
    state.turnPlayer = state.config?.firstPlayer === "B" ? "B" : "A";
    state.stonesThrown = { A: 0, B: 0 };
    state.lastThrowId = 0;
    state.waitingForTurnComplete = false;
    state.gameStarted = true;
    state.paused = false;
    state.restartConfirmed = {};
    state.newSettingsConfirmed = {};
}

function sendConfirmStatus(roomId, type, confirmedBy) {
    sendToRoom(roomId, {
        type,
        confirmedBy,
    });
}

function getRoomPlayers(roomId) {
    return [...wss.clients].filter(
        (client) =>
            client.roomId === roomId && client.readyState === WebSocket.OPEN,
    );
}

wss.on("connection", (ws) => {
    // Срабатывает при новом подключении клиента
    ws.id = `player_${++clientIdCounter}`; // Присваиваем клиенту уникальный идентификатор
    ws.playerName = ""; // Никнейм игрока пока пустой
    ws.roomId = null; // Идентификатор комнаты, если игрок будет в паре

    console.log(`Client connected: ${ws.id}`); // Логируем подключение

    ws.on("message", (message) => {
        // Срабатывает при получении сообщения от клиента
        const text = message.toString(); // Преобразуем данные в строку
        let payload;

        try {
            payload = JSON.parse(text); // Пытаемся разобрать JSON
        } catch (error) {
            return; // Если сообщение не JSON, игнорируем
        }

        if (payload.type === "joinLobby") {
            // Обрабатываем запрос на вход в лобби
            ws.playerName = String(payload.name || "Hráč"); // Записываем ник игрока

            if (!waitingClient) {
                // Если пока нет никакого ожидающего игрока
                waitingClient = ws; // Сохраняем текущего клиента как ожидающего
                ws.send(JSON.stringify({ type: "waitingForOpponent" })); // Отправляем уведомление об ожидании
                return; // Завершаем обработку
            }

            if (waitingClient.readyState !== WebSocket.OPEN) {
                // Если ожидающий клиент отключился
                waitingClient = ws; // Становимся единственным ожидающим клиентом
                ws.send(JSON.stringify({ type: "waitingForOpponent" })); // Уведомляем об ожидании
                return; // Завершаем обработку
            }

            const opponent = waitingClient; // Берём ожидающего игрока
            waitingClient = null; // Очищаем очередь ожидания
            const roomId = `room_${Date.now()}_${ws.id}`; // Генерируем идентификатор комнаты
            ws.roomId = roomId; // Сохраняем комнату для текущего игрока
            ws.playerRole = "B";
            opponent.roomId = roomId; // Сохраняем комнату для оппонента
            opponent.playerRole = "A";
            roomStates[roomId] = {
                confirmed: {},
                config: null,
                turnPlayer: "A",
                stonesThrown: { A: 0, B: 0 },
                lastThrowId: 0,
                waitingForTurnComplete: false,
                gameStarted: false,
                paused: false,
                restartConfirmed: {},
                newSettingsConfirmed: {},
            };

            opponent.send(
                JSON.stringify({
                    type: "roomReady",
                    roomId,
                    selfRole: "A",
                    opponentRole: "B",
                    selfName: opponent.playerName,
                    opponentName: ws.playerName,
                    playerAName: opponent.playerName,
                    playerBName: ws.playerName,
                }),
            ); // Отправляем первому игроку информацию о комнате

            ws.send(
                JSON.stringify({
                    type: "roomReady",
                    roomId,
                    selfRole: "B",
                    opponentRole: "A",
                    selfName: ws.playerName,
                    opponentName: opponent.playerName,
                    playerAName: opponent.playerName,
                    playerBName: ws.playerName,
                }),
            ); // Отправляем второму игроку информацию о комнате
            return;
        }

        if (payload.type === "configUpdate" && ws.roomId) {
            const state = roomStates[ws.roomId] || {
                confirmed: {},
                config: null,
            };
            state.config = payload.config;
            state.confirmed = {};
            roomStates[ws.roomId] = state;

            wss.clients.forEach((client) => {
                if (
                    client.roomId === ws.roomId &&
                    client.readyState === WebSocket.OPEN
                ) {
                    console.log(
                        `server: sending configUpdated to ${client.id}`,
                    );
                    client.send(
                        JSON.stringify({
                            type: "configUpdated",
                            config: state.config,
                        }),
                    );
                }
            });
            return;
        }

        if (payload.type === "requestConfig" && ws.roomId) {
            const state = roomStates[ws.roomId];
            if (state && state.config) {
                console.log(`server: sending currentConfig to ${ws.id}`);
                ws.send(
                    JSON.stringify({
                        type: "currentConfig",
                        config: state.config,
                    }),
                );
            }
            return;
        }

        if (payload.type === "confirmStart" && ws.roomId) {
            const state = roomStates[ws.roomId];
            if (!state) return;
            if (payload.config) state.config = payload.config;
            state.confirmed[ws.id] = ws.playerName;
            const confirmedBy = Object.values(state.confirmed);

            sendConfirmStatus(ws.roomId, "configConfirmStatus", confirmedBy);

            const playersInRoom = getRoomPlayers(ws.roomId);
            if (playersInRoom.length === 2 && confirmedBy.length === 2) {
                resetGameRound(state);
                state.confirmed = {};
                sendToRoom(ws.roomId, {
                    type: "roomStart",
                    config: state.config,
                    turnPlayer: state.turnPlayer,
                });
            }
            return;
        }

        if (payload.type === "gameRestartRequest" && ws.roomId) {
            const state = roomStates[ws.roomId];
            if (!state?.config) return;

            state.restartConfirmed[ws.id] = ws.playerName;
            state.newSettingsConfirmed = {};
            const confirmedBy = Object.values(state.restartConfirmed);
            sendConfirmStatus(ws.roomId, "gameRestartConfirmStatus", confirmedBy);

            const playersInRoom = getRoomPlayers(ws.roomId);
            if (playersInRoom.length === 2 && confirmedBy.length === 2) {
                resetGameRound(state);
                sendToRoom(ws.roomId, {
                    type: "gameRestart",
                    config: state.config,
                    turnPlayer: state.turnPlayer,
                });
            }
            return;
        }

        if (payload.type === "newSettingsRequest" && ws.roomId) {
            const state = roomStates[ws.roomId];
            if (!state) return;

            state.newSettingsConfirmed[ws.id] = ws.playerName;
            state.restartConfirmed = {};
            const confirmedBy = Object.values(state.newSettingsConfirmed);
            sendConfirmStatus(ws.roomId, "newSettingsConfirmStatus", confirmedBy);

            const playersInRoom = getRoomPlayers(ws.roomId);
            if (playersInRoom.length === 2 && confirmedBy.length === 2) {
                state.paused = false;
                state.gameStarted = false;
                state.waitingForTurnComplete = false;
                state.confirmed = {};
                state.newSettingsConfirmed = {};
                sendToRoom(ws.roomId, {
                    type: "openGameSettings",
                    config: state.config,
                });
            }
            return;
        }

        if (payload.type === "gameThrow" && ws.roomId) {
            const state = roomStates[ws.roomId];
            if (
                !state?.gameStarted ||
                state.paused ||
                state.waitingForTurnComplete ||
                ws.playerRole !== state.turnPlayer
            ) {
                return;
            }

            const player = state.turnPlayer;
            const stonesPerPlayer = state.config?.stonesPerPlayer || 0;
            if ((state.stonesThrown[player] || 0) >= stonesPerPlayer) return;

            state.lastThrowId += 1;
            const throwId = state.lastThrowId;
            const order = state.stonesThrown[player] || 0;
            state.stonesThrown[player] = order + 1;
            state.waitingForTurnComplete = true;

            sendToRoom(ws.roomId, {
                type: "gameThrow",
                throwId,
                player,
                order,
                velocity: payload.velocity,
                startPosition: payload.startPosition,
            });
            return;
        }

        if (payload.type === "gameTurnComplete" && ws.roomId) {
            const state = roomStates[ws.roomId];
            if (
                !state?.gameStarted ||
                !state.waitingForTurnComplete ||
                payload.throwId !== state.lastThrowId
            ) {
                return;
            }

            state.waitingForTurnComplete = false;
            state.turnPlayer = getNextTurnPlayer(state, state.turnPlayer);
            sendToRoom(ws.roomId, {
                type: "gameTurn",
                turnPlayer: state.turnPlayer,
                gameOver: state.turnPlayer === null,
            });
            return;
        }

        if (
            (payload.type === "gamePause" || payload.type === "gameResume") &&
            ws.roomId
        ) {
            const state = roomStates[ws.roomId];
            if (state) {
                state.paused = payload.type === "gamePause";
                if (payload.type === "gameResume") {
                    state.restartConfirmed = {};
                    state.newSettingsConfirmed = {};
                }
            }
            sendToRoom(ws.roomId, {
                type: payload.type,
                playerName: ws.playerName,
            });
            return;
        }
    });

    ws.on("close", () => {
        // Срабатывает при отключении клиента
        console.log(`Opponent disconnected: ${ws.id}`); // Логируем отключение

        if (waitingClient === ws) {
            // Если клиент находился в очереди ожидания
            waitingClient = null; // Убираем его из очереди
        }

        if (ws.roomId) {
            // Если клиент был в комнате
            const closedRoomId = ws.roomId;
            const payload = JSON.stringify({
                type: "opponentDisconnected",
                playerName: ws.playerName,
                message: `Hráč ${ws.playerName || "súper"} odišiel.`,
            }); // Формируем сообщение для партнёра

            wss.clients.forEach((client) => {
                // Обходим всех подключенных клиентов
                if (
                    client !== ws &&
                    client.roomId === closedRoomId &&
                    client.readyState === WebSocket.OPEN
                ) {
                    client.send(payload); // Уведомляем партнёра об отключении
                    client.roomId = null;
                    client.playerRole = "";
                }
            });

            delete roomStates[closedRoomId];
        }
    });
});

console.log("+------------------------------------------+");
console.log(`|  WebSocket server running on port ${PORT}   |`);
console.log("+------------------------------------------+");
