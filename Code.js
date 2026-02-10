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
    // Retrieve logged-in user name from session token
    var loggedInName = 'User';
    var sessionValid = false;
    var token = (e && e.parameter && e.parameter.token) || '';
    if (token) {
      try {
        var sessionData = getSessionData(token);
        if (sessionData) {
          loggedInName = sessionData.name || 'User';
          sessionValid = true;
        }
      } catch (ex) {}
    }

    // If no valid session, redirect to login
    if (!sessionValid) {
      return HtmlService.createTemplateFromFile('Login')
        .evaluate()
        .setTitle('UWC Immersive Zone - Login')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
        .addMetaTag('viewport', 'width=device-width, initial-scale=1');
    }

    var template = HtmlService.createTemplateFromFile('Dashboard');
    template.loggedInName = loggedInName;
    template.sessionToken = token;
    return template.evaluate()
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
 * JSON API endpoint for Cloudflare Pages frontend.
 * Receives POST with {action, params, token} and routes to existing functions.
 */
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var action = body.action;
    var params = body.params || {};
    var token = body.token || '';

    // Actions that do NOT require a valid session
    var publicActions = ['validateSession', 'sendAuthCode', 'verifyAuthCode', 'getAppVersion'];

    // Validate session for all protected actions
    if (publicActions.indexOf(action) === -1) {
      var session = getSessionData(token);
      if (!session) {
        return jsonResponse({ success: false, error: 'INVALID_SESSION' });
      }
    }

    var result;
    switch (action) {
      case 'fetchAllDashboardData':
        result = fetchAllDashboardData(params.period || 'WEEKLY');
        break;
      case 'validateSession':
        result = validateSession(params.token || token);
        break;
      case 'signOut':
        result = signOut(params.token || token);
        break;
      case 'getAppVersion':
        result = getAppVersion();
        break;
      case 'getDeploymentVersion':
        result = getDeploymentVersion();
        break;
      case 'fetchLogoAsBase64':
        result = fetchLogoAsBase64();
        break;
      case 'sendAuthCode':
        result = sendAuthCode(params.email);
        break;
      case 'verifyAuthCode':
        result = verifyAuthCode(params.email, params.code);
        break;
      default:
        result = { success: false, error: 'UNKNOWN_ACTION' };
    }

    return jsonResponse(result);
  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}

/**
 * Helper to return JSON from doPost
 */
function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
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
 * Get the previous period date range for comparison
 */
function getPreviousDateRange(period) {
  const today = new Date();
  let startDate, endDate;

  switch(period) {
    case 'DAU':
      // Previous day
      const yesterday = new Date(today.getTime() - 1 * 24 * 60 * 60 * 1000);
      startDate = Utilities.formatDate(yesterday, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      endDate = startDate;
      break;
    case 'WEEKLY':
      const prevWeekEnd = new Date(today.getTime() - 8 * 24 * 60 * 60 * 1000);
      const prevWeekStart = new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000);
      startDate = Utilities.formatDate(prevWeekStart, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      endDate = Utilities.formatDate(prevWeekEnd, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      break;
    case 'MONTHLY':
      const prevMonthEnd = new Date(today.getTime() - 31 * 24 * 60 * 60 * 1000);
      const prevMonthStart = new Date(today.getTime() - 61 * 24 * 60 * 60 * 1000);
      startDate = Utilities.formatDate(prevMonthStart, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      endDate = Utilities.formatDate(prevMonthEnd, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      break;
    case 'YEARLY':
      const prevYearEnd = new Date(today.getTime() - 366 * 24 * 60 * 60 * 1000);
      const prevYearStart = new Date(today.getTime() - 731 * 24 * 60 * 60 * 1000);
      startDate = Utilities.formatDate(prevYearStart, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      endDate = Utilities.formatDate(prevYearEnd, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      break;
    default:
      const defEnd = new Date(today.getTime() - 31 * 24 * 60 * 60 * 1000);
      const defStart = new Date(today.getTime() - 61 * 24 * 60 * 60 * 1000);
      startDate = Utilities.formatDate(defStart, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      endDate = Utilities.formatDate(defEnd, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return { startDate, endDate };
}

/**
 * Fetch overview metrics from GA4 with comparison to previous period
 */
function fetchOverviewMetrics(period) {
  try {
    const { startDate, endDate } = getDateRange(period);
    const prev = getPreviousDateRange(period);

    const requestBody = {
      dateRanges: [
        { startDate: startDate, endDate: endDate },
        { startDate: prev.startDate, endDate: prev.endDate }
      ],
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
      // First row = current period, second row = previous period (if exists)
      var currentVals = result.data.rows[0].metricValues;
      var prevVals = result.data.rows.length > 1 ? result.data.rows[1].metricValues : null;

      var cur = {
        totalUsers: parseInt(currentVals[0].value) || 0,
        newUsers: parseInt(currentVals[1].value) || 0,
        sessions: parseInt(currentVals[2].value) || 0,
        pageViews: parseInt(currentVals[3].value) || 0,
        avgSessionDuration: parseFloat(currentVals[4].value) || 0,
        bounceRate: (parseFloat(currentVals[5].value) * 100).toFixed(1),
        engagementRate: (parseFloat(currentVals[6].value) * 100).toFixed(1),
        activeUsers: parseInt(currentVals[7].value) || 0
      };

      // Calculate % changes vs previous period
      var changes = { totalUsers: null, sessions: null, pageViews: null, avgSessionDuration: null };
      if (prevVals) {
        var prevUsers = parseInt(prevVals[0].value) || 0;
        var prevSessions = parseInt(prevVals[2].value) || 0;
        var prevPageViews = parseInt(prevVals[3].value) || 0;
        var prevDuration = parseFloat(prevVals[4].value) || 0;

        changes.totalUsers = prevUsers > 0 ? Math.round(((cur.totalUsers - prevUsers) / prevUsers) * 100) : (cur.totalUsers > 0 ? 100 : 0);
        changes.sessions = prevSessions > 0 ? Math.round(((cur.sessions - prevSessions) / prevSessions) * 100) : (cur.sessions > 0 ? 100 : 0);
        changes.pageViews = prevPageViews > 0 ? Math.round(((cur.pageViews - prevPageViews) / prevPageViews) * 100) : (cur.pageViews > 0 ? 100 : 0);
        changes.avgSessionDuration = prevDuration > 0 ? Math.round(((cur.avgSessionDuration - prevDuration) / prevDuration) * 100) : 0;
      }

      cur.changes = changes;

      return {
        success: true,
        data: cur,
        period,
        dateRange: { startDate, endDate }
      };
    }

    // Return empty data if no results
    var emptyData = getEmptyMetrics();
    emptyData.changes = { totalUsers: null, sessions: null, pageViews: null, avgSessionDuration: null };
    return {
      success: true,
      data: emptyData,
      period,
      dateRange: { startDate, endDate },
      note: result.error || 'No data available for this period'
    };

  } catch (error) {
    Logger.log('Error fetching overview metrics: ' + error.toString());
    var emptyErr = getEmptyMetrics();
    emptyErr.changes = { totalUsers: null, sessions: null, pageViews: null, avgSessionDuration: null };
    return { success: false, error: error.toString(), data: emptyErr };
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
 * Fetch GA4 event data — event names with their counts
 */
function fetchEventData(period) {
  try {
    const { startDate, endDate } = getDateRange(period);

    const requestBody = {
      dateRanges: [{ startDate: startDate, endDate: endDate }],
      dimensions: [{ name: 'eventName' }],
      metrics: [
        { name: 'eventCount' },
        { name: 'totalUsers' }
      ],
      orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
      limit: 20
    };

    const result = makeGA4Request(requestBody);

    if (result.success && result.data.rows && result.data.rows.length > 0) {
      const events = result.data.rows.map(row => ({
        name: row.dimensionValues[0].value || 'Unknown',
        count: parseInt(row.metricValues[0].value) || 0,
        users: parseInt(row.metricValues[1].value) || 0
      }));

      return { success: true, data: events };
    }

    return { success: true, data: [] };

  } catch (error) {
    Logger.log('Error fetching event data: ' + error.toString());
    return { success: false, error: error.toString() };
  }
}

/**
 * Fetch real-time active users from GA4 Realtime API
 */
function fetchRealtimeUsers() {
  try {
    var realtimeUrl = 'https://analyticsdata.googleapis.com/v1beta/properties/' + GA4_PROPERTY_ID + ':runRealtimeReport';

    var requestBody = {
      metrics: [{ name: 'activeUsers' }]
    };

    var options = {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'Authorization': 'Bearer ' + ScriptApp.getOAuthToken()
      },
      payload: JSON.stringify(requestBody),
      muteHttpExceptions: true
    };

    var response = UrlFetchApp.fetch(realtimeUrl, options);
    var code = response.getResponseCode();

    if (code === 200) {
      var data = JSON.parse(response.getContentText());
      if (data.rows && data.rows.length > 0) {
        return { success: true, activeUsers: parseInt(data.rows[0].metricValues[0].value) || 0 };
      }
      return { success: true, activeUsers: 0 };
    }

    return { success: false, activeUsers: 0, error: 'API ' + code };
  } catch (e) {
    Logger.log('Realtime API error: ' + e);
    return { success: false, activeUsers: 0, error: e.toString() };
  }
}

/**
 * Fetch page-level flow data for the User Journey visualization.
 * Returns pagePath + pageViews + users + avgDuration, which the frontend
 * maps onto the known site nodes (Google Sites → InnovationHub → JigSpace).
 */
function fetchPageFlow(period) {
  try {
    var range = getDateRange(period);

    var requestBody = {
      dateRanges: [{ startDate: range.startDate, endDate: range.endDate }],
      dimensions: [{ name: 'pagePath' }],
      metrics: [
        { name: 'screenPageViews' },
        { name: 'totalUsers' },
        { name: 'averageSessionDuration' }
      ],
      orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
      limit: 30
    };

    var result = makeGA4Request(requestBody);

    if (result.success && result.data.rows && result.data.rows.length > 0) {
      var pages = result.data.rows.map(function(row) {
        return {
          path: row.dimensionValues[0].value || '/',
          views: parseInt(row.metricValues[0].value) || 0,
          users: parseInt(row.metricValues[1].value) || 0,
          avgDuration: parseFloat(row.metricValues[2].value) || 0
        };
      });
      return { success: true, data: pages };
    }

    return { success: true, data: [] };
  } catch (error) {
    Logger.log('Error fetching page flow: ' + error.toString());
    return { success: false, error: error.toString() };
  }
}

/**
 * Fetch bounce rate time series for sparkline trend
 */
function fetchBounceTimeSeries(period) {
  try {
    var range = getDateRange(period);

    var dimension = 'date';
    if (period === 'YEARLY') dimension = 'yearMonth';
    else if (period === 'DAU') dimension = 'hour';

    var requestBody = {
      dateRanges: [{ startDate: range.startDate, endDate: range.endDate }],
      dimensions: [{ name: dimension }],
      metrics: [{ name: 'bounceRate' }],
      orderBys: [{ dimension: { dimensionName: dimension } }]
    };

    var result = makeGA4Request(requestBody);

    if (result.success && result.data.rows && result.data.rows.length > 0) {
      var labels = [];
      var bounceRates = [];

      result.data.rows.forEach(function(row) {
        var label = row.dimensionValues[0].value;
        if (dimension === 'date' && label.length === 8) {
          label = label.substring(4,6) + '/' + label.substring(6,8);
        } else if (dimension === 'yearMonth' && label.length === 6) {
          var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
          var monthNum = parseInt(label.substring(4,6)) - 1;
          label = months[monthNum];
        } else if (dimension === 'hour') {
          label = label + ':00';
        }
        labels.push(label);
        bounceRates.push(parseFloat((parseFloat(row.metricValues[0].value) * 100).toFixed(1)));
      });

      return { success: true, data: { labels: labels, bounceRates: bounceRates } };
    }

    return { success: true, data: { labels: [], bounceRates: [] } };
  } catch (error) {
    Logger.log('Error fetching bounce time series: ' + error.toString());
    return { success: false, error: error.toString() };
  }
}

/**
 * Fetch all dashboard data at once
 */
function fetchAllDashboardData(period) {
  // Wrap each call in try/catch so one failure doesn't kill the entire response
  function safeFetch(fn) {
    try { return fn(); }
    catch(e) { return { success: false, error: e.toString() }; }
  }

  return {
    overview: safeFetch(function() { return fetchOverviewMetrics(period); }),
    timeSeries: safeFetch(function() { return fetchTimeSeriesData(period); }),
    trafficSources: safeFetch(function() { return fetchTrafficSources(period); }),
    topPages: safeFetch(function() { return fetchTopPages(period); }),
    devices: safeFetch(function() { return fetchDeviceData(period); }),
    countries: safeFetch(function() { return fetchCountryData(period); }),
    engagement: safeFetch(function() { return fetchEngagementMetrics(period); }),
    acquisition: safeFetch(function() { return fetchUserAcquisition(period); }),
    events: safeFetch(function() { return fetchEventData(period); }),
    realtime: safeFetch(function() { return fetchRealtimeUsers(); }),
    pageFlow: safeFetch(function() { return fetchPageFlow(period); }),
    bounceTimeSeries: safeFetch(function() { return fetchBounceTimeSeries(period); })
  };
}

/**
 * Returns the current deployment version stamp.
 * Updated automatically each time the script is deployed.
 * Clients poll this to detect new deployments.
 */
function getDeploymentVersion() {
  var props = PropertiesService.getScriptProperties();
  var version = props.getProperty('DEPLOYMENT_VERSION');
  if (!version) {
    // Initialize on first call
    version = new Date().toISOString();
    props.setProperty('DEPLOYMENT_VERSION', version);
  }
  return version;
}

/**
 * Call this after each new deployment to bump the version stamp.
 * Run manually from the Apps Script editor after deploying.
 */
function bumpDeploymentVersion() {
  var version = new Date().toISOString();
  PropertiesService.getScriptProperties().setProperty('DEPLOYMENT_VERSION', version);
  // Also bump the numeric app version
  bumpAppVersion();
  Logger.log('Deployment version bumped to: ' + version);
  return version;
}

/**
 * Numeric app version counter.
 * Stored as an integer in script properties (e.g. 1, 2, ... 15, ... 101).
 * Formatted as "0.XX" for versions < 100, "X.XX" for >= 100.
 * Example: 15 → "0.15", 99 → "0.99", 100 → "1.00", 101 → "1.01", 250 → "2.50"
 */
function getAppVersion() {
  var props = PropertiesService.getScriptProperties();
  var num = parseInt(props.getProperty('APP_VERSION') || '0', 10);
  if (num <= 0) {
    // Initialize at version 1
    num = 1;
    props.setProperty('APP_VERSION', String(num));
  }
  return formatAppVersion(num);
}

function getAppVersionNumber() {
  var props = PropertiesService.getScriptProperties();
  return parseInt(props.getProperty('APP_VERSION') || '1', 10);
}

function formatAppVersion(num) {
  var major = Math.floor(num / 100);
  var minor = num % 100;
  return major + '.' + (minor < 10 ? '0' : '') + minor;
}

/**
 * Bump the numeric app version by 1.
 * Run manually or called by bumpDeploymentVersion().
 */
function bumpAppVersion() {
  var props = PropertiesService.getScriptProperties();
  var num = parseInt(props.getProperty('APP_VERSION') || '0', 10) + 1;
  props.setProperty('APP_VERSION', String(num));
  var formatted = formatAppVersion(num);
  Logger.log('App version bumped to: ' + formatted + ' (build ' + num + ')');
  return formatted;
}

/**
 * Set the app version to a specific number.
 * Run from Apps Script editor: setAppVersion(15) → "0.15"
 */
function setAppVersion(num) {
  num = parseInt(num, 10);
  if (isNaN(num) || num < 1) {
    Logger.log('Error: setAppVersion requires a positive integer. Example: setAppVersion(15) → "0.15"');
    return 'Error: provide a number, e.g. setAppVersion(15)';
  }
  PropertiesService.getScriptProperties().setProperty('APP_VERSION', String(num));
  var formatted = formatAppVersion(num);
  Logger.log('App version set to: ' + formatted + ' (build ' + num + ')');
  return formatted;
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
    siteUrl: 'https://innovationhub.uwc.ac.za/jigspace/LoggerHeadTurtle/'
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
 * Also pre-builds the session token and dashboard URL so verification is instant.
 */
function sendAuthCode(email) {
  try {
    if (!email) return { success: false, error: 'NO_EMAIL' };
    email = String(email).trim().toLowerCase();

    // Anti-spam: 30-second cooldown between requests per email
    var cache = CacheService.getScriptCache();
    var cooldownKey = 'cooldown_' + email;
    if (cache.get(cooldownKey)) {
      return { success: false, error: 'RATE_LIMITED' };
    }

    // Anti-spam: max 3 code requests per email per 15 minutes
    var countKey = 'reqcount_' + email;
    var reqCount = parseInt(cache.get(countKey)) || 0;
    if (reqCount >= 3) {
      return { success: false, error: 'TOO_MANY_REQUESTS' };
    }

    var userCheck = checkUserEmail(email);
    if (!userCheck.success) return userCheck;

    // Set rate limit markers
    cache.put(cooldownKey, 'true', 30);           // 30-second cooldown
    cache.put(countKey, String(reqCount + 1), 900); // 15-minute window

    var code = generateAuthCode();
    var now = new Date();

    // Store code in sheet — batch write (single call instead of 3)
    var sheet = getUsersSheet();
    var row = userCheck.row;
    sheet.getRange(row, 5, 1, 3).setValues([[code, now.toISOString(), 0]]);

    // Pre-build session token & dashboard URL during this step
    // so verifyAuthCode can return instantly without extra API calls
    var token = Utilities.getUuid();
    var cfUrl = PropertiesService.getScriptProperties().getProperty('CF_DASHBOARD_URL');
    var dashboardUrl;
    if (cfUrl) {
      dashboardUrl = cfUrl + '?token=' + token;
    } else {
      var scriptUrl = ScriptApp.getService().getUrl();
      dashboardUrl = scriptUrl + '?page=dashboard&token=' + token;
    }
    cache.put('pending_session_' + email, JSON.stringify({
      token: token,
      name: userCheck.name,
      dashboardUrl: dashboardUrl
    }), 660); // 11 minutes (slightly longer than code expiry)

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
    var apiKey = PropertiesService.getScriptProperties().getProperty('PHP_API_KEY') || 'uwc-analytics-2025-sec';

    var emailSubject = 'UWC Immersive Zone - Loggerhead Turtle Analytics Dashboard Login Code';
    var payload = {
      to: email,
      subject: emailSubject,
      html: buildAuthEmailHtml(name, code),
      text: 'Hi ' + (name || 'User') + ',\n\nYou requested access to the Loggerhead Turtle Analytics Dashboard.\n\nYour login verification code is: ' + code + '\n\nThis code expires in 10 minutes. If you did not request this, please ignore this email.\n\nUWC Immersive Zone\nhttps://innovationhub.uwc.ac.za/jigspace/LoggerHeadTurtle/',
      fromName: 'UWC Immersive Zone'
    };

    var options = {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'X-API-Key': apiKey
      },
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
    var emailSubject = 'UWC Immersive Zone - Loggerhead Turtle Analytics Dashboard Login Code';
    GmailApp.sendEmail(email, emailSubject,
      'Hi ' + (name || 'User') + ',\n\nYou requested access to the Loggerhead Turtle Analytics Dashboard.\n\nYour login verification code is: ' + code + '\n\nThis code expires in 10 minutes. If you did not request this, please ignore this email.\n\nUWC Immersive Zone\nhttps://innovationhub.uwc.ac.za/jigspace/LoggerHeadTurtle/',
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
  return '<div style="max-width:680px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;border:1px solid #e0e0e0;border-radius:8px;overflow:hidden;">' +
    // Header — UWC blue banner with logo
    '<div style="background:#0a1a5c;padding:36px 40px;text-align:center;">' +
    '<img src="https://innovationhub.uwc.ac.za/img/UIH_Logo_FA_white.png" alt="UWC Immersive Zone" style="height:56px;width:auto;margin-bottom:12px;" />' +
    '<h2 style="color:#ffffff;margin:0;font-size:20px;font-weight:600;letter-spacing:0.5px;">Loggerhead Turtle Analytics Dashboard</h2>' +
    '<p style="color:rgba(255,255,255,0.7);margin:6px 0 0;font-size:13px;">Interactive Loggerhead Turtle Hatchlings</p>' +
    '</div>' +
    // Gold accent stripe
    '<div style="height:4px;background:linear-gradient(90deg,#bd9a4f 0%,#d4b96a 100%);"></div>' +
    // Body content
    '<div style="padding:40px 48px;background:#ffffff;">' +
    '<p style="color:#333;font-size:16px;margin:0 0 18px;">Hi ' + (name || 'User') + ',</p>' +
    '<p style="color:#555;font-size:15px;margin:0 0 10px;line-height:1.7;">You requested access to the <strong style="color:#0a1a5c;">Loggerhead Turtle Analytics Dashboard</strong> on the UWC Immersive Zone platform.</p>' +
    '<p style="color:#555;font-size:15px;margin:0 0 24px;line-height:1.7;">Please enter the verification code below to sign in:</p>' +
    // Code box
    '<div style="text-align:center;margin:28px 0;">' +
    '<div style="display:inline-block;padding:20px 44px;background:#fafafa;border:2px solid #bd9a4f;border-radius:12px;font-size:36px;font-weight:bold;letter-spacing:10px;color:#0a1a5c;">' + code + '</div>' +
    '</div>' +
    '<p style="color:#888;font-size:13px;margin:24px 0 0;text-align:center;">This code expires in <strong>10 minutes</strong>. If you did not request this, please ignore this email.</p>' +
    '</div>' +
    // Project preview section
    '<div style="padding:0 48px 36px;background:#ffffff;">' +
    '<div style="border-top:1px solid #eee;padding-top:24px;">' +
    '<p style="color:#0a1a5c;font-size:14px;font-weight:600;margin:0 0 14px;text-align:center;">About this project</p>' +
    '<a href="https://innovationhub.uwc.ac.za/jigspace/LoggerHeadTurtle/" target="_blank" style="display:block;text-decoration:none;">' +
    '<div style="background:#f0f4f8;border-radius:8px;overflow:hidden;border:1px solid #e0e0e0;">' +
    '<div style="background:#0a1a5c;padding:16px 24px;display:flex;align-items:center;">' +
    '<img src="https://innovationhub.uwc.ac.za/img/UIH_Logo_FA_white.png" alt="UWC" style="height:32px;width:auto;margin-right:14px;" />' +
    '<span style="color:#fff;font-size:14px;font-weight:600;">Ideal Ocean Home</span>' +
    '</div>' +
    '<img src="https://innovationhub.uwc.ac.za/jigspace/LoggerHeadTurtle/img/logger-head-turtle_pagepreview.png" alt="Interactive Loggerhead Turtle Hatchlings 3D Model" style="width:100%;height:auto;display:block;" />' +
    '<div style="padding:14px 20px;background:#ffffff;">' +
    '<p style="margin:0;font-size:13px;color:#0a1a5c;font-weight:600;">Interactive Loggerhead Turtle Hatchlings</p>' +
    '<p style="margin:4px 0 0;font-size:12px;color:#777;">UWC Immersive Zone &amp; Faculty of Natural Sciences</p>' +
    '</div>' +
    '</div>' +
    '</a>' +
    '<p style="color:#777;font-size:12px;margin:12px 0 0;text-align:center;line-height:1.5;">Track engagement and performance metrics for the Interactive Loggerhead Turtle Hatchlings educational experience.</p>' +
    '</div>' +
    '</div>' +
    // Footer
    '<div style="background:#f8f8f8;padding:20px 40px;text-align:center;border-top:1px solid #eee;">' +
    '<p style="margin:0 0 4px;font-size:13px;color:#888;">University of the Western Cape | UWC Immersive Zone</p>' +
    '<p style="margin:0;font-size:12px;color:#aaa;">405 Voortrekker Road, Oostersee, Cape Town, 7500</p>' +
    '</div>' +
    '</div>';
}

/**
 * Verify the auth code entered by the user.
 * Uses the pre-built session from sendAuthCode for instant response.
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

        // Check code first (increment attempts only on mismatch)
        if (storedCode !== code) {
          sheet.getRange(i + 1, 7).setValue(attempts + 1);
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

        // Success — batch update: Last Login, clear code, clear timestamp, reset attempts
        var row = i + 1;
        sheet.getRange(row, 4, 1, 4).setValues([[new Date().toISOString(), '', '', 0]]);

        // Retrieve pre-built session from sendAuthCode
        var cache = CacheService.getScriptCache();
        var pendingKey = 'pending_session_' + email;
        var pendingData = cache.get(pendingKey);
        var token, userName, dashboardUrl;

        if (pendingData) {
          var pending = JSON.parse(pendingData);
          token = pending.token;
          userName = pending.name || data[i][1] || 'User';
          dashboardUrl = pending.dashboardUrl;
          cache.remove(pendingKey);
        } else {
          // Fallback if pre-built session expired (shouldn't happen normally)
          token = Utilities.getUuid();
          userName = data[i][1] || 'User';
          var cfUrl = PropertiesService.getScriptProperties().getProperty('CF_DASHBOARD_URL');
          if (cfUrl) {
            dashboardUrl = cfUrl + '?token=' + token;
          } else {
            dashboardUrl = ScriptApp.getService().getUrl() + '?page=dashboard&token=' + token;
          }
        }

        // Activate the session — use PropertiesService for persistence (survives cache eviction)
        var sessionPayload = JSON.stringify({
          email: email,
          name: userName,
          created: new Date().toISOString()
        });
        PropertiesService.getScriptProperties().setProperty('session_' + token, sessionPayload);
        // Also keep in cache for fast reads
        cache.put('session_' + token, sessionPayload, 21600); // 6 hours cache

        return {
          success: true,
          name: userName,
          token: token,
          dashboardUrl: dashboardUrl
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
 * Read session from cache first, then PropertiesService fallback.
 * Sessions expire after 24 hours.
 */
function getSessionData(token) {
  if (!token) return null;
  try {
    var cache = CacheService.getScriptCache();
    var raw = cache.get('session_' + token);

    // Fallback to persistent storage
    if (!raw) {
      raw = PropertiesService.getScriptProperties().getProperty('session_' + token);
      if (raw) {
        // Re-populate cache for fast future reads
        cache.put('session_' + token, raw, 21600);
      }
    }

    if (!raw) return null;

    var data = JSON.parse(raw);

    // Check 24-hour expiry
    if (data.created) {
      var created = new Date(data.created);
      var now = new Date();
      var hoursElapsed = (now - created) / (1000 * 60 * 60);
      if (hoursElapsed > 24) {
        // Session expired — clean up
        PropertiesService.getScriptProperties().deleteProperty('session_' + token);
        cache.remove('session_' + token);
        return null;
      }
    }

    return data;
  } catch (e) {
    Logger.log('getSessionData error: ' + e);
    return null;
  }
}

/**
 * Validate session token (called from dashboard)
 * Returns { valid, name, email } or { valid: false }
 */
function validateSession(token) {
  try {
    var data = getSessionData(token);
    if (data) {
      return { valid: true, name: data.name || 'User', email: data.email || '' };
    }
    return { valid: false };
  } catch (e) {
    return { valid: false };
  }
}

/**
 * Sign out — remove session from both cache and persistent storage
 */
function signOut(token) {
  try {
    if (!token) return { success: false };
    var cache = CacheService.getScriptCache();
    cache.remove('session_' + token);
    PropertiesService.getScriptProperties().deleteProperty('session_' + token);
    return { success: true };
  } catch (e) {
    Logger.log('signOut error: ' + e);
    return { success: false };
  }
}

/**
 * Run this to trigger OAuth consent if needed
 */
/**
 * Test function — run from editor to test login flow
 * Change the email to a registered user in the Users sheet
 */
function testFetchUsers() {
  var sheet = getUsersSheet();
  var data = sheet.getDataRange().getValues();
  Logger.log('Users sheet URL: ' + sheet.getParent().getUrl());
  Logger.log('Total rows (incl header): ' + data.length);
  for (var i = 0; i < data.length; i++) {
    Logger.log('Row ' + (i + 1) + ': ' + JSON.stringify(data[i]));
  }
}

function testSendAuthCode() {
  var testEmail = 'studiouih@uwc.ac.za'; // Change to your test email
  var result = sendAuthCode(testEmail);
  Logger.log('sendAuthCode result: ' + JSON.stringify(result));
}

function testVerifyAuthCode() {
  var testEmail = 'studiouih@uwc.ac.za'; // Same email
  var testCode = 'XXXXX';                 // Replace with code from email
  var result = verifyAuthCode(testEmail, testCode);
  Logger.log('verifyAuthCode result: ' + JSON.stringify(result));
}

/**
 * One-time setup: Set the Cloudflare Pages dashboard URL.
 * Run this from the Apps Script editor to redirect logins to Cloudflare.
 * Delete CF_DASHBOARD_URL property to revert to the old Apps Script dashboard.
 */
function setCloudflareDashboardUrl() {
  var url = 'https://loggerheadturtleanalytics.pages.dev';
  PropertiesService.getScriptProperties().setProperty('CF_DASHBOARD_URL', url);
  Logger.log('CF_DASHBOARD_URL set to: ' + url);
}

function clearCloudflareDashboardUrl() {
  PropertiesService.getScriptProperties().deleteProperty('CF_DASHBOARD_URL');
  Logger.log('CF_DASHBOARD_URL cleared — login will redirect to Apps Script dashboard');
}

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
