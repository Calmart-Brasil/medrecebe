(function setupMedRecebeCloud(global) {
  const config = global.MEDRECEBE_CONFIG || {};
  const SESSION_KEY = 'medrecebe.cloud.session.v1';
  const ADMIN_MFA_KEY = 'medrecebe.admin.mfa.v1';

  function isEnabled() {
    return /^https:\/\/.+\.supabase\.co$/.test(config.supabaseUrl || '') && Boolean(config.supabasePublishableKey);
  }

  async function parse(response) {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Não foi possível concluir a operação.');
    return payload;
  }

  async function invoke(name, body = {}, accessToken = '', extraHeaders = {}) {
    if (!isEnabled()) throw new Error('O backend do MedRecebe ainda não foi configurado.');
    return parse(
      await fetch(`${config.supabaseUrl}/functions/v1/${name}`, {
        method: 'POST',
        headers: {
          apikey: config.supabasePublishableKey,
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          ...extraHeaders,
        },
        body: JSON.stringify(body),
      }),
    );
  }

  function getSession() {
    try {
      return JSON.parse(localStorage.getItem(SESSION_KEY)) || null;
    } catch {
      return null;
    }
  }

  function saveSession(session) {
    if (!session) return;
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }

  function sessionIsFresh(session) {
    return session?.accessToken && Number(session.expiresAt || 0) * 1000 > Date.now() + 60_000;
  }

  async function refreshSession(session = getSession()) {
    if (!session?.refreshToken) throw new Error('Sessão expirada. Entre novamente.');
    if (sessionIsFresh(session)) return session;
    const response = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: config.supabasePublishableKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: session.refreshToken }),
    });
    const payload = await parse(response);
    const refreshed = {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      expiresAt: payload.expires_at,
    };
    saveSession(refreshed);
    return refreshed;
  }

  async function register(input) {
    const result = await invoke('register', input);
    if (result.session) saveSession(result.session);
    return result;
  }

  async function login(cpf, password) {
    const result = await invoke('login-cpf', { cpf, password });
    saveSession(result.session);
    return result;
  }

  async function authenticatedInvoke(name, body = {}, requireMfa = false) {
    const session = await refreshSession();
    const proof = requireMfa ? sessionStorage.getItem(ADMIN_MFA_KEY) || '' : '';
    return invoke(name, body, session.accessToken, proof ? { 'X-Admin-MFA': proof } : {});
  }

  function importSessionFromUrl() {
    const fragment = new URLSearchParams(global.location.hash.replace(/^#/, ''));
    const accessToken = fragment.get('access_token');
    const refreshToken = fragment.get('refresh_token');
    if (!accessToken || !refreshToken) return false;
    saveSession({
      accessToken,
      refreshToken,
      expiresAt: Math.floor(Date.now() / 1000) + Number(fragment.get('expires_in') || 3600),
    });
    global.history.replaceState({}, document.title, `${global.location.pathname}${global.location.search}`);
    return true;
  }

  function sessionFromAuth(payload) {
    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      expiresAt: payload.expires_at,
    };
  }

  async function authRequest(path, init = {}, useSession = true) {
    const session = useSession ? await refreshSession() : null;
    return parse(await fetch(`${config.supabaseUrl}/auth/v1/${path.replace(/^\//, '')}`, {
      method: init.method || 'POST',
      headers: {
        apikey: config.supabasePublishableKey,
        'Content-Type': 'application/json',
        ...(session?.accessToken ? { Authorization: `Bearer ${session.accessToken}` } : {}),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    }));
  }

  function jwtAal() {
    try {
      const encoded = (getSession()?.accessToken || '').split('.')[1] || '';
      const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(encoded.length / 4) * 4, '=');
      const payload = JSON.parse(atob(normalized));
      return payload.aal || 'aal1';
    } catch {
      return 'aal1';
    }
  }

  async function listMfaFactors() {
    const payload = await authRequest('factors', { method: 'GET' });
    const factors = Array.isArray(payload) ? payload : payload.all || payload.factors || [];
    return factors.filter((factor) => factor.factor_type === 'totp' && factor.status === 'verified');
  }

  async function enrollTotp() {
    return authRequest('factors', { body: { factor_type: 'totp', friendly_name: 'MedRecebe Admin' } });
  }

  async function verifyTotp(factorId, code) {
    const challenge = await authRequest(`factors/${encodeURIComponent(factorId)}/challenge`, { body: {} });
    const verified = await authRequest(`factors/${encodeURIComponent(factorId)}/verify`, {
      body: { challenge_id: challenge.id, code: String(code || '').replace(/\D/g, '').slice(0, 6) },
    });
    if (verified.access_token) saveSession(sessionFromAuth(verified));
    sessionStorage.removeItem(ADMIN_MFA_KEY);
    return verified;
  }

  async function verifyAdminEmailOtp(email, token) {
    const verified = await authRequest('verify', {
      body: { type: 'email', email, token: String(token || '').replace(/\D/g, '').slice(0, 8) },
    }, false);
    if (!verified.access_token) throw new Error('Código de confirmação inválido.');
    saveSession(sessionFromAuth(verified));
    const result = await authenticatedInvoke('admin-mfa-email-complete');
    sessionStorage.setItem(ADMIN_MFA_KEY, result.proof);
    return result;
  }

  async function completeAdminEmailMfaLink() {
    if (!importSessionFromUrl()) return false;
    const result = await authenticatedInvoke('admin-mfa-email-complete');
    sessionStorage.setItem(ADMIN_MFA_KEY, result.proof);
    return true;
  }

  async function restore() {
    if (!getSession()) return null;
    try {
      const result = await authenticatedInvoke('account-status');
      return { ...result, session: getSession() };
    } catch (error) {
      logout();
      throw error;
    }
  }

  async function logout() {
    const session = getSession();
    localStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(ADMIN_MFA_KEY);
    if (session?.accessToken && isEnabled()) {
      fetch(`${config.supabaseUrl}/auth/v1/logout`, {
        method: 'POST',
        headers: { apikey: config.supabasePublishableKey, Authorization: `Bearer ${session.accessToken}` },
      }).catch(() => {});
    }
  }

  global.MedRecebeCloud = Object.freeze({
    isEnabled,
    register,
    login,
    restore,
    logout,
    createSubscription: (planCode) => authenticatedInvoke('create-subscription', { planCode }),
    cancelSubscription: () => authenticatedInvoke('cancel-subscription'),
    analyzeInvoice: (input) => authenticatedInvoke('analyze-invoice', input),
    loadState: () => authenticatedInvoke('sync-state', { action: 'load' }),
    saveState: (state) => authenticatedInvoke('sync-state', { action: 'save', state }),
    adminUsers: (input) => authenticatedInvoke('admin-users', input, true),
    adminUpdateUser: (input) => authenticatedInvoke('admin-update-user', input, true),
    adminCreateUser: (input) => authenticatedInvoke('admin-create-user', input, true),
    adminEmailMfaStart: () => authenticatedInvoke('admin-mfa-email-start'),
    verifyAdminEmailOtp,
    completeAdminEmailMfaLink,
    listMfaFactors,
    enrollTotp,
    verifyTotp,
    adminMfaSatisfied: () => jwtAal() === 'aal2' || Boolean(sessionStorage.getItem(ADMIN_MFA_KEY)),
  });
})(window);
