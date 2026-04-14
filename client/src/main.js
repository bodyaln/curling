import {
    addSocketMessageListener,
    playerNames,
    selfRole,
    socket,
} from "./lobby.js"; // Загружаем лобби-клиент WebSocket перед запуском игры
import "./startgame.js"; // Загружаем модуль настроек предстарта
import defaultConfig from "./config.json";
import { Engine, World, Bodies, Runner, Body } from "matter-js"; // Импортируем необходимые классы из matter-js

const canvas = document.getElementById("gameCanvas"); // Получаем element canvas
const ctx = canvas.getContext("2d"); // Контекст рисования 2D

let config = null; // Объявляем переменную для конфигурации
let engine = null; // Объявляем переменную для движка
let world = null; // Объявляем переменную для мира
let viewScale = 1; // Масштаб для Canvas
let viewOffsetX = 0; // Смещение поля по X в Canvas
let viewOffsetY = 0; // Смещение поля по Y в Canvas
let fieldWidth = 0; // Ширина поля после загрузки конфига
let fieldHeight = 0; // Высота поля после загрузки конфига
let targetVisual = null; // Параметры цели после загрузки конфига
let stones = []; // Список всех камней
let stoneRadius = 16; // Радиус камней
let baseX = 120; // Позиция стартовой точки по X
let rowY = 0; // Центральная линия старта
let throwPower = 18; // Множитель силы броска
let physicsSettings = null; // Параметры физики камней
const players = ["A", "B"]; // Игроки по очереди
let currentPlayerIndex = 0; // Текущий игрок
const nextStoneNumber = { A: 0, B: 0 }; // Индекс следующего камня для каждого игрока
let currentStone = null; // Текущий активный камень
let waitingForNextStone = false; // Ждём остановки текущего камня перед появлением следующего
let gameOver = false; // Завершился ли матч
let isPaused = false; // Игра на паузе
let activeThrowId = null; // Идентификатор броска, который ожидает завершения
let currentPointerId = null; // Идентификатор активного указателя во время прицеливания
let rebuildCurrentGame = null; // Функция пересоздания игры с новыми настройками

const dragState = {
    // Состояние перетаскивания камня
    body: null,
    start: null,
    pointer: { x: 0, y: 0 },
    active: false,
};

function getStartPosition() {
    // Функция возвращает стартовую позицию камня
    return {
        // Возвращаем значение
        x: baseX,
        y: rowY,
    };
}

function sendGameMessage(payload) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(payload));
}

function getPlayerName(player) {
    return playerNames[player] || "";
}

function getPlayerLabel(player) {
    const name = getPlayerName(player);
    return name ? `hráč ${name}` : "hráč";
}

function resizeCanvas() {
    // Функция обновляет размеры canvas
    const rect = canvas.getBoundingClientRect(); // Размеры элемента в CSS-пикселях
    canvas.width = rect.width; // Устанавливаем физическую ширину равной реальной ширине элемента
    canvas.height = rect.height; // Устанавливаем физическую высоту равной реальной высоте элемента
    ctx.setTransform(1, 0, 0, 1, 0, 0); // Не масштабируем контекст по DPR

    if (fieldWidth && fieldHeight) {
        // Проверяем условие
        viewScale = 1; // Логическая область совпадает с физическим размером canvas
    } else {
        viewScale = 1;
    }
    viewOffsetX = 0; // Нет внутренних отступов
    viewOffsetY = 0; // Нет внутренних отступов
}

window.addEventListener("resize", resizeCanvas); // Автоматически обновляем при изменении окна

async function init(selectedConfig, initialTurnPlayer) {
    // Главная функция инициализации игры
    config = selectedConfig || defaultConfig; // Загружаем конфиг

    document.documentElement.style.setProperty(
        "--player-a-color",
        config.colors.playerA,
    ); // Устанавливаем цвет игрока A из конфига
    document.documentElement.style.setProperty(
        "--player-b-color",
        config.colors.playerB,
    ); // Устанавливаем цвет игрока B из конфига

    fieldWidth = config.field.width; // Ширина игрового поля в логических координатах
    fieldHeight = config.field.height; // Высота игрового поля в логических координатах
    stoneRadius = config.stone.radius; // Радиус камня из конфига
    baseX = config.stone.baseX; // Позиция стартовой точки по X из конфига
    rowY = config.stone.rowY; // Центральная линия старта из конфига
    throwPower = config.stone.powerMultiplier; // Множитель силы броска из конфига
    physicsSettings = config.physics; // Загружаем параметры физики камней
    currentPlayerIndex =
        (initialTurnPlayer || config.firstPlayer) === "B" ? 1 : 0; // Выбираем игрока, который ходит первым
    targetVisual = {
        // Устанавливаем параметры цели
        x: config.target.x,
        y: config.target.y,
        radius: config.target.radius,
        levels: 3, // Количество уровней кольца
        colors: [
            "rgba(86, 146, 255, 0.18)",
            "rgba(255, 255, 255, 0.16)",
            "rgba(249, 102, 96, 0.28)",
        ],
        borderColors: [
            "rgba(255, 255, 255, 0.12)",
            "rgba(255, 255, 255, 0.18)",
            "rgba(255, 255, 255, 0.22)",
        ],
    };

    engine = Engine.create(); // Создаём движок Matter.js
    world = engine.world; // Берём мир из движка
    world.gravity.y = 0; // Выключаем гравитацию, ведь камни движутся по плоскости

    // Приводим контейнер и canvas к точному размеру поля
    canvas.parentElement.style.width = `${fieldWidth}px`; // Устанавливаем ширину контейнера под поле
    canvas.parentElement.style.height = `${fieldHeight}px`; // Устанавливаем высоту контейнера под поле
    resizeCanvas(); // Устанавливаем размеры и масштаб после загрузки конфига

    function createBoundaries() {
        // Создаём физические границы поля
        return [
            Bodies.rectangle(fieldWidth / 2, -20, fieldWidth, 40, {
                isStatic: true,
            }),
            Bodies.rectangle(fieldWidth / 2, fieldHeight + 20, fieldWidth, 40, {
                isStatic: true,
            }),
            Bodies.rectangle(-20, fieldHeight / 2, 40, fieldHeight, {
                isStatic: true,
            }),
            Bodies.rectangle(
                fieldWidth + 20,
                fieldHeight / 2,
                40,
                fieldHeight,
                {
                    isStatic: true,
                },
            ),
        ];
    }

    let boundaries = createBoundaries();
    World.add(world, boundaries); // Добавляем края поля в мир

    function createStone(x, y, color, player, order) {
        // Функция создаёт камень
        const stone = Bodies.circle(x, y, stoneRadius, {
            // Создаём физическое тело-камень
            restitution: physicsSettings.restitution,
            frictionAir: physicsSettings.frictionAir,
            friction: physicsSettings.friction,
            frictionStatic: physicsSettings.frictionStatic,
            render: { fillStyle: color },
        });
        stone.renderFill = color; // Сохраняем цвет для нашего рендера
        stone.player = player; // Привязываем камень к игроку
        stone.order = order; // Запоминаем номер камня в очереди
        stone.thrown = false; // Помечаем камень как ещё не брошенный
        return stone; // Возвращаем созданный камень
    }

    for (let i = 0; i < config.stonesPerPlayer; i += 1) {
        // Запускаем цикл
        stones.push(createStone(-200, -200, config.colors.playerA, "A", i)); // Добавляем камень в массив камней
        stones.push(createStone(-200, -200, config.colors.playerB, "B", i)); // Добавляем камень в массив камней
    }

    World.add(world, stones); // Добавляем все камни в мир

    function rebuildBodies(nextConfig, turnPlayer) {
        config = nextConfig || config;
        document.documentElement.style.setProperty(
            "--player-a-color",
            config.colors.playerA,
        );
        document.documentElement.style.setProperty(
            "--player-b-color",
            config.colors.playerB,
        );

        fieldWidth = config.field.width;
        fieldHeight = config.field.height;
        stoneRadius = config.stone.radius;
        baseX = config.stone.baseX;
        rowY = config.stone.rowY;
        throwPower = config.stone.powerMultiplier;
        physicsSettings = config.physics;
        targetVisual = {
            x: config.target.x,
            y: config.target.y,
            radius: config.target.radius,
            levels: 3,
            colors: [
                "rgba(86, 146, 255, 0.18)",
                "rgba(255, 255, 255, 0.16)",
                "rgba(249, 102, 96, 0.28)",
            ],
            borderColors: [
                "rgba(255, 255, 255, 0.12)",
                "rgba(255, 255, 255, 0.18)",
                "rgba(255, 255, 255, 0.22)",
            ],
        };
        canvas.parentElement.style.width = `${fieldWidth}px`;
        canvas.parentElement.style.height = `${fieldHeight}px`;
        resizeCanvas();

        World.remove(world, boundaries);
        World.remove(world, stones);
        boundaries = createBoundaries();
        stones = [];
        for (let i = 0; i < config.stonesPerPlayer; i += 1) {
            stones.push(createStone(-200, -200, config.colors.playerA, "A", i));
            stones.push(createStone(-200, -200, config.colors.playerB, "B", i));
        }
        World.add(world, boundaries);
        World.add(world, stones);
        resetRound(turnPlayer || config.firstPlayer);
    }

    function getRemainingStones(player) {
        // Вычисляем количество оставшихся камней игрока
        return config.stonesPerPlayer - nextStoneNumber[player]; // Возвращаем значение
    }

    function setTurnPlayer(player) {
        const index = players.indexOf(player);
        currentPlayerIndex = index === -1 ? currentPlayerIndex : index;
    }

    function evaluateWinner() {
        // Определяем победителя в конце игры
        const scores = stones.map((stone) => {
            // Собираем информацию о расстояниях камней до цели
            const dx = stone.position.x - targetVisual.x; // Вычисляем разницу по X до цели
            const dy = stone.position.y - targetVisual.y; // Вычисляем разницу по Y до цели
            const distance = Math.sqrt(dx * dx + dy * dy); // Вычисляем расстояние до центра цели
            const score = distance <= targetVisual.radius ? distance : 0; // Если камень в цели, считаем расстояние, иначе 0
            return { player: stone.player, distance, score }; // Возвращаем значение
        });

        const validScores = scores.filter((item) => item.score > 0); // Отбираем только попавшие в цель камни
        if (validScores.length === 0) {
            // Если никто не попал, объявляем это
            return { winner: null, message: "Nikto netrafil cieľ." }; // Возвращаем значение
        }

        let best = validScores[0]; // Считаем лучший результат
        for (let i = 1; i < validScores.length; i += 1) {
            // Запускаем цикл
            if (validScores[i].score < best.score) {
                // Проверяем условие
                best = validScores[i];
            }
        }

        const tied = validScores.filter(
            // Проверяем, нет ли ничьей по лучшему расстоянию
            (item) => item.score === best.score && item.player !== best.player,
        );
        if (tied.length > 0) {
            // Проверяем условие
            return { winner: null, message: "Remíza." }; // Возвращаем значение
        }

        return {
            // Возвращаем значение
            winner: best.player,
            message: `Víťaz: ${getPlayerLabel(best.player)}.`,
        };
    }

    function updateStatus() {
        // Обновляем значения в статусной панели
        stonesCountA.textContent = getRemainingStones("A"); // Показываем сколько камней осталось у игрока A
        stonesCountB.textContent = getRemainingStones("B"); // Показываем сколько камней осталось у игрока B

        if (gameOver) {
            // Если игра завершена, выводим результат
            turnIndicator.textContent = "";
            statusMessage.textContent = "Hra sa skončila.";
            const result = evaluateWinner(); // Вычисляем победителя
            statusResult.textContent = result.message;
            return;
        }

        if (!currentStone) {
            // Если активный камень отсутствует
            turnIndicator.textContent = "";
            statusMessage.textContent =
                "Hra sa skončila. Všetky kamene boli hodené.";
            statusResult.textContent = "Kontroluje sa víťaz...";
            return;
        }

        turnIndicator.textContent = getPlayerName(currentStone.player);
        statusMessage.textContent = `Na ťahu je ${getPlayerLabel(currentStone.player)}. Potiahnite kameň v smere hodu a pustite ho.`;
        statusResult.textContent = "Víťaz zatiaľ nie je.";
    }

    function prepareNextStone() {
        // Готовим следующий камень к броску
        const player = players[currentPlayerIndex]; // Извлекаем текущего игрока
        const order = nextStoneNumber[player]; // Узнаём номер следующего камня игрока
        const stone = stones.find(
            // Находим камень в массиве по игроку и номеру
            (item) => item.player === player && item.order === order,
        );

        if (!stone) {
            // Если камень не найден, завершаем игру
            currentStone = null;
            updateStatus();
            return;
        }

        Body.setPosition(stone, getStartPosition(player)); // Устанавливаем камень на стартовую позицию
        Body.setVelocity(stone, { x: 0, y: 0 }); // Останавливаем камень перед новым броском
        Body.setAngularVelocity(stone, 0); // Сбрасываем вращение камня
        stone.thrown = false; // Помечаем камень как ещё не брошенный
        currentStone = stone;
        updateStatus();
    }

    function applyServerThrow(payload) {
        const stone = stones.find(
            (item) =>
                item.player === payload.player && item.order === payload.order,
        );
        if (!stone || !payload.velocity) return;

        activeThrowId = payload.throwId;
        currentStone = stone;
        Body.setPosition(stone, getStartPosition());
        Body.setVelocity(stone, payload.velocity);
        Body.setAngularVelocity(stone, 0);
        stone.thrown = true;
        nextStoneNumber[payload.player] = Math.max(
            nextStoneNumber[payload.player],
            payload.order + 1,
        );
        waitingForNextStone = true;
        updateStatus();
    }

    function finishServerTurn() {
        if (activeThrowId === null) return;
        if (!currentStone || currentStone.player !== selfRole) return;
        sendGameMessage({
            type: "gameTurnComplete",
            throwId: activeThrowId,
        });
        activeThrowId = null;
    }

    function resetDragState() {
        dragState.active = false;
        dragState.body = null;
        dragState.start = null;
        dragState.pointer = { x: 0, y: 0 };
        currentPointerId = null;
    }

    function resetRound(turnPlayer) {
        nextStoneNumber.A = 0;
        nextStoneNumber.B = 0;
        currentStone = null;
        waitingForNextStone = false;
        gameOver = false;
        window.dispatchEvent(new CustomEvent("game-reset"));
        activeThrowId = null;
        resetDragState();
        setTurnPlayer(turnPlayer || config.firstPlayer || "A");

        stones.forEach((stone) => {
            Body.setPosition(stone, { x: -200, y: -200 });
            Body.setVelocity(stone, { x: 0, y: 0 });
            Body.setAngularVelocity(stone, 0);
            Body.setAngle(stone, 0);
            stone.thrown = false;
        });

        resumeGame();
        prepareNextStone();
    }

    rebuildCurrentGame = rebuildBodies;

    function getOpponentName() {
        const opponentRole = selfRole === "A" ? "B" : "A";
        return playerNames[opponentRole] || "súpera";
    }

    function showRestartWaitMessage(confirmedBy, action) {
        const selfName = playerNames[selfRole] || "";
        const opponentName = getOpponentName();
        const selfConfirmed = confirmedBy.includes(selfName);
        const opponentConfirmed = confirmedBy.includes(opponentName);
        const actionText =
            action === "settings"
                ? "otvoriť nastavenia novej hry"
                : "reštartovať hru";
        const waitText =
            action === "settings"
                ? "otvorenie nastavení novej hry"
                : "reštart hry";

        if (selfConfirmed && opponentConfirmed) {
            window.dispatchEvent(
                new CustomEvent("game-modal-message", {
                    detail: { message: "Spúšťa sa..." },
                }),
            );
            return;
        }

        if (selfConfirmed) {
            window.dispatchEvent(
                new CustomEvent("game-modal-message", {
                    detail: {
                        message: `Čakáte na hráča ${opponentName}, aby potvrdil ${waitText}.`,
                    },
                }),
            );
            return;
        }

        if (opponentConfirmed) {
            window.dispatchEvent(
                new CustomEvent("shared-restart-request", {
                    detail: { action },
                }),
            );
            window.dispatchEvent(
                new CustomEvent("game-modal-message", {
                    detail: {
                        message: `Hráč ${opponentName} chce ${actionText}. Čaká na vaše potvrdenie.`,
                    },
                }),
            );
        }
    }

    function pauseGame() {
        if (gameOver || isPaused) return;
        isPaused = true;
        Runner.stop(runner);
        statusMessage.textContent = "Hra je pozastavená.";
    }

    function resumeGame() {
        if (!isPaused) return;
        isPaused = false;
        Runner.run(runner, engine);
        updateStatus();
    }

    const runner = Runner.create(); // Создаём объект Runner
    Runner.run(runner, engine); // Запускаем физический цикл

    window.addEventListener("game-pause", () => {
        // Слушаем запрос на паузу
        sendGameMessage({ type: "gamePause" });
        pauseGame();
    });

    window.addEventListener("game-resume", () => {
        // Слушаем возобновление
        sendGameMessage({ type: "gameResume" });
        resumeGame();
    });

    window.addEventListener("game-restart-request", () => {
        sendGameMessage({ type: "gameRestartRequest" });
    });

    window.addEventListener("game-new-settings-request", () => {
        sendGameMessage({ type: "newSettingsRequest" });
    });

    const stonesCountA = document.getElementById("stones-count-a"); // Получаем DOM-элемент для счётчика A
    const stonesCountB = document.getElementById("stones-count-b"); // Получаем DOM-элемент для счётчика B
    const turnIndicator = document.getElementById("turn-indicator"); // Получаем DOM-элемент для индикатора хода
    const statusMessage = document.getElementById("status-message"); // Получаем DOM-элемент для сообщения статуса
    const statusResult = document.getElementById("status-result"); // Получаем DOM-элемент для результата игры
    const statusPlayerAName = document.getElementById("status-player-a-name"); // Имя игрока A в панели статуса
    const statusPlayerBName = document.getElementById("status-player-b-name"); // Имя игрока B в панели статуса

    function updateStatusPlayerNames() {
        if (statusPlayerAName)
            statusPlayerAName.textContent = getPlayerName("A");
        if (statusPlayerBName)
            statusPlayerBName.textContent = getPlayerName("B");
    }

    updateStatusPlayerNames();
    window.addEventListener("playerNamesUpdated", () => {
        updateStatusPlayerNames();
        updateStatus();
    });

    prepareNextStone(); // Готовим первый камень
    updateStatus();

    function clientToWorld(clientX, clientY) {
        // Преобразуем экранные координаты в игровые
        const rect = canvas.getBoundingClientRect(); // Получаем позицию canvas на странице
        const x = (clientX - rect.left - viewOffsetX) / viewScale; // Переводим X в координаты мира
        const y = (clientY - rect.top - viewOffsetY) / viewScale; // Переводим Y в координаты мира
        return { x, y }; // Возвращаем значение
    }

    function findStoneAtPoint(point) {
        // Ищем камень под курсором
        if (!currentStone || currentStone.thrown) {
            // Проверяем условие
            return null; // Возвращаем значение
        }
        const dx = point.x - currentStone.position.x; // Разница по X
        const dy = point.y - currentStone.position.y; // Разница по Y
        return Math.sqrt(dx * dx + dy * dy) <= stoneRadius // Возвращаем значение
            ? currentStone
            : null;
    }

    canvas.addEventListener("pointerdown", (event) => {
        // Обработчик начала перетаскивания камня
        if (isPaused || gameOver) {
            // Проверяем, можно ли перетаскивать камень
            return; // Не разрешаем броски во время паузы или после окончания игры
        }

        if (!currentStone || currentStone.player !== selfRole) {
            if (currentStone) {
                statusMessage.textContent = `Teraz je na ťahu ${getPlayerLabel(currentStone.player)}.`;
            }
            return;
        }

        const worldPoint = clientToWorld(event.clientX, event.clientY); // Переводим координаты курсора
        const stone = findStoneAtPoint(worldPoint); // Ищем активный камень под курсором

        if (!stone || stone.speed > 0.02) {
            // Проверяем условие
            return; // Нельзя выбрать камень, если его скорость ещё не нулевая
        }

        dragState.body = stone; // Запоминаем выбранный камень
        dragState.start = { x: stone.position.x, y: stone.position.y }; // Сохраняем исходную позицию
        dragState.pointer = worldPoint; // Сохраняем указатель мыши
        dragState.active = true; // Включаем режим перетаскивания
        currentPointerId = event.pointerId; // Запоминаем указатель, чтобы отпустить бросок даже за пределами canvas
        canvas.setPointerCapture(event.pointerId); // Захватываем события указателя до завершения броска
    });

    canvas.addEventListener("pointermove", (event) => {
        // Обработчик перемещения курсора
        if (!dragState.active) {
            // Проверяем условие
            return; // Не рисуем линию, если не тянем камень
        }
        if (currentPointerId !== null && event.pointerId !== currentPointerId) {
            return;
        }

        const worldPoint = clientToWorld(event.clientX, event.clientY); // Переводим координаты указателя
        dragState.pointer = worldPoint; // Обновляем позицию курсора в состоянии
        Body.setPosition(dragState.body, dragState.start); // Фиксируем камень на месте во время прицеливания
    });

    canvas.addEventListener("pointerup", (event) => {
        // Обработчик завершения броска
        if (!dragState.active) {
            // Проверяем условие
            return; // Если нет активного перетаскивания, пропускаем
        }
        if (currentPointerId !== null && event.pointerId !== currentPointerId) {
            return;
        }

        const aim = computeAimState(); // Берём тот же вектор, который рисуется стрелкой

        if (aim.distance > 5) {
            // Проверяем, достаточно ли длина для броска
            sendGameMessage({
                type: "gameThrow",
                velocity: aim.velocity,
            });
        }

        if (
            currentPointerId !== null &&
            canvas.hasPointerCapture(currentPointerId)
        ) {
            canvas.releasePointerCapture(currentPointerId); // Отпускаем захваченный указатель
        }
        currentPointerId = null; // Сбрасываем идентификатор указателя
        dragState.active = false; // Выключаем режим перетаскивания
        dragState.body = null; // Сбрасываем выбранный камень
    });

    canvas.addEventListener("pointercancel", (event) => {
        // Сбрасываем прицел, если браузер отменил указатель
        if (currentPointerId !== null && event.pointerId !== currentPointerId) {
            return;
        }
        dragState.active = false;
        dragState.body = null;
        currentPointerId = null;
    });

    function computeAimState() {
        // Вычисляем параметры прицеливания
        const dx = dragState.pointer.x - dragState.start.x; // Вектор от камня к курсору
        const dy = dragState.pointer.y - dragState.start.y; // Вектор от камня к курсору
        const rawDistance = Math.sqrt(dx * dx + dy * dy); // Длина сырого вектора
        const maxDragDistance = 180; // Максимальная длина прицела
        const distance = Math.min(rawDistance, maxDragDistance); // Ограничиваем длину стрелки
        const direction = // Определяем направление вектора прицела
            rawDistance > 0
                ? { x: dx / rawDistance, y: dy / rawDistance }
                : { x: 0, y: 0 };
        const endPoint = {
            // Вычисляем конечную точку стрелки прицела
            x: dragState.start.x + direction.x * distance,
            y: dragState.start.y + direction.y * distance,
        };
        const power = (distance / maxDragDistance) * throwPower; // Пропорциональная сила
        const velocity = {
            // Скорость совпадает с направлением стрелки
            x: direction.x * power,
            y: direction.y * power,
        };
        return { distance, power, endPoint, direction, velocity }; // Возвращаем значение
    }

    function worldToCanvas(point) {
        // Преобразуем координаты мира в координаты canvas
        return {
            // Возвращаем значение
            x: viewOffsetX + point.x * viewScale, // Конвертируем X мира в X canvas
            y: viewOffsetY + point.y * viewScale, // Конвертируем Y мира в Y canvas
        };
    }

    function drawField() {
        // Рисуем поле
        ctx.clearRect(0, 0, canvas.width, canvas.height); // Очищаем весь canvas
        const fieldX = viewOffsetX; // Начало поля по X
        const fieldY = viewOffsetY; // Начало поля по Y
        const fieldW = fieldWidth * viewScale; // Ширина поля в пикселях
        const fieldH = fieldHeight * viewScale; // Высота поля в пикселях
        ctx.fillStyle = "rgba(255, 255, 255, 0.08)"; // Полупрозрачный фон игрового поля
        ctx.fillRect(fieldX, fieldY, fieldW, fieldH); // Рисуем фон игрового поля

        ctx.strokeStyle = "rgba(0, 0, 0, 0.9)"; // Цвет границы поля
        ctx.lineWidth = 8; // Толщина линии границы
        ctx.strokeRect(fieldX, fieldY, fieldW, fieldH); // Рисуем обводку поля
    }

    function drawTarget() {
        // Рисуем цель
        const center = worldToCanvas(targetVisual); // Центр цели в пикселях
        const outer = targetVisual.radius * viewScale; // Радиус внешнего круга
        const ringSizes = [outer, outer * 0.66, outer * 0.32]; // Три уровня кольца

        ctx.save(); // Сохраняем состояние контекста
        ctx.translate(center.x, center.y); // Переносим начало в центр цели

        for (let i = 0; i < ringSizes.length; i += 1) {
            // Запускаем цикл
            ctx.beginPath(); // Начинаем путь для уровня
            ctx.arc(0, 0, ringSizes[i], 0, Math.PI * 2); // Рисуем круг уровня
            ctx.fillStyle = [
                // Рисуем на холсте
                "rgba(8, 122, 126, 0.65)",
                "rgb(210, 196, 176)",
                "rgba(255, 0, 251, 0.37)",
            ][i];
            ctx.fill(); // Заполняем уровень
        }

        ctx.lineWidth = 3; // Толщина границы кольца
        ctx.strokeStyle = "rgb(0, 0, 0)"; // Цвет границы
        ctx.beginPath(); // Рисуем на холсте
        ctx.arc(0, 0, outer, 0, Math.PI * 2); // Рисуем на холсте
        ctx.stroke(); // Рисуем на холсте
        ctx.beginPath(); // Рисуем на холсте
        ctx.arc(0, 0, ringSizes[1], 0, Math.PI * 2); // Рисуем на холсте
        ctx.stroke(); // Рисуем на холсте
        ctx.beginPath(); // Рисуем на холсте
        ctx.arc(0, 0, ringSizes[2], 0, Math.PI * 2); // Рисуем на холсте
        ctx.stroke(); // Рисуем на холсте

        ctx.restore(); // Восстанавливаем состояние контекста
    }

    function drawStones() {
        // Рисуем камни на поле
        stones.forEach((stone) => {
            const position = worldToCanvas(stone.position); // Позиция камня в пикселях
            const radius = stoneRadius * viewScale; // Объявляем переменную radius

            ctx.beginPath(); // Начинаем путь для круга
            ctx.arc(position.x, position.y, radius, 0, Math.PI * 2); // Рисуем круг камня
            ctx.fillStyle = stone.renderFill; // Цвет камня
            ctx.fill(); // Заполняем круг

            ctx.lineWidth = 2; // Толщина обводки камня
            ctx.strokeStyle = "rgba(0, 0, 0, 0.9)"; // Цвет обводки
            ctx.stroke(); // Рисуем обводку камня

            ctx.beginPath(); // Рисуем на холсте
            ctx.arc(position.x, position.y, radius * 0.36, 0, Math.PI * 2); // Рисуем на холсте
            ctx.fill(); // Рисуем на холсте

            if (gameOver) {
                // В конце игры показываем расстояние до центра цели внутри камня
                const dx = stone.position.x - targetVisual.x; // Разница по X от камня до центра цели
                const dy = stone.position.y - targetVisual.y; // Разница по Y от камня до центра цели
                const distance = Math.sqrt(dx * dx + dy * dy); // Вычисляем расстояние
                const isInTarget = distance <= targetVisual.radius; // Проверяем, внутри ли камень цели
                const distanceText = isInTarget
                    ? `${Math.round(distance * 10) / 10}` // Форматируем текст до десятых
                    : "0"; // Если камень не в радиусе цели, показываем 0

                ctx.font = "bold 12px Inter, sans-serif"; // Маленький шрифт для текста
                ctx.textAlign = "center"; // Выравниваем текст по центру камня
                ctx.textBaseline = "middle"; // Выравниваем текст по вертикали
                ctx.fillStyle = "#ffffff"; // Белый цвет текста
                ctx.strokeStyle = "rgba(0, 0, 0, 0.7)"; // Тёмная обводка для читаемости
                ctx.lineWidth = 2; // Толщина обводки текста
                ctx.strokeText(distanceText, position.x, position.y); // Рисуем обводку текста
                ctx.fillText(distanceText, position.x, position.y); // Рисуем сам текст
            }
        });
    }

    function drawAimLine() {
        // Рисуем индикатор направления броска
        if (!dragState.active || !dragState.body) {
            // Проверяем условие
            return; // Если нет перетаскивания, не рисуем подсказку
        }

        const start = worldToCanvas(dragState.start); // Начало линии на камне
        const aim = computeAimState(); // Состояние прицела с ограничением
        const end = worldToCanvas(aim.endPoint); // Конечная точка стрелки в пикселях

        ctx.beginPath(); // Начинаем путь для линии
        ctx.moveTo(start.x, start.y); // Перемещаемся в точку центра камня
        ctx.lineTo(end.x, end.y); // Рисуем линию до ограниченной точки
        ctx.strokeStyle = "rgba(255, 255, 255, 0.85)"; // Цвет линии подсказки
        ctx.lineWidth = 4; // Толщина линии
        ctx.setLineDash([10, 8]); // Пунктирная линия
        ctx.stroke(); // Рисуем линию
        ctx.setLineDash([]); // Сбрасываем пунктир

        const arrowSize = 14; // Размер стрелки
        const angle = Math.atan2(end.y - start.y, end.x - start.x); // Направление стрелки
        ctx.beginPath(); // Начинаем путь для стрелки
        ctx.moveTo(end.x, end.y); // Переносимся в конечную точку стрелки
        ctx.lineTo(
            // Рисуем на холсте
            end.x - arrowSize * Math.cos(angle - 0.35),
            end.y - arrowSize * Math.sin(angle - 0.35),
        );
        ctx.lineTo(
            // Рисуем на холсте
            end.x - arrowSize * Math.cos(angle + 0.35),
            end.y - arrowSize * Math.sin(angle + 0.35),
        );
        ctx.closePath(); // Замыкаем треугольник стрелки
        ctx.fillStyle = "rgb(0, 0, 0)"; // Цвет стрелки
        ctx.fill(); // Заполняем стрелку

        const strengthText = `Sila: ${Math.round(aim.power * 10) / 10}`; // Текст силы
        ctx.font = "bold 16px Inter, sans-serif"; // Шрифт текста
        ctx.fillStyle = "#2a2727"; // Цвет текста
        ctx.textAlign = "center"; // Выравнивание текста по центру
        ctx.textBaseline = "bottom"; // Базовая линия текста снизу
        ctx.fillText(strengthText, end.x, end.y - 12); // Рисуем текст чуть над стрелкой
    }

    function draw() {
        // Функция отрисовки одного кадра
        drawField(); // Рисуем игровое поле
        drawTarget(); // Рисуем цель на поле
        drawStones(); // Рисуем камни
        drawAimLine(); // Рисуем линию броска, если есть выбор

        if (waitingForNextStone && currentStone && currentStone.thrown) {
            // Проверяем условие
            const stopThreshold = 0.05; // Объявляем переменную stopThreshold
            if (currentStone.speed <= stopThreshold) {
                // Проверяем условие
                waitingForNextStone = false;
                finishServerTurn(); // Сообщаем серверу, что бросок завершился
                updateStatus();
            }
        }

        requestAnimationFrame(draw); // Запрашиваем следующий кадр
    }

    addSocketMessageListener((event) => {
        let payload;
        try {
            payload = JSON.parse(event.data);
        } catch (error) {
            return;
        }

        if (payload.type === "gameThrow") {
            applyServerThrow(payload);
        }

        if (payload.type === "gameTurn") {
            if (payload.gameOver) {
                currentStone = null;
                gameOver = true;
                updateStatus();
                window.dispatchEvent(new CustomEvent("game-finished"));
                return;
            }

            setTurnPlayer(payload.turnPlayer);
            prepareNextStone();
        }

        if (payload.type === "gamePause") {
            pauseGame();
            window.dispatchEvent(new CustomEvent("shared-game-pause"));
        }

        if (payload.type === "gameResume") {
            resumeGame();
            window.dispatchEvent(new CustomEvent("shared-game-resume"));
        }

        if (payload.type === "gameRestartConfirmStatus") {
            showRestartWaitMessage(payload.confirmedBy || [], "restart");
        }

        if (payload.type === "newSettingsConfirmStatus") {
            showRestartWaitMessage(payload.confirmedBy || [], "settings");
        }

        if (payload.type === "gameRestart") {
            window.dispatchEvent(new CustomEvent("shared-game-close-modal"));
            resetRound(payload.turnPlayer);
        }

        if (payload.type === "openGameSettings") {
            pauseGame();
            window.dispatchEvent(new CustomEvent("shared-game-close-modal"));
            window.dispatchEvent(
                new CustomEvent("open-game-settings", {
                    detail: { config: payload.config },
                }),
            );
        }
    });

    draw(); // Запускаем цикл рендера
}

window.addEventListener("startGameWithConfig", (event) => {
    if (engine && rebuildCurrentGame) {
        rebuildCurrentGame(event.detail?.config, event.detail?.turnPlayer);
        return;
    }
    init(event.detail?.config, event.detail?.turnPlayer);
}); // Запускаем игру после подтверждения настроек двумя игроками
