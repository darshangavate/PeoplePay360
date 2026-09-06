import { Navigate, Route, Routes } from 'react-router-dom'
import AuthLayout from '../../layouts/AuthLayout/AuthLayout'
import AppLayout from '../../layouts/AppLayout/AppLayout'
import AccessDeniedPage from '../../features/auth/AccessDeniedPage'
import ChangePasswordPage from '../../features/auth/ChangePasswordPage'
import HomePage from '../../features/auth/HomePage'
import ForgotPasswordPage from '../../features/auth/ForgotPasswordPage'
import LoginPage from '../../features/auth/LoginPage'
import CreateUserPage from '../../features/users/CreateUserPage'
import UserDetailPage from '../../features/users/UserDetailPage'
import UsersPage from '../../features/users/UsersPage'
import DepartmentFormPage from '../../features/departments/pages/DepartmentFormPage'
import DepartmentListPage from '../../features/departments/pages/DepartmentListPage'
import ScheduleFormPage from '../../features/schedules/pages/ScheduleFormPage'
import ScheduleListPage from '../../features/schedules/pages/ScheduleListPage'
import EmployeeDetailPage from '../../features/employees/pages/EmployeeDetailPage'
import EmployeeFormPage from '../../features/employees/pages/EmployeeFormPage'
import EmployeeListPage from '../../features/employees/pages/EmployeeListPage'
import MyProfilePage from '../../features/employees/pages/MyProfilePage'
import ContractDetailPage from '../../features/contracts/pages/ContractDetailPage'
import ContractFormPage from '../../features/contracts/pages/ContractFormPage'
import ContractListPage from '../../features/contracts/pages/ContractListPage'
import AttendancePage from '../../features/attendance/pages/AttendancePage'
import AttendanceDetailPage from '../../features/attendance/pages/AttendanceDetailPage'
import AllocationsPage from '../../features/timeOff/pages/AllocationsPage'
import RequestsPage from '../../features/timeOff/pages/RequestsPage'
import TimeOffTypesPage from '../../features/timeOff/pages/TimeOffTypesPage'
import SalaryStructureListPage from '../../features/salaryConfig/pages/SalaryStructureListPage'
import SalaryStructureDetailPage from '../../features/salaryConfig/pages/SalaryStructureDetailPage'
import SalaryStructureFormPage from '../../features/salaryConfig/pages/SalaryStructureFormPage'
import SalaryRuleListPage from '../../features/salaryConfig/pages/SalaryRuleListPage'
import SalaryRuleDetailPage from '../../features/salaryConfig/pages/SalaryRuleDetailPage'
import SalaryRuleFormPage from '../../features/salaryConfig/pages/SalaryRuleFormPage'
import PayrunListPage from '../../features/payruns/pages/PayrunListPage'
import PayrunWizardPage from '../../features/payruns/pages/PayrunWizardPage'
import PayrunProcessingPage from '../../features/payruns/pages/PayrunProcessingPage'
import PayslipListPage from '../../features/payslips/pages/PayslipListPage'
import PayslipDetailPage from '../../features/payslips/pages/PayslipDetailPage'
import MyPayslipsPage from '../../features/payslips/pages/MyPayslipsPage'
import PayrollDashboardPage from '../../features/reports/pages/PayrollDashboardPage'
import NotificationsPage from '../../features/notifications/pages/NotificationsPage'
import { ROLES } from '../../shared/constants/roles'
import { CONTRACT_MANAGEMENT_ROLES, EMPLOYEE_MANAGEMENT_ROLES, HR_CONFIGURATION_ROLES, HR_OPERATIONS_ROLES, PAYROLL_MANAGEMENT_ROLES, SALARY_CONFIG_MANAGE_ROLES, SALARY_CONFIG_READ_ROLES } from '../../shared/permissions/permissions'
import ProtectedRoute from './ProtectedRoute'
import RoleRoute from './RoleRoute'

export default function AppRoutes() {
  return <Routes>
    <Route element={<AuthLayout />}><Route path="/login" element={<LoginPage />} /><Route path="/forgot-password" element={<ForgotPasswordPage />} /></Route>
    <Route element={<ProtectedRoute />}>
      <Route path="/change-password" element={<AuthLayout />}><Route index element={<ChangePasswordPage />} /></Route>
      <Route element={<AppLayout />}>
        <Route index element={<HomePage />} />
        <Route path="access-denied" element={<AccessDeniedPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route element={<RoleRoute roles={[ROLES.ADMIN]} />}><Route path="users" element={<UsersPage />} /><Route path="users/new" element={<CreateUserPage />} /><Route path="users/:id" element={<UserDetailPage />} /></Route>
        <Route element={<RoleRoute roles={HR_CONFIGURATION_ROLES} />}><Route path="departments" element={<DepartmentListPage />} /><Route path="departments/new" element={<DepartmentFormPage />} /><Route path="departments/:id/edit" element={<DepartmentFormPage />} /><Route path="working-schedules" element={<ScheduleListPage />} /><Route path="working-schedules/new" element={<ScheduleFormPage />} /><Route path="working-schedules/:id/edit" element={<ScheduleFormPage />} /></Route>
        <Route element={<RoleRoute roles={EMPLOYEE_MANAGEMENT_ROLES} />}><Route path="employees" element={<EmployeeListPage />} /><Route path="employees/new" element={<EmployeeFormPage />} /><Route path="employees/:id" element={<EmployeeDetailPage />} /><Route path="employees/:id/edit" element={<EmployeeFormPage />} /></Route>
        <Route element={<RoleRoute roles={CONTRACT_MANAGEMENT_ROLES} />}><Route path="contracts" element={<ContractListPage />} /><Route path="contracts/new" element={<ContractFormPage />} /><Route path="contracts/:id" element={<ContractDetailPage />} /><Route path="contracts/:id/edit" element={<ContractFormPage />} /></Route>
        <Route path="attendance" element={<AttendancePage />} />
        <Route path="attendance/:id" element={<AttendanceDetailPage />} />
        <Route path="time-off/requests" element={<RequestsPage />} />
        <Route path="time-off/allocations" element={<AllocationsPage />} />
        <Route element={<RoleRoute roles={HR_OPERATIONS_ROLES} />}><Route path="time-off/types" element={<TimeOffTypesPage />} /></Route>
        <Route element={<RoleRoute roles={SALARY_CONFIG_READ_ROLES} />}><Route path="salary-config/structures" element={<SalaryStructureListPage />} /><Route path="salary-config/structures/:id" element={<SalaryStructureDetailPage />} /><Route path="salary-config/rules" element={<SalaryRuleListPage />} /><Route path="salary-config/rules/:id" element={<SalaryRuleDetailPage />} /></Route>
        <Route element={<RoleRoute roles={SALARY_CONFIG_MANAGE_ROLES} />}><Route path="salary-config/structures/new" element={<SalaryStructureFormPage />} /><Route path="salary-config/structures/:id/edit" element={<SalaryStructureFormPage />} /><Route path="salary-config/rules/new" element={<SalaryRuleFormPage />} /><Route path="salary-config/rules/:id/edit" element={<SalaryRuleFormPage />} /></Route>
        <Route element={<RoleRoute roles={PAYROLL_MANAGEMENT_ROLES} />}><Route path="payroll/dashboard" element={<PayrollDashboardPage />} /><Route path="payroll/payruns" element={<PayrunListPage />} /><Route path="payroll/payruns/new" element={<PayrunWizardPage />} /><Route path="payroll/payruns/:id" element={<PayrunProcessingPage />} /><Route path="payroll/payslips" element={<PayslipListPage />} /><Route path="payroll/payslips/:id" element={<PayslipDetailPage />} /></Route>
        <Route element={<RoleRoute roles={[ROLES.EMPLOYEE]} />}><Route path="my-profile" element={<MyProfilePage />} /><Route path="my-payslips" element={<MyPayslipsPage />} /><Route path="my-payslips/:id" element={<PayslipDetailPage />} /></Route>
      </Route>
    </Route>
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
}
