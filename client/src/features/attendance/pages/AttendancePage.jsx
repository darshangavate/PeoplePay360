import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../../app/providers/authContext'
import { getApiError } from '../../../shared/api/apiError'
import DataTable from '../../../shared/components/DataTable/DataTable'
import ConfirmDialog from '../../../shared/components/ConfirmDialog/ConfirmDialog'
import ErrorBanner from '../../../shared/components/ErrorBanner/ErrorBanner'
import FormField from '../../../shared/components/FormField/FormField'
import LoadingState from '../../../shared/components/LoadingState/LoadingState'
import Pagination from '../../../shared/components/Pagination/Pagination'
import StatusBadge from '../../../shared/components/StatusBadge/StatusBadge'
import { ROLES } from '../../../shared/constants/roles'
import { optionalText } from '../../../shared/validation/formValidation'
import employeesApi from '../../employees/api/employeesApi'
import { compact, employeeLabel, formatDate, formatDateTime, recordId, referenceLabel } from '../../timeOff/timeOffUtils'
import attendanceApi from '../api/attendanceApi'

const statuses = ['OPEN', 'PRESENT', 'LATE', 'OVERTIME', 'ABSENT', 'MISSING_CHECKOUT']
const blankManual = { employeeId: '', checkIn: '', checkOut: '', notes: '' }
const toIsoTimestamp = (value) => (value ? new Date(value).toISOString() : undefined)
const oneMinuteAfter = (value) => {
  if (!value) return undefined
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return undefined
  date.setMinutes(date.getMinutes() + 1)
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return localDate.toISOString().slice(0, 16)
}

export default function AttendancePage() {
  const { user } = useAuth()
  const employeeView = user.role === ROLES.EMPLOYEE
  const [searchParams] = useSearchParams()
  const [rows, setRows] = useState([])
  const [employees, setEmployees] = useState([])
  const [meta, setMeta] = useState(null)
  const [filters, setFilters] = useState({ employeeId: searchParams.get('employeeId') || '', departmentId: '', status: '', from: '', to: '', page: 1, limit: 10 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [manual, setManual] = useState(null)
  const [earlyCheckout, setEarlyCheckout] = useState(null)

  const load = () => {
    const query = compact(employeeView ? { status: filters.status, from: filters.from, to: filters.to, page: filters.page, limit: filters.limit } : filters)
    return (employeeView ? attendanceApi.mine(query) : attendanceApi.list(query)).then((result) => { setRows(result.data); setMeta(result.meta) })
  }
  useEffect(() => {
    let active = true
    const requests = [employeeView ? Promise.resolve({ data: [] }) : employeesApi.list({ page: 1, limit: 100 }), employeeView ? attendanceApi.mine(compact(filters)) : attendanceApi.list(compact(filters))]
    Promise.all(requests).then(([employeeResult, attendanceResult]) => {
      if (!active) return
      setEmployees(employeeResult.data); setRows(attendanceResult.data); setMeta(attendanceResult.meta); setError(''); setLoading(false)
    }).catch((requestError) => { if (active) { setError(getApiError(requestError).message); setLoading(false) } })
    return () => { active = false }
  }, [employeeView, filters])

  const clock = async (action, confirmed = false) => {
    setBusy(action); setError('')
    try { await attendanceApi[action](confirmed); setEarlyCheckout(null); await load() } catch (requestError) {
      const apiError = getApiError(requestError)
      if (action === 'checkOut' && apiError.details.confirmationRequired) setEarlyCheckout(apiError.details)
      else setError(apiError.message)
    }
    finally { setBusy('') }
  }
  const createManual = async (event) => {
    event.preventDefault(); setBusy('manual'); setError('')
    if (!manual.employeeId) {
      setError('Please select an employee.'); setBusy(''); return
    }
    if (!manual.checkIn || !Number.isFinite(new Date(manual.checkIn).getTime())) {
      setError('Please select a valid check-in time.'); setBusy(''); return
    }
    if (!manual.checkOut) {
      setError('Please select a check-out time.'); setBusy(''); return
    }
    if (!Number.isFinite(new Date(manual.checkOut).getTime())) {
      setError('Please select a valid check-out time.'); setBusy(''); return
    }
    if (new Date(manual.checkOut).getTime() <= new Date(manual.checkIn).getTime()) {
      setError('Check-out time must be after check-in time.'); setBusy(''); return
    }
    const notesError = optionalText(manual.notes, 'Notes', 2000)
    if (notesError) {
      setError(notesError); setBusy(''); return
    }
    try {
      const notes = manual.notes.trim()
      await attendanceApi.create({
        employeeId: manual.employeeId,
        checkIn: toIsoTimestamp(manual.checkIn),
        checkOut: toIsoTimestamp(manual.checkOut),
        ...(notes ? { notes } : {}),
      })
      setManual(null); await load()
    }
    catch (requestError) { setError(getApiError(requestError).message) }
    finally { setBusy('') }
  }
  const columns = useMemo(() => [
    ...(!employeeView ? [{ key: 'employee', label: 'Employee', render: (row) => referenceLabel(row.employee, employees, employeeLabel) }] : []),
    { key: 'date', label: 'Date', render: (row) => formatDate(row.date) },
    { key: 'checkIn', label: 'Check in', render: (row) => formatDateTime(row.checkIn) },
    { key: 'checkOut', label: 'Check out', render: (row) => formatDateTime(row.checkOut) },
    { key: 'hours', label: 'Worked', render: (row) => `${Number(row.workedHours || 0).toFixed(2)} hours` },
    { key: 'status', label: 'Status', render: (row) => <StatusBadge value={row.status} /> },
    { key: 'actions', label: '', render: (row) => <Link className="button-link" to={`/attendance/${recordId(row)}`}>View</Link> },
  ], [employeeView, employees])
  const updateFilter = (name, value) => setFilters((current) => ({ ...current, [name]: value, page: 1 }))
  const hasOpenAttendance = rows.some((row) => row.status === 'OPEN')
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const hasAttendanceToday = rows.some((row) => row.date?.slice?.(0, 10) === today)
  const manualTimeInvalid =
    !manual?.employeeId ||
    !manual?.checkIn ||
    !manual?.checkOut ||
    !Number.isFinite(new Date(manual.checkIn).getTime()) ||
    !Number.isFinite(new Date(manual.checkOut).getTime()) ||
    new Date(manual.checkOut).getTime() <= new Date(manual.checkIn).getTime()

  return <><header className="page-header"><div><p className="eyebrow">Attendance</p><h1>{employeeView ? 'My Attendance' : 'Attendance'}</h1><p>{employeeView ? 'Clock in, clock out, and review your attendance history.' : 'Review attendance and correct records using backend-derived status and worked hours.'}</p></div><div className="header-actions">{employeeView ? <><button className="button" disabled={Boolean(busy) || loading || hasAttendanceToday} onClick={() => clock('checkIn')}>{busy === 'checkIn' ? 'Checking in...' : 'Check In'}</button><button className="button button--secondary" disabled={Boolean(busy) || loading || !hasOpenAttendance} onClick={() => clock('checkOut')}>{busy === 'checkOut' ? 'Checking out...' : 'Check Out'}</button></> : <button className="button" onClick={() => setManual({ ...blankManual })}>+ Manual Attendance</button>}</div></header><ErrorBanner message={error} />
    {!employeeView && manual && <form className="panel inline-form" onSubmit={createManual}><h2>Manual attendance</h2><div className="form-grid"><FormField label="Employee *"><select required value={manual.employeeId} onChange={(event) => setManual({ ...manual, employeeId: event.target.value })}><option value="">Select employee</option>{employees.map((employee) => <option key={recordId(employee)} value={recordId(employee)}>{employeeLabel(employee)} ({employee.employeeId})</option>)}</select></FormField><FormField label="Check in *"><input required type="datetime-local" value={manual.checkIn} onChange={(event) => setManual({ ...manual, checkIn: event.target.value })} /></FormField><FormField label="Check out *"><input required type="datetime-local" min={oneMinuteAfter(manual.checkIn)} value={manual.checkOut} onChange={(event) => setManual({ ...manual, checkOut: event.target.value })} onBlur={() => { if (manual.checkIn && manual.checkOut && new Date(manual.checkOut).getTime() <= new Date(manual.checkIn).getTime()) { setError('Check-out time must be after check-in time.') } }} /></FormField><FormField label="Notes"><textarea rows="2" maxLength={2000} value={manual.notes} onChange={(event) => setManual({ ...manual, notes: event.target.value })} /><small>{manual.notes.length}/2000 characters</small></FormField></div><div className="form-actions"><button type="button" className="button button--secondary" onClick={() => setManual(null)}>Cancel</button><button className="button" disabled={busy === 'manual' || manualTimeInvalid}>{busy === 'manual' ? 'Saving...' : 'Create'}</button></div></form>}
    <section className="panel">{!employeeView && <div className="operation-filters"><select aria-label="Filter employee" value={filters.employeeId} onChange={(event) => updateFilter('employeeId', event.target.value)}><option value="">All employees</option>{employees.map((employee) => <option key={recordId(employee)} value={recordId(employee)}>{employeeLabel(employee)}</option>)}</select><select aria-label="Filter status" value={filters.status} onChange={(event) => updateFilter('status', event.target.value)}><option value="">All statuses</option>{statuses.map((status) => <option key={status}>{status}</option>)}</select><input aria-label="From date" type="date" value={filters.from} onChange={(event) => updateFilter('from', event.target.value)} /><input aria-label="To date" type="date" value={filters.to} onChange={(event) => updateFilter('to', event.target.value)} /></div>}{loading ? <LoadingState label="Loading attendance..." /> : <><DataTable columns={columns} rows={rows.map((row) => ({ ...row, id: recordId(row) }))} emptyMessage="No attendance records found." /><Pagination meta={meta} onPageChange={(page) => setFilters({ ...filters, page })} /></>}</section><ConfirmDialog open={Boolean(earlyCheckout)} title="Check out before your shift ends?" message={`Your scheduled workday ends at ${earlyCheckout?.scheduledEnd ? new Date(earlyCheckout.scheduledEnd).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'the scheduled time'}. Are you sure you want to check out now?`} confirmLabel="Check out early" busy={busy === 'checkOut'} onCancel={() => setEarlyCheckout(null)} onConfirm={() => clock('checkOut', true)} /></>
}
