  // ========================================
  // UWC Immersive Zone - Analytics Dashboard
  // Cloudflare Pages Edition
  // ========================================

  // API helper — replaces google.script.run
  const API_BASE = '/api';

  async function callAPI(action, params) {
    var token = window.SESSION_TOKEN || '';
    var response = await fetch(API_BASE + '/' + action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: action, params: params || {}, token: token })
    });
    if (!response.ok) {
      throw new Error('API error: ' + response.status);
    }
    return response.json();
  }

  // Apps Script login URL — update this to your deployed Apps Script URL
  const LOGIN_URL = 'https://script.google.com/macros/s/AKfycbzGU2I7Cyklhmry6FicL51YK0jAiIgCnleTb7A4qhgJm-IdNlN5Nf81Al_jSd803AUn/exec';

  // Chart instances
  let timeSeriesChart = null;
  let activityChart = null;
  let devicesChart = null;
  let bounceSparkline = null;

  // Current period
  let currentPeriod = 'WEEKLY';
  let totalUsers = 0;

  // Auto-refresh config
  const SYNC_INTERVAL = 60; // seconds between data refreshes
  let syncCountdown = SYNC_INTERVAL;
  let syncTimer = null;
  let deploymentVersion = null; // tracks current deployment version

  // UWC Brand color palette
  const colors = {
    primary: '#003366',      // UWC Blue
    primaryLight: 'rgba(0, 51, 102, 0.1)',
    teal: '#00C9A7',
    tealLight: 'rgba(0, 201, 167, 0.15)',
    gold: '#bd9a4f',         // UWC Gold
    goldLight: 'rgba(189, 154, 79, 0.15)',
    purple: '#845EC2',
    pink: '#D65DB1',
    orange: '#FF9671'
  };

  const chartColors = [
    colors.primary,
    colors.teal,
    colors.gold,
    colors.purple,
    colors.pink,
    colors.orange,
    '#0089BA',
    '#00D2FC'
  ];

  // Chart.js global defaults
  Chart.defaults.font.family = "'Inter', -apple-system, sans-serif";
  Chart.defaults.color = '#718096';
  Chart.defaults.plugins.legend.display = false;

  // ========================================
  // Initialization
  // ========================================
  document.addEventListener('DOMContentLoaded', async function() {
    // Read token from URL query parameter
    var urlParams = new URLSearchParams(window.location.search);
    window.SESSION_TOKEN = urlParams.get('token') || '';

    // Strip token from URL bar for security
    if (urlParams.get('token')) {
      window.history.replaceState({}, '', window.location.pathname);
    }

    // Try storage fallback if no token in URL
    if (!window.SESSION_TOKEN) {
      try { window.SESSION_TOKEN = sessionStorage.getItem('uwc_session_token') || ''; } catch(e) {}
    }
    if (!window.SESSION_TOKEN) {
      try { window.SESSION_TOKEN = localStorage.getItem('uwc_session_token') || ''; } catch(e) {}
    }

    // Preview mode for local development
    var isPreview = window.SESSION_TOKEN === 'preview';

    if (!window.SESSION_TOKEN) {
      redirectToLogin();
      return;
    }

    if (!isPreview) {
      // Validate session with backend
      try {
        var session = await callAPI('validateSession', { token: window.SESSION_TOKEN });
        if (!session || !session.valid) {
          redirectToLogin();
          return;
        }
        window.LOGGED_IN_NAME = session.name || 'User';
      } catch (e) {
        redirectToLogin();
        return;
      }
    } else {
      window.LOGGED_IN_NAME = 'Preview User';
    }

    // Persist token in storage
    try { sessionStorage.setItem('uwc_session_token', window.SESSION_TOKEN); } catch(e) {}
    try { sessionStorage.setItem('uwc_session_name', window.LOGGED_IN_NAME); } catch(e) {}
    try { localStorage.setItem('uwc_session_token', window.SESSION_TOKEN); } catch(e) {}
    try { localStorage.setItem('uwc_session_name', window.LOGGED_IN_NAME); } catch(e) {}

    // Session valid — proceed with dashboard initialization
    bustImageCache();
    setLoggedInName();
    setCurrentDate();
    initializePeriodButtons();
    initializeCharts();
    loadDashboardData(currentPeriod);
    fetchInitialDeploymentVersion();
    startSyncTimer();
    // Display app version in footer
    callAPI('getAppVersion')
      .then(function(ver) {
        var el = document.getElementById('footerAppVersion');
        if (el && ver) el.textContent = ver;
      })
      .catch(function() {});
  });

  function bustImageCache() {
    var cacheBuster = '?v=' + Date.now();
    var images = document.querySelectorAll('img[src]');
    images.forEach(function(img) {
      var src = img.getAttribute('src');
      if (src && src.indexOf('?') === -1) {
        img.setAttribute('src', src + cacheBuster);
      }
    });
  }

  function setLoggedInName() {
    var nameEl = document.getElementById('loggedInName');
    if (nameEl && window.LOGGED_IN_NAME && window.LOGGED_IN_NAME !== 'User') {
      nameEl.textContent = window.LOGGED_IN_NAME;
    }
  }

  function setCurrentDate() {
    const now = new Date();
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    document.getElementById('currentDate').textContent = now.toLocaleDateString('en-US', options);
  }

  function initializePeriodButtons() {
    const buttons = document.querySelectorAll('.period-btn');
    buttons.forEach(btn => {
      btn.addEventListener('click', function() {
        buttons.forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        currentPeriod = this.dataset.period;
        loadDashboardData(currentPeriod);
      });
    });
  }

  function initializeCharts() {
    // Time Series Chart - Smooth curved lines like reference
    const timeSeriesCtx = document.getElementById('timeSeriesChart').getContext('2d');

    // Create gradient fills
    const gradient1 = timeSeriesCtx.createLinearGradient(0, 0, 0, 250);
    gradient1.addColorStop(0, 'rgba(0, 51, 102, 0.2)');
    gradient1.addColorStop(1, 'rgba(0, 51, 102, 0)');

    const gradient2 = timeSeriesCtx.createLinearGradient(0, 0, 0, 250);
    gradient2.addColorStop(0, 'rgba(0, 201, 167, 0.15)');
    gradient2.addColorStop(1, 'rgba(0, 201, 167, 0)');

    timeSeriesChart = new Chart(timeSeriesCtx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Users',
            data: [],
            borderColor: colors.primary,
            backgroundColor: gradient1,
            fill: true,
            tension: 0.4,
            borderWidth: 2.5,
            pointRadius: 0,
            pointHoverRadius: 6,
            pointHoverBackgroundColor: colors.primary,
            pointHoverBorderColor: '#fff',
            pointHoverBorderWidth: 2
          },
          {
            label: 'Sessions',
            data: [],
            borderColor: colors.teal,
            backgroundColor: gradient2,
            fill: true,
            tension: 0.4,
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 5
          },
          {
            label: 'Page Views',
            data: [],
            borderColor: colors.gold,
            backgroundColor: 'transparent',
            tension: 0.4,
            borderWidth: 2,
            borderDash: [5, 5],
            pointRadius: 0,
            pointHoverRadius: 5
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          tooltip: {
            backgroundColor: 'rgba(255, 255, 255, 0.95)',
            titleColor: '#1a202c',
            bodyColor: '#4a5568',
            borderColor: '#e2e8f0',
            borderWidth: 1,
            padding: 12,
            cornerRadius: 8,
            boxPadding: 6,
            usePointStyle: true,
            callbacks: {
              label: function(context) {
                return ' ' + context.dataset.label + ': ' + formatNumber(context.raw);
              }
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              font: { size: 11 },
              maxRotation: 0
            }
          },
          y: {
            beginAtZero: true,
            grid: {
              color: 'rgba(0, 0, 0, 0.04)',
              drawBorder: false
            },
            ticks: {
              font: { size: 11 },
              callback: value => formatNumber(value)
            }
          }
        }
      }
    });

    // Activity Mini Chart
    const activityCtx = document.getElementById('activityChart').getContext('2d');
    const activityGradient = activityCtx.createLinearGradient(0, 0, 0, 120);
    activityGradient.addColorStop(0, 'rgba(0, 201, 167, 0.3)');
    activityGradient.addColorStop(1, 'rgba(0, 201, 167, 0)');

    activityChart = new Chart(activityCtx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          data: [],
          borderColor: colors.teal,
          backgroundColor: activityGradient,
          fill: true,
          tension: 0.4,
          borderWidth: 2,
          pointRadius: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false }
        },
        scales: {
          x: { display: false },
          y: { display: false }
        }
      }
    });

    // Devices Bar Chart
    const devicesCtx = document.getElementById('devicesChart').getContext('2d');
    devicesChart = new Chart(devicesCtx, {
      type: 'bar',
      data: {
        labels: ['Desktop', 'Mobile', 'Tablet'],
        datasets: [{
          data: [0, 0, 0],
          backgroundColor: [colors.primary, colors.teal, colors.purple],
          borderRadius: 8,
          barThickness: 40
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y',
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(255,255,255,0.95)',
            titleColor: '#1a202c',
            bodyColor: '#4a5568',
            borderColor: '#e2e8f0',
            borderWidth: 1,
            padding: 10,
            cornerRadius: 8
          }
        },
        scales: {
          x: {
            grid: {
              color: 'rgba(0,0,0,0.04)',
              drawBorder: false
            },
            ticks: { font: { size: 10 } }
          },
          y: {
            grid: { display: false },
            ticks: { font: { size: 11 } }
          }
        }
      }
    });

    // Bounce Rate Sparkline
    var bounceCtx = document.getElementById('bounceSparkline');
    if (bounceCtx) {
      bounceSparkline = new Chart(bounceCtx.getContext('2d'), {
        type: 'line',
        data: {
          labels: [],
          datasets: [{
            data: [],
            borderColor: '#8B1538',
            backgroundColor: 'rgba(139, 21, 56, 0.1)',
            fill: true,
            tension: 0.4,
            borderWidth: 1.5,
            pointRadius: 0
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { enabled: false } },
          scales: { x: { display: false }, y: { display: false } }
        }
      });
    }
  }

  // ========================================
  // Data Loading
  // ========================================
  async function loadDashboardData(period) {
    showLoading(true);

    // Fade out content during load to prevent visual jump
    var content = document.getElementById('dashboardContent');
    if (content) {
      content.style.opacity = '0.5';
      content.style.transition = 'opacity 0.2s ease';
    }

    try {
      var data = await callAPI('fetchAllDashboardData', { period: period });
      handleDashboardData(data);
    } catch (error) {
      handleError(error);
    } finally {
      // Fade back in
      if (content) {
        content.style.opacity = '1';
      }
    }
  }

  function handleDashboardData(data) {
    showLoading(false);
    hidePreloader();
    resetSyncCountdown();

    // Log API response for debugging data issues
    console.log('[Dashboard] API response received:', Object.keys(data));

    if (data.overview && data.overview.success) {
      updateMetrics(data.overview.data);
      updateDateRange(data.overview.dateRange);
    } else {
      console.warn('[Dashboard] Overview failed:', data.overview);
    }

    if (data.timeSeries && data.timeSeries.success) {
      updateTimeSeriesChart(data.timeSeries.data);
      updateActivityChart(data.timeSeries.data);
    } else {
      console.warn('[Dashboard] TimeSeries failed:', data.timeSeries);
    }

    if (data.devices && data.devices.success) {
      updateDevicesChart(data.devices.data);
    } else {
      console.warn('[Dashboard] Devices failed:', data.devices);
    }

    if (data.topPages && data.topPages.success) {
      updateTopPagesTable(data.topPages.data);
    } else {
      console.warn('[Dashboard] TopPages failed:', data.topPages);
    }

    if (data.countries && data.countries.success) {
      updateCountriesTable(data.countries.data);
      updateGeoMap(data.countries.data);
    } else {
      console.warn('[Dashboard] Countries failed:', data.countries);
    }

    if (data.events && data.events.success) {
      updateEventsTable(data.events.data);
    } else {
      console.warn('[Dashboard] Events failed:', data.events);
    }

    if (data.trafficSources && data.trafficSources.success) {
      updateTrafficSourcesTable(data.trafficSources.data);
    } else {
      console.warn('[Dashboard] TrafficSources failed:', data.trafficSources);
    }

    if (data.bounceTimeSeries && data.bounceTimeSeries.success) {
      updateBounceSparkline(data.bounceTimeSeries.data);
    } else {
      console.warn('[Dashboard] BounceTimeSeries failed:', data.bounceTimeSeries);
    }

    if (data.realtime) {
      updateRealtimeBadge(data.realtime);
    } else {
      console.warn('[Dashboard] Realtime failed:', data.realtime);
    }

    if (data.pageFlow && data.pageFlow.success) {
      updateJourneyFlow(data.pageFlow.data, data.events ? data.events.data : []);
    } else {
      console.warn('[Dashboard] PageFlow failed:', data.pageFlow);
    }

    // Update "Last Updated" timestamp
    updateLastUpdated();
  }

  function handleError(error) {
    showLoading(false);
    hidePreloader();
    console.error('Dashboard error:', error);

    // Check if this is a session/auth error
    var errStr = error ? error.toString().toLowerCase() : '';
    if (errStr.indexOf('authorization') !== -1 || errStr.indexOf('permission') !== -1 ||
        errStr.indexOf('not logged in') !== -1 || errStr.indexOf('invalid session') !== -1 ||
        errStr.indexOf('invalid_session') !== -1) {
      // Session likely expired — redirect to login
      redirectToLogin();
      return;
    }

    document.getElementById('dateRangeDisplay').textContent = 'Error loading data — retrying...';
    // Auto-retry once after 5 seconds
    setTimeout(function() {
      loadDashboardData(currentPeriod);
    }, 5000);
  }

  function hidePreloader() {
    var progress = document.getElementById('preloaderProgress');
    var overlay = document.getElementById('preloaderOverlay');
    if (progress) progress.classList.add('complete');
    setTimeout(function() {
      if (overlay) overlay.classList.add('hidden');
    }, 400);
  }

  // ========================================
  // UI Updates
  // ========================================
  function showLoading(isLoading) {
    const indicator = document.getElementById('refreshIndicator');
    if (isLoading) {
      indicator.classList.add('loading');
    } else {
      indicator.classList.remove('loading');
    }
  }

  function updateMetrics(metrics) {
    totalUsers = metrics.totalUsers;

    document.getElementById('totalUsers').textContent = formatNumber(metrics.totalUsers);
    document.getElementById('sessions').textContent = formatNumber(metrics.sessions);
    document.getElementById('pageViews').textContent = formatNumber(metrics.pageViews);
    document.getElementById('avgDuration').textContent = formatDuration(metrics.avgSessionDuration);

    // Activity stats
    document.getElementById('newUsersVal').textContent = formatNumber(metrics.newUsers);
    document.getElementById('engagementVal').textContent = metrics.engagementRate + '%';
    document.getElementById('bounceVal').textContent = metrics.bounceRate + '%';

    // Update comparison change indicators
    if (metrics.changes) {
      applyChangeIndicator('changeUsers', metrics.changes.totalUsers);
      applyChangeIndicator('changeSessions', metrics.changes.sessions);
      applyChangeIndicator('changePageViews', metrics.changes.pageViews);
      applyChangeIndicator('changeDuration', metrics.changes.avgSessionDuration);
    }
  }

  function applyChangeIndicator(elementId, pctChange) {
    var el = document.getElementById(elementId);
    if (!el) return;

    var iconEl = el.querySelector('.change-icon');
    var textEl = el.querySelector('.change-text');

    // Remove old classes
    el.classList.remove('positive', 'negative', 'neutral');

    if (pctChange === null || pctChange === undefined) {
      el.classList.add('neutral');
      iconEl.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
      textEl.textContent = 'No prior data';
      return;
    }

    if (pctChange > 0) {
      el.classList.add('positive');
      iconEl.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="18 15 12 9 6 15"></polyline></svg>';
      textEl.textContent = '+' + pctChange + '% vs prev';
    } else if (pctChange < 0) {
      el.classList.add('negative');
      iconEl.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="6 9 12 15 18 9"></polyline></svg>';
      textEl.textContent = pctChange + '% vs prev';
    } else {
      el.classList.add('neutral');
      iconEl.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
      textEl.textContent = '0% vs prev';
    }
  }

  function updateDateRange(dateRange) {
    const start = formatDate(dateRange.startDate);
    const end = formatDate(dateRange.endDate);
    document.getElementById('dateRangeDisplay').textContent =
      start === end ? start : `${start} — ${end}`;
  }

  function updateLastUpdated() {
    var el = document.getElementById('lastUpdated');
    if (!el) return;
    var now = new Date();
    var h = now.getHours();
    var m = now.getMinutes();
    var ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    var mStr = m < 10 ? '0' + m : m;
    el.textContent = 'Updated ' + h + ':' + mStr + ' ' + ampm;
  }

  function updateRealtimeBadge(realtimeData) {
    var countEl = document.getElementById('realtimeCount');
    var badge = document.getElementById('realtimeBadge');
    if (!countEl || !badge) return;

    if (realtimeData && realtimeData.success) {
      countEl.textContent = realtimeData.activeUsers;
      badge.classList.toggle('has-users', realtimeData.activeUsers > 0);
    } else {
      countEl.textContent = '0';
      badge.classList.remove('has-users');
    }
  }

  function updateTimeSeriesChart(data) {
    if (!data.labels || data.labels.length === 0) {
      timeSeriesChart.data.labels = ['No data'];
      timeSeriesChart.data.datasets[0].data = [0];
      timeSeriesChart.data.datasets[1].data = [0];
      timeSeriesChart.data.datasets[2].data = [0];
      timeSeriesChart.update('none');
      return;
    }
    timeSeriesChart.data.labels = data.labels;
    timeSeriesChart.data.datasets[0].data = data.users;
    timeSeriesChart.data.datasets[1].data = data.sessions;
    timeSeriesChart.data.datasets[2].data = data.pageViews;
    timeSeriesChart.update('none');
  }

  function updateActivityChart(data) {
    if (!data.labels || data.labels.length === 0) {
      activityChart.data.labels = ['No data'];
      activityChart.data.datasets[0].data = [0];
      activityChart.update('none');
      return;
    }
    activityChart.data.labels = data.labels;
    activityChart.data.datasets[0].data = data.users;
    activityChart.update('none');
  }

  function updateDevicesChart(data) {
    if (!data.labels || data.labels.length === 0) {
      devicesChart.data.labels = ['No data'];
      devicesChart.data.datasets[0].data = [0];
      devicesChart.data.datasets[0].backgroundColor = ['#e2e8f0'];
      devicesChart.update('none');
      return;
    }
    devicesChart.data.labels = data.labels;
    devicesChart.data.datasets[0].data = data.values;

    const deviceColors = data.labels.map((label, i) => chartColors[i % chartColors.length]);
    devicesChart.data.datasets[0].backgroundColor = deviceColors;

    devicesChart.update('none');
  }

  function updateTopPagesTable(pages) {
    const tbody = document.querySelector('#topPagesTable tbody');

    if (pages.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" class="loading-cell">No data available</td></tr>';
      return;
    }

    const maxViews = Math.max(...pages.map(p => p.views));

    tbody.innerHTML = pages.slice(0, 8).map(page => `
      <tr>
        <td class="page-title-cell" title="${escapeHtml(page.title)}">${escapeHtml(truncate(page.title, 50))}</td>
        <td>${formatNumber(page.views)}</td>
        <td>${formatDuration(page.avgDuration)}</td>
      </tr>
    `).join('');
  }

  function updateCountriesTable(countries) {
    const tbody = document.querySelector('#countriesTable tbody');

    if (countries.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" class="loading-cell">No data available</td></tr>';
      return;
    }

    const total = countries.reduce((sum, c) => sum + c.users, 0);

    tbody.innerHTML = countries.slice(0, 8).map(country => {
      const pct = total > 0 ? ((country.users / total) * 100).toFixed(1) : 0;
      return `
        <tr>
          <td>${escapeHtml(country.country)}</td>
          <td>${formatNumber(country.users)}</td>
          <td>
            ${pct}%
            <div class="progress-bar">
              <div class="progress-fill" style="width: ${pct}%"></div>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  // Custom tracked events — highlight with a tag
  var customEvents = [
    'open_interactive_model',
    'visit_project_site',
    'scroll_depth',
    'time_on_page'
  ];

  function updateEventsTable(events) {
    const tbody = document.querySelector('#eventsTable tbody');

    if (!events || events.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" class="loading-cell">No events recorded</td></tr>';
      return;
    }

    const maxCount = Math.max(...events.map(e => e.count));

    tbody.innerHTML = events.slice(0, 15).map(ev => {
      const pct = maxCount > 0 ? ((ev.count / maxCount) * 100).toFixed(1) : 0;
      const isCustom = customEvents.indexOf(ev.name) !== -1;
      const tag = isCustom ? '<span class="event-custom-tag">TRACKED</span>' : '';
      return `
        <tr>
          <td class="event-name-cell" title="${escapeHtml(ev.name)}">${escapeHtml(ev.name)}${tag}</td>
          <td>
            ${formatNumber(ev.count)}
            <div class="progress-bar">
              <div class="progress-fill" style="width: ${pct}%"></div>
            </div>
          </td>
          <td>${formatNumber(ev.users)}</td>
        </tr>
      `;
    }).join('');
  }

  // ========================================
  // Traffic Sources Table
  // ========================================
  var channelColors = {
    'Organic Search': '#003366',
    'Direct': '#00C9A7',
    'Referral': '#bd9a4f',
    'Organic Social': '#845EC2',
    'Paid Search': '#D65DB1',
    'Email': '#FF9671',
    'Display': '#0089BA',
    'Unassigned': '#a0aec0'
  };

  function updateTrafficSourcesTable(data) {
    var tbody = document.querySelector('#trafficSourcesTable tbody');
    if (!tbody) return;

    if (!data || !data.labels || data.labels.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" class="loading-cell">No data available</td></tr>';
      return;
    }

    var total = data.values.reduce(function(sum, v) { return sum + v; }, 0);

    tbody.innerHTML = data.labels.map(function(label, i) {
      var val = data.values[i];
      var pct = total > 0 ? ((val / total) * 100).toFixed(1) : 0;
      var color = channelColors[label] || chartColors[i % chartColors.length];
      return '<tr>' +
        '<td><div class="traffic-channel-cell">' +
          '<span class="traffic-channel-dot" style="background:' + color + '"></span>' +
          '<span class="traffic-channel-name">' + escapeHtml(label) + '</span>' +
        '</div></td>' +
        '<td>' + formatNumber(val) + '</td>' +
        '<td>' + pct + '%<div class="progress-bar"><div class="progress-fill" style="width:' + pct + '%;background:' + color + '"></div></div></td>' +
      '</tr>';
    }).join('');
  }

  // ========================================
  // Bounce Rate Sparkline
  // ========================================
  function updateBounceSparkline(data) {
    if (!bounceSparkline) return;
    if (!data || !data.labels || data.labels.length === 0) {
      bounceSparkline.data.labels = ['No data'];
      bounceSparkline.data.datasets[0].data = [0];
      bounceSparkline.update('none');
      return;
    }
    bounceSparkline.data.labels = data.labels;
    bounceSparkline.data.datasets[0].data = data.bounceRates;
    bounceSparkline.update('none');
  }

  // ========================================
  // Geographic Map
  // ========================================
  // Simplified world map — country name → SVG path data
  // Using rough continental outlines for visual representation
  var geoCountryPaths = {
    'South Africa': 'M485,340 L500,330 L515,335 L520,345 L515,360 L505,365 L490,360 L480,350 Z',
    'United States': 'M120,140 L200,130 L220,145 L210,170 L190,180 L150,175 L120,165 Z',
    'United Kingdom': 'M430,115 L440,105 L445,115 L440,125 L435,125 Z',
    'India': 'M590,200 L610,180 L625,190 L620,230 L605,250 L590,240 L585,215 Z',
    'Germany': 'M460,115 L470,110 L475,120 L470,130 L460,125 Z',
    'Brazil': 'M220,260 L260,240 L280,260 L270,300 L240,320 L210,300 L200,270 Z',
    'Canada': 'M100,70 L220,60 L240,80 L220,110 L180,115 L130,110 L100,95 Z',
    'Australia': 'M660,310 L720,300 L740,320 L730,350 L700,360 L670,345 L660,325 Z',
    'France': 'M440,125 L455,120 L460,130 L455,140 L445,140 L438,135 Z',
    'Netherlands': 'M450,110 L460,108 L462,115 L455,118 L450,115 Z',
    'Japan': 'M720,160 L725,150 L730,155 L728,170 L722,175 L718,165 Z',
    'Nigeria': 'M460,240 L475,235 L480,245 L475,255 L462,255 L458,248 Z',
    'Kenya': 'M520,250 L530,245 L535,255 L530,265 L520,260 Z',
    'China': 'M620,140 L680,130 L700,150 L690,180 L650,190 L620,175 L615,155 Z',
    'Russia': 'M480,50 L700,40 L750,70 L720,100 L600,110 L500,100 L470,75 Z',
    'Mexico': 'M120,185 L160,180 L170,200 L150,215 L130,210 L115,200 Z',
    'Italy': 'M465,130 L470,125 L475,135 L472,150 L467,148 L464,140 Z',
    'Spain': 'M425,140 L445,135 L450,145 L442,150 L428,150 L422,145 Z',
    'Egypt': 'M500,190 L520,185 L525,200 L515,210 L500,205 Z',
    'Indonesia': 'M640,260 L680,255 L700,265 L690,275 L650,275 L635,270 Z',
    'South Korea': 'M705,155 L712,150 L715,158 L710,165 L705,162 Z',
    'Turkey': 'M500,145 L530,140 L540,150 L525,155 L500,155 Z',
    'Argentina': 'M230,320 L250,310 L255,340 L245,370 L235,380 L225,360 L220,335 Z',
    'Saudi Arabia': 'M530,195 L555,185 L565,200 L555,215 L535,215 L525,205 Z',
    'Thailand': 'M635,215 L645,210 L650,225 L645,240 L637,235 L633,225 Z',
    'Zimbabwe': 'M510,330 L520,325 L525,335 L520,340 L510,338 Z',
    'Mozambique': 'M525,325 L535,320 L538,340 L530,350 L522,345 Z',
    'Tanzania': 'M520,270 L535,265 L540,280 L530,290 L518,285 Z',
    'Namibia': 'M475,330 L490,325 L495,340 L490,355 L478,350 L472,340 Z',
    'Botswana': 'M495,330 L510,325 L515,340 L508,350 L495,345 Z',
    'Ghana': 'M445,245 L455,240 L458,252 L452,258 L445,255 Z',
    'Zambia': 'M500,300 L520,295 L525,310 L515,320 L500,315 Z',
    'Uganda': 'M515,250 L525,245 L530,255 L525,260 L515,258 Z',
    'Ethiopia': 'M530,230 L550,225 L555,240 L545,250 L530,245 Z',
    'Philippines': 'M690,220 L700,215 L705,230 L698,240 L690,235 Z',
    'Vietnam': 'M650,200 L658,195 L663,210 L658,230 L650,225 L648,210 Z',
    'Malaysia': 'M645,250 L665,248 L670,255 L660,260 L645,258 Z',
    'Pakistan': 'M575,175 L595,168 L600,185 L590,195 L575,190 Z',
    'Bangladesh': 'M610,195 L620,190 L623,200 L618,205 L610,202 Z',
    'Poland': 'M470,105 L485,100 L490,110 L480,118 L468,115 Z',
    'Sweden': 'M465,70 L475,60 L480,80 L475,95 L465,90 Z',
    'Norway': 'M455,55 L465,45 L475,55 L470,75 L460,80 L455,70 Z',
    'Colombia': 'M195,230 L215,225 L220,240 L210,255 L195,250 Z',
    'Chile': 'M215,320 L225,315 L228,350 L222,380 L215,375 L212,340 Z',
    'Peru': 'M190,260 L210,255 L215,280 L205,300 L190,295 Z',
    'New Zealand': 'M750,360 L758,355 L762,370 L755,380 L748,372 Z',
    'Ireland': 'M420,110 L428,105 L430,115 L425,118 Z',
    'Portugal': 'M420,140 L428,138 L430,150 L425,155 L420,148 Z',
    'Singapore': 'M650,262 L655,260 L657,265 L653,267 L650,265 Z',
    'UAE': 'M555,200 L565,198 L568,205 L562,208 L555,206 Z'
  };

  function updateGeoMap(countries) {
    var svg = document.getElementById('geoMapSvg');
    var legend = document.getElementById('geoLegend');
    var countLabel = document.getElementById('geoTotalCountries');
    if (!svg || !legend) return;

    // Clear existing
    svg.innerHTML = '';
    legend.innerHTML = '';

    if (!countries || countries.length === 0) {
      svg.innerHTML = '<text x="400" y="200" text-anchor="middle" fill="#a0aec0" font-size="14" font-family="Inter,sans-serif">No geographic data available</text>';
      if (countLabel) countLabel.textContent = '0 countries';
      return;
    }

    if (countLabel) countLabel.textContent = countries.length + ' countries';

    // Build a map of country name → user count
    var countryMap = {};
    var maxUsers = 0;
    countries.forEach(function(c) {
      countryMap[c.country] = c.users;
      if (c.users > maxUsers) maxUsers = c.users;
    });

    // Color scale: UWC blue with varying opacity
    function getCountryColor(users) {
      if (!users || users === 0) return '#e2e8f0';
      var intensity = Math.max(0.15, Math.min(1, users / maxUsers));
      // Blend from light gold to UWC blue based on intensity
      if (intensity < 0.3) return 'rgba(189, 154, 79, 0.35)';
      if (intensity < 0.6) return 'rgba(0, 51, 102, 0.4)';
      return 'rgba(10, 26, 92, ' + (0.4 + intensity * 0.55) + ')';
    }

    // Add tooltip element
    var tooltip = document.createElement('div');
    tooltip.className = 'geo-tooltip';
    tooltip.id = 'geoTooltip';
    var container = document.getElementById('geoMapContainer');
    // Remove old tooltip if exists
    var oldTooltip = document.getElementById('geoTooltip');
    if (oldTooltip) oldTooltip.remove();
    container.style.position = 'relative';
    container.appendChild(tooltip);

    // Draw all known country paths
    Object.keys(geoCountryPaths).forEach(function(name) {
      var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', geoCountryPaths[name]);
      path.setAttribute('class', 'geo-country' + (countryMap[name] ? ' active' : ''));
      path.setAttribute('fill', getCountryColor(countryMap[name] || 0));
      path.setAttribute('data-country', name);
      path.setAttribute('data-users', countryMap[name] || 0);

      // Tooltip events
      path.addEventListener('mouseenter', function(e) {
        var users = parseInt(this.getAttribute('data-users'));
        if (users > 0) {
          tooltip.innerHTML = '<span class="geo-tooltip-country">' + name + '</span><span class="geo-tooltip-value">' + formatNumber(users) + ' users</span>';
          tooltip.style.display = 'block';
        }
      });
      path.addEventListener('mousemove', function(e) {
        var rect = container.getBoundingClientRect();
        tooltip.style.left = (e.clientX - rect.left + 10) + 'px';
        tooltip.style.top = (e.clientY - rect.top - 30) + 'px';
      });
      path.addEventListener('mouseleave', function() {
        tooltip.style.display = 'none';
      });

      svg.appendChild(path);
    });

    // Legend — top 5 countries
    var total = countries.reduce(function(sum, c) { return sum + c.users; }, 0);
    countries.slice(0, 5).forEach(function(c, i) {
      var pct = total > 0 ? ((c.users / total) * 100).toFixed(0) : 0;
      var color = getCountryColor(c.users);
      legend.innerHTML += '<span class="geo-legend-item">' +
        '<span class="geo-legend-dot" style="background:' + color + '"></span>' +
        escapeHtml(c.country) + ' <span class="geo-legend-count">' + pct + '%</span>' +
      '</span>';
    });
  }

  // ========================================
  // Utility Functions
  // ========================================
  function formatNumber(num) {
    if (num === null || num === undefined || isNaN(num)) return '-';
    num = parseInt(num);
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    } else if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    }
    return num.toLocaleString();
  }

  function formatDuration(seconds) {
    if (!seconds || seconds === 0) return '0s';
    seconds = parseFloat(seconds);

    if (seconds < 60) {
      return Math.round(seconds) + 's';
    } else if (seconds < 3600) {
      const mins = Math.floor(seconds / 60);
      const secs = Math.round(seconds % 60);
      return mins + 'm ' + secs + 's';
    } else {
      const hrs = Math.floor(seconds / 3600);
      const mins = Math.floor((seconds % 3600) / 60);
      return hrs + 'h ' + mins + 'm';
    }
  }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return months[parseInt(parts[1]) - 1] + ' ' + parseInt(parts[2]) + ', ' + parts[0];
    }
    return dateStr;
  }

  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function truncate(str, len) {
    if (!str) return '';
    return str.length > len ? str.substring(0, len) + '...' : str;
  }

  // ========================================
  // GA4 Outbound Click Tracking
  // ========================================
  function trackOutboundClick(eventName, source, destination, event) {
    // GA4 tag removed from dashboard to stop self-tracking.
    // Outbound clicks are now tracked on the destination pages themselves.
    // This function is kept as a no-op so onclick handlers don't throw errors.
    console.log('[Dashboard] Outbound click:', eventName, source, destination);
  }

  // ========================================
  // Side Tab Toggle with Auto-Hide
  // ========================================
  var sideTabTimer = null;

  function toggleSideTab() {
    var tab = document.getElementById('sideTab');
    tab.classList.toggle('collapsed');
    if (!tab.classList.contains('collapsed')) {
      startSideTabTimer();
    } else {
      clearSideTabTimer();
    }
  }

  function startSideTabTimer() {
    clearSideTabTimer();
    sideTabTimer = setTimeout(function() {
      var tab = document.getElementById('sideTab');
      if (tab && !tab.classList.contains('collapsed')) {
        tab.classList.add('collapsed');
      }
    }, 5000);
  }

  function clearSideTabTimer() {
    if (sideTabTimer) {
      clearTimeout(sideTabTimer);
      sideTabTimer = null;
    }
  }

  // Initialize side tab as collapsed + auto-hide listeners
  document.addEventListener('DOMContentLoaded', function() {
    var tab = document.getElementById('sideTab');
    if (tab) {
      tab.classList.add('collapsed');
      tab.addEventListener('mouseenter', function() {
        if (!tab.classList.contains('collapsed')) {
          clearSideTabTimer();
        }
      });
      tab.addEventListener('mouseleave', function() {
        if (!tab.classList.contains('collapsed')) {
          startSideTabTimer();
        }
      });
    }
  });

  // ========================================
  // PDF Export - Force fit to single page
  // ========================================
  async function exportToPDF() {
    const btn = document.getElementById('exportPdfBtn');
    const originalHTML = btn.innerHTML;

    btn.innerHTML = '<div class="spinner"></div> Generating...';
    btn.disabled = true;

    try {
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      // Header height and footer height
      const headerHeight = 30;
      const footerHeight = 12;
      const contentMargin = 2;
      const sideMargin = 3; // 3mm each side for wider content

      // Available height for content (page height minus header, footer, and margins)
      const availableHeight = pageHeight - headerHeight - footerHeight - (contentMargin * 2);
      const contentWidth = pageWidth - (sideMargin * 2);

      // Draw Header - white background
      pdf.setFillColor(255, 255, 255);
      pdf.rect(0, 0, pageWidth, headerHeight, 'F');

      // Add header logo centered via API base64 fetch
      var logoYEnd = 12;
      try {
        var logoBase64 = await callAPI('fetchLogoAsBase64');
        if (logoBase64) {
          var logoH = 10;
          var tempImg = new Image();
          tempImg.src = logoBase64;
          await new Promise(function(r) { tempImg.onload = r; tempImg.onerror = r; });
          var logoW = (tempImg.naturalWidth / tempImg.naturalHeight) * logoH;
          pdf.addImage(logoBase64, 'PNG', (pageWidth - logoW) / 2, 5, logoW, logoH);
          logoYEnd = 16;
        }
      } catch(e) { console.warn('Logo embed failed:', e); }

      pdf.setTextColor(0, 0, 0);
      pdf.setFontSize(9);
      pdf.setFont('helvetica', 'bold');
      pdf.text('UWC Immersive Zone', pageWidth / 2, logoYEnd + 2, { align: 'center' });

      pdf.setFontSize(7);
      pdf.setFont('helvetica', 'normal');
      pdf.text('Analytics Dashboard - Interactive Loggerhead Turtle JigSpace Solution', pageWidth / 2, logoYEnd + 6, { align: 'center' });

      pdf.setFontSize(6);
      const dateStr = document.getElementById('dateRangeDisplay').textContent;
      pdf.text('Report Period: ' + dateStr, pageWidth / 2, logoYEnd + 10, { align: 'center' });

      // Blue UWC line below header
      pdf.setFillColor(10, 26, 92); // --uwc-blue #0a1a5c
      var blueLineY = headerHeight - 1.5;
      pdf.rect(0, blueLineY, pageWidth, 1.5, 'F');

      // Capture dashboard content
      const content = document.getElementById('dashboardContent');

      // Use higher scale for better quality
      const canvas = await html2canvas(content, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#f5f7fa'
      });

      // Calculate scaling to fit content on single page
      const imgAspectRatio = canvas.width / canvas.height;
      let imgWidth = contentWidth;
      let imgHeight = imgWidth / imgAspectRatio;

      // If height exceeds available space, scale down to fit
      if (imgHeight > availableHeight) {
        imgHeight = availableHeight;
        imgWidth = imgHeight * imgAspectRatio;
      }

      // Center horizontally if width is less than available
      const xOffset = (pageWidth - imgWidth) / 2;
      const yOffset = headerHeight + contentMargin;

      // Add the scaled image
      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      pdf.addImage(imgData, 'JPEG', xOffset, yOffset, imgWidth, imgHeight);

      // Draw Footer
      pdf.setFillColor(0, 34, 68);
      pdf.rect(0, pageHeight - footerHeight, pageWidth, footerHeight, 'F');

      pdf.setTextColor(255, 255, 255);
      pdf.setFontSize(7);
      pdf.text('University of the Western Cape | UWC Immersive Zone | 405 Voortrekker Road, Oostersee | infouih@uwc.ac.za',
               pageWidth / 2, pageHeight - 5, { align: 'center' });

      // Save PDF
      const today = new Date().toISOString().split('T')[0];
      pdf.save(`UWC_Analytics_${currentPeriod}_${today}.pdf`);

    } catch (error) {
      console.error('PDF export error:', error);
      alert('Error generating PDF. Please try again.');
    } finally {
      btn.innerHTML = originalHTML;
      btn.disabled = false;
    }
  }

  // ========================================
  // Session Management & Sign Out
  // ========================================
  async function handleSignOut() {
    var token = window.SESSION_TOKEN || '';
    if (!token) { try { token = sessionStorage.getItem('uwc_session_token') || ''; } catch(e) {} }
    if (!token) { try { token = localStorage.getItem('uwc_session_token') || ''; } catch(e) {} }
    if (token) {
      try {
        await callAPI('signOut', { token: token });
      } catch(e) {
        // Sign out regardless of API success
      }
    }
    redirectToLogin();
  }

  function redirectToLogin() {
    // Clear session from all storage layers
    try { sessionStorage.removeItem('uwc_session_token'); } catch(e) {}
    try { sessionStorage.removeItem('uwc_session_name'); } catch(e) {}
    try { localStorage.removeItem('uwc_session_token'); } catch(e) {}
    try { localStorage.removeItem('uwc_session_name'); } catch(e) {}
    // Redirect to Cloudflare-hosted login page
    window.location.href = '/login.html';
  }

  // ========================================
  // Auto-Refresh & Sync Countdown
  // ========================================
  function startSyncTimer() {
    syncCountdown = SYNC_INTERVAL;
    updateSyncUI();
    if (syncTimer) clearInterval(syncTimer);
    syncTimer = setInterval(function() {
      syncCountdown--;
      if (syncCountdown <= 0) {
        syncCountdown = SYNC_INTERVAL;
        loadDashboardData(currentPeriod);
        checkDeploymentVersion();
      }
      updateSyncUI();
    }, 1000);
  }

  function updateSyncUI() {
    var fill = document.getElementById('syncBarFill');
    var label = document.getElementById('syncCountdown');
    if (!fill || !label) return;

    var pct = ((SYNC_INTERVAL - syncCountdown) / SYNC_INTERVAL) * 100;
    fill.style.width = pct + '%';

    if (syncCountdown <= 0) {
      label.textContent = 'Syncing...';
    } else {
      label.textContent = 'Next sync in ' + syncCountdown + 's';
    }
  }

  function resetSyncCountdown() {
    syncCountdown = SYNC_INTERVAL;
    updateSyncUI();
  }

  // ========================================
  // Deployment Version Check
  // ========================================
  function fetchInitialDeploymentVersion() {
    callAPI('getDeploymentVersion')
      .then(function(version) {
        deploymentVersion = version;
      })
      .catch(function() {
        // Silent fail — version check is non-critical
      });
  }

  function checkDeploymentVersion() {
    callAPI('getDeploymentVersion')
      .then(function(version) {
        if (deploymentVersion && version && version !== deploymentVersion) {
          showUpdatePopup();
        }
        deploymentVersion = version;
      })
      .catch(function() {
        // Silent fail
      });
  }

  function showUpdatePopup() {
    // Stop auto-refresh while popup is shown
    if (syncTimer) {
      clearInterval(syncTimer);
      syncTimer = null;
    }
    var overlay = document.getElementById('updatePopupOverlay');
    if (overlay) overlay.classList.add('visible');
  }

  // ========================================
  // User Journey Flow Visualization
  // ========================================
  function updateJourneyFlow(pages, events) {
    // Classify pages into 3 site buckets
    var gsViews = 0, gsUsers = 0, gsDuration = 0, gsCount = 0;
    var ihViews = 0, ihUsers = 0, ihDuration = 0, ihCount = 0;
    var ttoViews = 0; // track TTO separately so we can exclude it

    if (pages && pages.length > 0) {
      pages.forEach(function(p) {
        var path = (p.path || '').toLowerCase();

        // Google Sites pages — root "/" plus any idealoceanhome or uwc.ac.za path
        // BUT exclude dashboard self-tracking (just "/" alone on Cloudflare domain)
        if (path.indexOf('/uwc.ac.za/idealoceanhome') !== -1 ||
            path.indexOf('/interactive-loggerhead') !== -1) {
          gsViews += p.views;
          gsUsers += p.users;
          gsDuration += p.avgDuration * p.views;
          gsCount += p.views;
        }
        // InnovationHub project page
        else if (path.indexOf('/jigspace/loggerheadturtle') !== -1 ||
                 path.indexOf('/jigspace/loggerhead') !== -1) {
          ihViews += p.views;
          ihUsers += p.users;
          ihDuration += p.avgDuration * p.views;
          ihCount += p.views;
        }
        // TTO pages (excluded from journey but tracked for info)
        else if (path.indexOf('/uwc-tto') !== -1 || path.indexOf('/tto') !== -1) {
          ttoViews += p.views;
        }
        // Root "/" that is the Google Sites homepage
        else if (path === '/') {
          gsViews += p.views;
          gsUsers += p.users;
          gsDuration += p.avgDuration * p.views;
          gsCount += p.views;
        }
      });
    }

    // JigSpace clicks — from the open_interactive_model custom event
    var jigClicks = 0, jigUsers = 0;
    if (events && events.length > 0) {
      events.forEach(function(ev) {
        if (ev.name === 'open_interactive_model') {
          jigClicks = ev.count;
          jigUsers = ev.users;
        }
      });
    }

    // Calculate average durations
    var gsAvgDuration = gsCount > 0 ? gsDuration / gsCount : 0;
    var ihAvgDuration = ihCount > 0 ? ihDuration / ihCount : 0;

    // Update node stats
    setText('jnGSViews', formatNumber(gsViews));
    setText('jnGSUsers', formatNumber(gsUsers));
    setText('jnGSTime', gsAvgDuration > 0 ? 'avg ' + formatDuration(gsAvgDuration) : '—');

    setText('jnIHViews', formatNumber(ihViews));
    setText('jnIHUsers', formatNumber(ihUsers));
    setText('jnIHTime', ihAvgDuration > 0 ? 'avg ' + formatDuration(ihAvgDuration) : '—');

    setText('jnJigViews', formatNumber(jigClicks));
    setText('jnJigUsers', formatNumber(jigUsers));
    setText('jnJigTime', jigClicks > 0 ? 'via button click' : '—');

    // Calculate conversion arrows
    var totalEntry = gsViews + ihViews; // total site entry
    if (totalEntry > 0) {
      var gsToIhPct = ihViews > 0 && gsViews > 0
        ? Math.round((ihViews / (gsViews + ihViews)) * 100)
        : (ihViews > 0 ? 100 : 0);
      setText('jaGStoIH', gsToIhPct + '%');
    } else {
      setText('jaGStoIH', '—');
    }

    if (ihViews > 0) {
      var ihToJigPct = jigClicks > 0
        ? Math.min(Math.round((jigClicks / ihViews) * 100), 100)
        : 0;
      setText('jaIHtoJig', ihToJigPct + '%');
    } else {
      setText('jaIHtoJig', '—');
    }

    // Update funnel bars
    var maxFunnel = Math.max(gsViews, ihViews, jigClicks, 1);
    setStyle('funnelBar1', 'width', Math.max((gsViews / maxFunnel) * 100, 5) + '%');
    setStyle('funnelBar2', 'width', Math.max((ihViews / maxFunnel) * 100, 5) + '%');
    setStyle('funnelBar3', 'width', Math.max((jigClicks / maxFunnel) * 100, 5) + '%');

    setText('funnelVal1', formatNumber(gsViews) + ' views');
    setText('funnelVal2', formatNumber(ihViews) + ' views');
    setText('funnelVal3', formatNumber(jigClicks) + ' clicks');
  }

  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function setStyle(id, prop, val) {
    var el = document.getElementById(id);
    if (el) el.style[prop] = val;
  }

  // Update popup event listeners
  document.addEventListener('DOMContentLoaded', function() {
    var closeBtn = document.getElementById('updatePopupClose');
    var signInBtn = document.getElementById('updatePopupBtn');

    if (closeBtn) {
      closeBtn.addEventListener('click', function() {
        handleSignOut();
      });
    }
    if (signInBtn) {
      signInBtn.addEventListener('click', function() {
        handleSignOut();
      });
    }
  });
