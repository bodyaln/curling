// Импортируем WebSocket, чтобы проверять состояние соединений клиентов.
// Импортируем WebSocketServer, чтобы создать WebSocket-сервер.
import WebSocket, { WebSocketServer } from "ws";

// Импортируем функцию создания обработчиков для сообщений формы Nastavenia hry.
// Импортируем функцию сброса состояния раунда для старта и рестарта игры.
import {
    createStartGameHandlers,
    resetGameRound,
} from "./server_start_game.js";

// Берём порт из переменной окружения PORT, а если её нет, используем 3000.
const PORT = process.env.PORT || 3000;

// Создаём WebSocket-сервер на выбранном порту.
const wss = new WebSocketServer({ port: PORT });

// Храним клиента, который уже вошёл в lobby и ждёт второго игрока.
let waitingClient = null;

// Храним счётчик, чтобы выдавать каждому клиенту уникальный id.
let clientIdCounter = 0;

// Храним состояние всех игровых комнат по roomId.
const roomStates = {};

// Объявляем функцию отправки сообщения всем игрокам одной комнаты.
function sendToRoom(roomId, payload) {
    // Превращаем объект сообщения в JSON-строку.
    const message = JSON.stringify(payload);

    // Проходим по всем подключённым клиентам WebSocket-сервера.
    wss.clients.forEach((client) => {
        // Проверяем, что клиент находится в нужной комнате и его соединение открыто.
        if (client.roomId === roomId && client.readyState === WebSocket.OPEN) {
            // Отправляем клиенту подготовленное сообщение.
            client.send(message);
        }
    });
}

// Объявляем функцию определения следующего игрока после завершения хода.
function getNextTurnPlayer(state, currentPlayer) {
    // Задаём порядок игроков внутри комнаты.
    const players = ["A", "B"];

    // Находим индекс игрока, который только что ходил.
    const startIndex = players.indexOf(currentPlayer);

    // Берём количество камней на игрока из текущей конфигурации.
    const stonesPerPlayer = state.config?.stonesPerPlayer || 0;

    // Проверяем следующих игроков по очереди.
    for (let i = 1; i <= players.length; i += 1) {
        // Выбираем следующего игрока циклически.
        const player = players[(startIndex + i) % players.length];

        // Проверяем, остались ли у этого игрока неиспользованные камни.
        if ((state.stonesThrown[player] || 0) < stonesPerPlayer) {
            // Возвращаем игрока, который должен ходить следующим.
            return player;
        }
    }

    // Возвращаем null, если у обоих игроков закончились камни.
    return null;
}

// Создаём обработчики, связанные с настройками и запуском игры.
const { getRoomPlayers, handleStartGameMessage, sendConfirmStatus } =
    createStartGameHandlers({
        // Передаём WebSocket-сервер в модуль настроек.
        wss,
        // Передаём общее состояние комнат в модуль настроек.
        roomStates,
        // Передаём функцию отправки сообщения всем игрокам комнаты.
        sendToRoom,
    });

// Подписываемся на событие нового подключения клиента.
wss.on("connection", (ws) => {
    // Присваиваем подключившемуся клиенту уникальный id.
    ws.id = `player_${++clientIdCounter}`;

    // Изначально имя игрока пустое, пока он не отправит joinLobby.
    ws.playerName = "";

    // Изначально клиент не находится ни в какой комнате.
    ws.roomId = null;

    // Пишем в консоль сервера факт подключения клиента.
    console.log(`Client connected: ${ws.id}`);

    // Подписываемся на сообщения, которые этот клиент отправляет серверу.
    ws.on("message", (message) => {
        // Преобразуем полученные бинарные данные в строку.
        const text = message.toString();

        // Объявляем переменную для разобранного JSON-сообщения.
        let payload;

        // Начинаем безопасный разбор JSON.
        try {
            // Преобразуем JSON-строку в JavaScript-объект.
            payload = JSON.parse(text);
        } catch (error) {
            // Если сообщение не является JSON, просто игнорируем его.
            return;
        }

        // Передаём сообщение в модуль настроек и запуска игры.
        if (handleStartGameMessage(ws, payload)) {
            // Если модуль настроек обработал сообщение, дальше его не обрабатываем.
            return;
        }

        // Проверяем, что клиент хочет войти в lobby.
        if (payload.type === "joinLobby") {
            // Сохраняем имя игрока из сообщения или используем запасное имя.
            ws.playerName = String(payload.name || "Hráč");

            // Проверяем, есть ли уже ожидающий игрок.
            if (!waitingClient) {
                // Сохраняем текущего клиента как ожидающего второго игрока.
                waitingClient = ws;

                // Отправляем клиенту сообщение, что нужно ждать соперника.
                ws.send(JSON.stringify({ type: "waitingForOpponent" }));

                // Завершаем обработку joinLobby, потому что пары ещё нет.
                return;
            }

            // Проверяем, не отключился ли ранее ожидавший клиент.
            if (waitingClient.readyState !== WebSocket.OPEN) {
                // Делаем текущего клиента новым ожидающим игроком.
                waitingClient = ws;

                // Отправляем текущему клиенту сообщение ожидания соперника.
                ws.send(JSON.stringify({ type: "waitingForOpponent" }));

                // Завершаем обработку, потому что пары ещё нет.
                return;
            }

            // Берём ожидающего клиента как соперника для текущего клиента.
            const opponent = waitingClient;

            // Очищаем очередь ожидания, потому что пара найдена.
            waitingClient = null;

            // Создаём уникальный id комнаты на основе времени и id клиента.
            const roomId = `room_${Date.now()}_${ws.id}`;

            // Записываем roomId текущему игроку.
            ws.roomId = roomId;

            // Назначаем текущему игроку роль B.
            ws.playerRole = "B";

            // Записываем roomId ожидавшему игроку.
            opponent.roomId = roomId;

            // Назначаем ожидавшему игроку роль A.
            opponent.playerRole = "A";

            // Создаём начальное состояние новой комнаты.
            roomStates[roomId] = {
                // Храним подтверждения старта настроек.
                confirmed: {},

                // Пока конфигурация комнаты не выбрана.
                config: null,

                // По умолчанию первый ход у игрока A.
                turnPlayer: "A",

                // Счётчик брошенных камней для игроков A и B.
                stonesThrown: { A: 0, B: 0 },

                // Последний id броска в комнате.
                lastThrowId: 0,

                // Сервер пока не ждёт завершения броска.
                waitingForTurnComplete: false,

                // Игра ещё не запущена.
                gameStarted: false,

                // Игра не на паузе.
                paused: false,

                // Список игроков, подтвердивших рестарт.
                restartConfirmed: {},

                // Список игроков, подтвердивших новые настройки.
                newSettingsConfirmed: {},
            };

            // Отправляем первому игроку информацию о готовой комнате.
            opponent.send(
                // Преобразуем объект roomReady в JSON-строку.
                JSON.stringify({
                    // Тип сообщения сообщает клиенту, что комната готова.
                    type: "roomReady",

                    // Передаём id комнаты.
                    roomId,

                    // Сообщаем первому клиенту, что он игрок A.
                    selfRole: "A",

                    // Сообщаем первому клиенту, что соперник игрок B.
                    opponentRole: "B",

                    // Передаём имя игрока A.
                    playerAName: opponent.playerName,

                    // Передаём имя игрока B.
                    playerBName: ws.playerName,
                }),
            );

            // Отправляем второму игроку информацию о готовой комнате.
            ws.send(
                // Преобразуем объект roomReady в JSON-строку.
                JSON.stringify({
                    // Тип сообщения сообщает клиенту, что комната готова.
                    type: "roomReady",

                    // Передаём id комнаты.
                    roomId,

                    // Сообщаем второму клиенту, что он игрок B.
                    selfRole: "B",

                    // Сообщаем второму клиенту, что соперник игрок A.
                    opponentRole: "A",

                    // Передаём имя игрока A.
                    playerAName: opponent.playerName,

                    // Передаём имя игрока B.
                    playerBName: ws.playerName,
                }),
            );

            // Завершаем обработку входа в lobby.
            return;
        }

        // Проверяем, что клиент просит рестарт игры с теми же настройками.
        if (payload.type === "gameRestartRequest" && ws.roomId) {
            // Получаем состояние комнаты клиента.
            const state = roomStates[ws.roomId];

            // Если комнаты или конфига нет, ничего не делаем.
            if (!state?.config) return;

            // Запоминаем, что этот игрок подтвердил рестарт.
            state.restartConfirmed[ws.id] = ws.playerName;

            // Очищаем подтверждения открытия новых настроек, потому что выбрано действие рестарта.
            state.newSettingsConfirmed = {};

            // Собираем массив имён игроков, подтвердивших рестарт.
            const confirmedBy = Object.values(state.restartConfirmed);

            // Отправляем обоим игрокам статус подтверждения рестарта.
            sendConfirmStatus(ws.roomId, "gameRestartConfirmStatus", confirmedBy);

            // Получаем список активных игроков комнаты.
            const playersInRoom = getRoomPlayers(ws.roomId);

            // Проверяем, что оба игрока подключены и оба подтвердили рестарт.
            if (playersInRoom.length === 2 && confirmedBy.length === 2) {
                // Сбрасываем состояние раунда на сервере.
                resetGameRound(state);

                // Отправляем обоим игрокам команду начать игру заново.
                sendToRoom(ws.roomId, {
                    // Тип сообщения говорит клиенту выполнить рестарт.
                    type: "gameRestart",

                    // Передаём текущую конфигурацию игры.
                    config: state.config,

                    // Передаём игрока, который ходит первым после рестарта.
                    turnPlayer: state.turnPlayer,
                });
            }

            // Завершаем обработку запроса рестарта.
            return;
        }

        // Проверяем, что клиент отправил серверу вектор броска.
        if (payload.type === "gameThrow" && ws.roomId) {
            // Получаем состояние комнаты клиента.
            const state = roomStates[ws.roomId];

            // Проверяем, можно ли сейчас принять бросок.
            if (
                // Игра должна быть запущена.
                !state?.gameStarted ||
                // Игра не должна быть на паузе.
                state.paused ||
                // Сервер не должен ждать завершения предыдущего броска.
                state.waitingForTurnComplete ||
                // Бросать может только игрок, чей сейчас ход.
                ws.playerRole !== state.turnPlayer
            ) {
                // Если любое условие нарушено, игнорируем бросок.
                return;
            }

            // Берём роль игрока, который сейчас ходит.
            const player = state.turnPlayer;

            // Берём количество камней на игрока из конфига.
            const stonesPerPlayer = state.config?.stonesPerPlayer || 0;

            // Если игрок уже бросил все свои камни, игнорируем бросок.
            if ((state.stonesThrown[player] || 0) >= stonesPerPlayer) return;

            // Увеличиваем id последнего броска.
            state.lastThrowId += 1;

            // Сохраняем id нового броска.
            const throwId = state.lastThrowId;

            // Определяем порядковый номер камня игрока.
            const order = state.stonesThrown[player] || 0;

            // Увеличиваем количество брошенных камней этого игрока.
            state.stonesThrown[player] = order + 1;

            // Помечаем, что сервер ждёт завершения этого броска.
            state.waitingForTurnComplete = true;

            // Рассылаем событие броска всем игрокам комнаты.
            sendToRoom(ws.roomId, {
                // Тип сообщения говорит клиентам применить бросок.
                type: "gameThrow",

                // Передаём id броска.
                throwId,

                // Передаём игрока, который бросает.
                player,

                // Передаём номер камня этого игрока.
                order,

                // Передаём вектор скорости, который прислал клиент.
                velocity: payload.velocity,
            });

            // Завершаем обработку броска.
            return;
        }

        // Проверяем, что клиент сообщил о завершении физической симуляции броска.
        if (payload.type === "gameTurnComplete" && ws.roomId) {
            // Получаем состояние комнаты клиента.
            const state = roomStates[ws.roomId];

            // Проверяем, можно ли завершить текущий ход.
            if (
                // Игра должна быть запущена.
                !state?.gameStarted ||
                // Сервер должен ждать завершения броска.
                !state.waitingForTurnComplete ||
                // id завершённого броска должен совпадать с последним броском сервера.
                payload.throwId !== state.lastThrowId
            ) {
                // Если проверка не прошла, игнорируем сообщение.
                return;
            }

            // Снимаем ожидание завершения броска.
            state.waitingForTurnComplete = false;

            // Определяем следующего игрока или null, если камни закончились.
            state.turnPlayer = getNextTurnPlayer(state, state.turnPlayer);

            // Отправляем клиентам информацию о следующем ходе или конце игры.
            sendToRoom(ws.roomId, {
                // Тип сообщения сообщает клиентам, что ход изменился.
                type: "gameTurn",

                // Передаём игрока, который ходит следующим.
                turnPlayer: state.turnPlayer,

                // Передаём true, если следующего игрока нет и игра окончена.
                gameOver: state.turnPlayer === null,
            });

            // Завершаем обработку завершения хода.
            return;
        }

        // Проверяем, что клиент хочет поставить игру на паузу или снять паузу.
        if (
            // Разрешаем тип сообщения gamePause или gameResume.
            (payload.type === "gamePause" || payload.type === "gameResume") &&
            // Обрабатываем только игроков, которые находятся в комнате.
            ws.roomId
        ) {
            // Получаем состояние комнаты клиента.
            const state = roomStates[ws.roomId];

            // Проверяем, что состояние комнаты существует.
            if (state) {
                // Устанавливаем paused в true для gamePause и false для gameResume.
                state.paused = payload.type === "gamePause";

                // Проверяем, что игрок снимает паузу.
                if (payload.type === "gameResume") {
                    // Сбрасываем подтверждения рестарта при продолжении игры.
                    state.restartConfirmed = {};

                    // Сбрасываем подтверждения новых настроек при продолжении игры.
                    state.newSettingsConfirmed = {};
                }
            }

            // Рассылаем всем игрокам комнаты событие паузы или продолжения.
            sendToRoom(ws.roomId, {
                // Передаём тот же тип сообщения: gamePause или gameResume.
                type: payload.type,

                // Передаём имя игрока, который выполнил действие.
                playerName: ws.playerName,
            });

            // Завершаем обработку паузы или продолжения.
            return;
        }
    });

    // Подписываемся на закрытие соединения текущего клиента.
    ws.on("close", () => {
        // Пишем в консоль, какой клиент отключился.
        console.log(`Opponent disconnected: ${ws.id}`);

        // Проверяем, был ли отключившийся клиент в очереди ожидания.
        if (waitingClient === ws) {
            // Убираем отключившегося клиента из очереди ожидания.
            waitingClient = null;
        }

        // Проверяем, был ли отключившийся клиент в игровой комнате.
        if (ws.roomId) {
            // Сохраняем id комнаты, потому что дальше данные клиента могут очищаться.
            const closedRoomId = ws.roomId;

            // Создаём сообщение для второго игрока о выходе соперника.
            const payload = JSON.stringify({
                // Тип сообщения сообщает клиенту, что соперник отключился.
                type: "opponentDisconnected",

                // Передаём имя отключившегося игрока.
                playerName: ws.playerName,

                // Передаём готовый текст сообщения для интерфейса.
                message: `Hráč ${ws.playerName || "súper"} odišiel.`,
            });

            // Проходим по всем клиентам сервера.
            wss.clients.forEach((client) => {
                // Проверяем, что это второй клиент из той же комнаты и он ещё подключён.
                if (
                    // Не отправляем сообщение самому отключившемуся клиенту.
                    client !== ws &&
                    // Проверяем совпадение комнаты.
                    client.roomId === closedRoomId &&
                    // Проверяем, что соединение второго клиента открыто.
                    client.readyState === WebSocket.OPEN
                ) {
                    // Отправляем второму игроку уведомление об отключении соперника.
                    client.send(payload);

                    // Убираем второго игрока из старой комнаты.
                    client.roomId = null;

                    // Очищаем роль второго игрока.
                    client.playerRole = "";
                }
            });

            // Удаляем состояние комнаты, потому что один игрок вышел.
            delete roomStates[closedRoomId];
        }
    });
});

// Печатаем верхнюю рамку сообщения о запуске сервера.
console.log("+------------------------------------------+");

// Печатаем порт, на котором запущен WebSocket-сервер.
console.log(`|  WebSocket server running on port ${PORT}   |`);

// Печатаем нижнюю рамку сообщения о запуске сервера.
console.log("+------------------------------------------+");
