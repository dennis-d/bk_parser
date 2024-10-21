const form = document.getElementById("logForm")
const resultContainer = document.getElementById("result")
const parseButton = document.getElementById("parseButton")
const refreshButton = document.getElementById("refreshButton")

async function parseLogs(event) {
    console.log("Runs")
    event.preventDefault()
    const uri = document.getElementById("uri").value
    toggleButtons(false) // Disable buttons while parsing

    try {
        resultContainer.innerHTML = `<p>Loading...</p>`
        const response = await fetch("/parse", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ uri }),
        })

        if (!response.ok) {
            throw new Error("Error parsing logs")
        }

        const data = await response.json()
        if (data.players.length === 0) {
            throw new Error(
                "Бой завершен или не поддерживается, введите другой лог"
            )
        }

        displayResults(data)
    } catch (error) {
        resultContainer.innerHTML = `<p style="color:red;"><strong>${error.message}</strong></p>`
    } finally {
        toggleButtons(true) // Re-enable buttons
    }
}

function displayResults(data) {
    const maxRows = Math.max(
        data.players.filter((player) => player.team === "B1").length,
        data.players.filter((player) => player.team === "B2").length
    )

    document.getElementById("result-header").innerHTML = `
        <p><strong>Тип боя:</strong> ${data.battle_type} <img src="${data.battle_image}" alt="Battle Image"></p>
        <h3>Информация о игроках:</h3>
        `

    const team1 = buildTeamTable(data.players, "B1", "Нападение", maxRows)
    const team2 = buildTeamTable(data.players, "B2", "Защита", maxRows)

    document.getElementById("result").innerHTML = `

        <div class="result-container">
            <div class="team">${team1}</div>
            <div class="team">${team2}</div>
        </div>
    `
}

function buildTeamTable(players, team, teamLabel, maxRows) {
    let tableContent = ""
    let klan = ""
    const teamPlayers = players
        .filter((player) => player.team === team)
        .map((player) => {
            klan = player.clan_name
            const row = `
                <tr>
                    <td>${getAlign(player.aligns)}${getClan(
                player.clan_name
            )}${getName(player.name, player.user_id, player.level)}</td>
                    <td>[${player.current_health}/<b>${
                player.max_health
            }</b>]</td>
                    <td id="stolb">${getStolbFormatted(player.stolb)}</td>
                    <td id="total-heal">
                        <strong>${player.healed}</strong> HP | [${
                player.protect * 5
            }]
                    </td>
                </tr>
            `

            // Store row content in a hidden <textarea>
            tableContent += `* ${player.name}\t[${player.current_health}/${
                player.max_health
            }]\t${player.stolb.toFixed(2)}\t[${player.healed} HP/ ${
                player.protect
            }]\n *`

            return row
        })
        .join("")

    // Add empty rows if this team has fewer players
    let emptyRows = ""
    const numEmptyRows =
        maxRows - players.filter((player) => player.team === team).length
    for (let i = 0; i < numEmptyRows; i++) {
        emptyRows += `
            <tr>
                <td>&nbsp;</td>
                <td>&nbsp;</td>
                <td>&nbsp;</td>
                <td>&nbsp;</td>
            </tr>
        `
    }

    return `
        <div class="team-table-wrapper">
            <table class="players-table">
                <caption class="team-title">${getClan(
                    klan
                )} <span>${teamLabel}:</span></caption>
                <thead>
                    <tr>
                        <th>Ник</th>
                        <th>Здоровье</th>
                        <th>Столбы <img style="cursor:pointer" width="30" height="18" src="http://img.combats.com/i/icon/icon_available_hp.png" /></th>
                        <th>Отхил <img style="cursor:pointer" width="30" height="18" src="https://img.combats.com/i/items/pocket_12_heal_100_l.gif" />/<img style="cursor:pointer" width="30" height="18" src="http://img.combats.com/i/misc/icons/spirit_block25.gif" /></th>
                    </tr>
                </thead>
                <tbody>
                    ${teamPlayers}
                    ${emptyRows} <!-- Add empty rows to balance the table -->
                </tbody>
            </table>
            <textarea id="team-${team}-data" class="hidden-textarea">${tableContent}</textarea>
            <button class="copy-button" onclick="copyFromTextarea('team-${team}-data', this)">Copy</button>
        </div>
    `
}

async function refreshLogs() {
    const uri = document.getElementById("uri").value
    if (uri) {
        await parseLogs({ preventDefault: () => {} })
    }
}

function toggleButtons(enable) {
    parseButton.disabled = !enable
    refreshButton.disabled = !enable
}

function getClan(klan) {
    return `<a href="http://capitalcity.combats.com/clans_inf.pl?${klan}" target="_blank">
        <img src="https://img.combats.com/i/klan/${klan}.gif" width="24" height="15" alt="Clan ${klan}">
    </a>`
}

function getAlign(align) {
    const alignNames = [
        "Мусорщика",
        "Волынщика",
        "Искушения",
        "Падальщика",
        "Мироздателя",
        "Благодати",
        "Милосердия",
        "Вознесения",
        "Повелителя Воды",
        "Повелителя Огня",
        "Повелителя Воздуха",
        "Повелителя Земли",
        "Повелителя Вечности",
        "Повелителя Металла",
        "Пантеона Баланса",
        "Справедливости",
        "Пересмешника",
        "Лорда Разрушителя",
    ]
    const alignIndex = parseInt(align) - 11
    return `<a href="http://lib.combats.com/article-align${align}" target="_blank">
        <img src="https://img.combats.com/i/align${align}.gif" width="12" height="15" alt="Последователь ${alignNames[alignIndex]}">
    </a>`
}

function getStolbFormatted(stolb) {
    let color = "green"
    if (stolb >= 2 && stolb <= 4) {
        color = "orange"
    } else if (stolb > 4) {
        color = "red"
    }
    return `[<b style="color: ${color};">${stolb.toFixed(
        2
    )}</b> / <b style="color: blue;">5</b>]`
}

function getName(name, id, level) {
    return `${name} [${level}] <a href="http://capitalcity.combats.com/inf.pl?${id}" target="_blank">
        <img src="https://img.combats.com/i/inf.gif" width="12" height="11" alt="Инф. о ${name}">
    </a>`
}

function copyFromTextarea(elementId, button) {
    const textarea = document.getElementById(elementId)
    const originalButtonText = button.textContent

    // Use the modern clipboard API if available
    if (navigator.clipboard) {
        navigator.clipboard
            .writeText(textarea.value)
            .then(() => {
                // Show "Copied" message
                button.textContent = "Copied!"
                button.disabled = true

                // Reset after 5 seconds
                setTimeout(() => {
                    button.textContent = originalButtonText
                    button.disabled = false
                }, 5000)
            })
            .catch((err) => {
                console.error("Failed to copy text: ", err)
            })
    } else {
        // Fallback for browsers without navigator.clipboard support
        textarea.select()
        textarea.setSelectionRange(0, textarea.value.length) // For mobile devices

        try {
            const successful = document.execCommand("copy")
            if (successful) {
                // Show "Copied" message
                button.textContent = "Copied!"
                button.disabled = true

                // Reset after 5 seconds
                setTimeout(() => {
                    button.textContent = originalButtonText
                    button.disabled = false
                }, 5000)
            } else {
                throw new Error("Copy command was unsuccessful")
            }
        } catch (err) {
            console.error("Fallback: Oops, unable to copy", err)
        }

        // Clear the selection after the copy
        window.getSelection().removeAllRanges()
    }
}
