// Utilidades y funciones comunes utilizadas en toda la aplicación

function showToast(message, type = 'info', title = null) {
    // Crear contenedor de toast si no existe
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    // Crear elemento toast
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    // Mapeo de iconos
    const icons = {
        success: '✓',
        error: '✕',
        warning: '⚠',
        info: 'ℹ'
    };

    // Títulos predeterminados
    const defaultTitles = {
        success: 'Éxito',
        error: 'Error',
        warning: 'Advertencia',
        info: 'Información'
    };

    const toastTitle = title || defaultTitles[type] || 'Notificación';
    const toastIcon = icons[type] || 'ℹ';

    toast.innerHTML = `
        <div class="toast-icon">${toastIcon}</div>
        <div class="toast-content">
            <div class="toast-title">${toastTitle}</div>
            <div class="toast-message">${message}</div>
        </div>
        <button class="toast-close" onclick="this.parentElement.remove()">×</button>
        <div class="toast-progress"></div>
    `;

    container.appendChild(toast);

    // Auto-eliminar después de 5 segundos
    setTimeout(() => {
        if (toast && toast.parentElement) {
            toast.classList.add('toast-exit');
            setTimeout(() => {
                if (toast && toast.parentElement) {
                    toast.remove();
                }
            }, 300);
        }
    }, 5000);
}

// Función heredada para compatibilidad con versiones anteriores - redirige a showToast
function showAlert(container, message, type = 'info') {
    showToast(message, type);
}

function clearAlerts(containerId) {
    const container = document.getElementById(containerId);
    if (container) {
        container.innerHTML = '';
    }
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleString('es-ES', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function formatObjectiveValue(value) {
    if (value === null || value === undefined) return '-';
    return Number(value).toFixed(2);
}

// Method acronym shown in tables; its optional description appears in a tooltip
function formatMethod(method, description) {
    const escape = text => String(text === null || text === undefined ? '' : text)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    if (!description) return method ? escape(method) : '-';
    return `<span class="method-acronym" tabindex="0" data-description="${escape(description)}">${escape(method || '-')}</span>`;
}

// Tooltip for method descriptions (instant on hover/focus, toggled on tap)
(function setupMethodTooltip() {
    let tooltip = null;
    let current = null;

    function show(target) {
        if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.className = 'method-tooltip';
            tooltip.setAttribute('role', 'tooltip');
            document.body.appendChild(tooltip);
        }
        current = target;
        tooltip.textContent = target.dataset.description;
        tooltip.classList.add('visible');
        const rect = target.getBoundingClientRect();
        const tip = tooltip.getBoundingClientRect();
        let left = rect.left + rect.width / 2 - tip.width / 2;
        left = Math.max(8, Math.min(left, window.innerWidth - tip.width - 8));
        let top = rect.top - tip.height - 8;
        if (top < 8) top = rect.bottom + 8;
        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
    }

    function hide() {
        current = null;
        if (tooltip) tooltip.classList.remove('visible');
    }

    const find = event => event.target.closest && event.target.closest('.method-acronym[data-description]');

    document.addEventListener('mouseover', event => { const t = find(event); if (t) show(t); });
    document.addEventListener('mouseout', event => { if (find(event)) hide(); });
    document.addEventListener('focusin', event => { const t = find(event); if (t) show(t); });
    document.addEventListener('focusout', event => { if (find(event)) hide(); });
    document.addEventListener('click', event => {
        const t = find(event);
        if (t && t !== current) show(t); else hide();
    });
    window.addEventListener('scroll', hide, true);
})();

// Optional solving time (seconds) reported by the student, compact: 12.5", 3' 20", 1h 05' 03"
function formatTime(seconds) {
    if (seconds === null || seconds === undefined || seconds === '' || isNaN(Number(seconds))) return '-';
    const total = Number(seconds);
    if (total < 60) {
        return `${Number(total.toFixed(total < 10 ? 2 : 1))}"`;
    }
    const rounded = Math.round(total);
    const hours = Math.floor(rounded / 3600);
    const minutes = Math.floor((rounded % 3600) / 60);
    const secs = rounded % 60;
    const pad = n => String(n).padStart(2, '0');
    return hours > 0 ? `${hours}h ${pad(minutes)}' ${pad(secs)}"` : `${minutes}' ${pad(secs)}"`;
}

async function checkAuthStatus() {
    try {
        const response = await fetch('/api/user');
        if (response.ok) {
            const data = await response.json();
            return data.user;
        }
        return null;
    } catch (error) {
        console.error('Error checking auth status:', error);
        return null;
    }
}

function logout() {
    if (confirm('¿Estás seguro de que quieres cerrar sesión?')) {
        fetch('/api/logout', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        }).then(() => {
            updateNavigation();
            window.location.href = '/';
        }).catch(error => {
            console.error('Logout error:', error);
            window.location.href = '/';
        });
    }
}

function setLoading(element, loading = true) {
    if (typeof element === 'string') {
        element = document.getElementById(element);
    }
    
    if (element) {
        if (loading) {
            element.classList.add('loading');
            element.disabled = true;
        } else {
            element.classList.remove('loading');
            element.disabled = false;
        }
    }
}

function validateTSPSolution(solution) {
    // Remove extra whitespace and split by comma
    const numbers = solution.trim().split(',').map(n => n.trim()).filter(n => n);
    
    if (numbers.length === 0) {
        return { valid: false, error: 'La solución está vacía' };
    }
    
    // Convert to integers
    const intNumbers = [];
    for (const num of numbers) {
        const parsed = parseInt(num, 10);
        if (isNaN(parsed) || parsed <= 0) {
            return { valid: false, error: `"${num}" no es un número válido` };
        }
        intNumbers.push(parsed);
    }
    
    // Check for duplicates
    const uniqueNumbers = new Set(intNumbers);
    if (uniqueNumbers.size !== intNumbers.length) {
        return { valid: false, error: 'La solución contiene números duplicados' };
    }
    
    // Check if numbers are consecutive starting from 1
    const maxNumber = Math.max(...intNumbers);
    const expectedNumbers = new Set();
    for (let i = 1; i <= maxNumber; i++) {
        expectedNumbers.add(i);
    }
    
    for (const num of intNumbers) {
        if (!expectedNumbers.has(num)) {
            return { valid: false, error: `Número ${num} fuera del rango esperado (1-${maxNumber})` };
        }
    }
    
    // Check if all numbers from 1 to maxNumber are present
    if (intNumbers.length !== maxNumber) {
        return { valid: false, error: 'Faltan números en la secuencia' };
    }
    
    return { valid: true, numbers: intNumbers };
}

function updateNavigation() {
    checkAuthStatus().then(user => {
        const loginLink = document.getElementById('login-link');
        const userLink = document.getElementById('user-link');
        const adminLink = document.getElementById('admin-link');
        const logoutLink = document.getElementById('logout-link');
        
        if (user) {
            // User is logged in
            if (loginLink) loginLink.classList.add('hidden');
            if (userLink) userLink.classList.remove('hidden');
            if (logoutLink) logoutLink.classList.remove('hidden');
            
            if (user.is_admin && adminLink) {
                adminLink.classList.remove('hidden');
            } else if (adminLink) {
                adminLink.classList.add('hidden');
            }
        } else {
            // User is not logged in
            if (loginLink) loginLink.classList.remove('hidden');
            if (userLink) userLink.classList.add('hidden');
            if (adminLink) adminLink.classList.add('hidden');
            if (logoutLink) logoutLink.classList.add('hidden');
        }
    }).catch(() => {
        // Error checking auth status, assume not logged in
        const loginLink = document.getElementById('login-link');
        const userLink = document.getElementById('user-link');
        const adminLink = document.getElementById('admin-link');
        const logoutLink = document.getElementById('logout-link');
        
        if (loginLink) loginLink.classList.remove('hidden');
        if (userLink) userLink.classList.add('hidden');
        if (adminLink) adminLink.classList.add('hidden');
        if (logoutLink) logoutLink.classList.add('hidden');
    });
}

function updateCountdown() {
    Promise.all([
        fetch('/api/system-settings').then(r => r.json()),
        fetch('/api/current-instance').then(r => r.json())
    ])
        .then(([settings, instanceData]) => {
            const endDate = settings.competition_end_date;
            const instanceName = settings.instance_name || 'Berlin 52';

            // Update instance name if element exists
            const instanceNameElement = document.getElementById('instance-name');
            const competitionTitleElement = document.getElementById('competition-title');
            const noCompetitionElement = document.getElementById('no-competition');
            const downloadBtn = document.getElementById('download-instance-btn');
            const competitionButtons = document.getElementById('competition-buttons');

            if (instanceData.hasInstance) {
                // There is an instance available
                if (instanceNameElement) {
                    instanceNameElement.textContent = instanceName;
                }
                if (competitionTitleElement) {
                    competitionTitleElement.style.display = '';
                }
                if (noCompetitionElement) {
                    noCompetitionElement.style.display = 'none';
                }
                if (downloadBtn) {
                    downloadBtn.style.display = '';
                }
                if (competitionButtons) {
                    competitionButtons.style.display = '';
                }
            } else {
                // No instance available
                if (competitionTitleElement) {
                    competitionTitleElement.style.display = 'none';
                }
                if (noCompetitionElement) {
                    noCompetitionElement.style.display = '';
                }
                if (downloadBtn) {
                    downloadBtn.style.display = 'none';
                }
                if (competitionButtons) {
                    competitionButtons.style.display = 'none';
                }
            }
            
            const pausedBanner = document.getElementById('paused-banner');
            if (pausedBanner) {
                pausedBanner.classList.toggle('hidden', !(instanceData.hasInstance && settings.competition_paused === 'true'));
            }

            const countdownElement = document.getElementById('countdown');
            const endDateElement = document.getElementById('end-date');

            if (endDate) {
                const endDateTime = new Date(endDate);
                const now = new Date();
                const timeDiff = endDateTime - now;

                if (countdownElement && endDateElement) {
                    countdownElement.style.display = '';
                    endDateElement.style.display = '';

                    if (timeDiff > 0) {
                        const days = Math.floor(timeDiff / (1000 * 60 * 60 * 24));
                        const hours = Math.floor((timeDiff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                        const minutes = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60));

                        countdownElement.innerHTML = `⏰ <strong>${days}d ${hours}h ${minutes}m</strong> hasta el cierre`;
                        endDateElement.textContent = `Cierre: ${endDateTime.toLocaleString('es-ES')}`;
                    } else {
                        countdownElement.innerHTML = '⏰ <strong>Competición finalizada</strong>';
                        endDateElement.textContent = `Cerró: ${endDateTime.toLocaleString('es-ES')}`;
                    }
                }
            } else {
                // Hide countdown elements when no end date is set
                if (countdownElement) {
                    countdownElement.style.display = 'none';
                }
                if (endDateElement) {
                    endDateElement.style.display = 'none';
                }
            }
        })
        .catch(error => console.error('Error loading system settings:', error));
}

function downloadInstance() {
    window.location.href = '/api/download-instance';
}

function visualizeInstance() {
    window.location.href = '/visualize';
}

function toggleMobileMenu() {
    const nav = document.getElementById('mobile-nav');
    const overlay = document.querySelector('.mobile-menu-overlay');

    if (nav) {
        nav.classList.toggle('active');
    }
    if (overlay) {
        overlay.classList.toggle('active');
    }
}

// Initialize page-specific functionality
document.addEventListener('DOMContentLoaded', function() {
    // Add fade-in animation to all cards
    const cards = document.querySelectorAll('.card');
    cards.forEach((card, index) => {
        setTimeout(() => {
            card.classList.add('fade-in');
        }, index * 100);
    });

    // Update navigation based on auth status
    updateNavigation();

    // Update countdown and refresh every minute
    updateCountdown();
    setInterval(updateCountdown, 60000);
});