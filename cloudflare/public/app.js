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

  // Data cache — holds last successful API response per period
  // Prevents white flashes on refresh by keeping stale data visible until new data arrives
  let cachedData = {};
  let isFirstLoad = true;
  let isFetching = false; // prevents overlapping API calls

  // Data fingerprints — tracks JSON hash of each data section to skip re-renders
  // when auto-refresh returns identical data (common for analytics).
  var dataFingerprints = {};
  function hasDataChanged(key, newData) {
    var hash = JSON.stringify(newData);
    if (dataFingerprints[key] === hash) return false;
    dataFingerprints[key] = hash;
    return true;
  }

  // Render delay — debounces rendering 4s after auto-refresh fetch
  const RENDER_DELAY_MS = 4000;
  var renderDelayTimer = null;

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
          intersect: true
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
  // Data Loading — with caching & graceful refresh
  // ========================================
  async function loadDashboardData(period) {
    // Prevent overlapping fetches — if one is already in flight, skip
    if (isFetching) {
      console.log('[Dashboard] Fetch already in progress, skipping');
      return;
    }
    isFetching = true;

    // Only show the loading spinner on first load — subsequent auto-refreshes
    // keep the old data fully visible while fetching in the background.
    if (isFirstLoad) {
      showLoading(true);
    }

    try {
      var data = await callAPI('fetchAllDashboardData', { period: period });

      // Cache the successful response for this period (immediately available for PDF export)
      cachedData[period] = data;

      if (isFirstLoad) {
        // First load: render immediately — user is waiting on the preloader
        handleDashboardData(data);
        isFirstLoad = false;
      } else {
        // Auto-refresh: delay render by 4s (debounced).  If another fetch
        // completes before the timer fires, the timer resets — only the
        // last fetch triggers a re-render.  This avoids visual churn and
        // lets the data settle before touching the DOM.
        if (renderDelayTimer) clearTimeout(renderDelayTimer);
        renderDelayTimer = setTimeout(function() {
          renderDelayTimer = null;
          var latest = cachedData[currentPeriod];
          if (latest) handleDashboardData(latest);
        }, RENDER_DELAY_MS);
      }
    } catch (error) {
      // If we have cached data for this period, keep showing it
      if (cachedData[period] && !isFirstLoad) {
        console.warn('[Dashboard] Refresh failed, keeping cached data:', error);
        showLoading(false);
        resetSyncCountdown();
      } else {
        handleError(error);
      }
    } finally {
      isFetching = false;
    }
  }

  function handleDashboardData(data) {
    try {
      showLoading(false);
      hidePreloader();
      resetSyncCountdown();

      // Log API response for debugging data issues
      console.log('[Dashboard] API response received:', Object.keys(data));

      // Each section is guarded by hasDataChanged() — if the API returned
      // identical data, the update function is skipped entirely.  This avoids
      // unnecessary chart redraws, table rebuilds, and geo map repaints on the
      // typical 60-second auto-refresh where nothing changed.

      if (data.overview && data.overview.success) {
        if (hasDataChanged('overview', data.overview)) {
          updateMetrics(data.overview.data);
          updateDateRange(data.overview.dateRange);
        }
      } else {
        console.warn('[Dashboard] Overview failed:', data.overview);
      }

      if (data.timeSeries && data.timeSeries.success) {
        if (hasDataChanged('timeSeries', data.timeSeries)) {
          updateTimeSeriesChart(data.timeSeries.data);
          updateActivityChart(data.timeSeries.data);
        }
      } else {
        console.warn('[Dashboard] TimeSeries failed:', data.timeSeries);
      }

      if (data.devices && data.devices.success) {
        if (hasDataChanged('devices', data.devices)) {
          updateDevicesChart(data.devices.data);
        }
      } else {
        console.warn('[Dashboard] Devices failed:', data.devices);
      }

      if (data.topPages && data.topPages.success) {
        if (hasDataChanged('topPages', data.topPages)) {
          updateTopPagesTable(data.topPages.data);
        }
      } else {
        console.warn('[Dashboard] TopPages failed:', data.topPages);
      }

      if (data.countries && data.countries.success) {
        if (hasDataChanged('countries', data.countries)) {
          updateCountriesTable(data.countries.data);
          updateGeoMap(data.countries.data);
        }
      } else {
        console.warn('[Dashboard] Countries failed:', data.countries);
      }

      if (data.events && data.events.success) {
        if (hasDataChanged('events', data.events)) {
          updateEventsTable(data.events.data);
        }
      } else {
        console.warn('[Dashboard] Events failed:', data.events);
      }

      if (data.trafficSources && data.trafficSources.success) {
        if (hasDataChanged('trafficSources', data.trafficSources)) {
          updateTrafficSourcesTable(data.trafficSources.data);
        }
      } else {
        console.warn('[Dashboard] TrafficSources failed:', data.trafficSources);
      }

      if (data.bounceTimeSeries && data.bounceTimeSeries.success) {
        if (hasDataChanged('bounceTimeSeries', data.bounceTimeSeries)) {
          updateBounceSparkline(data.bounceTimeSeries.data);
        }
      } else {
        console.warn('[Dashboard] BounceTimeSeries failed:', data.bounceTimeSeries);
      }

      // Realtime badge — always update (cheap single textContent write, live count)
      if (data.realtime) {
        updateRealtimeBadge(data.realtime);
      } else {
        console.warn('[Dashboard] Realtime failed:', data.realtime);
      }

      if (data.pageFlow && data.pageFlow.success) {
        if (hasDataChanged('pageFlow', data.pageFlow)) {
          updateJourneyFlow(data.pageFlow.data, data.events ? data.events.data : []);
        }
      } else {
        console.warn('[Dashboard] PageFlow failed:', data.pageFlow);
      }

      // Always update — timestamp should reflect when data was last checked
      updateLastUpdated();
    } catch(e) {
      console.error('[Dashboard] Update error:', e);
    }
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

    // If this is the first load (no cached data), show error and retry
    if (isFirstLoad) {
      document.getElementById('dateRangeDisplay').textContent = 'Error loading data — retrying...';
    } else {
      // We have cached data on screen — just show a subtle indicator
      document.getElementById('dateRangeDisplay').textContent = 'Sync failed — retrying...';
    }

    // Auto-retry after 5 seconds
    setTimeout(function() {
      loadDashboardData(currentPeriod);
    }, 5000);
  }

  var preloaderHidden = false;
  function hidePreloader() {
    if (preloaderHidden) return;
    preloaderHidden = true;
    var overlay = document.getElementById('preloaderOverlay');
    if (!overlay) return;
    // Listen for the CSS transition end, then remove from DOM cleanly.
    // No cascading timeouts — the browser tells us when it's done.
    overlay.addEventListener('transitionend', function onEnd() {
      overlay.removeEventListener('transitionend', onEnd);
      overlay.remove();
    });
    // Fallback: if transitionend never fires, remove after 1s
    setTimeout(function() { if (overlay.parentNode) overlay.remove(); }, 1000);
    overlay.classList.add('hidden');
  }

  // ========================================
  // UI Updates
  // ========================================
  function showLoading(isLoading) {
    var indicator = document.getElementById('refreshIndicator');
    if (!indicator) return;
    if (isLoading) {
      indicator.classList.add('loading');
    } else {
      indicator.classList.remove('loading');
    }
  }

  // Update a text element — writes instantly, no transitions.
  // Per-element opacity fades (50+ simultaneous) caused compositor crashes.
  // The preloader covers the first load; refreshes update in-place.
  function smoothSetText(id, newText) {
    var el = document.getElementById(id);
    if (!el) return;
    if (el.textContent === newText) return;
    el.textContent = newText;
  }

  function updateMetrics(metrics) {
    totalUsers = metrics.totalUsers;

    smoothSetText('totalUsers', formatNumber(metrics.totalUsers));
    smoothSetText('sessions', formatNumber(metrics.sessions));
    smoothSetText('pageViews', formatNumber(metrics.pageViews));
    smoothSetText('avgDuration', formatDuration(metrics.avgSessionDuration));

    // Activity stats
    smoothSetText('newUsersVal', formatNumber(metrics.newUsers));
    smoothSetText('engagementVal', metrics.engagementRate + '%');
    smoothSetText('bounceVal', metrics.bounceRate + '%');

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
    var noAnim = { duration: 0 }; // always instant — animations cause compositor stalls
    if (!data.labels || data.labels.length === 0) {
      timeSeriesChart.data.labels = ['No data'];
      timeSeriesChart.data.datasets[0].data = [0];
      timeSeriesChart.data.datasets[1].data = [0];
      timeSeriesChart.data.datasets[2].data = [0];
      timeSeriesChart.update(noAnim);
      return;
    }
    timeSeriesChart.data.labels = data.labels;
    timeSeriesChart.data.datasets[0].data = data.users;
    timeSeriesChart.data.datasets[1].data = data.sessions;
    timeSeriesChart.data.datasets[2].data = data.pageViews;
    timeSeriesChart.update(noAnim);
  }

  function updateActivityChart(data) {
    var noAnim = { duration: 0 }; // always instant — animations cause compositor stalls
    if (!data.labels || data.labels.length === 0) {
      activityChart.data.labels = ['No data'];
      activityChart.data.datasets[0].data = [0];
      activityChart.update(noAnim);
      return;
    }
    activityChart.data.labels = data.labels;
    activityChart.data.datasets[0].data = data.users;
    activityChart.update(noAnim);
  }

  function updateDevicesChart(data) {
    var noAnim = { duration: 0 }; // always instant — animations cause compositor stalls
    if (!data.labels || data.labels.length === 0) {
      devicesChart.data.labels = ['No data'];
      devicesChart.data.datasets[0].data = [0];
      devicesChart.data.datasets[0].backgroundColor = ['#e2e8f0'];
      devicesChart.update(noAnim);
      return;
    }
    devicesChart.data.labels = data.labels;
    devicesChart.data.datasets[0].data = data.values;

    const deviceColors = data.labels.map((label, i) => chartColors[i % chartColors.length]);
    devicesChart.data.datasets[0].backgroundColor = deviceColors;

    devicesChart.update(noAnim);
  }

  // Update element HTML — writes instantly, no transitions.
  // Per-element opacity fades caused compositor crashes on both first load and refresh.
  function fadeUpdateElement(el, newHTML) {
    if (!el) return;
    if (el.innerHTML.trim() === newHTML.trim()) return;
    el.innerHTML = newHTML;
  }

  function updateTopPagesTable(pages) {
    const tbody = document.querySelector('#topPagesTable tbody');

    if (pages.length === 0) {
      fadeUpdateElement(tbody, '<tr><td colspan="3" class="loading-cell">No data available</td></tr>');
      return;
    }

    const maxViews = Math.max(...pages.map(p => p.views));

    var html = pages.slice(0, 8).map(page => `
      <tr>
        <td class="page-title-cell" title="${escapeHtml(page.title)}">${escapeHtml(truncate(page.title, 50))}</td>
        <td>${formatNumber(page.views)}</td>
        <td>${formatDuration(page.avgDuration)}</td>
      </tr>
    `).join('');
    fadeUpdateElement(tbody, html);
  }

  function updateCountriesTable(countries) {
    const tbody = document.querySelector('#countriesTable tbody');

    if (countries.length === 0) {
      fadeUpdateElement(tbody, '<tr><td colspan="3" class="loading-cell">No data available</td></tr>');
      return;
    }

    const total = countries.reduce((sum, c) => sum + c.users, 0);

    var html = countries.slice(0, 8).map(country => {
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
    fadeUpdateElement(tbody, html);
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
      fadeUpdateElement(tbody, '<tr><td colspan="3" class="loading-cell">No events recorded</td></tr>');
      return;
    }

    const maxCount = Math.max(...events.map(e => e.count));

    var html = events.slice(0, 15).map(ev => {
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
    fadeUpdateElement(tbody, html);
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
      fadeUpdateElement(tbody, '<tr><td colspan="3" class="loading-cell">No data available</td></tr>');
      return;
    }

    var total = data.values.reduce(function(sum, v) { return sum + v; }, 0);

    var html = data.labels.map(function(label, i) {
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
    fadeUpdateElement(tbody, html);
  }

  // ========================================
  // Bounce Rate Sparkline
  // ========================================
  function updateBounceSparkline(data) {
    if (!bounceSparkline) return;
    var noAnim = { duration: 0 }; // always instant — animations cause compositor stalls
    if (!data || !data.labels || data.labels.length === 0) {
      bounceSparkline.data.labels = ['No data'];
      bounceSparkline.data.datasets[0].data = [0];
      bounceSparkline.update(noAnim);
      return;
    }
    bounceSparkline.data.labels = data.labels;
    bounceSparkline.data.datasets[0].data = data.bounceRates;
    bounceSparkline.update(noAnim);
  }

  // ========================================
  // Geographic Map
  // ========================================
  // Uses Natural Earth 110m TopoJSON from world-atlas (public domain)
  // Source: https://github.com/topojson/world-atlas (Natural Earth data)
  var geoWorldData = null; // cached TopoJSON

  // ISO 3166-1 numeric → country name (GA4 uses country names)
  var isoToName = {
    '710': 'South Africa', '840': 'United States', '826': 'United Kingdom',
    '356': 'India', '276': 'Germany', '076': 'Brazil', '124': 'Canada',
    '036': 'Australia', '250': 'France', '528': 'Netherlands', '392': 'Japan',
    '566': 'Nigeria', '404': 'Kenya', '156': 'China', '643': 'Russia',
    '484': 'Mexico', '380': 'Italy', '724': 'Spain', '818': 'Egypt',
    '360': 'Indonesia', '410': 'South Korea', '792': 'Turkey',
    '032': 'Argentina', '682': 'Saudi Arabia', '764': 'Thailand',
    '716': 'Zimbabwe', '508': 'Mozambique', '834': 'Tanzania',
    '516': 'Namibia', '072': 'Botswana', '288': 'Ghana',
    '894': 'Zambia', '800': 'Uganda', '231': 'Ethiopia',
    '608': 'Philippines', '704': 'Vietnam', '458': 'Malaysia',
    '586': 'Pakistan', '050': 'Bangladesh', '616': 'Poland',
    '752': 'Sweden', '578': 'Norway', '170': 'Colombia',
    '152': 'Chile', '604': 'Peru', '554': 'New Zealand',
    '372': 'Ireland', '620': 'Portugal', '702': 'Singapore',
    '784': 'UAE', '756': 'Switzerland', '040': 'Austria',
    '056': 'Belgium', '203': 'Czechia', '208': 'Denmark',
    '246': 'Finland', '300': 'Greece', '348': 'Hungary',
    '376': 'Israel', '442': 'Luxembourg', '504': 'Morocco',
    '862': 'Venezuela', '218': 'Ecuador', '858': 'Uruguay',
    '012': 'Algeria', '788': 'Tunisia', '024': 'Angola',
    '180': 'DR Congo', '148': 'Chad', '562': 'Niger',
    '466': 'Mali', '736': 'Sudan', '854': 'Burkina Faso',
    '678': 'São Tomé and Príncipe', '646': 'Rwanda',
    '158': 'Taiwan', '344': 'Hong Kong', '764': 'Thailand',
    '104': 'Myanmar', '418': 'Laos', '116': 'Cambodia',
    '144': 'Sri Lanka', '524': 'Nepal', '496': 'Mongolia',
    '398': 'Kazakhstan', '860': 'Uzbekistan'
  };

  // Lightweight equirectangular projection
  function projectGeo(lon, lat, w, h) {
    var x = (lon + 180) * (w / 360);
    var y = (90 - lat) * (h / 180);
    return [x, y];
  }

  async function loadWorldMap() {
    if (geoWorldData) return geoWorldData;
    try {
      // Natural Earth 110m countries — public domain, hosted on jsDelivr
      var resp = await fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json');
      geoWorldData = await resp.json();
      return geoWorldData;
    } catch (e) {
      console.warn('Failed to load world map data:', e);
      return null;
    }
  }

  // ── Canvas-based geo map ──
  // Stores decoded country geometry as plain arrays — zero DOM nodes
  var geoCountryPaths = null;   // [{name, rings, users}]  — built once from TopoJSON
  var geoCanvasReady = false;
  var geoTooltipBound = false;

  function updateGeoMap(countries) {
    var canvas = document.getElementById('geoMapCanvas');
    var legend = document.getElementById('geoLegend');
    var countLabel = document.getElementById('geoTotalCountries');
    if (!canvas || !legend) return;

    if (!countries || countries.length === 0) {
      if (countLabel) countLabel.textContent = '0 countries';
      if (geoCanvasReady) drawGeoCanvas(canvas, {}, 0);
      legend.innerHTML = '';
      return;
    }

    if (countLabel) countLabel.textContent = countries.length + ' countries';

    // Build country name → user count map
    var countryMap = {};
    var maxUsers = 0;
    countries.forEach(function(c) {
      countryMap[c.country] = c.users;
      if (c.users > maxUsers) maxUsers = c.users;
    });

    // If geometry is already decoded, just redraw — no DOM work at all
    if (geoCanvasReady) {
      drawGeoCanvas(canvas, countryMap, maxUsers);
      updateGeoLegend(legend, countries, maxUsers);
      return;
    }

    // ── First call: load TopoJSON, decode geometry, draw, bind tooltip ──
    loadWorldMap().then(function(topo) {
      if (!topo) return;

      var w = 800, h = 400;
      var geoms = topo.objects.countries.geometries;

      // Decode all country geometry into plain coordinate arrays (no DOM nodes)
      geoCountryPaths = [];
      geoms.forEach(function(geom) {
        var id = geom.id;
        var name = (geom.properties && geom.properties.name) || isoToName[id] || '';
        var rings = topoToRings(topo.arcs, topo.transform, geom, w, h);
        if (rings.length === 0) return;
        geoCountryPaths.push({ name: name, rings: rings });
      });

      geoCanvasReady = true;
      drawGeoCanvas(canvas, countryMap, maxUsers);
      bindGeoTooltip(canvas);
    });

    // Update legend
    updateGeoLegend(legend, countries, maxUsers);
  }

  // Convert TopoJSON geometry to plain coordinate ring arrays (no SVG path strings)
  function topoToRings(arcs, transform, geometry, w, h) {
    var sx = transform.scale[0], sy = transform.scale[1];
    var tx = transform.translate[0], ty = transform.translate[1];

    function decodeArc(arcIdx) {
      var rev = arcIdx < 0;
      var arc = arcs[rev ? ~arcIdx : arcIdx];
      var coords = [], x = 0, y = 0;
      for (var i = 0; i < arc.length; i++) {
        x += arc[i][0]; y += arc[i][1];
        coords.push(projectGeo(x * sx + tx, y * sy + ty, w, h));
      }
      if (rev) coords.reverse();
      return coords;
    }

    function decodeRing(ring) {
      var pts = [];
      for (var i = 0; i < ring.length; i++) {
        var arcCoords = decodeArc(ring[i]);
        pts = pts.concat(i === 0 ? arcCoords : arcCoords.slice(1));
      }
      return pts;
    }

    var rings = [];
    if (geometry.type === 'Polygon') {
      geometry.arcs.forEach(function(ring) {
        var pts = decodeRing(ring);
        if (pts.length > 0) rings.push(pts);
      });
    } else if (geometry.type === 'MultiPolygon') {
      geometry.arcs.forEach(function(polygon) {
        polygon.forEach(function(ring) {
          var pts = decodeRing(ring);
          if (pts.length > 0) rings.push(pts);
        });
      });
    }
    return rings;
  }

  function getCountryColor(users, maxUsers) {
    if (!users || users === 0) return '#e2e8f0';
    var intensity = Math.max(0.05, Math.min(1, users / maxUsers));
    if (intensity < 0.15) return '#e8d5a3';      // pale gold
    if (intensity < 0.35) return '#bd9a4f';       // UWC gold
    if (intensity < 0.55) return '#1a8a7a';       // teal
    if (intensity < 0.75) return '#003366';       // UWC blue
    return '#0a1a5c';                              // deep navy
  }

  // Draw entire map to canvas — pure pixel work, zero DOM manipulation.
  // Debounced via rAF so rapid-fire refresh calls only paint once per frame.
  var _geoDrawRaf = 0;
  function drawGeoCanvas(canvas, countryMap, maxUsers) {
    // Always store the latest data so the tooltip stays correct
    canvas._countryMap = countryMap;
    canvas._maxUsers = maxUsers;

    if (_geoDrawRaf) cancelAnimationFrame(_geoDrawRaf);
    _geoDrawRaf = requestAnimationFrame(function() {
      _geoDrawRaf = 0;
      _drawGeoCanvasImmediate(canvas, countryMap, maxUsers);
    });
  }

  function _drawGeoCanvasImmediate(canvas, countryMap, maxUsers) {
    var ctx = canvas.getContext('2d');
    var w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    if (!geoCountryPaths) return;

    for (var i = 0; i < geoCountryPaths.length; i++) {
      var country = geoCountryPaths[i];
      var users = countryMap[country.name] || 0;
      var fill = getCountryColor(users, maxUsers);

      ctx.fillStyle = fill;
      ctx.strokeStyle = users > 0 ? 'rgba(255,255,255,0.7)' : '#ffffff';
      ctx.lineWidth = users > 0 ? 0.8 : 0.5;

      for (var r = 0; r < country.rings.length; r++) {
        var ring = country.rings[r];
        ctx.beginPath();
        ctx.moveTo(ring[0][0], ring[0][1]);
        for (var p = 1; p < ring.length; p++) {
          ctx.lineTo(ring[p][0], ring[p][1]);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }

    // Attribution text
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '8px Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('Natural Earth', w - 5, h - 5);
  }

  // Tooltip via canvas hit-testing — checks which country polygon contains the mouse point
  function bindGeoTooltip(canvas) {
    if (geoTooltipBound) return;
    geoTooltipBound = true;

    var container = document.getElementById('geoMapContainer');
    var tooltip = document.getElementById('geoTooltip');
    if (!tooltip || !container) return;

    function getCanvasPoint(e) {
      var rect = canvas.getBoundingClientRect();
      var scaleX = canvas.width / rect.width;
      var scaleY = canvas.height / rect.height;
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY
      };
    }

    // Point-in-polygon using ray casting
    function pointInRing(px, py, ring) {
      var inside = false;
      for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        var xi = ring[i][0], yi = ring[i][1];
        var xj = ring[j][0], yj = ring[j][1];
        if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
          inside = !inside;
        }
      }
      return inside;
    }

    function findCountry(px, py) {
      if (!geoCountryPaths) return null;
      var countryMap = canvas._countryMap || {};
      for (var i = 0; i < geoCountryPaths.length; i++) {
        var c = geoCountryPaths[i];
        var users = countryMap[c.name] || 0;
        if (users === 0) continue; // only tooltip for active countries
        for (var r = 0; r < c.rings.length; r++) {
          if (pointInRing(px, py, c.rings[r])) return c;
        }
      }
      return null;
    }

    // Throttle mousemove to ~20fps using rAF — unthrottled mousemove
    // fires 60+/sec, each calling getBoundingClientRect() twice which
    // forces layout reflows and starves the main thread.
    var _geoRafPending = false;
    canvas.addEventListener('mousemove', function(e) {
      if (_geoRafPending) return;
      _geoRafPending = true;
      var clientX = e.clientX, clientY = e.clientY;
      requestAnimationFrame(function() {
        _geoRafPending = false;
        var rect = canvas.getBoundingClientRect();
        var scaleX = canvas.width / rect.width;
        var scaleY = canvas.height / rect.height;
        var px = (clientX - rect.left) * scaleX;
        var py = (clientY - rect.top) * scaleY;
        var hit = findCountry(px, py);
        if (hit) {
          var users = (canvas._countryMap || {})[hit.name] || 0;
          tooltip.innerHTML = '<span class="geo-tooltip-country">' + escapeHtml(hit.name) + '</span><span class="geo-tooltip-value">' + formatNumber(users) + ' users</span>';
          tooltip.style.display = 'block';
          tooltip.style.left = (clientX - rect.left + 10) + 'px';
          tooltip.style.top = (clientY - rect.top - 30) + 'px';
          canvas.style.cursor = 'pointer';
        } else {
          tooltip.style.display = 'none';
          canvas.style.cursor = 'default';
        }
      });
    });

    canvas.addEventListener('mouseleave', function() {
      tooltip.style.display = 'none';
      canvas.style.cursor = 'default';
    });
  }

  // Update the top-5 country legend below the gradient bar
  function updateGeoLegend(legend, countries, maxUsers) {
    var total = countries.reduce(function(sum, c) { return sum + c.users; }, 0);
    var legendHTML = '';
    countries.slice(0, 5).forEach(function(c) {
      var pct = total > 0 ? ((c.users / total) * 100).toFixed(0) : 0;
      var color = getCountryColor(c.users, maxUsers);
      legendHTML += '<span class="geo-legend-item">' +
        '<span class="geo-legend-dot" style="background:' + color + '"></span>' +
        escapeHtml(c.country) + ' <span class="geo-legend-count">' + pct + '%</span>' +
      '</span>';
    });
    fadeUpdateElement(legend, legendHTML);
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
  // PDF Export — Pure jsPDF Canvas Rendering
  // ========================================
  // Draws each dashboard section directly onto the PDF using jsPDF primitives.
  // Reads from cachedData (not the live DOM) and snapshots chart images
  // via .toBase64Image() / .toDataURL() — zero DOM manipulation required.

  var PDF_COLORS = {
    uwcBlue:      [0, 51, 102],
    uwcNavy:      [10, 26, 92],
    uwcGold:      [189, 154, 79],
    teal:         [0, 201, 167],
    purple:       [132, 94, 194],
    red:          [139, 21, 56],
    textPrimary:  [26, 32, 44],
    textSecondary:[74, 85, 104],
    textMuted:    [113, 128, 150],
    borderLight:  [226, 232, 240],
    bgLight:      [245, 247, 250],
    white:        [255, 255, 255],
    positive:     [16, 185, 129],
    negative:     [239, 68, 68]
  };

  var channelColorMap = {
    'Organic Search': [0, 51, 102],
    'Direct':         [0, 201, 167],
    'Referral':       [189, 154, 79],
    'Organic Social': [132, 94, 194],
    'Paid Search':    [214, 93, 177],
    'Email':          [255, 150, 113],
    'Display':        [0, 137, 186],
    'Unassigned':     [160, 174, 192]
  };

  async function exportToPDF() {
    var btn = document.getElementById('exportPdfBtn');
    if (!btn) return;
    var originalHTML = btn.innerHTML;
    btn.innerHTML = '<div class="spinner"></div> Generating...';
    btn.disabled = true;

    try {
      var data = cachedData[currentPeriod];
      if (!data) { alert('No data loaded yet. Please wait for the dashboard to load.'); return; }
      if (!window.jspdf || !window.jspdf.jsPDF) { throw new Error('jsPDF library not loaded'); }

      var jsPDFLib = window.jspdf.jsPDF;
      var pdf = new jsPDFLib('p', 'mm', 'a4');
      var pageWidth = pdf.internal.pageSize.getWidth();
      var pageHeight = pdf.internal.pageSize.getHeight();

      // Layout constants
      var headerH = 30, footerH = 12, side = 8, gap = 2;
      var cw = pageWidth - side * 2; // content width
      var usableBottom = pageHeight - footerH - gap;
      var cursorY = headerH + gap + 2;
      var pageNum = 1;

      // Fetch logo
      var logoBase64 = null;
      try { logoBase64 = await callAPI('fetchLogoAsBase64'); } catch(e) {}

      // Snapshot chart images (instant, non-destructive reads)
      var chartImgs = {};
      try { if (timeSeriesChart && timeSeriesChart.canvas) chartImgs.timeSeries = timeSeriesChart.toBase64Image(); } catch(e) {}
      try { if (activityChart && activityChart.canvas) chartImgs.activity = activityChart.toBase64Image(); } catch(e) {}
      try { if (devicesChart && devicesChart.canvas) chartImgs.devices = devicesChart.toBase64Image(); } catch(e) {}
      try { if (bounceSparkline && bounceSparkline.canvas) chartImgs.bounce = bounceSparkline.toBase64Image(); } catch(e) {}
      try {
        var gc = document.getElementById('geoMapCanvas');
        // Flush any pending rAF-deferred geo draw so the snapshot is current
        if (gc && _geoDrawRaf) {
          cancelAnimationFrame(_geoDrawRaf);
          _geoDrawRaf = 0;
          if (gc._countryMap) _drawGeoCanvasImmediate(gc, gc._countryMap, gc._maxUsers || 0);
        }
        if (gc) chartImgs.geoMap = gc.toDataURL('image/png');
      } catch(e) {}

      // Date range from cached data
      var dr = data.overview && data.overview.dateRange;
      var dateStr = '';
      if (dr) {
        var s = formatDate(dr.startDate), e = formatDate(dr.endDate);
        dateStr = s === e ? s : s + ' — ' + e;
      }

      // ── Helper: draw page header + footer ──
      function drawPageChrome(pNum, totalP) {
        pdf.setFillColor(255, 255, 255);
        pdf.rect(0, 0, pageWidth, headerH, 'F');

        var logoYEnd = 12;
        if (logoBase64) {
          try {
            // Get actual image dimensions by decoding the base64 data
            var imgProps = pdf.getImageProperties(logoBase64);
            var lh = 10;
            var lw = imgProps.width && imgProps.height
              ? (imgProps.width / imgProps.height) * lh
              : lh * 2.5; // sensible fallback
            // Cap width so logo doesn't stretch across the page
            if (lw > 50) { lw = 50; lh = lw / (imgProps.width / imgProps.height); }
            pdf.addImage(logoBase64, 'PNG', (pageWidth - lw) / 2, 4, lw, lh);
            logoYEnd = 4 + lh + 1;
          } catch(e) {}
        }
        pdf.setTextColor(0, 0, 0);
        pdf.setFontSize(9); pdf.setFont('helvetica', 'bold');
        pdf.text('UWC Immersive Zone', pageWidth / 2, logoYEnd + 2, { align: 'center' });
        pdf.setFontSize(7); pdf.setFont('helvetica', 'normal');
        var periodLabel = { DAU: 'Today', WEEKLY: 'Weekly', MONTHLY: 'Monthly', YEARLY: 'Yearly' }[currentPeriod] || currentPeriod;
        pdf.text('Analytics Dashboard \u2014 ' + periodLabel + ' Report', pageWidth / 2, logoYEnd + 6, { align: 'center' });
        pdf.setFontSize(6);
        pdf.text('Report Period: ' + dateStr, pageWidth / 2, logoYEnd + 10, { align: 'center' });
        pdf.setFillColor(10, 26, 92);
        pdf.rect(0, headerH - 1.5, pageWidth, 1.5, 'F');
        // Footer
        pdf.setFillColor(0, 34, 68);
        pdf.rect(0, pageHeight - footerH, pageWidth, footerH, 'F');
        pdf.setTextColor(255, 255, 255); pdf.setFontSize(7);
        pdf.text('University of the Western Cape | UWC Immersive Zone | 405 Voortrekker Road, Oostersee | infouih@uwc.ac.za',
                 pageWidth / 2, pageHeight - footerH + 4.5, { align: 'center' });
        if (totalP > 1) {
          pdf.setFontSize(5.5);
          pdf.text('Page ' + pNum + ' of ' + totalP, pageWidth - side, pageHeight - footerH + 9, { align: 'right' });
        }
      }

      // ── Helper: ensure vertical space, add page if needed ──
      function ensureSpace(mm) {
        if (cursorY + mm > usableBottom) {
          pdf.addPage(); pageNum++;
          drawPageChrome(pageNum, 0);
          cursorY = headerH + gap + 2;
        }
      }

      // ── Helper: section header ──
      function sectionHead(title) {
        ensureSpace(12);
        cursorY += 3; // breathing room before section
        // Gold accent line — sits above the title text
        pdf.setFillColor.apply(pdf, PDF_COLORS.uwcGold);
        pdf.rect(side, cursorY, 12, 0.8, 'F');
        cursorY += 5; // gap between line and text
        pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11);
        pdf.setTextColor.apply(pdf, PDF_COLORS.uwcNavy);
        pdf.text(title, side, cursorY);
        cursorY += 6;
      }

      // ── Helper: draw a data table ──
      function drawTable(headers, rows, colWidths) {
        if (!rows || rows.length === 0) return;
        var rowH = 5.5, hdrH = 6;
        var totalW = colWidths.reduce(function(a,b){return a+b;}, 0);
        var scale = cw / totalW;
        var scaledW = colWidths.map(function(w){return w * scale;});

        function drawHeaderRow() {
          pdf.setFillColor.apply(pdf, PDF_COLORS.bgLight);
          pdf.rect(side, cursorY - 0.5, cw, hdrH, 'F');
          pdf.setFont('helvetica', 'bold'); pdf.setFontSize(6.5);
          pdf.setTextColor.apply(pdf, PDF_COLORS.uwcBlue);
          var x = side + 1;
          headers.forEach(function(h, i) {
            pdf.text(h, x, cursorY + 3.5);
            x += scaledW[i];
          });
          cursorY += hdrH;
        }

        ensureSpace(hdrH + rowH * Math.min(rows.length, 3));
        drawHeaderRow();

        pdf.setFont('helvetica', 'normal'); pdf.setFontSize(6.5);
        rows.forEach(function(row, ri) {
          if (cursorY + rowH > usableBottom) {
            pdf.addPage(); pageNum++;
            drawPageChrome(pageNum, 0);
            cursorY = headerH + gap + 2;
            drawHeaderRow();
          }
          // Alternating stripe
          if (ri % 2 === 1) {
            pdf.setFillColor(250, 251, 252);
            pdf.rect(side, cursorY - 0.5, cw, rowH, 'F');
          }
          // Row border
          pdf.setDrawColor.apply(pdf, PDF_COLORS.borderLight);
          pdf.line(side, cursorY + rowH - 0.5, side + cw, cursorY + rowH - 0.5);

          pdf.setTextColor.apply(pdf, PDF_COLORS.textPrimary);
          var x = side + 1;
          row.forEach(function(cell, ci) {
            var txt = String(cell || '');
            // Truncate long text to fit column
            var maxChars = Math.floor(scaledW[ci] / 1.6);
            if (txt.length > maxChars) txt = txt.substring(0, maxChars - 1) + '\u2026';
            pdf.text(txt, x, cursorY + 3.5);
            x += scaledW[ci];
          });
          cursorY += rowH;
        });
        cursorY += 2;
      }

      // ── Helper: add chart image ──
      function addChartImage(imgData, maxH) {
        if (!imgData) {
          pdf.setTextColor.apply(pdf, PDF_COLORS.textMuted);
          pdf.setFontSize(8);
          pdf.text('Chart unavailable', side + cw / 2, cursorY + 10, { align: 'center' });
          cursorY += 15;
          return;
        }
        try {
          var h = Math.min(maxH, cw / 2.2);
          ensureSpace(h + 4);
          pdf.addImage(imgData, 'PNG', side, cursorY, cw, h);
          cursorY += h + 3;
        } catch(e) {
          pdf.setTextColor.apply(pdf, PDF_COLORS.textMuted);
          pdf.setFontSize(8);
          pdf.text('Chart render failed', side + cw / 2, cursorY + 10, { align: 'center' });
          cursorY += 15;
        }
      }

      // ══════════════════════════════════════
      // DRAW PAGE 1 HEADER
      // ══════════════════════════════════════
      drawPageChrome(1, 0);

      // ── SECTION: Key Numbers ──
      sectionHead('Key Numbers');
      if (data.overview && data.overview.success) {
        var m = data.overview.data;
        var cards = [
          { label: 'Total Users', value: formatNumber(m.totalUsers), change: m.changes ? m.changes.totalUsers : null },
          { label: 'Sessions', value: formatNumber(m.sessions), change: m.changes ? m.changes.sessions : null },
          { label: 'Page Views', value: formatNumber(m.pageViews), change: m.changes ? m.changes.pageViews : null },
          { label: 'Avg Duration', value: formatDuration(m.avgSessionDuration), change: m.changes ? m.changes.avgSessionDuration : null }
        ];
        var cardW = (cw - 6) / 4;
        var cardH = 20;
        ensureSpace(cardH + 10);

        cards.forEach(function(c, i) {
          var cx = side + i * (cardW + 2);
          // Card background
          pdf.setFillColor.apply(pdf, PDF_COLORS.bgLight);
          pdf.roundedRect(cx, cursorY, cardW, cardH, 2, 2, 'F');
          // Label
          pdf.setFont('helvetica', 'normal'); pdf.setFontSize(6);
          pdf.setTextColor.apply(pdf, PDF_COLORS.textMuted);
          pdf.text(c.label, cx + 3, cursorY + 5);
          // Value
          pdf.setFont('helvetica', 'bold'); pdf.setFontSize(14);
          pdf.setTextColor.apply(pdf, PDF_COLORS.uwcBlue);
          pdf.text(c.value, cx + 3, cursorY + 13);
          // Change indicator
          if (c.change !== null && c.change !== undefined) {
            var pct = parseFloat(c.change);
            var changeText, changeColor;
            if (isNaN(pct)) { changeText = 'No prior data'; changeColor = PDF_COLORS.textMuted; }
            else if (pct > 0) { changeText = '+' + pct.toFixed(1) + '% vs prev'; changeColor = PDF_COLORS.positive; }
            else if (pct < 0) { changeText = pct.toFixed(1) + '% vs prev'; changeColor = PDF_COLORS.negative; }
            else { changeText = '0% vs prev'; changeColor = PDF_COLORS.textMuted; }
            pdf.setFont('helvetica', 'normal'); pdf.setFontSize(5.5);
            pdf.setTextColor.apply(pdf, changeColor);
            pdf.text(changeText, cx + 3, cursorY + 17.5);
          }
        });
        cursorY += cardH + 3;

        // Activity stats row
        var statsLine = 'New Users: ' + formatNumber(m.newUsers) +
          '   |   Engagement: ' + (m.engagementRate || 0) + '%' +
          '   |   Bounce Rate: ' + (m.bounceRate || 0) + '%';
        pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7);
        pdf.setTextColor.apply(pdf, PDF_COLORS.textSecondary);
        pdf.text(statsLine, side, cursorY + 3);
        cursorY += 7;
      }

      // ── SECTION: User Journey ──
      if (data.pageFlow && data.pageFlow.success) {
        sectionHead('User Journey');
        var j = computeJourneyData(
          data.pageFlow.data,
          data.events ? data.events.data : []
        );

        var nodeW = (cw - 20) / 3;
        var nodeH = 22;
        var arrowW = 10;
        ensureSpace(nodeH + 30);

        var nodes = [
          { label: 'Google Sites', sub: 'Ideal Ocean Home', views: j.gsViews, users: j.gsUsers, time: j.gsAvgDuration, color: PDF_COLORS.uwcBlue },
          { label: 'InnovationHub', sub: 'Project Page', views: j.ihViews, users: j.ihUsers, time: j.ihAvgDuration, color: PDF_COLORS.teal },
          { label: 'JigSpace 3D', sub: 'Interactive Model', views: j.jigClicks, users: j.jigUsers, time: 0, color: PDF_COLORS.uwcGold }
        ];
        var arrows = [j.gsToIhPct, j.ihToJigPct];

        nodes.forEach(function(n, i) {
          var nx = side + i * (nodeW + arrowW);
          // Node box
          pdf.setFillColor.apply(pdf, PDF_COLORS.bgLight);
          pdf.roundedRect(nx, cursorY, nodeW, nodeH, 1.5, 1.5, 'F');
          // Color accent top bar
          pdf.setFillColor.apply(pdf, n.color);
          pdf.rect(nx, cursorY, nodeW, 1.2, 'F');
          // Label
          pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7);
          pdf.setTextColor.apply(pdf, PDF_COLORS.textPrimary);
          pdf.text(n.label, nx + nodeW / 2, cursorY + 5.5, { align: 'center' });
          // Sublabel
          pdf.setFont('helvetica', 'normal'); pdf.setFontSize(5.5);
          pdf.setTextColor.apply(pdf, PDF_COLORS.textMuted);
          pdf.text(n.sub, nx + nodeW / 2, cursorY + 9, { align: 'center' });
          // Stats
          pdf.setFontSize(6);
          pdf.setTextColor.apply(pdf, PDF_COLORS.textSecondary);
          var viewLabel = i === 2 ? ' clicks' : ' views';
          pdf.text(formatNumber(n.views) + viewLabel + '  \u00b7  ' + formatNumber(n.users) + ' users', nx + nodeW / 2, cursorY + 14, { align: 'center' });
          if (n.time > 0) {
            pdf.text('avg ' + formatDuration(n.time), nx + nodeW / 2, cursorY + 18, { align: 'center' });
          }

          // Arrow to next node
          if (i < 2) {
            var ax = nx + nodeW + 1;
            var ay = cursorY + nodeH / 2;
            pdf.setDrawColor.apply(pdf, PDF_COLORS.uwcGold);
            pdf.setLineWidth(0.4);
            pdf.line(ax, ay, ax + arrowW - 2, ay);
            // Arrowhead
            pdf.line(ax + arrowW - 4, ay - 1.5, ax + arrowW - 2, ay);
            pdf.line(ax + arrowW - 4, ay + 1.5, ax + arrowW - 2, ay);
            // Percentage label
            pdf.setFont('helvetica', 'bold'); pdf.setFontSize(5.5);
            pdf.setTextColor.apply(pdf, PDF_COLORS.uwcGold);
            pdf.text(arrows[i] + '%', ax + arrowW / 2, ay - 2.5, { align: 'center' });
          }
        });
        cursorY += nodeH + 4;

        // Funnel bars
        var maxFunnel = Math.max(j.gsViews, j.ihViews, j.jigClicks, 1);
        var funnelData = [
          { label: 'Google Sites', val: j.gsViews, unit: 'views', color: PDF_COLORS.uwcBlue },
          { label: 'Project Page', val: j.ihViews, unit: 'views', color: PDF_COLORS.teal },
          { label: 'Interactive Model', val: j.jigClicks, unit: 'clicks', color: PDF_COLORS.uwcGold }
        ];
        var barH = 4;
        funnelData.forEach(function(f) {
          var bw = Math.max((f.val / maxFunnel) * cw * 0.8, cw * 0.03);
          pdf.setFillColor.apply(pdf, f.color);
          pdf.roundedRect(side, cursorY, bw, barH, 1, 1, 'F');
          pdf.setFont('helvetica', 'normal'); pdf.setFontSize(5.5);
          pdf.setTextColor.apply(pdf, PDF_COLORS.textPrimary);
          pdf.text(f.label + ': ' + formatNumber(f.val) + ' ' + f.unit, side + bw + 2, cursorY + 3);
          cursorY += barH + 2;
        });
        cursorY += 3;
      }

      // ── SECTION: Trends ──
      // Ensure the header + legend + chart all land on the same page
      var trendsH = 14 + 5 + 65; // sectionHead + legend + chart
      ensureSpace(Math.min(trendsH, usableBottom - headerH - gap - 4)); // don't ask for more than a full page
      sectionHead('Trends \u2014 Statistics');
      // Legend row
      var legendItems = [
        { label: 'Users', color: PDF_COLORS.uwcBlue },
        { label: 'Sessions', color: PDF_COLORS.teal },
        { label: 'Page Views', color: PDF_COLORS.uwcGold }
      ];
      var lx = side;
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(6);
      legendItems.forEach(function(li) {
        pdf.setFillColor.apply(pdf, li.color);
        pdf.circle(lx + 1.5, cursorY - 0.5, 1.2, 'F');
        pdf.setTextColor.apply(pdf, PDF_COLORS.textSecondary);
        pdf.text(li.label, lx + 4, cursorY);
        lx += 28;
      });
      cursorY += 4;
      // Draw chart — use remaining space on this page (no forced page break)
      if (chartImgs.timeSeries) {
        var tsRemaining = usableBottom - cursorY - 3;
        var tsH = Math.max(40, Math.min(65, tsRemaining));
        try { pdf.addImage(chartImgs.timeSeries, 'PNG', side, cursorY, cw, tsH); } catch(e) {}
        cursorY += tsH + 3;
      } else {
        pdf.setTextColor.apply(pdf, PDF_COLORS.textMuted); pdf.setFontSize(8);
        pdf.text('Chart unavailable', side + cw / 2, cursorY + 10, { align: 'center' });
        cursorY += 15;
      }

      // ── SECTION: Audience ──
      // Audience needs ~50mm total — ensure header + content stay together
      var audienceH = 50;
      ensureSpace(Math.min(audienceH, usableBottom - headerH - gap - 4));
      sectionHead('Audience');
      var leftW = cw * 0.55;
      var rightW = cw * 0.4;
      var audienceStartY = cursorY;
      var audienceEndY = cursorY;

      // Left: Activity chart + bounce sparkline
      if (chartImgs.activity) {
        try { pdf.addImage(chartImgs.activity, 'PNG', side, cursorY, leftW, 28); } catch(e) {}
        audienceEndY = Math.max(audienceEndY, cursorY + 30);
        cursorY += 30;
      }
      if (chartImgs.bounce) {
        pdf.setFont('helvetica', 'normal'); pdf.setFontSize(5.5);
        pdf.setTextColor.apply(pdf, PDF_COLORS.textMuted);
        pdf.text('Bounce Rate Trend', side, cursorY + 2);
        cursorY += 3;
        try { pdf.addImage(chartImgs.bounce, 'PNG', side, cursorY, leftW * 0.6, 10); } catch(e) {}
        audienceEndY = Math.max(audienceEndY, cursorY + 12);
        cursorY += 12;
      }

      // Right: Devices chart — placed alongside left content on the SAME page
      if (chartImgs.devices) {
        try { pdf.addImage(chartImgs.devices, 'PNG', side + leftW + 4, audienceStartY, rightW, 40); } catch(e) {}
        audienceEndY = Math.max(audienceEndY, audienceStartY + 42);
      }
      cursorY = audienceEndY + 3;

      // ── SECTION: Detailed Data ──
      sectionHead('Detailed Data');

      // Helper: draw a table with its sub-title (keeps title + first rows together)
      function drawNamedTable(title, headers, rows, colWidths) {
        if (!rows || rows.length === 0) return;
        // Ensure at least the title + header + 2 data rows fit before starting
        ensureSpace(5 + 6 + 5.5 * 2);
        pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7.5);
        pdf.setTextColor.apply(pdf, PDF_COLORS.textPrimary);
        pdf.text(title, side, cursorY + 3); cursorY += 5;
        drawTable(headers, rows, colWidths);
      }

      // Top Pages table
      if (data.topPages && data.topPages.success && data.topPages.data.length > 0) {
        var pgRows = data.topPages.data.slice(0, 8).map(function(p) {
          return [p.title || '', formatNumber(p.views), formatDuration(p.avgDuration)];
        });
        drawNamedTable('Top Pages', ['Page Title', 'Views', 'Avg. Time'], pgRows, [120, 30, 30]);
      }

      // Countries table
      if (data.countries && data.countries.success && data.countries.data.length > 0) {
        var cTotal = data.countries.data.reduce(function(s, c) { return s + c.users; }, 0);
        var cRows = data.countries.data.slice(0, 8).map(function(c) {
          return [c.country, formatNumber(c.users), (cTotal > 0 ? ((c.users / cTotal) * 100).toFixed(1) : '0') + '%'];
        });
        drawNamedTable('Countries', ['Country', 'Users', 'Share'], cRows, [80, 40, 40]);
      }

      // Events table
      if (data.events && data.events.success && data.events.data.length > 0) {
        var eRows = data.events.data.slice(0, 15).map(function(ev) {
          var name = ev.name + (customEvents.indexOf(ev.name) !== -1 ? ' [TRACKED]' : '');
          return [name, formatNumber(ev.count), formatNumber(ev.users)];
        });
        drawNamedTable('GA4 Events', ['Event Name', 'Count', 'Users'], eRows, [100, 40, 40]);
      }

      // Traffic Sources table
      if (data.trafficSources && data.trafficSources.success) {
        var ts = data.trafficSources.data;
        if (ts && ts.labels && ts.labels.length > 0) {
          var tsTotal = ts.values.reduce(function(s, v) { return s + v; }, 0);
          var tsRows = ts.labels.map(function(label, i) {
            var val = ts.values[i];
            return [label, formatNumber(val), (tsTotal > 0 ? ((val / tsTotal) * 100).toFixed(1) : '0') + '%'];
          });
          drawNamedTable('Traffic Sources', ['Channel', 'Sessions', 'Share'], tsRows, [80, 40, 40]);
        }
      }

      // ── SECTION: Visitor Geography ──
      if (chartImgs.geoMap) {
        var mapH = Math.min(55, cw / 2.2);
        // Ensure header + map + legend all land on the same page
        ensureSpace(Math.min(14 + mapH + 10, usableBottom - headerH - gap - 4));
        sectionHead('Visitor Geography');
        try {
          pdf.addImage(chartImgs.geoMap, 'PNG', side, cursorY, cw, mapH);
          cursorY += mapH + 3;
        } catch(e) { cursorY += 5; }

        // Top-5 country legend
        if (data.countries && data.countries.success && data.countries.data.length > 0) {
          var cTotal2 = data.countries.data.reduce(function(s, c) { return s + c.users; }, 0);
          var legendX = side;
          pdf.setFont('helvetica', 'normal'); pdf.setFontSize(6);
          data.countries.data.slice(0, 5).forEach(function(c) {
            var pct = cTotal2 > 0 ? ((c.users / cTotal2) * 100).toFixed(0) : '0';
            pdf.setFillColor.apply(pdf, PDF_COLORS.uwcBlue);
            pdf.circle(legendX + 1, cursorY, 1, 'F');
            pdf.setTextColor.apply(pdf, PDF_COLORS.textPrimary);
            pdf.text(c.country + ' ' + pct + '%', legendX + 3, cursorY + 0.8);
            legendX += 35;
          });
          cursorY += 5;
        }
      }

      // ══════════════════════════════════════
      // SECOND PASS: stamp correct page numbers
      // ══════════════════════════════════════
      var totalPages = pageNum;
      for (var p = 1; p <= totalPages; p++) {
        pdf.setPage(p);
        drawPageChrome(p, totalPages);
      }

      // Save
      var today = new Date().toISOString().split('T')[0];
      pdf.save('UWC_Analytics_' + currentPeriod + '_' + today + '.pdf');

    } catch (error) {
      console.error('PDF export error:', error);
      alert('Error generating PDF: ' + error.message);
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
    var newWidth = pct + '%';
    // Only touch DOM when the value actually changed
    if (fill.style.width !== newWidth) fill.style.width = newWidth;

    var newText = syncCountdown <= 0 ? 'Syncing...' : 'Next sync in ' + syncCountdown + 's';
    if (label.textContent !== newText) label.textContent = newText;
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
        // Only compare if both are valid non-empty strings
        if (typeof deploymentVersion === 'string' && deploymentVersion.length > 0 &&
            typeof version === 'string' && version.length > 0 &&
            version !== deploymentVersion) {
          showUpdatePopup();
        }
        // Only store if valid
        if (typeof version === 'string' && version.length > 0) {
          deploymentVersion = version;
        }
      })
      .catch(function() {
        // Silent fail — don't update deploymentVersion on error
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
  // Pure data function — computes journey metrics from page/event arrays.
  // Used by both the DOM updater (updateJourneyFlow) and the PDF renderer.
  function computeJourneyData(pages, events) {
    var gsViews = 0, gsUsers = 0, gsDuration = 0, gsCount = 0;
    var ihViews = 0, ihUsers = 0, ihDuration = 0, ihCount = 0;

    if (pages && pages.length > 0) {
      pages.forEach(function(p) {
        var path = (p.path || '').toLowerCase();
        if (path.indexOf('/uwc.ac.za/idealoceanhome') !== -1 ||
            path.indexOf('/interactive-loggerhead') !== -1) {
          gsViews += p.views; gsUsers += p.users;
          gsDuration += p.avgDuration * p.views; gsCount += p.views;
        } else if (path.indexOf('/jigspace/loggerheadturtle') !== -1 ||
                   path.indexOf('/jigspace/loggerhead') !== -1) {
          ihViews += p.views; ihUsers += p.users;
          ihDuration += p.avgDuration * p.views; ihCount += p.views;
        } else if (path === '/') {
          gsViews += p.views; gsUsers += p.users;
          gsDuration += p.avgDuration * p.views; gsCount += p.views;
        }
      });
    }

    var jigClicks = 0, jigUsers = 0;
    if (events && events.length > 0) {
      events.forEach(function(ev) {
        if (ev.name === 'open_interactive_model') {
          jigClicks = ev.count; jigUsers = ev.users;
        }
      });
    }

    var gsAvgDuration = gsCount > 0 ? gsDuration / gsCount : 0;
    var ihAvgDuration = ihCount > 0 ? ihDuration / ihCount : 0;

    var gsToIhPct = 0;
    var totalEntry = gsViews + ihViews;
    if (totalEntry > 0) {
      gsToIhPct = ihViews > 0 && gsViews > 0
        ? Math.round((ihViews / totalEntry) * 100)
        : (ihViews > 0 ? 100 : 0);
    }

    var ihToJigPct = 0;
    if (ihViews > 0 && jigClicks > 0) {
      ihToJigPct = Math.min(Math.round((jigClicks / ihViews) * 100), 100);
    }

    return {
      gsViews: gsViews, gsUsers: gsUsers, gsAvgDuration: gsAvgDuration,
      ihViews: ihViews, ihUsers: ihUsers, ihAvgDuration: ihAvgDuration,
      jigClicks: jigClicks, jigUsers: jigUsers,
      gsToIhPct: gsToIhPct, ihToJigPct: ihToJigPct
    };
  }

  function updateJourneyFlow(pages, events) {
    var j = computeJourneyData(pages, events);

    setText('jnGSViews', formatNumber(j.gsViews));
    setText('jnGSUsers', formatNumber(j.gsUsers));
    setText('jnGSTime', j.gsAvgDuration > 0 ? 'avg ' + formatDuration(j.gsAvgDuration) : '—');

    setText('jnIHViews', formatNumber(j.ihViews));
    setText('jnIHUsers', formatNumber(j.ihUsers));
    setText('jnIHTime', j.ihAvgDuration > 0 ? 'avg ' + formatDuration(j.ihAvgDuration) : '—');

    setText('jnJigViews', formatNumber(j.jigClicks));
    setText('jnJigUsers', formatNumber(j.jigUsers));
    setText('jnJigTime', j.jigClicks > 0 ? 'via button click' : '—');

    var totalEntry = j.gsViews + j.ihViews;
    setText('jaGStoIH', totalEntry > 0 ? j.gsToIhPct + '%' : '—');
    setText('jaIHtoJig', j.ihViews > 0 ? j.ihToJigPct + '%' : '—');

    var maxFunnel = Math.max(j.gsViews, j.ihViews, j.jigClicks, 1);
    setStyle('funnelBar1', 'width', Math.max((j.gsViews / maxFunnel) * 100, 5) + '%');
    setStyle('funnelBar2', 'width', Math.max((j.ihViews / maxFunnel) * 100, 5) + '%');
    setStyle('funnelBar3', 'width', Math.max((j.jigClicks / maxFunnel) * 100, 5) + '%');

    setText('funnelVal1', formatNumber(j.gsViews) + ' views');
    setText('funnelVal2', formatNumber(j.ihViews) + ' views');
    setText('funnelVal3', formatNumber(j.jigClicks) + ' clicks');
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

  // ========================================
  // Sticky Dashboard Hero — compact when stuck
  // ========================================
  document.addEventListener('DOMContentLoaded', function() {
    var hero = document.querySelector('.dashboard-hero');
    var navStrip = document.querySelector('.nav-strip');
    if (!hero || !navStrip) return;

    // Use IntersectionObserver on the nav-strip — when it scrolls out of view
    // the hero is "stuck" to the header, so we compact it.
    var observer = new IntersectionObserver(function(entries) {
      // nav-strip not visible → hero is stuck
      if (entries[0].isIntersecting) {
        hero.classList.remove('stuck');
      } else {
        hero.classList.add('stuck');
      }
    }, { threshold: 0 });

    observer.observe(navStrip);
  });
