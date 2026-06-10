import { defineStore } from 'pinia';

export const useAuth = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem('lvs_token') || '',
    user: JSON.parse(localStorage.getItem('lvs_user') || 'null')
  }),
  getters: {
    loggedIn: (s) => !!s.token,
    isAdmin: (s) => s.user && s.user.role === 'admin'
  },
  actions: {
    setSession(token, user) {
      this.token = token; this.user = user;
      localStorage.setItem('lvs_token', token);
      localStorage.setItem('lvs_user', JSON.stringify(user));
    },
    logout() {
      this.token = ''; this.user = null;
      localStorage.removeItem('lvs_token');
      localStorage.removeItem('lvs_user');
    }
  }
});
