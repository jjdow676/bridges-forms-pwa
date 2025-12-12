/**
 * Bridges Forms PWA
 * Quick access to Interest, Application, and Enrollment forms
 */

// Configuration
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
    forms: {
        interest: {
            name: 'Interest Form',
            path: '/interest-form',
            supportsPreFill: false
        },
        application: {
            name: 'Application Form',
            path: '/bridges-application',
            supportsPreFill: true,
            requiresContact: false
        },
        enrollment: {
            name: 'Enrollment Form',
            path: '/bridges-enrollment',
            supportsPreFill: true,
            requiresContact: true
        }
    },
    searchDebounceMs: 300,
    minSearchLength: 2
};

// App State
const state = {
    selectedSite: null,
    selectedForm: null,
    selectedContact: null,
    searchTimeout: null
};

// DOM Elements
const elements = {
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
    dismissInstall: document.getElementById('dismiss-install')
};

// Navigation
function showStep(stepId) {
    document.querySelectorAll('.step').forEach(step => step.classList.remove('active'));
    document.getElementById(stepId).classList.add('active');
}

function goToSiteSelect() {
    state.selectedSite = null;
    state.selectedForm = null;
    state.selectedContact = null;
    elements.searchInput.value = '';
    elements.searchResults.innerHTML = '';
    // Clear site button selection
    elements.siteGrid.querySelectorAll('.site-btn').forEach(btn => btn.classList.remove('selected'));
    showStep('step-site-select');
}

function goToFormSelect() {
    state.selectedForm = null;
    state.selectedContact = null;
    elements.searchInput.value = '';
    elements.searchResults.innerHTML = '';
    showStep('step-form-select');
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

// Site Selection
function handleSiteSelect(site, buttonElement) {
    state.selectedSite = site;
    // Highlight selected button
    elements.siteGrid.querySelectorAll('.site-btn').forEach(btn => btn.classList.remove('selected'));
    buttonElement.classList.add('selected');
    // Move to form selection
    goToFormSelect();
}

// Form Selection
function handleFormSelect(formType) {
    state.selectedForm = formType;
    const formConfig = CONFIG.forms[formType];

    // Interest form doesn't support pre-fill, launch directly
    if (!formConfig.supportsPreFill) {
        launchFormDirect();
    } else {
        goToSearch();
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

// Search
async function searchContacts(searchTerm) {
    if (searchTerm.length < CONFIG.minSearchLength) {
        elements.searchResults.innerHTML = '';
        return;
    }

    elements.searchSpinner.classList.add('active');

    try {
        // Build URL with search term and site filter
        let url = `${CONFIG.apiUrl}?searchTerm=${encodeURIComponent(searchTerm)}`;
        if (state.selectedSite) {
            url += `&site=${encodeURIComponent(state.selectedSite)}`;
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
        return `
            <div class="search-result-item" data-id="${contact.contactId}" data-name="${escapeHtml(contact.name)}" data-email="${escapeHtml(contact.email || '')}">
                <div class="result-avatar">${initials}</div>
                <div class="result-info">
                    <div class="result-name">${escapeHtml(contact.name)}</div>
                    <div class="result-email">${escapeHtml(contact.email || 'No email')}</div>
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

// Launch Form
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

// Utilities
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

// PWA Install
let deferredPrompt = null;

function handleInstallPrompt(event) {
    event.preventDefault();
    deferredPrompt = event;

    // Check if already dismissed
    if (localStorage.getItem('installDismissed')) {
        return;
    }

    elements.installPrompt.classList.remove('hidden');
}

async function installApp() {
    if (!deferredPrompt) return;

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;

    if (outcome === 'accepted') {
        console.log('App installed');
    }

    deferredPrompt = null;
    elements.installPrompt.classList.add('hidden');
}

function dismissInstall() {
    localStorage.setItem('installDismissed', 'true');
    elements.installPrompt.classList.add('hidden');
}

// Render Site Grid
function renderSiteGrid() {
    const html = CONFIG.sites.map(site =>
        `<button class="site-btn" data-site="${escapeHtml(site)}">${escapeHtml(site)}</button>`
    ).join('');
    elements.siteGrid.innerHTML = html;

    // Add click handlers
    elements.siteGrid.querySelectorAll('.site-btn').forEach(btn => {
        btn.addEventListener('click', () => handleSiteSelect(btn.dataset.site, btn));
    });
}

// Event Listeners
function initEventListeners() {
    // Render site buttons
    renderSiteGrid();

    // Form card selection
    elements.formCards.forEach(card => {
        card.addEventListener('click', () => handleFormSelect(card.dataset.form));
    });

    // Navigation
    elements.backToSites.addEventListener('click', goToSiteSelect);
    elements.backToForms.addEventListener('click', goToFormSelect);
    elements.backToSearch.addEventListener('click', goToSearch);

    // Search
    elements.searchInput.addEventListener('input', handleSearchInput);
    elements.skipSearchBtn.addEventListener('click', goToConfirm);

    // Launch
    elements.launchFormBtn.addEventListener('click', launchForm);

    // PWA Install
    window.addEventListener('beforeinstallprompt', handleInstallPrompt);
    elements.installBtn.addEventListener('click', installApp);
    elements.dismissInstall.addEventListener('click', dismissInstall);
}

// Service Worker Registration
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

// Initialize
function init() {
    initEventListeners();
    registerServiceWorker();
}

// Start app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
