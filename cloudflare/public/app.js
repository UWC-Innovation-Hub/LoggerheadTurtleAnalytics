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
  let performanceChart = null;
  let activityChart = null;
  let trafficChart = null;
  let devicesChart = null;

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

    if (!window.SESSION_TOKEN) {
      redirectToLogin();
      return;
    }

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

    // Performance Radar Chart
    const performanceCtx = document.getElementById('performanceChart').getContext('2d');
    performanceChart = new Chart(performanceCtx, {
      type: 'radar',
      data: {
        labels: ['Engagement', 'Sessions/User', 'Pages/Session', 'Avg Time', 'Return Rate'],
        datasets: [
          {
            label: 'Current',
            data: [65, 45, 70, 50, 55],
            borderColor: colors.primary,
            backgroundColor: 'rgba(0, 51, 102, 0.2)',
            borderWidth: 2,
            pointRadius: 3,
            pointBackgroundColor: colors.primary
          },
          {
            label: 'Target',
            data: [80, 70, 85, 75, 80],
            borderColor: colors.teal,
            backgroundColor: 'rgba(0, 201, 167, 0.1)',
            borderWidth: 2,
            borderDash: [4, 4],
            pointRadius: 3,
            pointBackgroundColor: colors.teal
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: { display: false }
        },
        scales: {
          r: {
            beginAtZero: true,
            max: 100,
            ticks: {
              display: false,
              stepSize: 20
            },
            grid: {
              color: 'rgba(0, 0, 0, 0.06)'
            },
            angleLines: {
              color: 'rgba(0, 0, 0, 0.06)'
            },
            pointLabels: {
              font: { size: 10 },
              color: '#718096'
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

    // Traffic Doughnut Chart
    const trafficCtx = document.getElementById('trafficChart').getContext('2d');
    trafficChart = new Chart(trafficCtx, {
      type: 'doughnut',
      data: {
        labels: [],
        datasets: [{
          data: [],
          backgroundColor: chartColors,
          borderWidth: 0,
          hoverOffset: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        cutout: '70%',
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

    if (data.trafficSources && data.trafficSources.success) {
      updateTrafficChart(data.trafficSources.data);
    } else {
      console.warn('[Dashboard] TrafficSources failed:', data.trafficSources);
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
    } else {
      console.warn('[Dashboard] Countries failed:', data.countries);
    }

    if (data.engagement && data.engagement.success) {
      updatePerformanceChart(data.engagement.data);
    } else {
      console.warn('[Dashboard] Engagement failed:', data.engagement);
    }

    if (data.acquisition && data.acquisition.success) {
      updateAcquisitionCard(data.acquisition.data);
    } else {
      console.warn('[Dashboard] Acquisition failed:', data.acquisition);
    }

    if (data.events && data.events.success) {
      updateEventsTable(data.events.data);
    } else {
      console.warn('[Dashboard] Events failed:', data.events);
    }

    if (data.realtime) {
      updateRealtimeBadge(data.realtime);
    } else {
      console.warn('[Dashboard] Realtime failed:', data.realtime);
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

  function updatePerformanceChart(data) {
    if (data.values && data.values.length > 0) {
      performanceChart.data.datasets[0].data = data.values;
      performanceChart.update('none');
    }
  }

  function updateTrafficChart(data) {
    const legendContainer = document.getElementById('trafficLegend');
    if (!data.labels || data.labels.length === 0) {
      trafficChart.data.labels = ['No data'];
      trafficChart.data.datasets[0].data = [1];
      trafficChart.data.datasets[0].backgroundColor = ['#e2e8f0'];
      trafficChart.update('none');
      legendContainer.innerHTML = '<div class="empty-state-text">No traffic data for this period</div>';
      return;
    }
    trafficChart.data.labels = data.labels;
    trafficChart.data.datasets[0].data = data.values;
    trafficChart.data.datasets[0].backgroundColor = chartColors;
    trafficChart.update('none');

    legendContainer.innerHTML = data.labels.map((label, i) => `
      <div class="breakdown-legend-item">
        <span class="breakdown-legend-dot" style="background: ${chartColors[i % chartColors.length]}"></span>
        <span>${label}</span>
      </div>
    `).join('');
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
        <td class="page-title-cell" title="${escapeHtml(page.title)}">${escapeHtml(truncate(page.title, 35))}</td>
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

  function updateAcquisitionCard(data) {
    document.getElementById('acqNewUsers').textContent = formatNumber(data.newUsers);
    document.getElementById('acqReturningUsers').textContent = formatNumber(data.returningUsers);
    document.getElementById('acqSessionsPerUser').textContent = data.sessionsPerUser;
    document.getElementById('acqEngagedSessions').textContent = formatNumber(data.engagedSessions);

    const newBar = document.getElementById('acqNewUserBar');
    const retBar = document.getElementById('acqReturnBar');
    var newPct = Math.max(data.newUserPct, 0);
    var retPct = Math.max(data.returningUserPct, 0);

    // Ensure minimum visible width when non-zero, hide text when too small
    newBar.style.width = newPct > 0 ? Math.max(newPct, 5) + '%' : '0%';
    retBar.style.width = retPct > 0 ? Math.max(retPct, 5) + '%' : '0%';
    newBar.querySelector('span').textContent = newPct >= 15 ? 'New ' + newPct + '%' : (newPct > 0 ? newPct + '%' : '');
    retBar.querySelector('span').textContent = retPct >= 15 ? 'Ret ' + retPct + '%' : (retPct > 0 ? retPct + '%' : '');
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
    if (typeof gtag === 'function') {
      // Use beacon transport so the hit sends even when navigating away
      gtag('event', eventName, {
        event_category: 'outbound_click',
        event_label: destination,
        click_source: source,
        source_page: 'AnalyticsDashboard',
        transport_type: 'beacon'
      });
    }
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
      pdf.text('Analytics Dashboard - Interactive Loggerhead Turtle Hatchlings', pageWidth / 2, logoYEnd + 6, { align: 'center' });

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
