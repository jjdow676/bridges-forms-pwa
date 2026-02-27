/**
 * Bridges Forms PWA
 * Quick access to Interest, Application, and Enrollment forms
 * With Microsoft SSO Authentication (only for forms requiring participant search)
 */

// ======================
// Microsoft SSO Configuration
// ======================
const msalConfig = {
    auth: {
        clientId: 'b734621f-54bd-40ca-ac79-09f78c143df5',
        // Bridges organization tenant
        authority: 'https://login.microsoftonline.com/bridgestowork.org',
        // Azure Static Web Apps redirect URI
        redirectUri: window.location.origin + window.location.pathname,
        postLogoutRedirectUri: window.location.origin + window.location.pathname
    },
    cache: {
        cacheLocation: 'localStorage',
        storeAuthStateInCookie: false
    }
};

// Login request scopes
const loginRequest = {
    scopes: ['openid', 'profile', 'email']
};

// MSAL instance (initialized after DOM ready)
let msalInstance = null;

// Authentication state
const authState = {
    isAuthenticated: false,
    user: null
};

// ======================
// App Configuration
// ======================
const CONFIG = {
    // Base URL for Experience Cloud site
    baseUrl: 'https://bridgestowork.my.site.com/forms/s',
    // API endpoint for contact search (will be exposed via Experience Cloud)
    apiUrl: 'https://bridgestowork.my.site.com/forms/services/apexrest/contactsearch',
    // Available sites (from External_Form_Site__mdt)
    sites: [
        'Atlanta',
        'Boston',
        'Chicago',
        'Dallas',
        'Fort Worth',
        'Los Angeles',
        'New York City',
        'Oakland',
        'Philadelphia',
        'Richmond',
        'San Francisco'
    ],
    // Form paths
    // requiresAuth: true means authentication is required to access search
    forms: {
        interest: {
            name: 'Interest Form',
            path: '/interest-form',
            supportsPreFill: false,
            requiresAuth: false,  // No auth needed - opens directly
            category: 'participant'
        },
        application: {
            name: 'Application Form',
            path: '/bridges-application',
            supportsPreFill: true,
            requiresAuth: true,   // Auth needed for participant search
            requiresContact: false,
            category: 'participant',
            programTypeFilter: 'jobPlacement'  // Filter by Job Placement programs
        },
        enrollment: {
            name: 'Enrollment Form',
            path: '/bridges-enrollment',
            supportsPreFill: true,
            requiresAuth: true,   // Auth always required (needs contact)
            requiresContact: true,
            category: 'participant',
            programTypeFilter: 'jobPlacement'  // Filter by Job Placement programs
        },
        preEtsInterest: {
            name: 'Pre-ETS Interest Form',
            path: '/pre-ets-interest-form',
            supportsPreFill: false,
            requiresAuth: false,  // No auth needed - opens directly
            category: 'other'
        },
        educationalPlacement: {
            name: 'Educational Placement Form',
            path: '/educational-placement-interest-form',
            supportsPreFill: false,
            requiresAuth: false,  // No auth needed - opens directly
            category: 'other'
        },
        mipApplication: {
            name: 'MIP Application Form',
            path: '/mip-application',
            supportsPreFill: false,
            requiresAuth: false,  // No auth needed - opens directly
            category: 'other'
        }
    },
    searchDebounceMs: 300,
    minSearchLength: 2,
    // Site-based form visibility (forms in "Other Forms" section)
    siteFormRules: {
        preEtsInterest: ['Atlanta', 'New York City', 'Philadelphia'],
        educationalPlacement: ['Oakland', 'Richmond', 'San Francisco'],
        mipApplication: ['New York City']
    },
    // Allowed email domain for authentication
    allowedDomain: 'bridgestowork.org'
};

// App State
const state = {
    selectedSite: null,
    selectedForm: null,
    selectedContact: null,
    searchTimeout: null,
    pendingFormType: null  // Store form type when auth is needed
};

// DOM Elements (will be populated after DOM ready)
let elements = {};

// ======================
// Authentication Functions
// ======================

// Detect if running in an environment where popups are blocked:
// installed PWA, Nativefier/Electron desktop app, etc.
function isStandaloneMode() {
    return window.matchMedia('(display-mode: standalone)').matches
        || window.navigator.standalone === true
        || navigator.userAgent.includes('Electron')
        || typeof nativefier !== 'undefined';
}

async function initializeMsal() {
    try {
        // Check if MSAL library is loaded
        if (typeof msal === 'undefined') {
            console.error('MSAL library not loaded. Authentication will not work.');
            return;
        }

        msalInstance = new msal.PublicClientApplication(msalConfig);
        await msalInstance.initialize();
        console.log('MSAL initialized successfully');

        // Handle redirect callback
        const response = await msalInstance.handleRedirectPromise();
        if (response) {
            handleAuthResponse(response);
        } else {
            // Check for existing session and silently refresh token
            const accounts = msalInstance.getAllAccounts();
            if (accounts.length > 0) {
                const account = accounts[0];
                // Verify domain
                if (isAllowedDomain(account.username)) {
                    msalInstance.setActiveAccount(account);
                    // Silently refresh the token to keep the session alive
                    // This uses the refresh token (valid ~90 days) to get a new access token
                    try {
                        await msalInstance.acquireTokenSilent({
                            scopes: loginRequest.scopes,
                            account: account
                        });
                    } catch (silentError) {
                        console.log('Silent token refresh failed, session may require re-auth');
                    }
                    authState.isAuthenticated = true;
                    authState.user = account;
                    updateHeaderForAuth();
                }
            }
        }
    } catch (error) {
        console.error('MSAL initialization error:', error);
        msalInstance = null;
    }
}

function isAllowedDomain(email) {
    if (!email) return false;
    const domain = email.split('@')[1];
    return domain && domain.toLowerCase() === CONFIG.allowedDomain.toLowerCase();
}

async function signIn(pendingFormType = null) {
    state.pendingFormType = pendingFormType;

    // Persist pending form type for redirect flow (page reloads during redirect)
    if (pendingFormType) {
        sessionStorage.setItem('pendingFormType', pendingFormType);
    }
    if (state.selectedSite) {
        sessionStorage.setItem('pendingSite', state.selectedSite);
    }

    // Check if MSAL is initialized
    if (!msalInstance) {
        console.error('MSAL not initialized. Attempting to reinitialize...');
        await initializeMsal();
        if (!msalInstance) {
            showLoginError('Authentication service unavailable. Please refresh the page.');
            return;
        }
    }

    try {
        // Show loading state on login screen if visible
        const loginBtn = document.getElementById('login-btn');
        if (loginBtn) {
            loginBtn.disabled = true;
            loginBtn.innerHTML = 'Signing in...';
        }

        // Use redirect in standalone/installed PWA mode (popups are blocked),
        // popup in regular browser mode
        if (isStandaloneMode()) {
            await msalInstance.loginRedirect(loginRequest);
            // Page will redirect — no code runs after this
            return;
        }

        const response = await msalInstance.loginPopup(loginRequest);
        handleAuthResponse(response);
    } catch (error) {
        console.error('Login error:', error);
        // Reset button
        const loginBtn = document.getElementById('login-btn');
        if (loginBtn) {
            loginBtn.disabled = false;
            loginBtn.innerHTML = `
                <svg class="microsoft-logo" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg">
                    <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
                    <rect x="11" y="1" width="9" height="9" fill="#7fba00"/>
                    <rect x="1" y="11" width="9" height="9" fill="#00a4ef"/>
                    <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
                </svg>
                Sign in with Microsoft
            `;
        }

        if (error.errorCode === 'user_cancelled') {
            // User cancelled, go back to form selection
            state.pendingFormType = null;
            return;
        }

        // Popup blocked/failed — fall back to redirect auth automatically
        if (error.errorCode === 'popup_window_error' || error.errorCode === 'popup_blocked') {
            console.log('Popup blocked, falling back to redirect auth');
            await msalInstance.loginRedirect(loginRequest);
            return;
        }

        showLoginError('Sign in failed. Please try again.');
    }
}

function handleAuthResponse(response) {
    if (response && response.account) {
        const account = response.account;

        // Verify domain
        if (isAllowedDomain(account.username)) {
            authState.isAuthenticated = true;
            authState.user = account;
            msalInstance.setActiveAccount(account);

            // Hide login screen if showing
            hideLoginScreen();
            updateHeaderForAuth();

            // Restore pending state from sessionStorage (redirect flow reloads the page)
            if (!state.pendingFormType) {
                state.pendingFormType = sessionStorage.getItem('pendingFormType');
            }
            if (!state.selectedSite) {
                state.selectedSite = sessionStorage.getItem('pendingSite');
            }
            // Clean up
            sessionStorage.removeItem('pendingFormType');
            sessionStorage.removeItem('pendingSite');

            // If there was a pending form, continue to search
            if (state.pendingFormType) {
                state.selectedForm = state.pendingFormType;
                state.pendingFormType = null;
                goToSearch();
            }
        } else {
            // Wrong domain
            signOut();
            showLoginError('Only @bridgestowork.org accounts are allowed. You signed in with: ' + account.username);
        }
    }
}

async function signOut() {
    try {
        authState.isAuthenticated = false;
        authState.user = null;

        const accounts = msalInstance.getAllAccounts();
        if (accounts.length > 0) {
            const logoutOptions = {
                account: accounts[0],
                postLogoutRedirectUri: window.location.origin + window.location.pathname
            };

            // Use redirect in standalone/installed PWA mode (popups are blocked)
            if (isStandaloneMode()) {
                await msalInstance.logoutRedirect(logoutOptions);
                return;
            }

            await msalInstance.logoutPopup(logoutOptions);
        }

        updateHeaderForAuth();
        goToSiteSelect();
    } catch (error) {
        console.error('Logout error:', error);
        // Clear only MSAL-related storage, not all localStorage
        const keysToRemove = Object.keys(localStorage).filter(key =>
            key.startsWith('msal.') || key.includes('login.windows.net')
        );
        keysToRemove.forEach(key => localStorage.removeItem(key));
        updateHeaderForAuth();
        goToSiteSelect();
    }
}

function showLoginScreen() {
    const loginScreen = document.getElementById('login-screen');
    if (loginScreen) {
        loginScreen.classList.add('active');
        // Clear any previous errors
        const errorEl = loginScreen.querySelector('.login-error');
        if (errorEl) errorEl.style.display = 'none';
    }
}

function hideLoginScreen() {
    const loginScreen = document.getElementById('login-screen');
    if (loginScreen) loginScreen.classList.remove('active');
}

function updateHeaderForAuth() {
    const userName = document.getElementById('user-name');
    const logoutBtn = document.getElementById('logout-btn');

    if (authState.isAuthenticated && authState.user) {
        const displayName = authState.user.name || authState.user.username.split('@')[0];
        if (userName) userName.textContent = displayName;
        if (logoutBtn) logoutBtn.style.display = 'block';
    } else {
        if (userName) userName.textContent = '';
        if (logoutBtn) logoutBtn.style.display = 'none';
    }
}

function showLoginError(message) {
    const loginScreen = document.getElementById('login-screen');
    if (!loginScreen) return;

    let errorEl = loginScreen.querySelector('.login-error');
    if (!errorEl) {
        errorEl = document.createElement('p');
        errorEl.className = 'login-error';
        const loginBtn = document.getElementById('login-btn');
        if (loginBtn) {
            loginBtn.parentNode.insertBefore(errorEl, loginBtn.nextSibling);
        }
    }

    errorEl.textContent = message;
    errorEl.style.display = 'block';
}

// ======================
// Navigation Functions
// ======================

function showStep(stepId) {
    document.querySelectorAll('.step').forEach(step => step.classList.remove('active'));
    document.getElementById(stepId).classList.add('active');
}

function goToSiteSelect() {
    state.selectedSite = null;
    state.selectedForm = null;
    state.selectedContact = null;
    if (elements.searchInput) elements.searchInput.value = '';
    if (elements.searchResults) elements.searchResults.innerHTML = '';
    // Clear site button selection
    if (elements.siteGrid) {
        elements.siteGrid.querySelectorAll('.site-btn').forEach(btn => btn.classList.remove('selected'));
    }
    showStep('step-site-select');
}

function goToFormSelect() {
    state.selectedForm = null;
    state.selectedContact = null;
    if (elements.searchInput) elements.searchInput.value = '';
    if (elements.searchResults) elements.searchResults.innerHTML = '';
    // Update form visibility based on selected site
    updateOtherFormsVisibility();
    showStep('step-form-select');
}

// Update Other Forms section visibility based on selected site
function updateOtherFormsVisibility() {
    const site = state.selectedSite;
    const rules = CONFIG.siteFormRules;

    // Check which forms should be visible for this site
    const showPreEts = rules.preEtsInterest.includes(site);
    const showEducational = rules.educationalPlacement.includes(site);
    const showMip = rules.mipApplication.includes(site);

    // Show/hide individual cards
    if (elements.preEtsCard) {
        elements.preEtsCard.style.display = showPreEts ? 'flex' : 'none';
    }
    if (elements.educationalPlacementCard) {
        elements.educationalPlacementCard.style.display = showEducational ? 'flex' : 'none';
    }
    if (elements.mipApplicationCard) {
        elements.mipApplicationCard.style.display = showMip ? 'flex' : 'none';
    }

    // Show/hide the entire Other Forms section if no forms apply
    if (elements.otherFormsSection) {
        if (showPreEts || showEducational || showMip) {
            elements.otherFormsSection.classList.remove('hidden');
        } else {
            elements.otherFormsSection.classList.add('hidden');
        }
    }
}

function goToSearch() {
    state.selectedContact = null;
    elements.searchInput.value = '';
    elements.searchResults.innerHTML = '';
    elements.selectedFormName.textContent = CONFIG.forms[state.selectedForm].name;
    elements.selectedSiteName.textContent = state.selectedSite;

    // Hide skip button if contact is required (Enrollment form)
    const formConfig = CONFIG.forms[state.selectedForm];
    if (formConfig.requiresContact) {
        elements.skipSearchBtn.style.display = 'none';
    } else {
        elements.skipSearchBtn.style.display = 'block';
    }

    showStep('step-search');
    elements.searchInput.focus();
}

function goToConfirm() {
    const formConfig = CONFIG.forms[state.selectedForm];

    elements.confirmSite.textContent = state.selectedSite;
    elements.confirmForm.textContent = formConfig.name;

    if (state.selectedContact) {
        elements.confirmParticipant.textContent = state.selectedContact.name;
        elements.confirmParticipantRow.style.display = 'flex';

        if (state.selectedContact.email) {
            elements.confirmEmail.textContent = state.selectedContact.email;
            elements.confirmEmailRow.style.display = 'flex';
        } else {
            elements.confirmEmailRow.style.display = 'none';
        }
    } else {
        elements.confirmParticipantRow.style.display = 'none';
        elements.confirmEmailRow.style.display = 'none';
    }

    showStep('step-confirm');
}

// ======================
// Site & Form Selection
// ======================

function handleSiteSelect(site, buttonElement) {
    state.selectedSite = site;
    // Highlight selected button
    elements.siteGrid.querySelectorAll('.site-btn').forEach(btn => btn.classList.remove('selected'));
    buttonElement.classList.add('selected');
    // Move to form selection
    goToFormSelect();
}

function handleFormSelect(formType) {
    const formConfig = CONFIG.forms[formType];

    // Forms that don't support pre-fill launch directly (no auth needed)
    if (!formConfig.supportsPreFill) {
        state.selectedForm = formType;
        launchFormDirect();
        return;
    }

    // Forms that always require contact (Enrollment) - must authenticate
    if (formConfig.requiresContact) {
        if (!authState.isAuthenticated) {
            showLoginScreen();
            state.pendingFormType = formType;
            return;
        }
        state.selectedForm = formType;
        goToSearch();
        return;
    }

    // Forms that support optional pre-fill (Application) - show choice
    if (formConfig.supportsPreFill && !formConfig.requiresContact) {
        state.selectedForm = formType;
        showSearchChoice();
        return;
    }

    // Fallback - go to search if authenticated
    state.selectedForm = formType;
    goToSearch();
}

// Show search choice screen (for Application form)
function showSearchChoice() {
    const formConfig = CONFIG.forms[state.selectedForm];
    elements.choiceFormName.textContent = formConfig.name;
    showStep('step-search-choice');
}

// Handle choice to search for participant (requires auth)
function handleChoiceSearch() {
    if (!authState.isAuthenticated) {
        showLoginScreen();
        state.pendingFormType = state.selectedForm;
        return;
    }
    goToSearch();
}

// Handle choice to open blank form (no auth needed)
function handleChoiceBlank() {
    launchFormDirect();
}

function goToSearchChoice() {
    showStep('step-search-choice');
}

// Handle back button from search - go to choice screen for Application, form select for others
function handleBackToForms() {
    const formConfig = CONFIG.forms[state.selectedForm];
    // If coming from a form with optional pre-fill (Application), go back to choice
    if (formConfig && formConfig.supportsPreFill && !formConfig.requiresContact) {
        goToSearchChoice();
    } else {
        goToFormSelect();
    }
}

// Launch form directly without confirm screen (for Interest form)
function launchFormDirect() {
    const formConfig = CONFIG.forms[state.selectedForm];
    let url = CONFIG.baseUrl + formConfig.path;

    // Add site parameter to pre-populate the site field
    if (state.selectedSite) {
        url += `?site=${encodeURIComponent(state.selectedSite)}`;
    }

    // Open in new tab/window
    window.open(url, '_blank');

    // Reset to site selection after a brief delay
    setTimeout(() => {
        goToSiteSelect();
    }, 500);
}

// ======================
// Search Functions
// ======================

async function searchContacts(searchTerm) {
    if (searchTerm.length < CONFIG.minSearchLength) {
        elements.searchResults.innerHTML = '';
        return;
    }

    elements.searchSpinner.classList.add('active');

    try {
        // Build URL with search term, site filter, and program type filter
        let url = `${CONFIG.apiUrl}?searchTerm=${encodeURIComponent(searchTerm)}`;
        if (state.selectedSite) {
            url += `&site=${encodeURIComponent(state.selectedSite)}`;
        }

        // Add program type filter if the form requires it
        const formConfig = CONFIG.forms[state.selectedForm];
        if (formConfig && formConfig.programTypeFilter) {
            url += `&programType=${encodeURIComponent(formConfig.programTypeFilter)}`;
        }

        const response = await fetch(
            url,
            {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                }
            }
        );

        if (!response.ok) {
            throw new Error('Search failed');
        }

        const results = await response.json();
        displaySearchResults(results);
    } catch (error) {
        console.error('Search error:', error);
        elements.searchResults.innerHTML = `
            <div class="no-results">
                <p>Unable to search. Please check your connection and try again.</p>
            </div>
        `;
    } finally {
        elements.searchSpinner.classList.remove('active');
    }
}

function displaySearchResults(results) {
    if (!results || results.length === 0) {
        elements.searchResults.innerHTML = `
            <div class="no-results">
                <p>No participants found. Try a different search or skip to open a blank form.</p>
            </div>
        `;
        return;
    }

    const html = results.map(contact => {
        const initials = getInitials(contact.name);
        const birthdateDisplay = contact.birthdate ? formatBirthdate(contact.birthdate) : '';
        return `
            <div class="search-result-item" data-id="${contact.contactId}" data-name="${escapeHtml(contact.name)}" data-email="${escapeHtml(contact.email || '')}">
                <div class="result-avatar">${initials}</div>
                <div class="result-info">
                    <div class="result-name">${escapeHtml(contact.name)}</div>
                    <div class="result-details">
                        <span class="result-email">${escapeHtml(contact.email || 'No email')}</span>
                        ${birthdateDisplay ? `<span class="result-birthdate">DOB: ${birthdateDisplay}</span>` : ''}
                    </div>
                </div>
            </div>
        `;
    }).join('');

    elements.searchResults.innerHTML = html;

    // Add click handlers
    elements.searchResults.querySelectorAll('.search-result-item').forEach(item => {
        item.addEventListener('click', () => handleContactSelect(item));
    });
}

// Format birthdate from YYYY-MM-DD to MM/DD/YYYY
function formatBirthdate(dateString) {
    if (!dateString) return '';
    const parts = dateString.split('-');
    if (parts.length !== 3) return dateString;
    return `${parts[1]}/${parts[2]}/${parts[0]}`;
}

function handleContactSelect(item) {
    state.selectedContact = {
        id: item.dataset.id,
        name: item.dataset.name,
        email: item.dataset.email
    };
    goToConfirm();
}

function handleSearchInput(event) {
    const searchTerm = event.target.value.trim();

    // Clear existing timeout
    if (state.searchTimeout) {
        clearTimeout(state.searchTimeout);
    }

    if (searchTerm.length < CONFIG.minSearchLength) {
        elements.searchResults.innerHTML = '';
        return;
    }

    // Debounce search
    state.searchTimeout = setTimeout(() => {
        searchContacts(searchTerm);
    }, CONFIG.searchDebounceMs);
}

// ======================
// Launch Form
// ======================

function launchForm() {
    const formConfig = CONFIG.forms[state.selectedForm];
    let url = CONFIG.baseUrl + formConfig.path;
    let params = [];

    // Add contactId parameter if a contact was selected
    if (state.selectedContact && formConfig.supportsPreFill) {
        params.push(`contactId=${state.selectedContact.id}`);
    }

    // Add site parameter to pre-populate the site field
    if (state.selectedSite) {
        params.push(`site=${encodeURIComponent(state.selectedSite)}`);
    }

    // Append query string if we have parameters
    if (params.length > 0) {
        url += '?' + params.join('&');
    }

    // Open in new tab/window
    window.open(url, '_blank');

    // Reset to form selection after a brief delay
    setTimeout(() => {
        goToFormSelect();
    }, 500);
}

// ======================
// Utilities
// ======================

function getInitials(name) {
    if (!name) return '?';
    const parts = name.split(' ').filter(p => p.length > 0);
    if (parts.length >= 2) {
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ======================
// PWA Install Functions
// ======================

let deferredPrompt = null;

function isAppInstalled() {
    if (window.matchMedia('(display-mode: standalone)').matches) {
        return true;
    }
    if (window.navigator.standalone === true) {
        return true;
    }
    return false;
}

function shouldShowInstallPrompt() {
    if (isAppInstalled()) {
        return false;
    }
    const dismissedTime = localStorage.getItem('installDismissedTime');
    if (dismissedTime) {
        const daysSinceDismissed = (Date.now() - parseInt(dismissedTime)) / (1000 * 60 * 60 * 24);
        if (daysSinceDismissed < 7) {
            return false;
        }
    }
    return true;
}

function handleInstallPrompt(event) {
    event.preventDefault();
    deferredPrompt = event;

    if (shouldShowInstallPrompt()) {
        setTimeout(() => {
            showInstallBanner();
        }, 1500);
    }
}

function showInstallBanner() {
    if (deferredPrompt && shouldShowInstallPrompt() && elements.installBanner) {
        elements.installBanner.classList.remove('hidden');
        if (elements.installPrompt) {
            elements.installPrompt.classList.add('hidden');
        }
    }
}

async function installApp() {
    if (!deferredPrompt) return;

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;

    if (outcome === 'accepted') {
        console.log('App installed');
        localStorage.removeItem('installDismissedTime');
    }

    deferredPrompt = null;
    if (elements.installBanner) elements.installBanner.classList.add('hidden');
    if (elements.installPrompt) elements.installPrompt.classList.add('hidden');
}

function dismissInstallBanner() {
    localStorage.setItem('installDismissedTime', Date.now().toString());
    if (elements.installBanner) elements.installBanner.classList.add('hidden');
}

function dismissInstall() {
    localStorage.setItem('installDismissedTime', Date.now().toString());
    if (elements.installPrompt) elements.installPrompt.classList.add('hidden');
}

function checkiOSInstall() {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const isInStandaloneMode = window.navigator.standalone === true;

    if (isIOS && !isInStandaloneMode && shouldShowInstallPrompt()) {
        setTimeout(() => {
            if (!deferredPrompt && elements.installBanner) {
                elements.installBanner.classList.remove('hidden');
                const bannerText = elements.installBanner.querySelector('.install-banner-text p');
                if (bannerText) {
                    bannerText.textContent = 'Tap the share button and select "Add to Home Screen"';
                }
                if (elements.installBannerBtn) {
                    elements.installBannerBtn.textContent = 'How to Install';
                    elements.installBannerBtn.onclick = showIOSInstructions;
                }
            }
        }, 2000);
    }
}

function showIOSInstructions() {
    alert('To install Bridges Forms:\n\n1. Tap the Share button (square with arrow)\n2. Scroll down and tap "Add to Home Screen"\n3. Tap "Add" to confirm\n\nThe app will appear on your home screen!');
}

// ======================
// Render Functions
// ======================

function renderSiteGrid() {
    const html = CONFIG.sites.map(site =>
        `<button class="site-btn" data-site="${escapeHtml(site)}">${escapeHtml(site)}</button>`
    ).join('');
    elements.siteGrid.innerHTML = html;

    elements.siteGrid.querySelectorAll('.site-btn').forEach(btn => {
        btn.addEventListener('click', () => handleSiteSelect(btn.dataset.site, btn));
    });
}

// ======================
// Initialization
// ======================

function initDOMElements() {
    elements = {
        stepSiteSelect: document.getElementById('step-site-select'),
        stepFormSelect: document.getElementById('step-form-select'),
        stepSearch: document.getElementById('step-search'),
        stepConfirm: document.getElementById('step-confirm'),
        siteGrid: document.getElementById('site-grid'),
        formCards: document.querySelectorAll('.form-card'),
        backToSites: document.getElementById('back-to-sites'),
        backToForms: document.getElementById('back-to-forms'),
        backToSearch: document.getElementById('back-to-search'),
        selectedFormName: document.getElementById('selected-form-name'),
        selectedSiteName: document.getElementById('selected-site-name'),
        searchInput: document.getElementById('search-input'),
        searchSpinner: document.getElementById('search-spinner'),
        searchResults: document.getElementById('search-results'),
        skipSearchBtn: document.getElementById('skip-search-btn'),
        confirmSite: document.getElementById('confirm-site'),
        confirmForm: document.getElementById('confirm-form'),
        confirmParticipant: document.getElementById('confirm-participant'),
        confirmParticipantRow: document.getElementById('confirm-participant-row'),
        confirmEmail: document.getElementById('confirm-email'),
        confirmEmailRow: document.getElementById('confirm-email-row'),
        launchFormBtn: document.getElementById('launch-form-btn'),
        installPrompt: document.getElementById('install-prompt'),
        installBtn: document.getElementById('install-btn'),
        dismissInstall: document.getElementById('dismiss-install'),
        installBanner: document.getElementById('install-banner'),
        installBannerBtn: document.getElementById('install-banner-btn'),
        dismissBanner: document.getElementById('dismiss-banner'),
        otherFormsSection: document.getElementById('other-forms-section'),
        preEtsCard: document.getElementById('preEtsCard'),
        educationalPlacementCard: document.getElementById('educationalPlacementCard'),
        mipApplicationCard: document.getElementById('mipApplicationCard'),
        // Auth elements
        loginScreen: document.getElementById('login-screen'),
        loginBtn: document.getElementById('login-btn'),
        logoutBtn: document.getElementById('logout-btn'),
        userName: document.getElementById('user-name'),
        // Search choice elements
        stepSearchChoice: document.getElementById('step-search-choice'),
        choiceFormName: document.getElementById('choice-form-name'),
        choiceSearchBtn: document.getElementById('choice-search-btn'),
        choiceBlankBtn: document.getElementById('choice-blank-btn'),
        backToFormsFromChoice: document.getElementById('back-to-forms-from-choice')
    };
}

function initEventListeners() {
    // Form card selection
    elements.formCards.forEach(card => {
        card.addEventListener('click', () => handleFormSelect(card.dataset.form));
    });

    // Navigation
    elements.backToSites.addEventListener('click', goToSiteSelect);
    elements.backToForms.addEventListener('click', handleBackToForms);
    elements.backToSearch.addEventListener('click', goToSearch);

    // Search choice screen navigation
    if (elements.backToFormsFromChoice) {
        elements.backToFormsFromChoice.addEventListener('click', goToFormSelect);
    }
    if (elements.choiceSearchBtn) {
        elements.choiceSearchBtn.addEventListener('click', handleChoiceSearch);
    }
    if (elements.choiceBlankBtn) {
        elements.choiceBlankBtn.addEventListener('click', handleChoiceBlank);
    }

    // Search
    elements.searchInput.addEventListener('input', handleSearchInput);
    elements.skipSearchBtn.addEventListener('click', goToConfirm);

    // Launch
    elements.launchFormBtn.addEventListener('click', launchForm);

    // PWA Install
    window.addEventListener('beforeinstallprompt', handleInstallPrompt);
    if (elements.installBtn) elements.installBtn.addEventListener('click', installApp);
    if (elements.dismissInstall) elements.dismissInstall.addEventListener('click', dismissInstall);
    if (elements.installBannerBtn) elements.installBannerBtn.addEventListener('click', installApp);
    if (elements.dismissBanner) elements.dismissBanner.addEventListener('click', dismissInstallBanner);

    // Check for iOS install prompt
    checkiOSInstall();
}

async function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        try {
            const registration = await navigator.serviceWorker.register('sw.js');
            console.log('Service Worker registered:', registration.scope);
        } catch (error) {
            console.error('Service Worker registration failed:', error);
        }
    }
}

async function init() {
    // Initialize DOM elements
    initDOMElements();

    // Render site buttons
    renderSiteGrid();

    // Set up event listeners
    initEventListeners();

    // Set up login button
    if (elements.loginBtn) {
        elements.loginBtn.addEventListener('click', () => signIn(state.pendingFormType));
    }

    // Set up logout button
    if (elements.logoutBtn) {
        elements.logoutBtn.addEventListener('click', signOut);
        elements.logoutBtn.style.display = 'none'; // Hide by default
    }

    // Register service worker
    await registerServiceWorker();

    // Initialize MSAL (will check for existing session)
    await initializeMsal();

    // Show the app (site selection) - no login required initially
    showStep('step-site-select');
}

// Start app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
