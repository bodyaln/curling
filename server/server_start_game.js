import WebSocket from "ws"; // Импортируем WebSocket, чтобы проверять состояние подключения клиента.

export function resetGameRound(state) { // Экспортируем функцию, которая сбрасывает состояние раунда перед стартом или рестартом.
    state.turnPlayer = state.config?.firstPlayer === "B" ? "B" : "A"; // Выбираем игрока, который должен ходить первым, по настройке firstPlayer.
    state.stonesThrown = { A: 0, B: 0 }; // Обнуляем количество уже брошенных камней для обоих игроков.
    state.lastThrowId = 0; // Сбрасываем идентификатор последнего броска.
    state.waitingForTurnComplete = false; // Указываем, что сервер больше не ждёт завершения текущего броска.
    state.gameStarted = true; // Помечаем, что игра запущена.
    state.paused = false; // Снимаем паузу, если она была включена.
    state.restartConfirmed = {}; // Очищаем список игроков, которые подтвердили рестарт.
    state.newSettingsConfirmed = {}; // Очищаем список игроков, которые подтвердили открытие новых настроек.
} // Закрываем функцию resetGameRound.

export function createStartGameHandlers({ wss, roomStates, sendToRoom }) { // Экспортируем фабрику обработчиков для настроек и запуска игры.
    function sendConfirmStatus(roomId, type, confirmedBy) { // Объявляем функцию отправки статуса подтверждения игрокам комнаты.
        sendToRoom(roomId, { // Отправляем сообщение всем клиентам в указанной комнате.
            type, // Передаём тип сообщения, например configConfirmStatus.
            confirmedBy, // Передаём массив имён игроков, которые уже подтвердили действие.
        }); // Закрываем объект сообщения и вызов sendToRoom.
    } // Закрываем функцию sendConfirmStatus.

    function getRoomPlayers(roomId) { // Объявляем функцию, которая возвращает активных игроков конкретной комнаты.
        return [...wss.clients].filter( // Превращаем набор клиентов WebSocket в массив и фильтруем его.
            (client) => // Для каждого клиента проверяем, подходит ли он под условия.
                client.roomId === roomId && // Оставляем только клиентов из нужной комнаты.
                client.readyState === WebSocket.OPEN, // Оставляем только клиентов с открытым WebSocket-соединением.
        ); // Закрываем filter и возвращаем результат.
    } // Закрываем функцию getRoomPlayers.

    function handleStartGameMessage(ws, payload) { // Объявляем главный обработчик сообщений, связанных с настройками игры.
        if (payload.type === "configUpdate" && ws.roomId) { // Проверяем, что клиент отправил обновлённые настройки и находится в комнате.
            const state = roomStates[ws.roomId] || { // Получаем состояние комнаты или создаём минимальное состояние, если его ещё нет.
                confirmed: {}, // Создаём пустой список подтверждений настроек.
                config: null, // Создаём пустое значение конфигурации.
            }; // Закрываем объект состояния по умолчанию.
            state.config = payload.config; // Сохраняем новую конфигурацию, которую прислал клиент.
            state.confirmed = {}; // Сбрасываем подтверждения, потому что настройки изменились.
            roomStates[ws.roomId] = state; // Записываем обновлённое состояние обратно в хранилище комнат.

            wss.clients.forEach((client) => { // Проходим по всем подключённым WebSocket-клиентам.
                if ( // Начинаем проверку, нужно ли отправлять клиенту обновлённые настройки.
                    client.roomId === ws.roomId && // Проверяем, что клиент находится в той же комнате.
                    client.readyState === WebSocket.OPEN // Проверяем, что соединение клиента открыто.
                ) { // Если клиент подходит, отправляем ему обновление.
                    console.log( // Пишем в консоль сервера, кому отправляется обновление конфигурации.
                        `server: sending configUpdated to ${client.id}`, // Формируем текст лога с id клиента.
                    ); // Закрываем console.log.
                    client.send( // Отправляем клиенту WebSocket-сообщение.
                        JSON.stringify({ // Превращаем объект сообщения в JSON-строку.
                            type: "configUpdated", // Указываем тип сообщения: настройки уже обновлены сервером.
                            config: state.config, // Передаём актуальную конфигурацию комнаты.
                        }), // Закрываем JSON.stringify.
                    ); // Закрываем client.send.
                } // Закрываем условие отправки клиенту.
            }); // Закрываем перебор клиентов.
            return true; // Возвращаем true, чтобы основной server.js понял, что сообщение уже обработано.
        } // Закрываем обработку configUpdate.

        if (payload.type === "requestConfig" && ws.roomId) { // Проверяем, что клиент запросил текущую конфигурацию комнаты.
            const state = roomStates[ws.roomId]; // Получаем состояние комнаты по roomId клиента.
            if (state && state.config) { // Проверяем, что состояние и конфигурация существуют.
                console.log(`server: sending currentConfig to ${ws.id}`); // Логируем отправку текущей конфигурации конкретному клиенту.
                ws.send( // Отправляем ответ только тому клиенту, который запросил конфигурацию.
                    JSON.stringify({ // Превращаем объект ответа в JSON-строку.
                        type: "currentConfig", // Указываем тип ответа: текущая конфигурация комнаты.
                        config: state.config, // Передаём сохранённую конфигурацию комнаты.
                    }), // Закрываем JSON.stringify.
                ); // Закрываем ws.send.
            } // Закрываем проверку существования конфигурации.
            return true; // Возвращаем true, потому что requestConfig обработан.
        } // Закрываем обработку requestConfig.

        if (payload.type === "confirmStart" && ws.roomId) { // Проверяем, что клиент подтвердил настройки и хочет старт игры.
            const state = roomStates[ws.roomId]; // Получаем состояние комнаты игрока.
            if (!state) return true; // Если состояния комнаты нет, считаем сообщение обработанным и ничего не делаем.
            if (payload.config) state.config = payload.config; // Если клиент прислал конфиг вместе с подтверждением, сохраняем его.
            state.confirmed[ws.id] = ws.playerName; // Запоминаем, что этот игрок подтвердил запуск.
            const confirmedBy = Object.values(state.confirmed); // Получаем массив имён игроков, которые уже подтвердили запуск.

            sendConfirmStatus(ws.roomId, "configConfirmStatus", confirmedBy); // Отправляем обоим игрокам статус подтверждения настроек.

            const playersInRoom = getRoomPlayers(ws.roomId); // Получаем список активных игроков в комнате.
            if (playersInRoom.length === 2 && confirmedBy.length === 2) { // Проверяем, что в комнате два игрока и оба подтвердили старт.
                resetGameRound(state); // Сбрасываем игровое состояние перед началом раунда.
                state.confirmed = {}; // Очищаем подтверждения запуска после успешного старта.
                sendToRoom(ws.roomId, { // Отправляем обоим игрокам команду стартовать игру.
                    type: "roomStart", // Указываем тип сообщения: комната начинает игру.
                    config: state.config, // Передаём финальную конфигурацию игры.
                    turnPlayer: state.turnPlayer, // Передаём игрока, который ходит первым.
                }); // Закрываем объект сообщения и вызов sendToRoom.
            } // Закрываем проверку подтверждения двумя игроками.
            return true; // Возвращаем true, потому что confirmStart обработан.
        } // Закрываем обработку confirmStart.

        if (payload.type === "newSettingsRequest" && ws.roomId) { // Проверяем, что клиент хочет открыть настройки новой игры.
            const state = roomStates[ws.roomId]; // Получаем состояние комнаты игрока.
            if (!state) return true; // Если комнаты нет, считаем сообщение обработанным и ничего не делаем.

            state.newSettingsConfirmed[ws.id] = ws.playerName; // Запоминаем, что этот игрок подтвердил открытие новых настроек.
            state.restartConfirmed = {}; // Сбрасываем подтверждения рестарта, потому что выбрано другое действие.
            const confirmedBy = Object.values(state.newSettingsConfirmed); // Получаем массив имён игроков, подтвердивших новые настройки.
            sendConfirmStatus( // Отправляем статус подтверждения открытия настроек.
                ws.roomId, // Передаём id комнаты.
                "newSettingsConfirmStatus", // Передаём тип сообщения для клиента.
                confirmedBy, // Передаём список подтвердивших игроков.
            ); // Закрываем вызов sendConfirmStatus.

            const playersInRoom = getRoomPlayers(ws.roomId); // Получаем активных игроков комнаты.
            if (playersInRoom.length === 2 && confirmedBy.length === 2) { // Проверяем, что оба игрока подтвердили открытие настроек.
                state.paused = false; // Снимаем паузу на сервере.
                state.gameStarted = false; // Помечаем, что текущая игра больше не запущена.
                state.waitingForTurnComplete = false; // Сбрасываем ожидание завершения броска.
                state.confirmed = {}; // Очищаем подтверждения запуска игры.
                state.newSettingsConfirmed = {}; // Очищаем подтверждения открытия настроек.
                sendToRoom(ws.roomId, { // Отправляем обоим игрокам команду открыть экран настроек.
                    type: "openGameSettings", // Указываем тип сообщения: открыть настройки игры.
                    config: state.config, // Передаём текущую конфигурацию, чтобы заполнить форму.
                }); // Закрываем объект сообщения и вызов sendToRoom.
            } // Закрываем проверку подтверждения двумя игроками.
            return true; // Возвращаем true, потому что newSettingsRequest обработан.
        } // Закрываем обработку newSettingsRequest.

        return false; // Возвращаем false, если этот модуль не умеет обрабатывать такой тип сообщения.
    } // Закрываем функцию handleStartGameMessage.

    return { // Возвращаем объект функций, которые будут использоваться в server.js.
        getRoomPlayers, // Передаём функцию получения активных игроков комнаты.
        handleStartGameMessage, // Передаём функцию обработки сообщений настроек и запуска.
        sendConfirmStatus, // Передаём функцию отправки статусов подтверждения.
    }; // Закрываем возвращаемый объект.
} // Закрываем функцию createStartGameHandlers.
