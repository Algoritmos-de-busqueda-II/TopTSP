document.addEventListener('DOMContentLoaded', async function() {
    await loadRanking();

    // Auto-refresh ranking every 30 seconds
    setInterval(loadRanking, 30000);
});

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