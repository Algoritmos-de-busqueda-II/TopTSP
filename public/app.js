// Common utilities and functions used across the application

function showAlert(container, message, type = 'info') {
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type}`;
    alertDiv.innerHTML = message;
    
    const targetContainer = typeof container === 'string' 
        ? document.getElementById(container) 
        : container;
    
    if (targetContainer) {
        // Clear existing alerts safely
        while (targetContainer.firstChild) {
            targetContainer.removeChild(targetContainer.firstChild);
        }
        targetContainer.appendChild(alertDiv);
        
        // Auto-hide after 5 seconds for success messages
        if (type === 'success') {
            setTimeout(() => {
                if (alertDiv && alertDiv.parentNode) {
                    alertDiv.parentNode.removeChild(alertDiv);
                }
            }, 5000);
        }
    }
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