let currentUser = null; // Logged-in user (if any), used to highlight their own rows
let generalLoaded = false;

document.addEventListener('DOMContentLoaded', async function() {
    currentUser = await checkAuthStatus();

    if (window.location.hash === '#general') {
        switchRankingTab('general');
    }

    await loadRanking();

    // Auto-refresh ranking every 30 seconds
    setInterval(loadRanking, 30000);
    // Also refresh competition progression chart every 30s
    setInterval(loadCompetitionProgression, 30000);
    // Initial load
    loadCompetitionProgression();
});

async function loadCompetitionProgression() {
    const container = document.getElementById('competition-progression');
    if (!container) return;

    try {
        const resp = await fetch('/api/competition-best-history');
        if (!resp.ok) return;
        const data = await resp.json();
        const improvements = data.improvements || [];

        if (improvements.length === 0) {
            container.innerHTML = '<p style="text-align:center;">No hay datos de mejoras aún.</p>';
            return;
        }

        // Prepare arrays
        const x = improvements.map(i => new Date(i.date));
        const y = improvements.map(i => i.value);
        const users = improvements.map(i => i.user ? i.user.split('@')[0] : '-');
        const methods = improvements.map(i => i.method || '-');

        // Continuous red line for the best solution over time (step-like)
        // We'll extend the line up to 'now' so it continues to the current moment
        let lineX = x.slice();
        let lineY = y.slice();
        let lastValue = lineY.length > 0 ? lineY[lineY.length - 1] : null;

        if (lastValue === null) {
            // No historical improvements — try to fetch current best from /api/ranking
            try {
                const rankingResp = await fetch('/api/ranking');
                if (rankingResp.ok) {
                    const rankingData = await rankingResp.json();
                    if (rankingData && rankingData.stats && rankingData.stats.bestSolution !== null) {
                        lastValue = Number(rankingData.stats.bestSolution);
                    } else if (rankingData && Array.isArray(rankingData.ranking) && rankingData.ranking.length > 0) {
                        lastValue = Number(rankingData.ranking[0].best_objective_value);
                    }
                }
            } catch (e) {
                console.error('Error fetching ranking for default best value:', e);
            }
        }

        const now = new Date();
        if (lastValue !== null) {
            if (lineX.length === 0) {
                // create a short horizontal line from 24h ago to now
                const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
                lineX = [yesterday, now];
                lineY = [lastValue, lastValue];
            } else {
                // extend existing series to 'now'
                lineX.push(now);
                lineY.push(lastValue);
            }
        }

        const lineTrace = {
            x: lineX,
            y: lineY,
            mode: 'lines',
            name: 'Mejor solución',
            line: { color: '#D32F2F', width: 2 },
            hoverinfo: 'skip'
        };

        // Markers for each improvement
        const markerTrace = {
            x: x,
            y: y,
            mode: 'markers',
            name: 'Nueva mejor solución',
            marker: { color: '#D32F2F', size: 8 },
            customdata: improvements.map(i => ({ user: i.user || '-', method: i.method || '-', value: i.value })),
            hovertemplate: 'Usuario: %{customdata.user}<br>Valor: %{customdata.value:.2f}<br>Método: %{customdata.method}<extra></extra>'
        };

        const layout = {
            xaxis: { title: 'Fecha' },
            yaxis: { title: 'Función Objetivo' },
            template: 'plotly_white',
            margin: { t: 20, r: 80, l: 60, b: 80 },
            legend: { orientation: 'h', x: 0.02, y: 1.1 }
        };

        Plotly.newPlot(container, [lineTrace, markerTrace], layout, { responsive: true, displayModeBar: false });

    } catch (e) {
        console.error('Error loading competition progression:', e);
    }
}

async function checkInstanceAvailability() {
    try {
        const response = await fetch('/api/current-instance');
        if (response.ok) {
            const data = await response.json();
            return data.hasInstance;
        }
        return false;
    } catch (error) {
        console.error('Error checking instance availability:', error);
        return false;
    }
}

function updateInstanceButtons(hasInstance) {
    const competitionTitle = document.getElementById('competition-title');
    const rankingButtons = document.getElementById('ranking-buttons');
    const noCompetition = document.getElementById('no-competition');

    if (hasInstance) {
        if (competitionTitle) competitionTitle.style.display = '';
        if (rankingButtons) rankingButtons.style.display = '';
        if (noCompetition) noCompetition.style.display = 'none';
    } else {
        if (competitionTitle) competitionTitle.style.display = 'none';
        if (rankingButtons) rankingButtons.style.display = 'none';
        if (noCompetition) noCompetition.style.display = '';
    }
}

async function loadRanking() {
    const loadingMessage = document.getElementById('loading-message');
    const frozenMessage = document.getElementById('frozen-message');
    const rankingTableContainer = document.getElementById('ranking-table-container');
    const emptyMessage = document.getElementById('empty-message');

    // Check if there's an instance available
    const hasInstance = await checkInstanceAvailability();
    updateInstanceButtons(hasInstance);
    if (!hasInstance) {
        // Hide all ranking-related elements when no instance
        loadingMessage.classList.add('hidden');
        frozenMessage.classList.add('hidden');
        rankingTableContainer.classList.add('hidden');
        emptyMessage.classList.add('hidden');
        return;
    }

    try {
        const response = await fetch('/api/ranking');
        
        if (response.ok) {
            const data = await response.json();
            
            // Hide loading message
            loadingMessage.classList.add('hidden');
            
            if (data.frozen) {
                // Show frozen message with timestamp
                frozenMessage.classList.remove('hidden');
                updateFrozenMessage(data.frozenAt);
                updateRankingStatus(true, data.frozenAt);
                
                // Still show the frozen ranking and stats
                if (data.ranking.length === 0) {
                    rankingTableContainer.classList.add('hidden');
                    emptyMessage.classList.remove('hidden');
                } else {
                    emptyMessage.classList.add('hidden');
                    rankingTableContainer.classList.remove('hidden');
                    populateRankingTable(data.ranking);
                }
                
                updateStatistics(data.stats || data.ranking);
                loadRecentSubmissions();
            } else {
                // Hide frozen message
                frozenMessage.classList.add('hidden');
                updateRankingStatus(false);
                
                if (data.ranking.length === 0) {
                    // Show empty message
                    rankingTableContainer.classList.add('hidden');
                    emptyMessage.classList.remove('hidden');
                } else {
                    // Show ranking table
                    emptyMessage.classList.add('hidden');
                    rankingTableContainer.classList.remove('hidden');
                    populateRankingTable(data.ranking);
                }
                
                updateStatistics(data.stats || data.ranking);
                loadRecentSubmissions();
            }
        } else {
            console.error('Error loading ranking:', response.status);
            loadingMessage.innerHTML = '<p class="alert alert-danger">Error al cargar el ranking. Inténtalo de nuevo más tarde.</p>';
        }
    } catch (error) {
        console.error('Error loading ranking:', error);
        loadingMessage.innerHTML = '<p class="alert alert-danger">Error de conexión. Inténtalo de nuevo más tarde.</p>';
    }
}

function updateRankingStatus(frozen, frozenAt) {
    const statusElement = document.getElementById('ranking-status');
    
    if (frozen) {
        const frozenTime = frozenAt ? formatDate(frozenAt) : '';
        statusElement.innerHTML = `<span class="status-indicator status-frozen"></span><span>Ranking congelado temporalmente${frozenTime ? ' - ' + frozenTime : ''}</span>`;
    } else {
        statusElement.innerHTML = '<span class="status-indicator status-online"></span><span>Ranking actualizado en tiempo real</span>';
    }
}

function updateFrozenMessage(frozenAt) {
    const frozenMessage = document.getElementById('frozen-message');
    const frozenTime = frozenAt ? formatDate(frozenAt) : '';
    
    frozenMessage.innerHTML = `
        <strong>⚠️ Ranking Congelado</strong><br>
        El ranking está temporalmente oculto. Las soluciones continúan siendo procesadas en segundo plano.
        ${frozenTime ? '<br><small><strong>Congelado en:</strong> ' + frozenTime + '</small>' : ''}
    `;
}

function populateRankingTable(ranking) {
    const tbody = document.getElementById('ranking-tbody');
    tbody.innerHTML = '';

    ranking.forEach((entry, index) => {
        const row = document.createElement('tr');

        // Add special styling for top 3
        if (index === 0) {
            row.classList.add('rank-1');
        } else if (index === 1) {
            row.classList.add('rank-2');
        } else if (index === 2) {
            row.classList.add('rank-3');
        }

        if (currentUser && entry.email === currentUser.email) {
            row.classList.add('own-row');
        }

        // Remove the @ part from email (including @)
        const displayEmail = entry.email.split('@')[0];

        row.innerHTML = `
            <td>
                <strong>#${index + 1}</strong>
                ${index === 0 ? ' 🥇' : index === 1 ? ' 🥈' : index === 2 ? ' 🥉' : ''}
            </td>
            <td>${sanitizeHtml(displayEmail)}</td>
            <td><strong>${formatObjectiveValue(entry.best_objective_value)}</strong></td>
            <td>${formatMethod(entry.best_method, entry.best_method_description)}</td>
            <td>${formatDate(entry.last_improvement)}</td>
            <td class="compact-col">${entry.total_submissions || 0}</td>
            <td class="time-col">${formatTime(entry.best_time_seconds)}</td>
            <td>
                <button onclick="visualizeUserSolution(${entry.user_id})" class="btn btn-secondary btn-sm" title="Visualizar solución">
                    👁️
                </button>
            </td>
        `;

        tbody.appendChild(row);
    });
}

function visualizeUserSolution(userId) {
    // Open in same page instead of new tab
    window.location.href = `/visualize?userId=${userId}`;
}

async function loadRecentSubmissions() {
    const container = document.getElementById('recent-submissions');
    const tableWrapper = document.getElementById('recent-submissions-table');
    const frozenText = document.getElementById('recent-submissions-frozen');
    const tbody = document.getElementById('recent-submissions-tbody');
    if (!container || !tableWrapper || !frozenText || !tbody) return;

    try {
        const response = await fetch('/api/recent-submissions');
        if (!response.ok) return;
        const data = await response.json();

        if (data.frozen) {
            tableWrapper.classList.add('hidden');
            frozenText.classList.remove('hidden');
            container.classList.remove('hidden');
            return;
        }

        const submissions = Array.isArray(data.submissions) ? data.submissions : [];
        if (submissions.length === 0) {
            container.classList.add('hidden');
            return;
        }

        tbody.innerHTML = '';
        submissions.forEach(sub => {
            // submitted_at is stored in UTC without timezone ('YYYY-MM-DD HH:MM:SS')
            const raw = String(sub.submitted_at || '');
            const date = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(raw)
                ? new Date(raw.replace(' ', 'T') + 'Z')
                : new Date(raw);

            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${sanitizeHtml(sub.user || '-')}</td>
                <td><strong>${formatObjectiveValue(sub.objective_value)}</strong></td>
                <td>${formatMethod(sub.method, sub.method_description)}</td>
                <td class="time-col">${formatTime(sub.time_seconds)}</td>
                <td>${isNaN(date.getTime()) ? '-' : formatDate(date)}</td>
            `;
            tbody.appendChild(row);
        });

        frozenText.classList.add('hidden');
        tableWrapper.classList.remove('hidden');
        container.classList.remove('hidden');
    } catch (error) {
        console.error('Error loading recent submissions:', error);
    }
}

function updateStatistics(data) {
    let totalParticipants, bestSolution, totalSolutions;
    
    if (data && data.totalParticipants !== undefined) {
        // It's a stats object from frozen data
        totalParticipants = data.totalParticipants;
        bestSolution = data.bestSolution !== null ? formatObjectiveValue(data.bestSolution) : '-';
        totalSolutions = data.totalSolutions;
    } else if (Array.isArray(data)) {
        // It's a ranking array
        totalParticipants = data.length;
        bestSolution = data.length > 0 ? formatObjectiveValue(data[0].best_objective_value) : '-';
        totalSolutions = data.reduce((sum, entry) => sum + (entry.total_submissions || 0), 0);
    } else {
        // Fallback
        totalParticipants = '-';
        bestSolution = '-';
        totalSolutions = '-';
    }
    
    document.getElementById('total-participants').textContent = totalParticipants;
    document.getElementById('best-solution').textContent = bestSolution;
    document.getElementById('total-solutions').textContent = totalSolutions;
}

function sanitizeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function downloadInstance() {
    window.location.href = '/api/download-instance';
}

function visualizeInstance() {
    window.location.href = '/visualize';
}

// ---------- Tabs: current competition / general classification ----------

function switchRankingTab(tab) {
    const isGeneral = tab === 'general';
    document.getElementById('tab-current').classList.toggle('hidden', isGeneral);
    document.getElementById('tab-general').classList.toggle('hidden', !isGeneral);
    document.querySelectorAll('.ranking-tab').forEach(btn => {
        const active = btn.dataset.tab === tab;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    try {
        history.replaceState(null, '', isGeneral ? '#general' : window.location.pathname + window.location.search);
    } catch (e) {
        // Ignore: only cosmetic
    }

    if (isGeneral && !generalLoaded) {
        loadGeneralRanking();
    }

    // Plotly charts drawn while hidden need a resize once visible again
    const chart = document.getElementById('competition-progression');
    if (!isGeneral && chart && window.Plotly && chart.data) {
        Plotly.Plots.resize(chart);
    }
}

async function loadGeneralRanking() {
    const loading = document.getElementById('general-loading');
    const empty = document.getElementById('general-empty');
    const content = document.getElementById('general-content');

    try {
        const response = await fetch('/api/general-ranking');
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const data = await response.json();
        generalLoaded = true;

        loading.classList.add('hidden');
        const competitions = data.competitions || [];
        const players = data.players || [];

        if (competitions.length === 0 || players.length === 0) {
            empty.classList.remove('hidden');
            content.classList.add('hidden');
            return;
        }

        empty.classList.add('hidden');
        content.classList.remove('hidden');
        renderMedalsTable(players, competitions);
        renderOptimumsTable(players);
        renderCompetitionsTable(competitions);
    } catch (error) {
        console.error('Error loading general ranking:', error);
        loading.innerHTML = '<p class="alert alert-danger">Error al cargar la clasificación general.</p>';
    }
}

// Rank numbers shared by rows that tie on every sorting criterion
function sharedRanks(rows, sameKey) {
    const ranks = [];
    rows.forEach((row, i) => {
        ranks.push(i > 0 && sameKey(rows[i - 1]) === sameKey(row) ? ranks[i - 1] : i + 1);
    });
    return ranks;
}

function isOwnPlayer(player) {
    return currentUser && player.user_id !== null && player.user_id === currentUser.id;
}

function renderMedalsTable(players, competitions) {
    const tbody = document.getElementById('medals-tbody');
    const sorted = players.slice().sort((a, b) =>
        b.gold - a.gold || b.silver - a.silver || b.bronze - a.bronze ||
        a.avgPosition - b.avgPosition || b.participations - a.participations ||
        a.user.localeCompare(b.user));
    const ranks = sharedRanks(sorted, p => [p.gold, p.silver, p.bronze, p.avgPosition, p.participations].join('|'));
    const recent = competitions.slice(-8);

    tbody.innerHTML = sorted.map((p, i) => `
        <tr class="${isOwnPlayer(p) ? 'own-row' : ''}">
            <td><strong>${ranks[i]}</strong></td>
            <td>${sanitizeHtml(p.user)}</td>
            <td class="text-center">${p.gold || '-'}</td>
            <td class="text-center">${p.silver || '-'}</td>
            <td class="text-center">${p.bronze || '-'}</td>
            <td class="text-center">${p.participations}</td>
            <td class="text-center">${p.avgPosition.toFixed(2)}</td>
            <td><div class="position-badges">${recent.map(c => positionBadge(p.positions[c.id], c)).join('')}</div></td>
        </tr>
    `).join('');
}

function positionBadge(position, competition) {
    const title = sanitizeHtml(competition.name);
    if (position === undefined || position === null) {
        return `<span class="position-badge position-none" title="${title}: no participó">–</span>`;
    }
    const medal = position === 1 ? 'position-gold' : position === 2 ? 'position-silver' : position === 3 ? 'position-bronze' : '';
    return `<span class="position-badge ${medal}" title="${title}: puesto ${position}">${position}</span>`;
}

function renderOptimumsTable(players) {
    const tbody = document.getElementById('optimums-tbody');
    const sorted = players.slice().sort((a, b) =>
        Number(a.avgDeviation.toFixed(2)) - Number(b.avgDeviation.toFixed(2)) ||
        b.optimums - a.optimums || b.participations - a.participations || a.user.localeCompare(b.user));
    const ranks = sharedRanks(sorted, p => [p.avgDeviation.toFixed(2), p.optimums, p.participations].join('|'));

    tbody.innerHTML = sorted.map((p, i) => `
        <tr class="${isOwnPlayer(p) ? 'own-row' : ''}">
            <td><strong>${ranks[i]}</strong></td>
            <td>${sanitizeHtml(p.user)}</td>
            <td class="text-center"><strong>${p.avgDeviation.toFixed(2)}%</strong></td>
            <td class="text-center">${p.optimums}</td>
            <td class="text-center">${p.participations}</td>
        </tr>
    `).join('');
}

function renderCompetitionsTable(competitions) {
    const tbody = document.getElementById('competitions-tbody');
    tbody.innerHTML = competitions.slice().reverse().map((c, i) => {
        // archived_at comes from SQLite CURRENT_TIMESTAMP (UTC without timezone)
        const raw = String(c.archivedAt || '');
        const date = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(raw) ? new Date(raw.replace(' ', 'T') + 'Z') : new Date(raw);
        return `
            <tr>
                <td>${competitions.length - i}</td>
                <td>${sanitizeHtml(c.name)}${c.dimension ? ` <small>(${c.dimension} nodos)</small>` : ''}</td>
                <td>${isNaN(date.getTime()) ? '-' : formatDate(date)}</td>
                <td class="text-center">${c.participants}</td>
                <td><strong>${formatObjectiveValue(c.bestValue)}</strong></td>
                <td>${sanitizeHtml(c.winner || '-')}</td>
            </tr>
        `;
    }).join('');
}
