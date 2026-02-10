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

      // Cache the successful response for this period
      cachedData[period] = data;

      // Apply data to UI with smooth transitions
      handleDashboardData(data);
      isFirstLoad = false;
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
    if (preloaderHidden) return; // only run once
    preloaderHidden = true;
    var progress = document.getElementById('preloaderProgress');
    var overlay = document.getElementById('preloaderOverlay');
    if (progress) progress.classList.add('complete');
    setTimeout(function() {
      if (overlay) {
        overlay.classList.add('hidden');
        // Remove from DOM entirely after fade-out to free resources
        setTimeout(function() { overlay.remove(); }, 600);
      }
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

  // Smoothly update a text element — only animate if value actually changed
  function smoothSetText(id, newText) {
    var el = document.getElementById(id);
    if (!el) return;
    if (el.textContent === newText) return; // no change
    // Cancel any pending transition timer
    if (el._smoothTimer) clearTimeout(el._smoothTimer);
    el.style.transition = 'opacity 0.2s ease';
    el.style.opacity = '0.3';
    el._smoothTimer = setTimeout(function() {
      el.textContent = newText;
      el.style.opacity = '1';
      el._smoothTimer = null;
    }, 200);
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
    if (!data.labels || data.labels.length === 0) {
      timeSeriesChart.data.labels = ['No data'];
      timeSeriesChart.data.datasets[0].data = [0];
      timeSeriesChart.data.datasets[1].data = [0];
      timeSeriesChart.data.datasets[2].data = [0];
      timeSeriesChart.update();
      return;
    }
    timeSeriesChart.data.labels = data.labels;
    timeSeriesChart.data.datasets[0].data = data.users;
    timeSeriesChart.data.datasets[1].data = data.sessions;
    timeSeriesChart.data.datasets[2].data = data.pageViews;
    timeSeriesChart.update();
  }

  function updateActivityChart(data) {
    if (!data.labels || data.labels.length === 0) {
      activityChart.data.labels = ['No data'];
      activityChart.data.datasets[0].data = [0];
      activityChart.update();
      return;
    }
    activityChart.data.labels = data.labels;
    activityChart.data.datasets[0].data = data.users;
    activityChart.update();
  }

  function updateDevicesChart(data) {
    if (!data.labels || data.labels.length === 0) {
      devicesChart.data.labels = ['No data'];
      devicesChart.data.datasets[0].data = [0];
      devicesChart.data.datasets[0].backgroundColor = ['#e2e8f0'];
      devicesChart.update();
      return;
    }
    devicesChart.data.labels = data.labels;
    devicesChart.data.datasets[0].data = data.values;

    const deviceColors = data.labels.map((label, i) => chartColors[i % chartColors.length]);
    devicesChart.data.datasets[0].backgroundColor = deviceColors;

    devicesChart.update();
  }

  // Graceful table update — fades old content out, swaps HTML, fades in
  function fadeUpdateElement(el, newHTML) {
    if (!el) return;
    // If content hasn't changed, skip the update entirely
    if (el.innerHTML.trim() === newHTML.trim()) return;
    // Cancel any pending transition timer
    if (el._fadeTimer) clearTimeout(el._fadeTimer);
    el.style.transition = 'opacity 0.25s ease';
    el.style.opacity = '0.3';
    el._fadeTimer = setTimeout(function() {
      el.innerHTML = newHTML;
      el.style.opacity = '1';
      el._fadeTimer = null;
    }, 250);
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
    if (!data || !data.labels || data.labels.length === 0) {
      bounceSparkline.data.labels = ['No data'];
      bounceSparkline.data.datasets[0].data = [0];
      bounceSparkline.update();
      return;
    }
    bounceSparkline.data.labels = data.labels;
    bounceSparkline.data.datasets[0].data = data.bounceRates;
    bounceSparkline.update();
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

  // Lightweight equirectangular projection for SVG
  function projectGeo(lon, lat, w, h) {
    var x = (lon + 180) * (w / 360);
    var y = (90 - lat) * (h / 180);
    return [x, y];
  }

  // Convert TopoJSON geometry to SVG path string
  function topoToSvgPath(arcs, transform, geometry, w, h) {
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

    function ringToPath(ring) {
      var pts = [];
      for (var i = 0; i < ring.length; i++) {
        var arcCoords = decodeArc(ring[i]);
        // Skip first point of subsequent arcs (shared with previous)
        pts = pts.concat(i === 0 ? arcCoords : arcCoords.slice(1));
      }
      return 'M' + pts.map(function(p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join('L') + 'Z';
    }

    var paths = [];
    if (geometry.type === 'Polygon') {
      geometry.arcs.forEach(function(ring) { paths.push(ringToPath(ring)); });
    } else if (geometry.type === 'MultiPolygon') {
      geometry.arcs.forEach(function(polygon) {
        polygon.forEach(function(ring) { paths.push(ringToPath(ring)); });
      });
    }
    return paths.join(' ');
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

  // Track whether the SVG map paths have been built yet
  var geoMapBuilt = false;

  function updateGeoMap(countries) {
    var svg = document.getElementById('geoMapSvg');
    var legend = document.getElementById('geoLegend');
    var countLabel = document.getElementById('geoTotalCountries');
    if (!svg || !legend) return;

    if (!countries || countries.length === 0) {
      if (countLabel) countLabel.textContent = '0 countries';
      // If map is already built, just gray out all countries — no DOM thrash
      if (geoMapBuilt) {
        var paths = svg.querySelectorAll('.geo-country');
        paths.forEach(function(p) {
          p.setAttribute('fill', '#e2e8f0');
          p.classList.remove('active');
        });
      }
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

    function getCountryColor(users) {
      if (!users || users === 0) return '#e2e8f0';
      var intensity = Math.max(0.05, Math.min(1, users / maxUsers));
      // 5-step vivid gradient: light gold → gold → teal → navy → deep navy
      if (intensity < 0.15) return '#e8d5a3';      // pale gold
      if (intensity < 0.35) return '#bd9a4f';       // UWC gold
      if (intensity < 0.55) return '#1a8a7a';       // teal
      if (intensity < 0.75) return '#003366';       // UWC blue
      return '#0a1a5c';                              // deep navy
    }

    // If map is already built, just update fills in place — no rebuild, no flash
    if (geoMapBuilt) {
      var paths = svg.querySelectorAll('.geo-country');
      paths.forEach(function(p) {
        var name = p.getAttribute('data-country');
        var users = countryMap[name] || 0;
        p.setAttribute('fill', getCountryColor(users));
        p.setAttribute('data-users', users);
        if (users > 0) {
          p.classList.add('active');
        } else {
          p.classList.remove('active');
        }
      });
      updateGeoLegend(legend, countries, getCountryColor);
      return;
    }

    // ── First render — build the SVG map once, never again ──
    var container = document.getElementById('geoMapContainer');

    // Tooltip element (created once)
    var tooltip = document.createElement('div');
    tooltip.className = 'geo-tooltip';
    tooltip.id = 'geoTooltip';
    container.style.position = 'relative';
    container.appendChild(tooltip);

    // Delegated tooltip — ONE listener on the SVG, reads data-* live
    // No per-path listeners, no cloning, no rebinding on refresh
    svg.addEventListener('mouseover', function(e) {
      var path = e.target.closest('.geo-country.active');
      if (!path) return;
      var name = path.getAttribute('data-country');
      var users = path.getAttribute('data-users');
      tooltip.innerHTML = '<span class="geo-tooltip-country">' + escapeHtml(name) + '</span><span class="geo-tooltip-value">' + formatNumber(parseInt(users)) + ' users</span>';
      tooltip.style.display = 'block';
    });
    svg.addEventListener('mousemove', function(e) {
      if (tooltip.style.display === 'block') {
        var rect = container.getBoundingClientRect();
        tooltip.style.left = (e.clientX - rect.left + 10) + 'px';
        tooltip.style.top = (e.clientY - rect.top - 30) + 'px';
      }
    });
    svg.addEventListener('mouseout', function(e) {
      var path = e.target.closest('.geo-country.active');
      if (!path) return;
      // Only hide if we're actually leaving the path (not entering a child)
      if (!path.contains(e.relatedTarget)) {
        tooltip.style.display = 'none';
      }
    });

    loadWorldMap().then(function(topo) {
      if (!topo) {
        svg.innerHTML = '<text x="400" y="200" text-anchor="middle" fill="#a0aec0" font-size="14">Map data unavailable</text>';
        return;
      }

      var w = 800, h = 400;
      var geoms = topo.objects.countries.geometries;

      geoms.forEach(function(geom) {
        var id = geom.id;
        var name = (geom.properties && geom.properties.name) || isoToName[id] || '';
        var users = countryMap[name] || 0;

        var d = topoToSvgPath(topo.arcs, topo.transform, geom, w, h);
        if (!d) return;

        var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', d);
        path.setAttribute('class', 'geo-country' + (users > 0 ? ' active' : ''));
        path.setAttribute('fill', getCountryColor(users));
        path.setAttribute('data-country', name);
        path.setAttribute('data-users', users);
        svg.appendChild(path);
      });

      // Attribution
      var attr = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      attr.setAttribute('x', '795'); attr.setAttribute('y', '395');
      attr.setAttribute('text-anchor', 'end'); attr.setAttribute('fill', '#cbd5e1');
      attr.setAttribute('font-size', '8'); attr.setAttribute('font-family', 'Inter,sans-serif');
      attr.textContent = 'Natural Earth';
      svg.appendChild(attr);

      geoMapBuilt = true;
    });

    // Update legend
    updateGeoLegend(legend, countries, getCountryColor);
  }

  // Update the top-5 country legend below the gradient bar
  function updateGeoLegend(legend, countries, getCountryColor) {
    var total = countries.reduce(function(sum, c) { return sum + c.users; }, 0);
    var legendHTML = '';
    countries.slice(0, 5).forEach(function(c) {
      var pct = total > 0 ? ((c.users / total) * 100).toFixed(0) : 0;
      var color = getCountryColor(c.users);
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
