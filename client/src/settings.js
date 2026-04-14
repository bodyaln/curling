const pauseButton = document.getElementById("pause-button");

const modalRoot = document.createElement("div");
modalRoot.className = "app-modal";
modalRoot.innerHTML = `
    <div class="modal-card">
        <p class="modal-title" id="settings-modal-title"></p>
        <p class="modal-text" id="settings-modal-text"></p>
        <div class="modal-actions">
            <button type="button" class="secondary" id="settings-modal-secondary">Späť</button>
            <button type="button" class="secondary" id="settings-modal-tertiary" hidden>Nová hra</button>
            <button type="button" class="primary" id="settings-modal-primary">OK</button>
        </div>
        <p class="modal-wait-message" id="settings-modal-wait" hidden></p>
    </div>
`;
document.body.appendChild(modalRoot);

const modalTitle = modalRoot.querySelector("#settings-modal-title");
const modalText = modalRoot.querySelector("#settings-modal-text");
const modalPrimary = modalRoot.querySelector("#settings-modal-primary");
const modalSecondary = modalRoot.querySelector("#settings-modal-secondary");
const modalTertiary = modalRoot.querySelector("#settings-modal-tertiary");
const modalWait = modalRoot.querySelector("#settings-modal-wait");
let isGameFinished = false;

function openModal(options) {
    if (
        !modalTitle ||
        !modalText ||
        !modalPrimary ||
        !modalSecondary ||
        !modalTertiary ||
        !modalWait
    ) {
        return;
    }

    modalTitle.textContent = options.title;
    modalText.textContent = options.text || "";
    modalText.hidden = !options.text;
    modalPrimary.textContent = options.primaryText;
    modalSecondary.textContent = options.secondaryText;
    modalTertiary.textContent = options.tertiaryText || "";
    modalTertiary.hidden = !options.tertiaryText;
    modalWait.textContent = "";
    modalWait.hidden = true;

    modalPrimary.onclick = () => {
        options.onPrimary();
    };
    modalSecondary.onclick = () => {
        options.onSecondary();
    };
    modalTertiary.onclick = () => {
        if (options.onTertiary) options.onTertiary();
    };

    modalRoot.classList.add("active");
}

function closeModal() {
    modalRoot.classList.remove("active");
    if (modalWait) {
        modalWait.textContent = "";
        modalWait.hidden = true;
    }
}

function openPauseModal() {
    if (isGameFinished) {
        openRestartModal();
        return;
    }
    window.dispatchEvent(new CustomEvent("game-pause"));
    openSharedPauseModal();
}

function openSharedPauseModal() {
    openModal({
        title: "Pauza",
        text: "Hra je pozastavená. Môžete pokračovať, reštartovať hru s rovnakými nastaveniami alebo otvoriť nové nastavenia.",
        primaryText: "Reštart",
        secondaryText: "Pokračovať",
        tertiaryText: "Začať novú hru",
        onPrimary: () =>
            window.dispatchEvent(new CustomEvent("game-restart-request")),
        onSecondary: () => {
            closeModal();
            window.dispatchEvent(new CustomEvent("game-resume"));
        },
        onTertiary: () =>
            window.dispatchEvent(new CustomEvent("game-new-settings-request")),
    });
}

function openRestartModal() {
    openModal({
        title: "Reštart",
        text: "",
        primaryText: "Reštart",
        secondaryText: "Späť",
        tertiaryText: "Začať novú hru",
        onPrimary: () =>
            window.dispatchEvent(new CustomEvent("game-restart-request")),
        onSecondary: closeModal,
        onTertiary: () =>
            window.dispatchEvent(new CustomEvent("game-new-settings-request")),
    });
}

if (pauseButton) {
    pauseButton.addEventListener("click", openPauseModal);
}

window.addEventListener("shared-game-pause", openSharedPauseModal);
window.addEventListener("shared-restart-request", openRestartModal);
window.addEventListener("shared-game-resume", closeModal);
window.addEventListener("shared-game-close-modal", closeModal);
window.addEventListener("game-finished", () => {
    isGameFinished = true;
    if (pauseButton) pauseButton.textContent = "Reštart";
});
window.addEventListener("game-reset", () => {
    isGameFinished = false;
    if (pauseButton) pauseButton.textContent = "Pauza";
});
window.addEventListener("game-modal-message", (event) => {
    if (!modalWait) return;
    modalWait.textContent = event.detail?.message || "";
    modalWait.hidden = !modalWait.textContent;
});
