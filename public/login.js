document.addEventListener('DOMContentLoaded', function() {
    const loginForm = document.getElementById('login-form');
    const passwordModal = document.getElementById('password-modal');
    const passwordForm = document.getElementById('password-form');

    // Check if user is already logged in
    checkAuthStatus().then(user => {
        console.log('Initial auth check:', user);
        if (user) {
            console.log('User already logged in, redirecting...');
            if (user.is_admin) {
                window.location.href = '/admin';
            } else {
                window.location.href = '/user';
            }
        }
    }).catch(error => {
        console.log('Auth check error:', error);
    });

    loginForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        clearAlerts('alert-container');
        
        const formData = new FormData(loginForm);
        const email = formData.get('email');
        const password = formData.get('password');
        
        if (!email || !password) {
            showAlert('alert-container', 'Por favor, completa todos los campos.', 'danger');
            return;
        }
        
        const submitBtn = loginForm.querySelector('button[type="submit"]');
        setLoading(submitBtn, true);
        
        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email, password })
            });
            
            const data = await response.json();
            console.log('Login response:', data);
            
            if (response.ok) {
                if (data.requirePasswordChange) {
                    console.log('Showing password change modal');
                    // Show password change modal
                    document.body.style.overflow = 'hidden';
                    passwordModal.classList.remove('hidden');
                } else {
                    console.log('Redirecting user, is_admin:', data.user.is_admin);
                    // Redirect based on user role
                    if (data.user.is_admin) {
                        window.location.href = '/admin';
                    } else {
                        window.location.href = '/user';
                    }
                }
            } else {
                showAlert('alert-container', data.error || 'Error al iniciar sesión', 'danger');
            }
        } catch (error) {
            console.error('Login error:', error);
            showAlert('alert-container', 'Error de conexión. Por favor, inténtalo de nuevo.', 'danger');
        } finally {
            setLoading(submitBtn, false);
        }
    });

    passwordForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        clearAlerts('password-alert-container');
        
        const formData = new FormData(passwordForm);
        const newPassword = formData.get('newPassword');
        const confirmPassword = formData.get('confirmPassword');
        
        if (!newPassword || !confirmPassword) {
            showAlert('password-alert-container', 'Por favor, completa todos los campos.', 'danger');
            return;
        }
        
        if (newPassword.length < 6) {
            showAlert('password-alert-container', 'La contraseña debe tener al menos 6 caracteres.', 'danger');
            return;
        }
        
        if (newPassword !== confirmPassword) {
            showAlert('password-alert-container', 'Las contraseñas no coinciden.', 'danger');
            return;
        }
        
        const submitBtn = passwordForm.querySelector('button[type="submit"]');
        setLoading(submitBtn, true);
        
        try {
            const response = await fetch('/api/change-password', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ newPassword })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                showAlert('password-alert-container', 'Contraseña cambiada exitosamente. Redirigiendo...', 'success');
                
                setTimeout(async () => {
                    // Check user role and redirect
                    const user = await checkAuthStatus();
                    if (user && user.is_admin) {
                        window.location.href = '/admin';
                    } else {
                        window.location.href = '/user';
                    }
                }, 2000);
            } else {
                showAlert('password-alert-container', data.error || 'Error al cambiar la contraseña', 'danger');
            }
        } catch (error) {
            console.error('Password change error:', error);
            showAlert('password-alert-container', 'Error de conexión. Por favor, inténtalo de nuevo.', 'danger');
        } finally {
            setLoading(submitBtn, false);
        }
    });
});