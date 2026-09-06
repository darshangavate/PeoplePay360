import httpClient from '../../../shared/api/httpClient'

const attendanceApi = {
  mine: (params) =>
    httpClient
      .get('/attendance/me', { params })
      .then((response) => response.data),

  list: (params) =>
    httpClient
      .get('/attendance', { params })
      .then((response) => response.data),

  get: (id) =>
    httpClient
      .get(`/attendance/${id}`)
      .then((response) => response.data.data),

  checkIn: () =>
    httpClient
      .post('/attendance/check-in', {})
      .then((response) => response.data.data),

  checkOut: (confirmEarlyCheckout = false) =>
    httpClient
      .post('/attendance/check-out', confirmEarlyCheckout ? { confirmEarlyCheckout: true } : {})
      .then((response) => response.data.data),

  create: (payload) =>
    httpClient
      .post('/attendance', payload)
      .then((response) => response.data.data),

  correct: (id, payload) =>
    httpClient
      .patch(`/attendance/${id}`, payload)
      .then((response) => response.data.data),
}

export default attendanceApi
