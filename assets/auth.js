/* Authentication helpers shared by the browser pages. */

let token = null;
let currentUser = null;

function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/login.html';
}

// Loads the stored session, redirects to the login page when missing and
// fills in the username / role badges when present.
function checkAuth() {
    token = localStorage.getItem('token');
    const userStr = localStorage.getItem('user');

    if (!token || !userStr) {
        window.location.href = '/login.html';
        return false;
    }

    currentUser = JSON.parse(userStr);
    document.getElementById('username').textContent = currentUser.username;
    document.getElementById('userRole').textContent = currentUser.role;
    return true;
}

// fetch() with the bearer token attached. By default an expired session logs
// the user out; pass handleAuthError: false to inspect the status instead.
async function authFetch(url, options = {}, { handleAuthError = true } = {}) {
    const response = await fetch(url, {
        ...options,
        headers: {
            ...(options.headers || {}),
            'Authorization': `Bearer ${token}`
        }
    });

    if (handleAuthError && (response.status === 401 || response.status === 403)) {
        alert('Session expired. Please login again.');
        logout();
        return null;
    }

    return response;
}
