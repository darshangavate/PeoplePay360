import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getApiError } from '../../../shared/api/apiError'
import ErrorBanner from '../../../shared/components/ErrorBanner/ErrorBanner'
import LoadingState from '../../../shared/components/LoadingState/LoadingState'
import departmentsApi from '../../departments/api/departmentsApi'
import { compact, formatMoney } from '../../payruns/payrollUiUtils'
import reportsApi from '../api/reportsApi'

const payrollColors = {
  DRAFT: '#9a8f7c',
  COMPUTED: '#4c75b9',
  VALIDATED: '#8a65c8',
  PAID: '#16845b',
}

const attendanceColors = ['#16845b', '#d18a24', '#c44e46', '#5578c8', '#9a6ac7', '#738093']
const employeeTypes = [
  { value: '', label: 'All employee types' },
  { value: 'FULL_TIME', label: 'Full time' },
  { value: 'CONTRACT', label: 'Contract' },
]

function Kpi({ label, value, note }) {
  return <article className="payroll-kpi"><span>{label}</span><strong>{value}</strong><small>{note}</small></article>
}

function SectionHeading({ title, subtitle }) {
  return <header className="payroll-section-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div></header>
}

function EmptyChart() {
  return <div className="payroll-chart-empty">No report data for this scope.</div>
}

function DepartmentBars({ rows }) {
  const maximum = Math.max(0, ...rows.map((row) => Number(row.totalNetSalary || 0)))
  if (!rows.length) return <EmptyChart />

  return <div className="department-bars">{rows.map((row) => {
    const height = maximum ? Math.max(5, Number(row.totalNetSalary || 0) * 100 / maximum) : 0
    return <div className="department-bar" key={row.departmentId}><span className="department-bar-value">{formatMoney(row.totalNetSalary)}</span><div className="department-bar-track"><span style={{ height: `${height}%` }} /></div><strong>{row.departmentName}</strong><small>{row.headcount} employee{row.headcount === 1 ? '' : 's'}</small></div>
  })}</div>
}

function TrendChart({ rows }) {
  if (!rows.length) return <EmptyChart />
  const width = 680
  const height = 190
  const insetX = 34
  const insetY = 24
  const maximum = Math.max(1, ...rows.map((row) => Number(row.totalNetSalary || 0)))
  const points = rows.map((row, index) => ({
    ...row,
    x: rows.length === 1 ? width / 2 : insetX + index * (width - insetX * 2) / (rows.length - 1),
    y: height - insetY - Number(row.totalNetSalary || 0) * (height - insetY * 2) / maximum,
  }))
  const month = (value) => new Intl.DateTimeFormat(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(new Date(`${value}-01T00:00:00.000Z`))

  return <div className="trend-chart"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Monthly net salary trend">
    <line x1={insetX} y1={height - insetY} x2={width - insetX} y2={height - insetY} className="trend-axis" />
    <polyline points={points.map((point) => `${point.x},${point.y}`).join(' ')} className="trend-line" />
    {points.map((point) => <g key={point.month}><circle cx={point.x} cy={point.y} r="4" className="trend-point"><title>{month(point.month)}: {formatMoney(point.totalNetSalary)}</title></circle><text x={point.x} y={height - 4} textAnchor="middle">{month(point.month)}</text></g>)}
  </svg></div>
}

function PayrollStatus({ values }) {
  const entries = Object.entries(values)
  const total = entries.reduce((sum, [, value]) => sum + Number(value || 0), 0)
  return <div className="payroll-status"><div className="status-track" aria-label={`${total} Payruns`}>{entries.map(([label, value]) => Number(value) > 0 && <span key={label} title={`${label}: ${value}`} style={{ width: `${Number(value) * 100 / total}%`, background: payrollColors[label] }} />)}</div><div className="status-legend">{entries.map(([label, value]) => <div key={label}><span style={{ background: payrollColors[label] }} /><small>{label}</small><strong>{value}</strong></div>)}</div></div>
}

function StatBars({ values }) {
  const entries = Object.entries(values)
  const maximum = Math.max(1, ...entries.map(([, value]) => Number(value || 0)))
  return <div className="stat-bars">{entries.map(([label, value], index) => <div key={label}><strong>{value}</strong><div><span style={{ height: `${Number(value || 0) * 100 / maximum}%`, background: attendanceColors[index % attendanceColors.length] }} /></div><small>{label.replace(/([A-Z])/g, ' $1')}</small></div>)}</div>
}

export default function PayrollDashboardPage() {
  const [departments, setDepartments] = useState([])
  const [filters, setFilters] = useState({ from: '', to: '', departmentId: '', employeeType: '' })
  const [applied, setApplied] = useState(filters)
  const [dashboard, setDashboard] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => { departmentsApi.list({ page: 1, limit: 100 }).then((result) => setDepartments(result.data)).catch(() => {}) }, [])
  useEffect(() => {
    let active = true
    reportsApi.payrollDashboard(compact(applied)).then((result) => {
      if (active) { setDashboard(result); setError(''); setLoading(false) }
    }).catch((requestError) => {
      if (active) { setError(getApiError(requestError).message); setLoading(false) }
    })
    return () => { active = false }
  }, [applied])

  const apply = (event) => { event.preventDefault(); setLoading(true); setApplied({ ...filters }) }
  if (loading && !dashboard) return <LoadingState label="Loading Payroll Dashboard..." />

  const attention = dashboard?.attention || {}
  const attentionRows = [...(attention.payrollBlockingWarnings || []), ...(attention.payrollWarnings || [])]
  const attentionCounts = {
    blocking: attention.payrollBlockingWarnings?.length || 0,
    warnings: attention.payrollWarnings?.length || 0,
    contracts: attention.contractAttention?.length || 0,
    attendance: attention.attendanceExceptions?.length || 0,
  }

  return <div className="payroll-dashboard">
    <header className="page-header"><div><p className="eyebrow">Live reports</p><h1>Payroll Dashboard</h1><p>Payments, staffing impact, leave patterns, and attendance quality for the selected period.</p></div></header>
    <ErrorBanner message={error} />
    <form className="panel payroll-dashboard-filters" onSubmit={apply}>
      <label><span>From</span><input aria-label="Report from" type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} /></label>
      <label><span>To</span><input aria-label="Report to" type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} /></label>
      <label><span>Department</span><select value={filters.departmentId} onChange={(event) => setFilters({ ...filters, departmentId: event.target.value })}><option value="">All departments</option>{departments.map((department) => <option key={department.id || department._id} value={department.id || department._id}>{department.name}</option>)}</select></label>
      <label><span>Employee type</span><select value={filters.employeeType} onChange={(event) => setFilters({ ...filters, employeeType: event.target.value })}>{employeeTypes.map((option) => <option key={option.value || 'ALL'} value={option.value}>{option.label}</option>)}</select></label>
      <button className="button" disabled={loading}>{loading ? 'Refreshing...' : 'Apply filters'}</button>
    </form>

    {dashboard && <>
      <section className="payroll-kpi-grid">
        <Kpi label="Total Net Salary Paid" value={formatMoney(dashboard.kpis.totalNetSalaryPaid)} note="Paid Payslips in this scope" />
        <Kpi label="Payslips Generated" value={dashboard.kpis.payslipsGenerated} note="Across all payroll states" />
        <Kpi label="Average Net Salary" value={formatMoney(dashboard.kpis.averageNetSalary ?? dashboard.kpis.averageSalary)} note="Based on paid Payslips" />
        <Kpi label="Approved Time Off" value={dashboard.kpis.approvedTimeOff} note={`${dashboard.timeOffOverview.approvedDays} approved units`} />
        <Kpi label="Attendance Health" value={`${dashboard.kpis.attendanceHealth}%`} note="Present, late, and overtime" />
      </section>

      <div className="payroll-analytics-grid">
        <section className="panel payroll-chart-panel payroll-chart-panel--wide"><SectionHeading title="Salary Cost by Department" subtitle="Paid net salary and employee headcount" /><DepartmentBars rows={dashboard.salaryByDepartment} /></section>
        <section className="panel payroll-chart-panel payroll-chart-panel--wide"><SectionHeading title="Monthly Net Salary Trend" subtitle="Paid net salary by payroll month" /><TrendChart rows={dashboard.monthlyNetSalaryTrend} /></section>

        <section className="panel payroll-chart-panel payroll-chart-panel--status"><SectionHeading title="Payrun Status & Payroll Alerts" subtitle="Current workflow state and persisted Payrun issues" /><div className="payroll-status-layout"><PayrollStatus values={dashboard.payrollStatus} /><div className="attention-summary"><h3>Current attention</h3>{Object.entries(attentionCounts).map(([label, value]) => <div key={label}><span className={`attention-dot attention-dot--${label}`} /><span>{label}</span><strong>{value}</strong></div>)}</div></div></section>

        <section className="panel payroll-chart-panel"><SectionHeading title="Attendance Overview" subtitle="Attendance records in the selected scope" /><StatBars values={dashboard.attendanceOverview} /></section>

        <section className="panel payroll-chart-panel"><SectionHeading title="Time Off Overview" subtitle="Request status and approved duration" /><div className="time-off-stats"><div><span>Approved</span><strong>{dashboard.timeOffOverview.approved}</strong></div><div><span>Pending</span><strong>{dashboard.timeOffOverview.pending}</strong></div><div><span>Refused</span><strong>{dashboard.timeOffOverview.refused}</strong></div><div className="time-off-stats__total"><span>Approved units</span><strong>{dashboard.timeOffOverview.approvedDays}</strong></div></div></section>

        <section className="panel payroll-chart-panel payroll-chart-panel--departments"><SectionHeading title="Department Overview" subtitle="Paid payroll headcount and monthly net salary" />{dashboard.salaryByDepartment.length ? <div className="department-table"><div className="department-table__head"><span>Department</span><span>Headcount</span><span>Net salary</span></div>{dashboard.salaryByDepartment.map((row) => <div key={row.departmentId}><strong>{row.departmentName}</strong><span>{row.headcount}</span><span>{formatMoney(row.totalNetSalary)}</span></div>)}</div> : <EmptyChart />}</section>
      </div>

      <section className="panel dashboard-attention"><div className="section-toolbar"><div><h2>Payroll warnings and attention items</h2><p>Review persisted Payrun issues that need payroll attention.</p></div></div>{attentionRows.length ? <div className="issue-list">{attentionRows.map((issue, index) => <article className={`issue-row issue-row--${issue.severity === 'BLOCKING' ? 'blocking' : 'warning'}`} key={`${issue.payrunId}-${issue.code}-${index}`}><Link className="table-link" to={`/payroll/payruns/${issue.payrunId}`}>Open Payrun</Link><span className="code-text">{issue.code}</span><p>{issue.message}</p></article>)}</div> : <div className="empty-cell">No payroll warnings for this scope.</div>}</section>
    </>}
  </div>
}
