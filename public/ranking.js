document.addEventListener('DOMContentLoaded', async function() {
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

        // Remove the @ part from email (including @)
        const displayEmail = entry.email.split('@')[0];

        row.innerHTML = `
            <td>
                <strong>#${index + 1}</strong>
                ${index === 0 ? ' 🥇' : index === 1 ? ' 🥈' : index === 2 ? ' 🥉' : ''}
            </td>
            <td>${sanitizeHtml(displayEmail)}</td>
            <td><strong>${formatObjectiveValue(entry.best_objective_value)}</strong></td>
            <td>${sanitizeHtml(entry.best_method || '-')}</td>
            <td>${formatDate(entry.last_improvement)}</td>
            <td>${entry.total_submissions || 0}</td>
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