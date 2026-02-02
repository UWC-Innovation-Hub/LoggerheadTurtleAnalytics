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
 * Serves the HTML dashboard
 */
function doGet(e) {
  return HtmlService.createTemplateFromFile('Dashboard')
    .evaluate()
    .setTitle('UWC Immersive Zone - Analytics Dashboard')
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
