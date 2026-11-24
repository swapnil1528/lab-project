/**
 * Local Development Server for Arogya LIS
 * Provides in-memory Google Workspace mocks (SpreadsheetApp, Session, LockService, CacheService)
 * and serves the HtmlService SPA with full API routing on http://localhost:3000
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const SRC_DIR = path.join(__dirname, 'src');

// -------------------------------------------------------------
// 1. Google Workspace In-Memory Mocks
// -------------------------------------------------------------

const memorySheets = {};

function createMockSheet(name) {
  const sheetData = []; // 2D array [row][col]

  return {
    name: name,
    _data: sheetData,
    getDataRange() {
      return {
        getValues: () => sheetData.map(r => [...r])
      };
    },
    getLastRow() {
      return sheetData.length;
    },
    getLastColumn() {
      return sheetData[0] ? sheetData[0].length : 0;
    },
    getRange(row, col, numRows, numCols) {
      // 1-based indexing in Apps Script
      const startR = (row || 1) - 1;
      const startC = (col || 1) - 1;
      const nR = numRows || 1;
      const nC = numCols || 1;

      return {
        getValues: () => {
          const slice = [];
          for (let r = startR; r < startR + nR; r++) {
            const rowSlice = [];
            const srcRow = sheetData[r] || [];
            for (let c = startC; c < startC + nC; c++) {
              rowSlice.push(srcRow[c] !== undefined ? srcRow[c] : '');
            }
            slice.push(rowSlice);
          }
          return slice;
        },
        setValues: (vals) => {
          for (let r = 0; r < vals.length; r++) {
            const targetR = startR + r;
            if (!sheetData[targetR]) sheetData[targetR] = [];
            for (let c = 0; c < vals[r].length; c++) {
              sheetData[targetR][startC + c] = vals[r][c];
            }
          }
          return this;
        },
        setValue: (v) => {
          if (!sheetData[startR]) sheetData[startR] = [];
          sheetData[startR][startC] = v;
          return this;
        },
        setBackground: () => this,
        setFontColor: () => this,
        setFontWeight: () => this,
        setFontSize: () => this,
        setFormula: () => this,
        merge: () => this
      };
    },
    appendRow(rowArr) {
      sheetData.push([...rowArr]);
    },
    setFrozenRows: () => {},
    setColumnWidth: () => {},
    autoResizeColumns: () => {},
    clear() {
      sheetData.length = 0;
    }
  };
}

const mockSpreadsheet = {
  getSheetByName(name) {
    if (!memorySheets[name]) return null;
    return memorySheets[name];
  },
  insertSheet(name) {
    memorySheets[name] = createMockSheet(name);
    return memorySheets[name];
  },
  deleteSheet(sheet) {
    if (sheet && sheet.name) delete memorySheets[sheet.name];
  },
  getSheets() {
    return Object.values(memorySheets);
  },
  getId() { return 'LOCAL_MOCK_SPREADSHEET_ID'; },
  getName() { return 'Arogya LIS Local Database'; }
};

const memoryCache = {};

global.SpreadsheetApp = {
  getActiveSpreadsheet: () => mockSpreadsheet,
  openById: () => mockSpreadsheet
};

global.PropertiesService = {
  getScriptProperties: () => ({
    getProperty: () => 'LOCAL_MOCK_SPREADSHEET_ID',
    setProperty: () => {}
  })
};

global.Session = {
  getActiveUser: () => ({ getEmail: () => 'admin@arogyalabs.in' }),
  getEffectiveUser: () => ({ getEmail: () => 'admin@arogyalabs.in' })
};

global.LockService = {
  getScriptLock: () => ({
    waitLock: () => true,
    releaseLock: () => true
  })
};

global.CacheService = {
  getScriptCache: () => ({
    get: (key) => memoryCache[key] || null,
    put: (key, val) => { memoryCache[key] = val; },
    remove: (key) => { delete memoryCache[key]; },
    removeAll: (keys) => { (keys || []).forEach(k => delete memoryCache[k]); }
  })
};

global.ScriptApp = {
  getService: () => ({
    getUrl: () => `http://localhost:${PORT}`
  }),
  newTrigger: () => ({
    timeBased: () => ({
      atHour: () => ({ everyDays: () => ({ inTimezone: () => ({ create: () => {} }) }), onMonthDay: () => ({ inTimezone: () => ({ create: () => {} }) }) })
    })
  }),
  getProjectTriggers: () => [],
  deleteTrigger: () => {}
};

global.MailApp = {
  sendEmail: (options) => {
    console.log(`[SIMULATED EMAIL] To: ${options.to} | Subject: ${options.subject}`);
  }
};

// -------------------------------------------------------------
// 2. Load Services & Initialize Schema
// -------------------------------------------------------------

const Utils = require('./src/Utils.js');
const Repository = require('./src/Repository.js');
const { ROLES, PERMISSIONS, SessionContext } = require('./src/Auth.js');
const Setup = require('./src/Setup.js');
const PatientService = require('./src/PatientService.js');
const CatalogService = require('./src/CatalogService.js');
const OrderBillingService = require('./src/OrderBillingService.js');
const SampleService = require('./src/SampleService.js');
const ResultService = require('./src/ResultService.js');
const ReportService = require('./src/ReportService.js');
const DashboardService = require('./src/DashboardService.js');
const InventoryService = require('./src/InventoryService.js');
const AdminService = require('./src/AdminService.js');
const Triggers = require('./src/Triggers.js');
const WebApp = require('./src/WebApp.js');

global.Utils = Utils;
global.Repository = Repository;
global.SessionContext = SessionContext;
global.ROLES = ROLES;
global.PERMISSIONS = PERMISSIONS;
global.Setup = Setup;
global.PatientService = PatientService;
global.CatalogService = CatalogService;
global.OrderBillingService = OrderBillingService;
global.SampleService = SampleService;
global.ResultService = ResultService;
global.ReportService = ReportService;
global.DashboardService = DashboardService;
global.InventoryService = InventoryService;
global.AdminService = AdminService;
global.Triggers = Triggers;

// Run Setup to create and seed all 17 tabs
console.log('Initializing in-memory Google Sheets database...');
Setup.setup();
console.log('Database seeded with standard clinical baseline.');

// -------------------------------------------------------------
// 3. Template Resolution (HtmlService include() emulation)
// -------------------------------------------------------------

function renderHtml(templateName, data = {}) {
  const filePath = path.join(SRC_DIR, templateName + '.html');
  if (!fs.existsSync(filePath)) {
    return `<div style="color:red">Template not found: ${templateName}</div>`;
  }

  let content = fs.readFileSync(filePath, 'utf8');

  // Replace <?!= include('...') ?> recursively
  content = content.replace(/<\?!=\s*include\(['"]([^'"]+)['"]\);\s*\?>/g, (match, includedFile) => {
    return renderHtml(includedFile, data);
  });

  // Inject client-side google.script.run proxy shim before </head>
  const shim = `
  <script>
    // Local development shim for google.script.run
    window.google = window.google || {};
    window.google.script = window.google.script || {};
    window.google.script.run = new Proxy({}, {
      get(target, propKey) {
        if (propKey === 'withSuccessHandler') {
          return (onSuccess) => {
            let failureHandler = (err) => console.error('API Error:', err);
            const proxyObj = new Proxy({}, {
              get(t, method) {
                if (method === 'withFailureHandler') {
                  return (onFail) => {
                    failureHandler = onFail;
                    return proxyObj;
                  };
                }
                return (...args) => {
                  fetch('/api/' + method, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ args })
                  })
                  .then(res => res.json())
                  .then(data => {
                    if (data.error) failureHandler(new Error(data.error));
                    else onSuccess(data.result);
                  })
                  .catch(err => failureHandler(err));
                };
              }
            });
            return proxyObj;
          };
        }
        return (...args) => {
          return fetch('/api/' + propKey, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ args })
          });
        };
      }
    });
  </script>
  `;

  if (content.includes('</head>')) {
    content = content.replace('</head>', shim + '</head>');
  } else {
    content = shim + content;
  }

  return content;
}

// -------------------------------------------------------------
// 4. HTTP Request Router
// -------------------------------------------------------------

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = parsedUrl.pathname;

  // Static Assets / Pages
  if (req.method === 'GET') {
    if (pathname === '/' || pathname === '/index.html') {
      const page = parsedUrl.searchParams.get('page');
      let html = '';
      if (page === 'portal') {
        html = renderHtml('ui/PatientPortal');
      } else {
        html = renderHtml('ui/Index');
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    if (pathname === '/portal') {
      const html = renderHtml('ui/PatientPortal');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    if (pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'UP', port: PORT }));
      return;
    }
  }

  // API RPC Endpoint: /api/:method
  if (req.method === 'POST' && pathname.startsWith('/api/')) {
    const methodName = pathname.replace('/api/', '');
    let bodyStr = '';

    req.on('data', chunk => { bodyStr += chunk; });
    req.on('end', () => {
      try {
        const payload = bodyStr ? JSON.parse(bodyStr) : { args: [] };
        const args = payload.args || [];

        // Check if WebApp or Services export this function
        let handler = null;
        if (typeof global[methodName] === 'function') {
          handler = global[methodName];
        } else if (WebApp && typeof WebApp[methodName] === 'function') {
          handler = WebApp[methodName];
        } else {
          // Check common API mappings
          const apis = {
            apiGetContext: () => SessionContext.getClientContext(),
            apiSearchPatients: (q) => PatientService.searchPatients(q),
            apiRegisterPatient: (d, f) => PatientService.registerPatient(d, f),
            apiGetPatientProfile: (u) => PatientService.getPatientProfile(u),
            apiGetCatalog: () => CatalogService.getFullCatalog(),
            apiSearchCatalog: (q) => CatalogService.searchCatalog(q),
            apiCreateOrder: (o) => OrderBillingService.createOrder(o),
            apiAddPayment: (id, p) => OrderBillingService.addPayment(id, p),
            apiGetPhlebotomyWorklist: (s) => SampleService.getPhlebotomyWorklist(s),
            apiMarkSampleCollected: (id) => SampleService.markCollected(id),
            apiMarkSampleReceived: (id) => SampleService.markReceived(id),
            apiRejectSample: (id, r, rec) => SampleService.rejectSample(id, r, rec),
            apiGetLabelPayload: (id) => SampleService.getLabelPayload(id),
            apiGetDepartmentWorklist: (d) => ResultService.getDepartmentWorklist(d),
            apiGetOrderResultsForEntry: (o, s) => ResultService.getOrderResultsForEntry(o, s),
            apiSaveResults: (o, s, v, sub) => ResultService.saveResults(o, s, v, sub),
            apiValidateResults: (o) => ResultService.validateResults(o),
            apiAmendResult: (id, val, r) => ResultService.amendResult(id, val, r),
            apiCompileReportData: (o) => ReportService.compileReportData(o),
            apiGetWhatsAppShareUrl: (o) => ReportService.getWhatsAppShareUrl(o, `http://localhost:${PORT}`),
            apiGenerateReportPdf: (o) => ReportService.generateReportPdf(o, `http://localhost:${PORT}`),
            apiSendReportEmail: (o) => ReportService.sendReportEmail(o),
            apiGetOperationalDashboard: () => DashboardService.getOperationalDashboard(),
            apiGetInventoryList: () => InventoryService.getInventoryList(),
            apiAdjustStock: (id, d, r) => InventoryService.adjustStock(id, d, r),
            apiGetAuditLogs: (l, o) => AdminService.getAuditLogs(l, o),
            apiPortalRequestOtp: (t, m) => ReportService.requestPortalOtp(t, m),
            apiPortalVerifyOtp: (t, m, o) => ReportService.verifyPortalOtp(t, m, o)
          };
          if (apis[methodName]) handler = apis[methodName];
        }

        if (!handler) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `API method not found: ${methodName}` }));
          return;
        }

        const result = handler.apply(null, args);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ result }));
      } catch (err) {
        console.error(`Error in ${methodName}:`, err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Fallback 404
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

function startServer(portToTry) {
  server.listen(portToTry, () => {
    console.log(`\n======================================================`);
    console.log(`🚀 Arogya LIS Local Development Server is RUNNING!`);
    console.log(`👉 Main Web App:       http://localhost:${portToTry}`);
    console.log(`👉 Patient Portal:     http://localhost:${portToTry}/portal`);
    console.log(`======================================================\n`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`Port ${portToTry} is in use, trying port ${portToTry + 1}...`);
      startServer(portToTry + 1);
    } else {
      console.error('Server error:', err);
    }
  });
}

startServer(PORT);
