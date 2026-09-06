import { useState } from 'react'
import ErrorBanner from '../../../shared/components/ErrorBanner/ErrorBanner'
import FormField from '../../../shared/components/FormField/FormField'
import {
  nonNegativeNumber,
  dateRange,
  optionExists,
  oneOf,
} from '../../../shared/validation/formValidation'
import { employeeLabel, recordId, referenceId } from '../contractUtils'

const JOB_POSITIONS = [
  'Software Engineer',
  'HR Executive',
  'Payroll Executive',
  'Accountant',
  'Sales Executive',
  'Operations Executive',
  'Manager',
]

const values = (contract, employees) => {
  const employeeId = referenceId(contract?.employee)
  const employee = employees.find((item) => recordId(item) === employeeId)
  return {
    employeeId,
    departmentId: referenceId(contract?.department) || referenceId(employee?.department),
    jobPosition: contract?.jobPosition || employee?.jobPosition || '',
    workingScheduleId: referenceId(contract?.workingSchedule) || referenceId(employee?.workingSchedule),
    salaryStructureId: referenceId(contract?.salaryStructure),
    wage: contract?.wage ?? '', startDate: contract?.startDate?.slice(0, 10) || '', endDate: contract?.endDate?.slice(0, 10) || '',
  }
}

export default function ContractForm({ contract, references, error, busy, onSubmit, onCancel }) {
  const [form, setForm] = useState(() => values(contract, references.employees))
  const [fieldError, setFieldError] = useState('')
  const update = (event) => setForm((current) => ({ ...current, [event.target.name]: event.target.value }))
  const selectEmployee = (event) => {
    const employee = references.employees.find((item) => recordId(item) === event.target.value)
    setForm((current) => ({ ...current, employeeId: event.target.value, departmentId: referenceId(employee?.department), jobPosition: employee?.jobPosition || '', workingScheduleId: referenceId(employee?.workingSchedule) }))
  }
  const submit = (event) => {
    event.preventDefault()
    const errors = [
      optionExists(form.employeeId, references.employees, (item) => recordId(item), 'Employee'),
      optionExists(form.departmentId, references.departments, (item) => recordId(item), 'Department'),
      oneOf(form.jobPosition, jobPositions, 'Job position'),
      optionExists(form.workingScheduleId, references.schedules, (item) => recordId(item), 'Working schedule'),
      optionExists(form.salaryStructureId, references.structures, (item) => recordId(item), 'Salary structure'),
      nonNegativeNumber(form.wage, 'Monthly wage'),
      dateRange(form.startDate, form.endDate, 'Start date', 'End date', false),
    ].find(Boolean)
    if (errors) return setFieldError(errors)
    setFieldError('')
    onSubmit({ employeeId: form.employeeId, departmentId: form.departmentId, jobPosition: form.jobPosition.trim(), workingScheduleId: form.workingScheduleId, salaryStructureId: form.salaryStructureId, wage: Number(form.wage), wageType: 'MONTHLY', startDate: form.startDate, endDate: form.endDate || null })
  }
  const activeOrCurrent = (items, current) => items.filter((item) => item.active !== false || recordId(item) === current)
  const selectedEmployee = references.employees.find((item) => recordId(item) === form.employeeId)
  const jobPositions = form.jobPosition && !JOB_POSITIONS.includes(form.jobPosition) ? [form.jobPosition, ...JOB_POSITIONS] : JOB_POSITIONS

  return <form className="panel form-panel contract-form" onSubmit={submit}><ErrorBanner message={fieldError || error} />
    {!references.salaryStructureAccess && <div className="alert alert--warning">Your backend role cannot read Salary Structures. Contract creation or editing requires a payroll user or Admin until that API permission is aligned.</div>}
    <div className="form-grid">
      <FormField label="Employee *" htmlFor="contract-employee" hint={selectedEmployee ? `Current position: ${selectedEmployee.jobPosition}` : 'Selecting an employee fills their current employment details.'}><select id="contract-employee" name="employeeId" required value={form.employeeId} onChange={selectEmployee}><option value="">Select employee</option>{references.employees.map((employee) => <option key={recordId(employee)} value={recordId(employee)}>{employeeLabel(employee)} ({employee.employeeId})</option>)}</select></FormField>
      <FormField label="Department *" htmlFor="contract-department"><select id="contract-department" name="departmentId" required value={form.departmentId} onChange={update}><option value="">Select department</option>{activeOrCurrent(references.departments, form.departmentId).map((department) => <option key={recordId(department)} value={recordId(department)}>{department.name}</option>)}</select></FormField>
      <FormField label="Job position *" htmlFor="contract-job"><select id="contract-job" name="jobPosition" required value={form.jobPosition} onChange={update}><option value="">Select job position</option>{jobPositions.map((position) => <option key={position} value={position}>{position}</option>)}</select></FormField>
      <FormField label="Working schedule *" htmlFor="contract-schedule"><select id="contract-schedule" name="workingScheduleId" required value={form.workingScheduleId} onChange={update}><option value="">Select schedule</option>{activeOrCurrent(references.schedules, form.workingScheduleId).map((schedule) => <option key={recordId(schedule)} value={recordId(schedule)}>{schedule.name}</option>)}</select></FormField>
      <FormField label="Salary Structure *" htmlFor="contract-structure"><select id="contract-structure" name="salaryStructureId" required disabled={!references.salaryStructureAccess} value={form.salaryStructureId} onChange={update}><option value="">Select Salary Structure</option>{activeOrCurrent(references.structures, form.salaryStructureId).map((structure) => <option key={recordId(structure)} value={recordId(structure)}>{structure.name} ({structure.code})</option>)}</select></FormField>
      <FormField label="Monthly wage *" htmlFor="contract-wage"><input id="contract-wage" name="wage" type="number" min="0" step="0.01" required value={form.wage} onChange={update} /></FormField>
      <FormField label="Start date *" htmlFor="contract-start"><input id="contract-start" name="startDate" type="date" required value={form.startDate} onChange={update} /></FormField>
      <FormField label="End date" htmlFor="contract-end" hint="Leave blank for an open-ended Contract."><input id="contract-end" name="endDate" type="date" value={form.endDate} onChange={update} /></FormField>
      <FormField label="Wage type" htmlFor="contract-wage-type"><input id="contract-wage-type" value="Monthly" disabled /></FormField>
    </div>
    <div className="form-actions"><button type="button" className="button button--secondary" onClick={onCancel} disabled={busy}>Cancel</button><button className="button" disabled={busy || !references.salaryStructureAccess}>{busy ? 'Saving...' : contract ? 'Save changes' : 'Create Contract'}</button></div>
  </form>
}
