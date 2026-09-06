import httpClient from '../../shared/api/httpClient'

export const authApi = {
  login: (credentials) => httpClient.post('/auth/login', credentials).then((response) => response.data.data),
  me: () => httpClient.get('/auth/me').then((response) => response.data.data),
  requestPasswordReset: (payload) => httpClient.post('/auth/forgot-password', payload).then((response) => response.data.data),
  changePassword: (payload) => httpClient.post('/auth/change-password', payload).then((response) => response.data.data),
}
