/**
 * UWC Immersive Zone - Analytics Dashboard
 * Project: Interactive Loggerhead Turtle Hatchlings
 * GA4 Property ID: 522398801
 * 
 * This version uses the REST API directly via UrlFetchApp
 * No need to enable Advanced Services!
 */

const GA4_PROPERTY_ID = '522398801';
const GA4_API_URL = 'https://analyticsdata.googleapis.com/v1beta/properties/' + GA4_PROPERTY_ID + ':runReport';

/**
 * Serves the login page or dashboard based on auth parameter
 */
function doGet(e) {
  var page = (e && e.parameter && e.parameter.page) || 'login';

  if (page === 'dashboard') {
    return HtmlService.createTemplateFromFile('Dashboard')
      .evaluate()
      .setTitle('UWC Immersive Zone - Analytics Dashboard')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  // Default: serve login page
  return HtmlService.createTemplateFromFile('Login')
    .evaluate()
    .setTitle('UWC Immersive Zone - Login')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Include HTML files (for templating)
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Fetch header logo as base64 data URL for PDF embedding
 */
function fetchLogoAsBase64() {
  try {
    var response = UrlFetchApp.fetch('https://innovationhub.uwc.ac.za/img/UIH_Logo_FA.png', { muteHttpExceptions: true });
    var blob = response.getBlob();
    var base64 = Utilities.base64Encode(blob.getBytes());
    return 'data:' + blob.getContentType() + ';base64,' + base64;
  } catch(e) {
    Logger.log('Logo fetch error: ' + e);
    return null;
  }
}

/**
 * Make API request to GA4 Data API using REST
 */
function makeGA4Request(requestBody) {
  try {
    const options = {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'Authorization': 'Bearer ' + ScriptApp.getOAuthToken()
      },
      payload: JSON.stringify(requestBody),
      muteHttpExceptions: true
    };
    
    const response = UrlFetchApp.fetch(GA4_API_URL, options);
    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();
    
    if (responseCode === 200) {
      return { success: true, data: JSON.parse(responseText) };
    } else {
      Logger.log('GA4 API Error: ' + responseCode + ' - ' + responseText);
      return { success: false, error: 'API Error: ' + responseCode, details: responseText };
    }
  } catch (error) {
    Logger.log('Request Error: ' + error.toString());
    return { success: false, error: error.toString() };
  }
}

/**
 * Get date range based on period selection
 */
function getDateRange(period) {
  const today = new Date();
  let startDate, endDate;
  
  endDate = Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  
  switch(period) {
    case 'DAU':
      startDate = endDate;
      break;
    case 'WEEKLY':
      const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
      startDate = Utilities.formatDate(weekAgo, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      break;
    case 'MONTHLY':
      const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
      startDate = Utilities.formatDate(monthAgo, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      break;
    case 'YEARLY':
      const yearAgo = new Date(today.getTime() - 365 * 24 * 60 * 60 * 1000);
      startDate = Utilities.formatDate(yearAgo, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      break;
    default:
      const defaultStart = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
      startDate = Utilities.formatDate(defaultStart, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  
  return { startDate, endDate };
}

/**
 * Fetch overview metrics from GA4
 */
function fetchOverviewMetrics(period) {
  try {
    const { startDate, endDate } = getDateRange(period);
    
    const requestBody = {
      dateRanges: [{ startDate: startDate, endDate: endDate }],
      metrics: [
        { name: 'totalUsers' },
        { name: 'newUsers' },
        { name: 'sessions' },
        { name: 'screenPageViews' },
        { name: 'averageSessionDuration' },
        { name: 'bounceRate' },
        { name: 'engagementRate' },
        { name: 'activeUsers' }
      ]
    };
    
    const result = makeGA4Request(requestBody);
    
    if (result.success && result.data.rows && result.data.rows.length > 0) {
      const values = result.data.rows[0].metricValues;
      return {
        success: true,
        data: {
          totalUsers: parseInt(values[0].value) || 0,
          newUsers: parseInt(values[1].value) || 0,
          sessions: parseInt(values[2].value) || 0,
          pageViews: parseInt(values[3].value) || 0,
          avgSessionDuration: parseFloat(values[4].value) || 0,
          bounceRate: (parseFloat(values[5].value) * 100).toFixed(1),
          engagementRate: (parseFloat(values[6].value) * 100).toFixed(1),
          activeUsers: parseInt(values[7].value) || 0
        },
        period,
        dateRange: { startDate, endDate }
      };
    }
    
    // Return empty data if no results
    return { 
      success: true, 
      data: getEmptyMetrics(), 
      period, 
      dateRange: { startDate, endDate },
      note: result.error || 'No data available for this period'
    };
    
  } catch (error) {
    Logger.log('Error fetching overview metrics: ' + error.toString());
    return { success: false, error: error.toString(), data: getEmptyMetrics() };
  }
}

/**
 * Fetch time series data for charts
 */
function fetchTimeSeriesData(period) {
  try {
    const { startDate, endDate } = getDateRange(period);
    
    let dimension = 'date';
    if (period === 'YEARLY') {
      dimension = 'yearMonth';
    } else if (period === 'DAU') {
      dimension = 'hour';
    }
    
    const requestBody = {
      dateRanges: [{ startDate: startDate, endDate: endDate }],
      dimensions: [{ name: dimension }],
      metrics: [
        { name: 'activeUsers' },
        { name: 'sessions' },
        { name: 'screenPageViews' }
      ],
      orderBys: [{ dimension: { dimensionName: dimension } }]
    };
    
    const result = makeGA4Request(requestBody);
    
    if (result.success && result.data.rows && result.data.rows.length > 0) {
      const labels = [];
      const users = [];
      const sessions = [];
      const pageViews = [];
      
      result.data.rows.forEach(row => {
        let label = row.dimensionValues[0].value;
        
        if (dimension === 'date' && label.length === 8) {
          label = label.substring(4,6) + '/' + label.substring(6,8);
        } else if (dimension === 'yearMonth' && label.length === 6) {
          const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
          const monthNum = parseInt(label.substring(4,6)) - 1;
          label = months[monthNum] + ' ' + label.substring(0,4);
        } else if (dimension === 'hour') {
          label = label + ':00';
        }
        
        labels.push(label);
        users.push(parseInt(row.metricValues[0].value) || 0);
        sessions.push(parseInt(row.metricValues[1].value) || 0);
        pageViews.push(parseInt(row.metricValues[2].value) || 0);
      });
      
      return { success: true, data: { labels, users, sessions, pageViews } };
    }
    
    return { success: true, data: { labels: [], users: [], sessions: [], pageViews: [] } };
    
  } catch (error) {
    Logger.log('Error fetching time series: ' + error.toString());
    return { success: false, error: error.toString() };
  }
}

/**
 * Fetch traffic sources data
 */
function fetchTrafficSources(period) {
  try {
    const { startDate, endDate } = getDateRange(period);
    
    const requestBody = {
      dateRanges: [{ startDate: startDate, endDate: endDate }],
      dimensions: [{ name: 'sessionDefaultChannelGroup' }],
      metrics: [{ name: 'sessions' }],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 8
    };
    
    const result = makeGA4Request(requestBody);
    
    if (result.success && result.data.rows && result.data.rows.length > 0) {
      const labels = [];
      const values = [];
      
      result.data.rows.forEach(row => {
        labels.push(row.dimensionValues[0].value || 'Unknown');
        values.push(parseInt(row.metricValues[0].value) || 0);
      });
      
      return { success: true, data: { labels, values } };
    }
    
    return { success: true, data: { labels: [], values: [] } };
    
  } catch (error) {
    Logger.log('Error fetching traffic sources: ' + error.toString());
    return { success: false, error: error.toString() };
  }
}

/**
 * Fetch top pages data
 */
function fetchTopPages(period) {
  try {
    const { startDate, endDate } = getDateRange(period);
    
    const requestBody = {
      dateRanges: [{ startDate: startDate, endDate: endDate }],
      dimensions: [{ name: 'pageTitle' }],
      metrics: [
        { name: 'screenPageViews' },
        { name: 'averageSessionDuration' }
      ],
      orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
      limit: 10
    };
    
    const result = makeGA4Request(requestBody);
    
    if (result.success && result.data.rows && result.data.rows.length > 0) {
      const pages = result.data.rows.map(row => ({
        title: row.dimensionValues[0].value || 'Unknown',
        views: parseInt(row.metricValues[0].value) || 0,
        avgDuration: parseFloat(row.metricValues[1].value) || 0
      }));
      
      return { success: true, data: pages };
    }
    
    return { success: true, data: [] };
    
  } catch (error) {
    Logger.log('Error fetching top pages: ' + error.toString());
    return { success: false, error: error.toString() };
  }
}

/**
 * Fetch device category data
 */
function fetchDeviceData(period) {
  try {
    const { startDate, endDate } = getDateRange(period);
    
    const requestBody = {
      dateRanges: [{ startDate: startDate, endDate: endDate }],
      dimensions: [{ name: 'deviceCategory' }],
      metrics: [{ name: 'sessions' }],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }]
    };
    
    const result = makeGA4Request(requestBody);
    
    if (result.success && result.data.rows && result.data.rows.length > 0) {
      const labels = [];
      const values = [];
      
      result.data.rows.forEach(row => {
        const device = row.dimensionValues[0].value;
        labels.push(device.charAt(0).toUpperCase() + device.slice(1));
        values.push(parseInt(row.metricValues[0].value) || 0);
      });
      
      return { success: true, data: { labels, values } };
    }
    
    return { success: true, data: { labels: [], values: [] } };
    
  } catch (error) {
    Logger.log('Error fetching device data: ' + error.toString());
    return { success: false, error: error.toString() };
  }
}

/**
 * Fetch country data
 */
function fetchCountryData(period) {
  try {
    const { startDate, endDate } = getDateRange(period);
    
    const requestBody = {
      dateRanges: [{ startDate: startDate, endDate: endDate }],
      dimensions: [{ name: 'country' }],
      metrics: [{ name: 'activeUsers' }],
      orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
      limit: 10
    };
    
    const result = makeGA4Request(requestBody);
    
    if (result.success && result.data.rows && result.data.rows.length > 0) {
      const countries = result.data.rows.map(row => ({
        country: row.dimensionValues[0].value || 'Unknown',
        users: parseInt(row.metricValues[0].value) || 0
      }));
      
      return { success: true, data: countries };
    }
    
    return { success: true, data: [] };
    
  } catch (error) {
    Logger.log('Error fetching country data: ' + error.toString());
    return { success: false, error: error.toString() };
  }
}

/**
 * Fetch engagement metrics for radar chart
 */
function fetchEngagementMetrics(period) {
  try {
    const { startDate, endDate } = getDateRange(period);
    
    const requestBody = {
      dateRanges: [{ startDate: startDate, endDate: endDate }],
      metrics: [
        { name: 'engagementRate' },
        { name: 'engagedSessions' },
        { name: 'sessionsPerUser' },
        { name: 'screenPageViewsPerSession' },
        { name: 'userEngagementDuration' }
      ]
    };
    
    const result = makeGA4Request(requestBody);
    
    if (result.success && result.data.rows && result.data.rows.length > 0) {
      const values = result.data.rows[0].metricValues;
      
      const engagementRate = parseFloat(values[0].value) * 100 || 0;
      const engagedSessions = parseInt(values[1].value) || 0;
      const sessionsPerUser = parseFloat(values[2].value) || 0;
      const pagesPerSession = parseFloat(values[3].value) || 0;
      const totalEngagementTime = parseFloat(values[4].value) || 0;
      
      return {
        success: true,
        data: {
          labels: ['Engagement Rate', 'Sessions/User', 'Pages/Session', 'Avg Time', 'Return Rate'],
          values: [
            Math.min(engagementRate, 100),
            Math.min(sessionsPerUser * 25, 100),
            Math.min(pagesPerSession * 15, 100),
            Math.min((engagedSessions > 0 ? totalEngagementTime / engagedSessions : 0) / 3, 100),
            Math.min(engagementRate * 0.8, 100)
          ]
        }
      };
    }
    
    return { success: true, data: { labels: [], values: [] } };
    
  } catch (error) {
    Logger.log('Error fetching engagement metrics: ' + error.toString());
    return { success: false, error: error.toString() };
  }
}

/**
 * Fetch user acquisition data (new vs returning, sessions per user, engaged sessions)
 */
function fetchUserAcquisition(period) {
  try {
    const { startDate, endDate } = getDateRange(period);

    const requestBody = {
      dateRanges: [{ startDate: startDate, endDate: endDate }],
      metrics: [
        { name: 'totalUsers' },
        { name: 'newUsers' },
        { name: 'sessionsPerUser' },
        { name: 'engagedSessions' }
      ]
    };

    const result = makeGA4Request(requestBody);

    if (result.success && result.data.rows && result.data.rows.length > 0) {
      const values = result.data.rows[0].metricValues;
      const totalUsers = parseInt(values[0].value) || 0;
      const newUsers = parseInt(values[1].value) || 0;
      const returningUsers = Math.max(totalUsers - newUsers, 0);
      const sessionsPerUser = parseFloat(values[2].value) || 0;
      const engagedSessions = parseInt(values[3].value) || 0;

      const newPct = totalUsers > 0 ? Math.round((newUsers / totalUsers) * 100) : 50;
      const returnPct = 100 - newPct;

      return {
        success: true,
        data: {
          newUsers: newUsers,
          returningUsers: returningUsers,
          sessionsPerUser: sessionsPerUser.toFixed(2),
          engagedSessions: engagedSessions,
          newUserPct: newPct,
          returningUserPct: returnPct
        }
      };
    }

    return { success: true, data: { newUsers: 0, returningUsers: 0, sessionsPerUser: '0.00', engagedSessions: 0, newUserPct: 50, returningUserPct: 50 } };

  } catch (error) {
    Logger.log('Error fetching user acquisition: ' + error.toString());
    return { success: false, error: error.toString() };
  }
}

/**
 * Fetch all dashboard data at once
 */
function fetchAllDashboardData(period) {
  return {
    overview: fetchOverviewMetrics(period),
    timeSeries: fetchTimeSeriesData(period),
    trafficSources: fetchTrafficSources(period),
    topPages: fetchTopPages(period),
    devices: fetchDeviceData(period),
    countries: fetchCountryData(period),
    engagement: fetchEngagementMetrics(period),
    acquisition: fetchUserAcquisition(period)
  };
}

/**
 * Returns empty metrics object for error states
 */
function getEmptyMetrics() {
  return {
    totalUsers: 0,
    newUsers: 0,
    sessions: 0,
    pageViews: 0,
    avgSessionDuration: 0,
    bounceRate: '0.0',
    engagementRate: '0.0',
    activeUsers: 0
  };
}

/**
 * Get project info
 */
function getProjectInfo() {
  return {
    name: 'Interactive Loggerhead Turtle Hatchlings',
    propertyId: GA4_PROPERTY_ID,
    accountId: '382632926',
    siteUrl: 'https://sites.google.com/uwc.ac.za/idealoceanhome/interactive-loggerhead-turtle-hatchlings'
  };
}

/**
 * ============================================
 * TEST FUNCTION - Run this first!
 * ============================================
 * Go to: Run > testAPIConnection
 * This will test your API connection and show results in the Execution Log
 */
function testAPIConnection() {
  Logger.log('='.repeat(50));
  Logger.log('Testing GA4 API Connection...');
  Logger.log('Property ID: ' + GA4_PROPERTY_ID);
  Logger.log('='.repeat(50));
  
  const result = fetchOverviewMetrics('WEEKLY');
  
  Logger.log('');
  Logger.log('API Response:');
  Logger.log(JSON.stringify(result, null, 2));
  
  if (result.success && result.data.totalUsers > 0) {
    Logger.log('');
    Logger.log('✓ SUCCESS! API is working correctly.');
    Logger.log('');
    Logger.log('Data Retrieved:');
    Logger.log('  Total Users: ' + result.data.totalUsers);
    Logger.log('  Sessions: ' + result.data.sessions);
    Logger.log('  Page Views: ' + result.data.pageViews);
  } else if (result.success) {
    Logger.log('');
    Logger.log('⚠ API connected but no data returned.');
    Logger.log('This could mean:');
    Logger.log('  1. No traffic in the selected period');
    Logger.log('  2. Property ID might be incorrect');
  } else {
    Logger.log('');
    Logger.log('✗ ERROR: ' + result.error);
    Logger.log('');
    Logger.log('Troubleshooting:');
    Logger.log('  1. Make sure you have access to GA4 property ' + GA4_PROPERTY_ID);
    Logger.log('  2. Enable Google Analytics Data API in GCP Console');
    Logger.log('  3. Re-authorize the script');
  }
  
  return result;
}

// ============================================
// LOGIN & AUTHENTICATION
// ============================================

/**
 * Get or create the Users spreadsheet bound to this script
 * Sheet columns: Email | Name | Access | Last Login | Auth Code | Code Timestamp | Attempts
 */
function getUsersSheet() {
  var props = PropertiesService.getScriptProperties();
  var sheetId = props.getProperty('USERS_SHEET_ID');
  var ss = null;

  if (sheetId) {
    try {
      ss = SpreadsheetApp.openById(sheetId);
    } catch (e) {
      Logger.log('Stored sheet ID invalid, creating new: ' + e);
      ss = null;
    }
  }

  if (!ss) {
    ss = SpreadsheetApp.create('UWC Immersive Zone - Analytics Users');
    props.setProperty('USERS_SHEET_ID', ss.getId());
    Logger.log('Created Users spreadsheet: ' + ss.getUrl());
  }

  var sheet = ss.getSheetByName('Users');
  if (!sheet) {
    sheet = ss.insertSheet('Users');
    sheet.appendRow(['Email', 'Name', 'Access', 'Last Login', 'Auth Code', 'Code Timestamp', 'Attempts']);
    sheet.setFrozenRows(1);
    // Set column widths
    sheet.setColumnWidth(1, 250);
    sheet.setColumnWidth(2, 150);
    sheet.setColumnWidth(3, 100);
    sheet.setColumnWidth(4, 180);
    sheet.setColumnWidth(5, 100);
    sheet.setColumnWidth(6, 180);
    sheet.setColumnWidth(7, 80);
  }
  return sheet;
}

/**
 * Check if email is registered and has access
 */
function checkUserEmail(email) {
  try {
    if (!email) return { success: false, error: 'NO_EMAIL' };
    email = String(email).trim().toLowerCase();
    var sheet = getUsersSheet();
    var data = sheet.getDataRange().getValues();

    for (var i = 1; i < data.length; i++) {
      if (data[i][0].toString().trim().toLowerCase() === email) {
        var access = data[i][2].toString().trim().toLowerCase();
        if (access === 'granted' || access === 'yes' || access === 'true') {
          return { success: true, name: data[i][1], row: i + 1 };
        } else if (access === 'denied' || access === 'blocked') {
          return { success: false, error: 'ACCESS_DENIED' };
        } else {
          return { success: false, error: 'ACCESS_PENDING' };
        }
      }
    }

    return { success: false, error: 'NOT_REGISTERED' };
  } catch (e) {
    Logger.log('checkUserEmail error: ' + e);
    return { success: false, error: 'SYSTEM_ERROR' };
  }
}

/**
 * Generate a 5-character alphanumeric auth code (no ambiguous chars)
 */
function generateAuthCode() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var code = '';
  for (var i = 0; i < 5; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * Send auth code to user's email via PHP mail API
 */
function sendAuthCode(email) {
  try {
    if (!email) return { success: false, error: 'NO_EMAIL' };
    email = String(email).trim().toLowerCase();
    var userCheck = checkUserEmail(email);
    if (!userCheck.success) return userCheck;

    var code = generateAuthCode();
    var now = new Date();

    // Store code in sheet
    var sheet = getUsersSheet();
    var row = userCheck.row;
    sheet.getRange(row, 5).setValue(code);           // Auth Code column
    sheet.getRange(row, 6).setValue(now.toISOString()); // Code Timestamp
    sheet.getRange(row, 7).setValue(0);              // Reset attempts

    // Send via PHP API
    var sent = sendEmailViaPHP(email, userCheck.name, code);
    if (sent) {
      return { success: true, message: 'Code sent to ' + email };
    } else {
      return { success: false, error: 'EMAIL_FAILED' };
    }
  } catch (e) {
    Logger.log('sendAuthCode error: ' + e);
    return { success: false, error: 'SYSTEM_ERROR' };
  }
}

/**
 * Send email via the UWC Immersive Zone PHP mail API
 */
function sendEmailViaPHP(email, name, code) {
  try {
    var apiKey = PropertiesService.getScriptProperties().getProperty('PHP_API_KEY') || 'tto-contact-form-2024-xyz';

    var payload = {
      to: email,
      name: name || 'User',
      subject: 'UWC Immersive Zone - Your Login Code',
      code: code,
      template: 'auth_code',
      api_key: apiKey
    };

    var options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    var response = UrlFetchApp.fetch('https://innovationhub.uwc.ac.za/sendmail-api.php', options);
    var status = response.getResponseCode();
    Logger.log('Email API response: ' + status + ' - ' + response.getContentText());
    if (status === 200) return true;

    // PHP API failed — fall through to Gmail fallback
    Logger.log('PHP API non-200, falling back to GmailApp');
    return sendViaGmail(email, name, code);
  } catch (e) {
    Logger.log('sendEmailViaPHP error: ' + e);
    return sendViaGmail(email, name, code);
  }
}

/**
 * Fallback: send auth code via GmailApp
 */
function sendViaGmail(email, name, code) {
  try {
    GmailApp.sendEmail(email, 'UWC Immersive Zone - Your Login Code',
      'Hi ' + (name || 'User') + ',\n\nYour login code is: ' + code + '\n\nThis code expires in 10 minutes.\n\nUWC Immersive Zone',
      {
        name: 'UWC Immersive Zone',
        htmlBody: buildAuthEmailHtml(name, code)
      }
    );
    Logger.log('Email sent via GmailApp to ' + email);
    return true;
  } catch (e) {
    Logger.log('GmailApp fallback error: ' + e);
    return false;
  }
}

/**
 * Build branded HTML email for auth code
 */
function buildAuthEmailHtml(name, code) {
  return '<div style="max-width:480px;margin:0 auto;font-family:Arial,sans-serif;">' +
    '<div style="background:#0a1a5c;padding:24px;text-align:center;">' +
    '<h2 style="color:#ffffff;margin:0;font-size:18px;">UWC Immersive Zone</h2>' +
    '</div>' +
    '<div style="padding:32px 24px;background:#ffffff;">' +
    '<p style="color:#333;font-size:15px;">Hi ' + (name || 'User') + ',</p>' +
    '<p style="color:#333;font-size:15px;">Your login verification code is:</p>' +
    '<div style="text-align:center;margin:24px 0;">' +
    '<div style="display:inline-block;padding:16px 32px;background:#f8f8f8;border:2px solid #bd9a4f;border-radius:8px;font-size:28px;font-weight:bold;letter-spacing:6px;color:#0a1a5c;">' + code + '</div>' +
    '</div>' +
    '<p style="color:#666;font-size:13px;">This code expires in 10 minutes. If you did not request this, please ignore this email.</p>' +
    '</div>' +
    '<div style="background:#f5f5f5;padding:16px;text-align:center;font-size:12px;color:#999;">' +
    'University of the Western Cape | UWC Immersive Zone' +
    '</div>' +
    '</div>';
}

/**
 * Verify the auth code entered by the user
 */
function verifyAuthCode(email, code) {
  try {
    if (!email || !code) return { success: false, error: 'MISSING_INPUT' };
    email = String(email).trim().toLowerCase();
    code = String(code).trim().toUpperCase();

    var sheet = getUsersSheet();
    var data = sheet.getDataRange().getValues();

    for (var i = 1; i < data.length; i++) {
      if (data[i][0].toString().trim().toLowerCase() === email) {
        var storedCode = data[i][4].toString().trim().toUpperCase();
        var timestamp = data[i][5].toString();
        var attempts = parseInt(data[i][6]) || 0;

        // Check max attempts
        if (attempts >= 3) {
          return { success: false, error: 'MAX_ATTEMPTS' };
        }

        // Increment attempts
        sheet.getRange(i + 1, 7).setValue(attempts + 1);

        // Check code
        if (storedCode !== code) {
          return { success: false, error: 'INVALID_CODE', attemptsLeft: 2 - attempts };
        }

        // Check expiry (10 minutes)
        if (timestamp) {
          var codeTime = new Date(timestamp);
          var now = new Date();
          var diffMinutes = (now - codeTime) / (1000 * 60);
          if (diffMinutes > 10) {
            return { success: false, error: 'CODE_EXPIRED' };
          }
        }

        // Success — update last login, clear code
        var row = i + 1;
        sheet.getRange(row, 4).setValue(new Date().toISOString()); // Last Login
        sheet.getRange(row, 5).setValue('');   // Clear auth code
        sheet.getRange(row, 6).setValue('');   // Clear timestamp
        sheet.getRange(row, 7).setValue(0);    // Reset attempts

        // Generate session token
        var token = Utilities.getUuid();
        var cache = CacheService.getScriptCache();
        cache.put('session_' + token, email, 3600); // 1 hour session

        return {
          success: true,
          name: data[i][1],
          token: token,
          dashboardUrl: ScriptApp.getService().getUrl() + '?page=dashboard'
        };
      }
    }

    return { success: false, error: 'NOT_REGISTERED' };
  } catch (e) {
    Logger.log('verifyAuthCode error: ' + e);
    return { success: false, error: 'SYSTEM_ERROR' };
  }
}

/**
 * Validate session token (called from dashboard)
 */
function validateSession(token) {
  try {
    if (!token) return false;
    var cache = CacheService.getScriptCache();
    var email = cache.get('session_' + token);
    return !!email;
  } catch (e) {
    return false;
  }
}

/**
 * Run this to trigger OAuth consent if needed
 */
function authorizeScript() {
  // These scopes will trigger OAuth consent
  const token = ScriptApp.getOAuthToken();
  Logger.log('Authorization successful!');
  Logger.log('Token length: ' + token.length + ' characters');
  
  // Also try a simple fetch to warm up the connection
  try {
    const testUrl = 'https://analyticsdata.googleapis.com/v1beta/properties/' + GA4_PROPERTY_ID + '/metadata';
    const response = UrlFetchApp.fetch(testUrl, {
      method: 'get',
      headers: { 'Authorization': 'Bearer ' + token },
      muteHttpExceptions: true
    });
    Logger.log('API reachable: ' + (response.getResponseCode() === 200 ? 'Yes' : 'No (code: ' + response.getResponseCode() + ')'));
  } catch (e) {
    Logger.log('Could not reach API: ' + e.toString());
  }
}
