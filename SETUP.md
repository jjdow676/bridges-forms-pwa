# Bridges Forms PWA Setup Guide

## Overview
This PWA allows staff to quickly access Interest, Application, and Enrollment forms with participant pre-fill capability.

## App Flow
1. **Select Form Type** - Choose Interest, Application, or Enrollment
2. **Search Participant** (Application/Enrollment only) - Search by name to pre-fill
3. **Launch Form** - Opens the form in a new tab

## Deployment Steps

### Step 1: Deploy Apex REST Service
The `ContactSearchRestService` class provides the contact search API.

```bash
sf project deploy start --source-dir force-app/main/default/classes/ContactSearchRestService.cls --source-dir force-app/main/default/classes/ContactSearchRestServiceTest.cls
```

### Step 2: Configure Experience Cloud Site

1. **Go to Setup** > Experience Cloud > All Sites
2. **Open** the "forms" site in Experience Builder
3. **Go to** Settings > Security & Privacy
4. **Add** the Apex class `ContactSearchRestService` to the "Guest User Profile" access

To expose the REST endpoint publicly:

1. Go to **Setup** > Sites > forms
2. Under **Public Access Settings**, click on the guest user profile
3. Add `ContactSearchRestService` to the Apex Class Access
4. Under **Setup** > Guest User Sharing, ensure Contact object has appropriate sharing rules

### Step 3: Host the PWA

#### Option A: Static Resource in Salesforce
1. Zip the contents of `pwa-forms-app/` folder
2. Upload as a Static Resource named `BridgesFormsPWA`
3. Access via: `https://bridgestowork.my.site.com/forms/resource/BridgesFormsPWA`

#### Option B: Separate Web Hosting (Recommended)
Host on any static hosting service:
- **Netlify**: Drag & drop the folder
- **Vercel**: Connect to repo or upload
- **GitHub Pages**: Push to gh-pages branch
- **Azure Static Web Apps**: Deploy from VS Code

After hosting, update the `CONFIG.apiUrl` in `app.js` to match the actual endpoint URL.

### Step 4: Generate App Icons

Replace the placeholder icon with a proper Bridges logo:

1. Create a 512x512 PNG logo
2. Use a tool like https://realfavicongenerator.net/ to generate all sizes
3. Replace files in the `icons/` folder

### Step 5: Test the PWA

1. Open the hosted PWA URL in Chrome
2. Select a form type (Application or Enrollment)
3. Search for a participant name
4. Verify the form opens with pre-filled data
5. Test the "Install" prompt to add to home screen

## Form URLs

| Form | URL | Pre-fill Support |
|------|-----|------------------|
| Interest | `/bridges-interest` | No |
| Application | `/bridges-application?contactId=XXX` | Yes |
| Enrollment | `/bridges-enrollment?contactId=XXX` | Yes |

## API Endpoint

**Search Contacts**
```
GET /services/apexrest/contactsearch?searchTerm={name}
```

**Response**
```json
[
  {
    "contactId": "003XXXXXXXXXXXX",
    "name": "John Smith",
    "email": "john@example.com"
  }
]
```

## Troubleshooting

### Search not returning results
- Verify the guest user profile has access to ContactSearchRestService
- Check that Contact sharing rules allow guest access
- Ensure CORS is configured for your PWA domain

### Forms not pre-filling
- Verify the contactId parameter is being passed correctly
- Check browser console for errors
- Ensure the form's BridgesFormController has getContactData access

### PWA not installable
- Must be served over HTTPS
- manifest.json must be valid
- Service worker must be registered
