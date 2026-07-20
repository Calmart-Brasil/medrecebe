(function setupMedRecebeCloud(global) {
  const config = global.MEDRECEBE_CONFIG || {};
  const SESSION_KEY = 'medrecebe.cloud.session.v1';

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

  async function authenticatedInvoke(name, body = {}) {
    const session = await refreshSession();
    return invoke(name, body, session.accessToken);
  }

  async function restore() {
    if (!getSession()) return null;
    try {
      const result = await authenticatedInvoke('account-status');
      return { ...result, session: getSession() };
    } catch (error) {
      await logout();
      throw error;
    }
  }

  async function logout() {
    const session = getSession();
    try {
      if (session?.accessToken && isEnabled()) {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 5000);
        try {
          await fetch(`${config.supabaseUrl}/auth/v1/logout?scope=local`, {
            method: 'POST',
            headers: { apikey: config.supabasePublishableKey, Authorization: `Bearer ${session.accessToken}` },
            keepalive: true,
            signal: controller.signal,
          });
        } finally {
          window.clearTimeout(timeout);
        }
      }
    } finally {
      localStorage.removeItem(SESSION_KEY);
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
    listDocuments: () => authenticatedInvoke('documents', { action: 'list' }),
    uploadDocument: (input) => authenticatedInvoke('documents', { action: 'upload', ...input }),
    deleteDocumentsForRecord: (recordId) => authenticatedInvoke('documents', { action: 'delete-record', recordId }),
    loadState: () => authenticatedInvoke('sync-state', { action: 'load' }),
    saveState: (state) => authenticatedInvoke('sync-state', { action: 'save', state }),
    adminUsers: (input) => authenticatedInvoke('admin-users', input),
    adminUpdateUser: (input) => authenticatedInvoke('admin-update-user', input),
    adminCreateUser: (input) => authenticatedInvoke('admin-create-user', input),
  });
})(window);
