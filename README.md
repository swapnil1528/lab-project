# Arogya Laboratory Information System (LIS)
> Complete Google Workspace-based Laboratory Information System for Pathology Diagnostic Labs in India.

Built exclusively using:
- **Google Sheets** as the transactional relational database & storage.
- **Google Apps Script (V8 runtime)** as the serverless backend & business logic engine.
- **HtmlService** as the responsive, tablet-friendly Single Page Application (SPA).
- **Google Docs & Google Drive** for template-based, pixel-perfect medical report & invoice PDF generation.
- **GmailApp / MailApp** & **WhatsApp Click-to-Chat** for seamless omnichannel patient report delivery.
- **Zero external paid services or third-party servers.** Fully aligned with the **Digital Personal Data Protection Act (DPDP Act 2023)**.

---

## 1. System Architecture & Relational Schema (17 Sheets)

The database spreadsheet consists of 17 structured tabs:

1. **`Patients`**: UHID (`UHID-YYYY-XXXXX`), demographics, age/unit, mobile, masked ID, DPDP digital consent flag, audit trail.
2. **`Tests`**: Diagnostic catalog parameters (CBC, Glucose, HbA1c, LFT, KFT, Lipid, TSH, Urine), sample type, tube color, price, B2B price, units, calculated formulas.
3. **`Panels`**: Diagnostic profiles/packages (Complete Blood Count, Liver Function Test, Kidney Function Test, Lipid Profile).
4. **`PanelTests`**: Junction mapping tests to panels with display sort sequence.
5. **`ReferenceRanges`**: Evidence-based clinical reference intervals (AIIMS, Tietz 6th Ed, ICMR) segmented by Age in days, Gender, with Critical / Panic limits.
6. **`Orders`**: Diagnostic bookings, walk-in vs home collection, priority, gross amount, authorized discounts, net amount, paid amount, payment status.
7. **`OrderItems`**: Expanded test items per order, linked to physical sample tubes.
8. **`Samples`**: Barcode identifiers (`SMP-1XXXXX`), specimen type, container tube color, status lifecycle: `Ordered` → `Collected` → `Received` → `In Process` → `Resulted` → `Validated` → `Reported`, rejection reasons, recollection flags.
9. **`Results`**: Parameter results, auto-flags (`Normal`, `Low`, `High`, `Critical Low`, `Critical High`), delta checks against previous visits, version-controlled amendments (never overwrites).
10. **`Invoices`**: Tax invoices, gross, discount, balance, PDF Drive URLs.
11. **`Payments`**: Money receipts, tender modes (UPI, Cash, Debit/Credit Card, NEFT), UTR transaction references.
12. **`Doctors`**: Referring physicians, specialties, referral commission percentages, portal access.
13. **`Centres`**: Main central lab + B2B collection centres, price tiers, commission margins.
14. **`Inventory`**: Reagent kits, blood tubes, current stock, minimum reorder thresholds, lot/batch numbers, expiry dates.
15. **`Users`**: Staff accounts, Google Email, roles (`Admin`, `FrontDesk`, `Phlebotomist`, `LabTechnician`, `Pathologist`), digital signature file IDs.
16. **`AuditLog`**: Append-only compliance log (timestamp, user email, action, entity, JSON changes).
17. **`Settings`**: Atomic sequential counters (`COUNTER_UHID`, `COUNTER_ORDER`, `COUNTER_SAMPLE`, `COUNTER_INVOICE`, `COUNTER_RECEIPT`), lab branding, retention policies.

---

## 2. Prerequisites & Local Clasp Tooling

You can version and manage the entire codebase locally using Git and Google Clasp (`@google/clasp`).

### System Requirements
- **Node.js** (v18+ or v24+ installed)
- **Git**
- A **Google Account** (Google Workspace domain or standard Gmail account)

### Verify Installation
In PowerShell / Terminal:
```bash
node -v
npm -v
git --version
```

---

## 3. Step-by-Step Clasp Setup & Deployment Guide

### Step 3.1: Install Google Clasp Locally
Navigate to the project root directory:
```bash
cd C:\Users\Swapnil\.gemini\antigravity\scratch\lis-pathology-workspace
npm install -g @google/clasp
```
*(Or run clasp commands with `npx @google/clasp`)*

### Step 3.2: Enable Google Apps Script API
1. Visit [https://script.google.com/home/usersettings](https://script.google.com/home/usersettings).
2. Ensure **Google Apps Script API** is toggled to **ON**.

### Step 3.3: Authenticate Clasp with Google
Run the interactive login command:
```bash
clasp login
```
This opens your browser. Select your Google account and grant Clasp permissions.

### Step 3.4: Create the Database Spreadsheet & Bound Script
Option A (Recommended: Create container-bound script):
1. Go to [Google Sheets](https://sheets.new) and create a new blank spreadsheet named `Arogya LIS Database`.
2. Click **Extensions** > **Apps Script**.
3. In the Apps Script project settings (gear icon), copy the **Script ID**.
4. Paste the Script ID into `.clasp.json`:
   ```json
   {
     "scriptId": "YOUR_APPS_SCRIPT_PROJECT_ID_HERE",
     "rootDir": "src"
   }
   ```

Option B (Create standalone script via clasp):
```bash
clasp create --title "Arogya LIS Backend" --type webapp --rootDir src
```

### Step 3.5: Push Code to Google Apps Script
Push all local backend scripts and HTML templates into Apps Script:
```bash
clasp push
```

---

## 4. Initializing the Database & Seed Data

Once pushed, initialize the 17 sheets with clinical baselines:
1. Open your Apps Script editor.
2. Select the `Setup.js` file from the left sidebar.
3. From the function dropdown, select `setup` and click **Run**.
4. Grant the required Google Workspace permissions (Spreadsheets, Drive, Documents, Mail).
5. The script automatically creates and styles all 17 sheets, sets frozen headers, and seeds standard tests, panels, ICMR/AIIMS reference ranges, demo staff users, and atomic counters.

---

## 5. Web App Production Deployment

To serve the responsive Single Page Application:
1. In the Apps Script editor, click **Deploy** > **New deployment**.
2. Click the gear icon > Select **Web app**.
3. Configure settings:
   - **Description**: `Arogya LIS Production v1.0`
   - **Execute as**: `Me (your-email@domain.com)` *(Owner)*
   - **Who has access**:
     - For Google Workspace domain: `Anyone within [Your Domain]` (Staff only) OR
     - If patient portal access is enabled: `Anyone` *(Access is gated by server-side `Auth.gs` and patient OTP verification)*.
4. Click **Deploy**.
5. Copy the generated **Web App URL** (e.g. `https://script.google.com/macros/s/AKfycbx.../exec`).

---

## 6. Automating Scheduled Triggers (Backups & Scale Guard)

To activate the 3 automated background triggers:
1. In the Apps Script editor, open `Triggers.js`.
2. Select `installAllTriggers` from the function dropdown and click **Run**.
3. This registers:
   - **Daily 02:00 AM IST**: Rolling 30-day database snapshot to Google Drive (`LIS_Backups`).
   - **Daily 07:00 AM IST**: Reagent inventory low-stock alert email check.
   - **1st of Every Month 03:00 AM IST**: Scale Guard Archival Job (moves orders older than 12 months to archive tabs to keep lookup sheets blazing fast).

---

## 7. Running Automated Unit Tests

A comprehensive unit test suite is built into `src/Tests.js`. You can execute tests both locally via Node.js and inside Apps Script:

### Run Locally:
```bash
node src/Tests.js
```

### Verified Test Suites:
- `testIdGeneration`: Atomic sequential counters and SHA-256 OTP hashing.
- `testRolePermissions`: Granular role-based access control matrix (Admin, FrontDesk, Phlebotomist, Tech, Pathologist).
- `testClinicalFormulas`: Bilirubin, Globulin, A/G Ratio, VLDL, Friedewald LDL, Absolute Neutrophil Count.
- `testSchemaIntegrity`: Verification of all 17 normalized sheet definitions.
- `testPatientValidation`: DPDP 2023 consent enforcement, 10-digit Indian phone checks.
- `testReferenceRangeResolution`: Age & biological sex-banded clinical reference range resolution.
- `testOrderAndBillingTotals`: Multi-tier pricing (walk-in vs B2B), discount authorizations, payment reconciliation.
- `testSampleTrackingAndRecollection`: Tube grouping, status transitions, and specimen rejection/recollection workflows.
- `testResultFlagsAndAmendments`: Auto-flagging, delta velocity checks, two-step validation, and version-controlled amendments.
- `testReportCompilationAndPortalOtp`: Historical trend tables, payment watermarking, WhatsApp share links, and patient portal OTP verification.
- `testDashboardAndInventory`: KPI aggregation and low-stock reorder alerts.
