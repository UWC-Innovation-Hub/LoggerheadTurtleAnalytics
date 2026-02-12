  // ========================================
  // UWC Immersive Zone - Login Page Logic
  // Cloudflare Pages Edition
  // ========================================

  const API_BASE = '/api';

  async function callAPI(action, params) {
    var response = await fetch(API_BASE + '/' + action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: action, params: params || {}, token: '' })
    });
    if (!response.ok) {
      throw new Error('API error: ' + response.status);
    }
    return response.json();
  }

  var loginEmail = '';
  var isProcessing = false;

  // ========================================
  // Safe Storage Helper
  // ========================================
  function safeStorageGet(key) {
    try {
      var val = sessionStorage.getItem(key);
      if (val) return val;
    } catch(e) {}
    try {
      return localStorage.getItem(key);
    } catch(e) {}
    return null;
  }

  function safeStorageSet(key, value) {
    try { sessionStorage.setItem(key, value); } catch(e) {}
    try { localStorage.setItem(key, value); } catch(e) {}
  }

  function safeStorageRemove(key) {
    try { sessionStorage.removeItem(key); } catch(e) {}
    try { localStorage.removeItem(key); } catch(e) {}
  }

  // ========================================
  // Warm-up Preloader + Auto-restore session
  // Fires a lightweight API call to wake Apps Script while showing the
  // preloader, so the backend is hot when the user submits their email.
  // If there's a saved session token, validates it in parallel.
  // ========================================
  (async function warmUpAndCheckSession() {
    var preloader = document.getElementById('loginPreloader');
    var loginPage = document.getElementById('loginPage');
    var fillBar = document.getElementById('loginPreloaderFill');

    function revealLogin() {
      // Complete the progress bar, then fade out preloader
      if (fillBar) fillBar.classList.add('complete');
      setTimeout(function() {
        if (loginPage) loginPage.style.display = '';
        if (preloader) preloader.classList.add('hidden');
        // Remove preloader from DOM after transition
        setTimeout(function() {
          if (preloader && preloader.parentNode) preloader.parentNode.removeChild(preloader);
        }, 600);
      }, 400);
    }

    // Maximum wait — always reveal login after 8s even if API is unresponsive
    var maxWaitTimer = setTimeout(revealLogin, 8000);

    // Check for existing session
    var savedToken = safeStorageGet('uwc_session_token');

    try {
      if (savedToken) {
        // Validate existing session (also warms up Apps Script)
        var result = await callAPI('validateSession', { token: savedToken });
        if (result && result.valid) {
          // Session still good — redirect to dashboard
          clearTimeout(maxWaitTimer);
          window.location.href = '/?token=' + savedToken;
          return;
        } else {
          safeStorageRemove('uwc_session_token');
          safeStorageRemove('uwc_session_name');
        }
      } else {
        // No saved session — warm up with lightweight call
        await callAPI('getAppVersion');
      }
    } catch(e) {
      safeStorageRemove('uwc_session_token');
      safeStorageRemove('uwc_session_name');
    }

    // Warm-up complete — reveal login
    clearTimeout(maxWaitTimer);
    revealLogin();
  })();

  // ========================================
  // DOM Ready
  // ========================================
  document.addEventListener('DOMContentLoaded', function() {
    var emailInput = document.getElementById('emailInput');
    var codeInput = document.getElementById('codeInput');

    emailInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleEmailSubmit();
      }
    });

    codeInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleCodeSubmit();
      }
    });

    // Auto-uppercase code input
    codeInput.addEventListener('input', function() {
      this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    });

    // Focus email input
    emailInput.focus();

    // Fetch and display app version
    callAPI('getAppVersion')
      .then(function(ver) {
        var el = document.getElementById('appVersion');
        if (el && ver) el.textContent = 'Version ' + ver;
      })
      .catch(function() {});
  });

  // ========================================
  // Step 1: Email Submission
  // ========================================
  async function handleEmailSubmit() {
    if (isProcessing) return;

    var email = document.getElementById('emailInput').value.trim();
    if (!email || !isValidEmail(email)) {
      showError('emailError', 'Please enter a valid email address.');
      return;
    }

    loginEmail = email;
    setLoading('emailBtn', true);
    hideError('emailError');

    try {
      var result = await callAPI('sendAuthCode', { email: email });
      handleSendCodeResult(result);
    } catch(err) {
      setLoading('emailBtn', false);
      showError('emailError', 'An error occurred. Please try again.');
    }
  }

  function handleSendCodeResult(result) {
    setLoading('emailBtn', false);

    if (result.success) {
      document.getElementById('sentEmailDisplay').textContent = loginEmail;
      showStep(2);
      setTimeout(function() {
        document.getElementById('codeInput').focus();
      }, 300);
    } else {
      switch (result.error) {
        case 'NOT_REGISTERED':
          showError('emailError', 'This email is not registered. Please contact your administrator to request access.');
          break;
        case 'ACCESS_DENIED':
          showError('emailError', 'Access has been denied for this account. Please contact your administrator.');
          break;
        case 'ACCESS_PENDING':
          showError('emailError', 'Your access request is pending approval. Please check back later.');
          break;
        case 'EMAIL_FAILED':
          showError('emailError', 'Failed to send verification email. Please try again.');
          break;
        case 'RATE_LIMITED':
          showError('emailError', 'Please wait 30 seconds before requesting another code.');
          break;
        case 'TOO_MANY_REQUESTS':
          showError('emailError', 'Too many requests. Please try again in 15 minutes.');
          break;
        default:
          showError('emailError', 'An error occurred. Please try again.');
      }
    }
  }

  // ========================================
  // Step 2: Code Verification
  // ========================================
  async function handleCodeSubmit() {
    if (isProcessing) return;

    var code = document.getElementById('codeInput').value.trim().toUpperCase();
    if (!code || code.length !== 5) {
      showError('codeError', 'Please enter the 5-digit code sent to your email.');
      return;
    }

    setLoading('codeBtn', true);
    hideError('codeError');

    try {
      var result = await callAPI('verifyAuthCode', { email: loginEmail, code: code });
      handleVerifyResult(result);
    } catch(err) {
      setLoading('codeBtn', false);
      showError('codeError', 'An error occurred. Please try again.');
    }
  }

  function handleVerifyResult(result) {
    setLoading('codeBtn', false);

    if (result.success) {
      // Store session
      if (result.token) {
        safeStorageSet('uwc_session_token', result.token);
        safeStorageSet('uwc_session_name', result.name || 'User');
      }

      // Show success screen
      document.getElementById('welcomeName').textContent = result.name || 'User';
      showStep(3);

      // Redirect to dashboard
      setTimeout(function() {
        window.location.href = '/?token=' + result.token;
      }, 800);
    } else {
      switch (result.error) {
        case 'INVALID_CODE':
          var msg = 'Invalid code.';
          if (result.attemptsLeft !== undefined && result.attemptsLeft > 0) {
            msg += ' ' + result.attemptsLeft + ' attempt(s) remaining.';
          }
          showError('codeError', msg);
          break;
        case 'CODE_EXPIRED':
          showError('codeError', 'This code has expired. Please request a new one.');
          break;
        case 'MAX_ATTEMPTS':
          showError('codeError', 'Too many failed attempts. Please request a new code.');
          break;
        default:
          showError('codeError', 'An error occurred. Please try again.');
      }
      document.getElementById('codeInput').value = '';
      document.getElementById('codeInput').focus();
    }
  }

  // ========================================
  // Resend Code
  // ========================================
  async function resendCode() {
    if (isProcessing) return;
    hideError('codeError');
    document.getElementById('codeInput').value = '';

    setLoading('codeBtn', true);

    try {
      var result = await callAPI('sendAuthCode', { email: loginEmail });
      setLoading('codeBtn', false);
      if (result.success) {
        showError('codeError', 'A new code has been sent to ' + loginEmail);
        document.getElementById('codeError').style.background = '#f0fff4';
        document.getElementById('codeError').style.borderColor = '#9ae6b4';
        document.getElementById('codeError').style.color = '#276749';
        document.getElementById('codeInput').focus();
      } else if (result.error === 'RATE_LIMITED') {
        showError('codeError', 'Please wait 30 seconds before requesting another code.');
      } else {
        showError('codeError', 'Failed to resend code. Please try again.');
      }
    } catch(e) {
      setLoading('codeBtn', false);
      showError('codeError', 'Failed to resend code. Please try again.');
    }
  }

  // ========================================
  // Navigation
  // ========================================
  function goBackToEmail() {
    hideError('codeError');
    document.getElementById('codeInput').value = '';
    showStep(1);
    setTimeout(function() {
      document.getElementById('emailInput').focus();
    }, 300);
  }

  function showStep(stepNumber) {
    var steps = document.querySelectorAll('.login-step');
    steps.forEach(function(step) {
      step.classList.remove('active');
    });
    document.getElementById('loginStep' + stepNumber).classList.add('active');
  }

  // ========================================
  // Utility
  // ========================================
  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function showError(elementId, message) {
    var el = document.getElementById(elementId);
    el.textContent = message;
    el.style.display = 'block';
    el.style.background = '#fff5f5';
    el.style.borderColor = '#feb2b2';
    el.style.color = '#c53030';
  }

  function hideError(elementId) {
    document.getElementById(elementId).style.display = 'none';
  }

  function setLoading(btnId, loading) {
    isProcessing = loading;
    var btn = document.getElementById(btnId);
    if (loading) {
      btn.disabled = true;
      btn.querySelector('.login-btn-text').textContent = 'Please wait...';
      var icon = btn.querySelector('.login-btn-icon');
      if (icon) icon.style.display = 'none';
      var spinner = document.createElement('div');
      spinner.className = 'spinner-small';
      spinner.id = 'btnSpinner';
      btn.appendChild(spinner);
    } else {
      btn.disabled = false;
      var spinner = document.getElementById('btnSpinner');
      if (spinner) spinner.remove();
      var icon = btn.querySelector('.login-btn-icon');
      if (icon) icon.style.display = '';
      if (btnId === 'emailBtn') {
        btn.querySelector('.login-btn-text').textContent = 'Continue';
      } else if (btnId === 'codeBtn') {
        btn.querySelector('.login-btn-text').textContent = 'Verify & Sign In';
      }
    }
  }

  // Register service worker on login page too (pre-caches dashboard assets)
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function() {
      navigator.serviceWorker.register('/sw.js').catch(function() {});
    });
  }

  // ========================================
  // PWA Install Prompt (login page)
  // ========================================
  (function() {
    var deferredPrompt = null;
    var installDismissed = false;

    // Capture beforeinstallprompt (Android / Desktop Chrome)
    window.addEventListener('beforeinstallprompt', function(e) {
      e.preventDefault();
      deferredPrompt = e;
      if (!installDismissed && !sessionStorage.getItem('pwa-install-dismissed')) {
        setTimeout(showInstallPopup, 2000);
      }
    });

    // iOS detection
    function isIOS() {
      return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    }
    function isInStandaloneMode() {
      return window.matchMedia('(display-mode: standalone)').matches ||
             window.navigator.standalone === true;
    }

    // Show install popup on iOS
    if (isIOS() && !isInStandaloneMode()) {
      if (!sessionStorage.getItem('pwa-install-dismissed')) {
        window.addEventListener('load', function() {
          setTimeout(showInstallPopup, 3000);
        });
      }
    }

    function showInstallPopup() {
      var popup = document.getElementById('pwaInstallPopup');
      if (!popup) return;

      var nativeBtn = document.getElementById('pwaInstallBtn');
      var iosInstructions = document.getElementById('pwaIOSInstructions');
      if (isIOS()) {
        if (nativeBtn) nativeBtn.style.display = 'none';
        if (iosInstructions) iosInstructions.style.display = 'block';
      } else {
        if (nativeBtn) nativeBtn.style.display = '';
        if (iosInstructions) iosInstructions.style.display = 'none';
      }

      popup.classList.add('visible');
    }

    // Install button click
    window.pwaInstallApp = function() {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function() {
        deferredPrompt = null;
        dismissInstallPopup();
      });
    };

    // Dismiss popup
    window.dismissInstallPopup = function() {
      installDismissed = true;
      sessionStorage.setItem('pwa-install-dismissed', '1');
      var popup = document.getElementById('pwaInstallPopup');
      if (popup) popup.classList.remove('visible');
    };

    window.addEventListener('appinstalled', function() {
      window.dismissInstallPopup();
    });
  })();
