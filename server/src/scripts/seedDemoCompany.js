'use strict';

require('dotenv').config({ quiet: true });

const mongoose = require('mongoose');
const { env } = require('../src/config/env');
const roles = require('../src/core/constants/roles');
const { ACCOUNT_STATUSES } = require('../src/core/constants/statuses');
const { hashPassword } = require('../src/core/security/password');

const User = require('../src/modules/users/user.model');
const Department = require('../src/modules/departments/department.model');
const Schedule = require('../src/modules/schedules/schedule.model');
const Employee = require('../src/modules/employees/employee.model');
const Contract = require('../src/modules/contracts/contract.model');
const Attendance = require('../src/modules/attendance/attendance.model');

const TimeOffType = require('../src/modules/timeOff/timeOffType.model');
const TimeOffAllocation = require('../src/modules/timeOff/allocation.model');
const TimeOffRequest = require('../src/modules/timeOff/timeOffRequest.model');

const SalaryStructure =
  require('../src/modules/salaryConfig/salaryStructure.model');

const SalaryRule =
  require('../src/modules/salaryConfig/salaryRule.model');

const formulaService =
  require('../src/modules/salaryConfig/formula.service');


/* =========================================================
   DEMO CONSTANTS
========================================================= */

const DEMO_DOMAIN = 'demo.peoplepay360.test';

const DEMO_EMAIL_REGEX =
  /@demo\.peoplepay360\.test$/i;

const PERIOD_START =
  new Date('2026-08-01T00:00:00.000Z');

const PERIOD_END =
  new Date('2026-08-31T23:59:59.999Z');

const DAY_MS =
  24 * 60 * 60 * 1000;

const DAY_NAMES = [
  'SUNDAY',
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
];


/* =========================================================
   SMALL HELPERS
========================================================= */

const dateOnly = value =>
  new Date(`${value}T00:00:00.000Z`);

const endOfDay = value =>
  new Date(`${value}T23:59:59.999Z`);

const timestamp = (date, time) =>
  new Date(`${date}T${time}:00.000Z`);

const addMinutes = (date, minutes) =>
  new Date(
    date.getTime() +
      minutes * 60000
  );

const asId = value =>
  String(value?._id ?? value);


/* =========================================================
   SAFETY
========================================================= */

function requireDemoPassword() {
  const password =
    process.env.DEMO_SEED_PASSWORD;

  if (
    !password ||
    password.length < 8
  ) {
    throw new Error(
      'Set DEMO_SEED_PASSWORD to at least 8 characters before running this seed.'
    );
  }

  return password;
}


function productionGuard() {
  if (
    env.nodeEnv === 'production' &&
    process.env.ALLOW_DEMO_SEED !==
      'true'
  ) {
    throw new Error(
      'Demo seed is blocked in production. Set ALLOW_DEMO_SEED=true only if this is intentionally a demo database.'
    );
  }

  if (!env.mongodbUri) {
    throw new Error(
      'MONGODB_URI is required.'
    );
  }
}


/* =========================================================
   BANK DETAILS
========================================================= */

function bank(
  accountHolderName,
  suffix,
  bankName = 'HDFC Bank',
  ifscCode = 'HDFC0001234'
) {
  return {
    accountHolderName,

    accountNumber:
      `DEMO0000${suffix}`,

    bankName,

    ifscCode,
  };
}


/* =========================================================
   SCHEDULE HELPERS
========================================================= */

function scheduleDays(
  workingDayNames,
  startTime,
  endTime,
  breakMinutes,
  dailyHours
) {
  const working =
    new Set(workingDayNames);

  return DAY_NAMES
    .slice(1)
    .concat('SUNDAY')
    .map(day => ({
      day,

      isWorkingDay:
        working.has(day),

      startTime:
        working.has(day)
          ? startTime
          : null,

      endTime:
        working.has(day)
          ? endTime
          : null,

      breakMinutes:
        working.has(day)
          ? breakMinutes
          : 0,

      dailyHours:
        working.has(day)
          ? dailyHours
          : 0,
    }));
}


function workingDates(schedule) {
  const byDay =
    new Map(
      schedule.workingDays.map(
        line => [
          line.day,
          line,
        ]
      )
    );

  const result = [];

  for (
    let cursor =
      new Date(PERIOD_START);

    cursor <= PERIOD_END;

    cursor =
      new Date(
        cursor.getTime() +
          DAY_MS
      )
  ) {
    const line =
      byDay.get(
        DAY_NAMES[
          cursor.getUTCDay()
        ]
      );

    if (line?.isWorkingDay) {
      result.push({
        key:
          cursor
            .toISOString()
            .slice(0, 10),

        date:
          new Date(cursor),

        line,
      });
    }
  }

  return result;
}


/*
 Current backend precedence:

 Missing checkout
 → Late
 → Overtime
 → Present
*/

function attendanceStatus(
  checkIn,
  checkOut,
  scheduleStart,
  expectedMinutes
) {
  if (!checkOut) {
    return 'MISSING_CHECKOUT';
  }

  const workedMinutes =
    (checkOut - checkIn) /
    60000;

  if (
    checkIn >
    scheduleStart
  ) {
    return 'LATE';
  }

  if (
    workedMinutes >
    expectedMinutes
  ) {
    return 'OVERTIME';
  }

  return 'PRESENT';
}


/* =========================================================
   REMOVE ONLY OUR PREVIOUS DEMO DATA

   This does NOT wipe the whole database.
========================================================= */

async function cleanPreviousDemo() {

  const demoEmployees =
    await Employee
      .find({
        email:
          DEMO_EMAIL_REGEX,
      })
      .select('_id');

  const demoEmployeeIds =
    demoEmployees.map(
      record =>
        record._id
    );

  const demoUsers =
    await User
      .find({
        email:
          DEMO_EMAIL_REGEX,
      })
      .select('_id');

  const demoUserIds =
    demoUsers.map(
      record =>
        record._id
    );


  /*
   If you previously rehearsed payroll,
   remove generated demo Payruns/Payslips
   before recreating demo employees.
  */

  if (
    demoEmployeeIds.length
  ) {
    await mongoose
      .connection
      .db
      .collection('payslips')
      .deleteMany({
        employee: {
          $in:
            demoEmployeeIds,
        },
      });


    await mongoose
      .connection
      .db
      .collection('payruns')
      .deleteMany({
        employees: {
          $in:
            demoEmployeeIds,
        },
      });


    await Contract.deleteMany({
      employee: {
        $in:
          demoEmployeeIds,
      },
    });


    await Attendance.deleteMany({
      employee: {
        $in:
          demoEmployeeIds,
      },
    });


    await TimeOffRequest.deleteMany({
      employee: {
        $in:
          demoEmployeeIds,
      },
    });


    await TimeOffAllocation.deleteMany({
      employee: {
        $in:
          demoEmployeeIds,
      },
    });


    await Employee.deleteMany({
      _id: {
        $in:
          demoEmployeeIds,
      },
    });
  }


  if (demoUserIds.length) {
    await mongoose
      .connection
      .db
      .collection(
        'notifications'
      )
      .deleteMany({
        user: {
          $in:
            demoUserIds,
        },
      });
  }


  await User.deleteMany({
    email:
      DEMO_EMAIL_REGEX,
  });


  const demoStructures =
    await SalaryStructure
      .find({
        code: /^DEMO_/,
      })
      .select('_id');


  if (
    demoStructures.length
  ) {
    await SalaryRule.deleteMany({
      salaryStructure: {
        $in:
          demoStructures.map(
            record =>
              record._id
          ),
      },
    });
  }


  await SalaryStructure.deleteMany({
    code: /^DEMO_/,
  });


  await TimeOffType.deleteMany({
    code: /^DEMO_/,
  });


  await Department.deleteMany({
    code: /^DEMO_/,
  });


  await Schedule.deleteMany({
    name: /^Demo /,
  });
}


/* =========================================================
   INTERNAL SYSTEM USERS

   ADMIN is NOT created here.
   ADMIN remains bootstrap-only.
========================================================= */

async function createInternalUsers(
  passwordHash
) {
  const definitions = [

    /*
      HR operations user
    */
    {
      key:
        'HR_MANAGER',

      uniqueId:
        'PP360-U-DEMO-HR01',

      firstName:
        'Ananya',

      lastName:
        'Desai',

      email:
        `hr.manager@${DEMO_DOMAIN}`,

      role:
        roles.HR_MANAGER,

      accountStatus:
        ACCOUNT_STATUSES.ACTIVE,

      mustChangePassword:
        false,

      lastLogin:
        new Date(
          '2026-08-31T09:15:00.000Z'
        ),
    },


    /*
      Payroll execution user
    */
    {
      key:
        'PAYROLL_USER',

      uniqueId:
        'PP360-U-DEMO-PR01',

      firstName:
        'Karan',

      lastName:
        'Shah',

      email:
        `payroll.user@${DEMO_DOMAIN}`,

      role:
        roles.HR_PAYROLL_USER,

      accountStatus:
        ACCOUNT_STATUSES.ACTIVE,

      mustChangePassword:
        false,

      lastLogin:
        new Date(
          '2026-08-31T10:00:00.000Z'
        ),
    },


    /*
      Salary configuration owner
    */
    {
      key:
        'PAYROLL_MANAGER',

      uniqueId:
        'PP360-U-DEMO-PM01',

      firstName:
        'Meera',

      lastName:
        'Kapoor',

      email:
        `payroll.manager@${DEMO_DOMAIN}`,

      role:
        roles.HR_PAYROLL_MANAGER,

      accountStatus:
        ACCOUNT_STATUSES.ACTIVE,

      mustChangePassword:
        false,

      lastLogin:
        new Date(
          '2026-08-31T10:20:00.000Z'
        ),
    },


    /*
      Shows inactive User lifecycle
    */
    {
      key:
        'ARCHIVED_PAYROLL_USER',

      uniqueId:
        'PP360-U-DEMO-PR99',

      firstName:
        'Ritika',

      lastName:
        'Sen',

      email:
        `payroll.archived@${DEMO_DOMAIN}`,

      role:
        roles.HR_PAYROLL_USER,

      accountStatus:
        ACCOUNT_STATUSES.INACTIVE,

      mustChangePassword:
        true,

      lastLogin:
        new Date(
          '2026-06-30T12:00:00.000Z'
        ),
    },
  ];


  const users = {};


  for (
    const definition
    of definitions
  ) {
    const {
      key,
      ...values
    } = definition;


    users[key] =
      await User.create({
        ...values,

        passwordHash,

        /*
         Internal HR/payroll
         accounts are NOT
         Employee-linked.
        */
        employeeId:
          null,
      });
  }


  return users;
}


/* =========================================================
   DEPARTMENTS + WORKING SCHEDULES
========================================================= */

async function createDepartmentsAndSchedules() {

  const departments = {

    ENG:
      await Department.create({
        name:
          'Engineering',

        code:
          'DEMO_ENG',

        description:
          'Product engineering and quality assurance.',

        active:
          true,
      }),


    HR:
      await Department.create({
        name:
          'Human Resources',

        code:
          'DEMO_HR',

        description:
          'People operations, attendance and leave administration.',

        active:
          true,
      }),


    FIN:
      await Department.create({
        name:
          'Finance & Payroll',

        code:
          'DEMO_FIN',

        description:
          'Payroll operations and finance administration.',

        active:
          true,
      }),


    /*
      Shows inactive master data
    */
    LEGACY:
      await Department.create({
        name:
          'Legacy Operations',

        code:
          'DEMO_OPS_LEGACY',

        description:
          'Inactive master-data example.',

        active:
          false,
      }),
  };


  const monFri = [
    'MONDAY',
    'TUESDAY',
    'WEDNESDAY',
    'THURSDAY',
    'FRIDAY',
  ];


  const monSat = [
    ...monFri,
    'SATURDAY',
  ];


  const schedules = {

    /*
      21 scheduled working
      days in August 2026.
    */
    STANDARD:
      await Schedule.create({
        name:
          'Demo Standard Mon-Fri',

        workingDays:
          scheduleDays(
            monFri,
            '09:00',
            '18:00',
            60,
            8
          ),

        weeklyHours:
          40,

        active:
          true,
      }),


    /*
      CONTRACT Employee scenario.
      26 scheduled working days
      in August 2026.
    */
    SIX_DAY:
      await Schedule.create({
        name:
          'Demo Six-Day Mon-Sat',

        workingDays:
          scheduleDays(
            monSat,
            '09:00',
            '18:00',
            60,
            8
          ),

        weeklyHours:
          48,

        active:
          true,
      }),


    /*
      Same total hours but
      different shift timing.
    */
    EARLY:
      await Schedule.create({
        name:
          'Demo Early Shift Mon-Fri',

        workingDays:
          scheduleDays(
            monFri,
            '08:00',
            '17:00',
            60,
            8
          ),

        weeklyHours:
          40,

        active:
          true,
      }),


    /*
      Shows inactive schedule.
    */
    LEGACY:
      await Schedule.create({
        name:
          'Demo Legacy Inactive Schedule',

        workingDays:
          scheduleDays(
            monFri,
            '10:00',
            '19:00',
            60,
            8
          ),

        weeklyHours:
          40,

        active:
          false,
      }),
  };


  return {
    departments,
    schedules,
  };
}


/* =========================================================
   SALARY STRUCTURES + RULES
========================================================= */

async function createSalaryConfiguration() {

  const structures = {

    STANDARD:
      await SalaryStructure.create({
        name:
          'Demo Standard Monthly',

        code:
          'DEMO_STANDARD_MONTHLY',

        description:
          'Demo policy: monthly wage prorated by payable worked days, with configurable allowance and deduction rules.',

        active:
          true,
      }),


    EXECUTIVE:
      await SalaryStructure.create({
        name:
          'Demo Executive Monthly',

        code:
          'DEMO_EXECUTIVE_MONTHLY',

        description:
          'Demo executive policy showing percentage, formula and fixed salary components.',

        active:
          true,
      }),


    /*
      Lifecycle demonstration.
      Cannot be selected for
      a new Payrun.
    */
    LEGACY:
      await SalaryStructure.create({
        name:
          'Demo Legacy Monthly',

        code:
          'DEMO_LEGACY_MONTHLY',

        description:
          'Inactive Salary Structure used to demonstrate configuration lifecycle.',

        active:
          false,
      }),
  };


  /*
   IMPORTANT:

   These are DEMO COMPANY policies.

   They are NOT being claimed
   as Indian statutory payroll
   formulas.
  */

  const rules = {

    STANDARD: [

      /*
       Payable basic changes with
       approved unpaid leave.
      */
      {
        name:
          'Basic Salary',

        code:
          'BASIC',

        category:
          'BASIC',

        sequence:
          10,

        calculationType:
          'FORMULA',

        formula:
          'CONTRACT_WAGE * WORKED_DAYS / EXPECTED_WORKING_DAYS * 0.60',

        active:
          true,
      },


      {
        name:
          'Housing Allowance',

        code:
          'HRA',

        category:
          'ALLOWANCE',

        sequence:
          20,

        calculationType:
          'PERCENTAGE',

        percentage:
          20,

        percentageBase:
          'BASIC',

        active:
          true,
      },


      /*
       Makes total earnings before
       deduction equal to the
       prorated monthly wage.
      */
      {
        name:
          'Special Allowance',

        code:
          'SPECIAL',

        category:
          'ALLOWANCE',

        sequence:
          30,

        calculationType:
          'FORMULA',

        formula:
          'CONTRACT_WAGE * WORKED_DAYS / EXPECTED_WORKING_DAYS - BASIC - HRA',

        active:
          true,
      },


      /*
       Inactive rule example.
       Engine must ignore it.
      */
      {
        name:
          'Legacy Demo Bonus',

        code:
          'BONUS_UNUSED',

        category:
          'ALLOWANCE',

        sequence:
          35,

        calculationType:
          'FIXED',

        fixedAmount:
          2000,

        active:
          false,
      },


      {
        name:
          'Gross Salary',

        code:
          'GROSS',

        category:
          'GROSS',

        sequence:
          40,

        calculationType:
          'FORMULA',

        formula:
          'BASIC + HRA + SPECIAL',

        active:
          true,
      },


      {
        name:
          'Provident Fund - Demo Policy',

        code:
          'PF',

        category:
          'DEDUCTION',

        sequence:
          50,

        calculationType:
          'PERCENTAGE',

        percentage:
          12,

        percentageBase:
          'BASIC',

        active:
          true,
      },


      {
        name:
          'Net Salary',

        code:
          'NET',

        category:
          'NET',

        sequence:
          100,

        calculationType:
          'FORMULA',

        formula:
          'GROSS - PF',

        active:
          true,
      },
    ],


    EXECUTIVE: [

      {
        name:
          'Executive Basic',

        code:
          'BASIC',

        category:
          'BASIC',

        sequence:
          10,

        calculationType:
          'FORMULA',

        formula:
          'CONTRACT_WAGE * WORKED_DAYS / EXPECTED_WORKING_DAYS * 0.70',

        active:
          true,
      },


      {
        name:
          'Housing Allowance',

        code:
          'HRA',

        category:
          'ALLOWANCE',

        sequence:
          20,

        calculationType:
          'PERCENTAGE',

        percentage:
          20,

        percentageBase:
          'BASIC',

        active:
          true,
      },


      {
        name:
          'Special Allowance',

        code:
          'SPECIAL',

        category:
          'ALLOWANCE',

        sequence:
          30,

        calculationType:
          'FORMULA',

        formula:
          'CONTRACT_WAGE * WORKED_DAYS / EXPECTED_WORKING_DAYS - BASIC - HRA',

        active:
          true,
      },


      /*
       FIXED calculation demonstration.
      */
      {
        name:
          'Transport Allowance',

        code:
          'TRANSPORT',

        category:
          'ALLOWANCE',

        sequence:
          35,

        calculationType:
          'FIXED',

        fixedAmount:
          5000,

        active:
          true,
      },


      {
        name:
          'Gross Salary',

        code:
          'GROSS',

        category:
          'GROSS',

        sequence:
          40,

        calculationType:
          'FORMULA',

        formula:
          'BASIC + HRA + SPECIAL + TRANSPORT',

        active:
          true,
      },


      {
        name:
          'Income Tax - Demo Policy',

        code:
          'TAX',

        category:
          'DEDUCTION',

        sequence:
          50,

        calculationType:
          'PERCENTAGE',

        percentage:
          10,

        percentageBase:
          'GROSS',

        active:
          true,
      },


      {
        name:
          'Net Salary',

        code:
          'NET',

        category:
          'NET',

        sequence:
          100,

        calculationType:
          'FORMULA',

        formula:
          'GROSS - TAX',

        active:
          true,
      },
    ],


    LEGACY: [

      {
        name:
          'Basic Salary',

        code:
          'BASIC',

        category:
          'BASIC',

        sequence:
          10,

        calculationType:
          'PERCENTAGE',

        percentage:
          100,

        percentageBase:
          'CONTRACT_WAGE',

        active:
          true,
      },


      {
        name:
          'Gross Salary',

        code:
          'GROSS',

        category:
          'GROSS',

        sequence:
          20,

        calculationType:
          'FORMULA',

        formula:
          'BASIC',

        active:
          true,
      },


      {
        name:
          'Net Salary',

        code:
          'NET',

        category:
          'NET',

        sequence:
          30,

        calculationType:
          'FORMULA',

        formula:
          'GROSS',

        active:
          true,
      },
    ],
  };


  /*
   Validate our seed configuration
   with the ACTUAL project parser
   before storing anything.
  */

  for (
    const [
      key,
      ruleDefinitions
    ]
    of Object.entries(rules)
  ) {

    formulaService
      .validateDependencies(
        ruleDefinitions
      );


    await SalaryRule.create(
      ruleDefinitions.map(
        rule => ({
          ...rule,

          salaryStructure:
            structures[key]._id,
        })
      )
    );
  }


  return structures;
}


/* =========================================================
   EMPLOYEES + EMPLOYEE LOGIN USERS
========================================================= */

async function createEmployees({
  departments,
  schedules,
  passwordHash,
}) {

  /*
   Organizational Manager means:
   Employee.jobPosition === "Manager"

   This is completely separate
   from the HR_MANAGER login role.
  */

  const definitions = [

    /* ================= ENGINEERING ================= */

    {
      key:
        'AARAV',

      employeeId:
        'PP360-E-D1001',

      firstName:
        'Aarav',

      lastName:
        'Mehta',

      department:
        'ENG',

      jobPosition:
        'Manager',

      manager:
        null,

      employeeType:
        'FULL_TIME',

      schedule:
        'STANDARD',

      joiningDate:
        '2023-01-16',

      phone:
        '+91 90000 01001',

      bankDetails:
        bank(
          'Aarav Mehta',
          '1001'
        ),
    },


    {
      key:
        'PRIYA',

      employeeId:
        'PP360-E-D1002',

      firstName:
        'Priya',

      lastName:
        'Shah',

      department:
        'ENG',

      jobPosition:
        'Software Engineer',

      manager:
        'AARAV',

      employeeType:
        'FULL_TIME',

      schedule:
        'STANDARD',

      joiningDate:
        '2024-06-10',

      phone:
        '+91 90000 01002',

      bankDetails:
        bank(
          'Priya Shah',
          '1002',
          'ICICI Bank',
          'ICIC0001234'
        ),
    },


    {
      key:
        'ROHAN',

      employeeId:
        'PP360-E-D1003',

      firstName:
        'Rohan',

      lastName:
        'Patil',

      department:
        'ENG',

      jobPosition:
        'Backend Engineer',

      manager:
        'AARAV',

      employeeType:
        'FULL_TIME',

      schedule:
        'STANDARD',

      joiningDate:
        '2024-02-05',

      phone:
        '+91 90000 01003',

      bankDetails:
        bank(
          'Rohan Patil',
          '1003',
          'State Bank of India',
          'SBIN0001234'
        ),
    },


    {
      key:
        'ADITYA',

      employeeId:
        'PP360-E-D1004',

      firstName:
        'Aditya',

      lastName:
        'Joshi',

      department:
        'ENG',

      jobPosition:
        'Frontend Engineer',

      manager:
        'AARAV',

      employeeType:
        'FULL_TIME',

      schedule:
        'STANDARD',

      joiningDate:
        '2025-01-13',

      phone:
        '+91 90000 01004',

      bankDetails:
        bank(
          'Aditya Joshi',
          '1004'
        ),
    },


    /*
      Active Employee but only
      future DRAFT Contract.
    */
    {
      key:
        'NEHA',

      employeeId:
        'PP360-E-D1005',

      firstName:
        'Neha',

      lastName:
        'Verma',

      department:
        'ENG',

      jobPosition:
        'Software Engineer',

      manager:
        'AARAV',

      employeeType:
        'FULL_TIME',

      schedule:
        'STANDARD',

      joiningDate:
        '2026-07-15',

      phone:
        '+91 90000 01005',

      bankDetails:
        bank(
          'Neha Verma',
          '1005'
        ),
    },


    /*
      Has EXECUTIVE structure.
      Excluded when Standard
      Payrun is selected.
    */
    {
      key:
        'VIKRAM',

      employeeId:
        'PP360-E-D1006',

      firstName:
        'Vikram',

      lastName:
        'Rao',

      department:
        'ENG',

      jobPosition:
        'Senior Engineer',

      manager:
        'AARAV',

      employeeType:
        'FULL_TIME',

      schedule:
        'STANDARD',

      joiningDate:
        '2022-11-21',

      phone:
        '+91 90000 01006',

      bankDetails:
        bank(
          'Vikram Rao',
          '1006',
          'Axis Bank',
          'UTIB0001234'
        ),
    },


    /*
      Missing bank details:
      payroll warning.
    */
    {
      key:
        'ISHA',

      employeeId:
        'PP360-E-D1007',

      firstName:
        'Isha',

      lastName:
        'Kapoor',

      department:
        'ENG',

      jobPosition:
        'QA Engineer',

      manager:
        'AARAV',

      employeeType:
        'FULL_TIME',

      schedule:
        'STANDARD',

      joiningDate:
        '2025-08-04',

      phone:
        '+91 90000 01007',

      bankDetails:
        null,
    },


    /*
      Employee lifecycle:
      INACTIVE + historical Contract.
    */
    {
      key:
        'RAHUL',

      employeeId:
        'PP360-E-D1008',

      firstName:
        'Rahul',

      lastName:
        'Deshmukh',

      department:
        'ENG',

      jobPosition:
        'Software Engineer',

      manager:
        'AARAV',

      employeeType:
        'FULL_TIME',

      schedule:
        'STANDARD',

      joiningDate:
        '2023-09-11',

      phone:
        '+91 90000 01008',

      bankDetails:
        bank(
          'Rahul Deshmukh',
          '1008'
        ),

      employmentStatus:
        'INACTIVE',
    },


    /* ================= HR ================= */

    {
      key:
        'NISHA',

      employeeId:
        'PP360-E-D1009',

      firstName:
        'Nisha',

      lastName:
        'Kulkarni',

      department:
        'HR',

      jobPosition:
        'Manager',

      manager:
        null,

      employeeType:
        'FULL_TIME',

      schedule:
        'STANDARD',

      joiningDate:
        '2022-04-18',

      phone:
        '+91 90000 01009',

      bankDetails:
        bank(
          'Nisha Kulkarni',
          '1009'
        ),
    },


    {
      key:
        'KAVYA',

      employeeId:
        'PP360-E-D1010',

      firstName:
        'Kavya',

      lastName:
        'Iyer',

      department:
        'HR',

      jobPosition:
        'HR Executive',

      manager:
        'NISHA',

      employeeType:
        'FULL_TIME',

      schedule:
        'STANDARD',

      joiningDate:
        '2025-03-03',

      phone:
        '+91 90000 01010',

      bankDetails:
        bank(
          'Kavya Iyer',
          '1010'
        ),
    },


    {
      key:
        'POOJA',

      employeeId:
        'PP360-E-D1011',

      firstName:
        'Pooja',

      lastName:
        'Sharma',

      department:
        'HR',

      jobPosition:
        'HR Executive',

      manager:
        'NISHA',

      employeeType:
        'FULL_TIME',

      schedule:
        'STANDARD',

      joiningDate:
        '2025-09-01',

      phone:
        '+91 90000 01011',

      bankDetails:
        bank(
          'Pooja Sharma',
          '1011'
        ),
    },


    /* ================= FINANCE ================= */

    {
      key:
        'MANAV',

      employeeId:
        'PP360-E-D1012',

      firstName:
        'Manav',

      lastName:
        'Jain',

      department:
        'FIN',

      jobPosition:
        'Manager',

      manager:
        null,

      employeeType:
        'FULL_TIME',

      schedule:
        'EARLY',

      joiningDate:
        '2021-12-06',

      phone:
        '+91 90000 01012',

      bankDetails:
        bank(
          'Manav Jain',
          '1012',
          'Kotak Mahindra Bank',
          'KKBK0001234'
        ),
    },


    /*
      CONTRACT employee +
      six-day schedule.
    */
    {
      key:
        'ARJUN',

      employeeId:
        'PP360-E-D1013',

      firstName:
        'Arjun',

      lastName:
        'Malhotra',

      department:
        'FIN',

      jobPosition:
        'Payroll Analyst',

      manager:
        'MANAV',

      employeeType:
        'CONTRACT',

      schedule:
        'SIX_DAY',

      joiningDate:
        '2026-01-05',

      phone:
        '+91 90000 01013',

      bankDetails:
        bank(
          'Arjun Malhotra',
          '1013'
        ),
    },


    {
      key:
        'DEVIKA',

      employeeId:
        'PP360-E-D1014',

      firstName:
        'Devika',

      lastName:
        'Rao',

      department:
        'FIN',

      jobPosition:
        'Finance Executive',

      manager:
        'MANAV',

      employeeType:
        'FULL_TIME',

      schedule:
        'EARLY',

      joiningDate:
        '2025-05-12',

      phone:
        '+91 90000 01014',

      bankDetails:
        bank(
          'Devika Rao',
          '1014'
        ),
    },
  ];


  /*
   Pre-create IDs so Employee
   manager relationships can point
   to the correct Employee.
  */

  const employeeIds =
    Object.fromEntries(
      definitions.map(
        def => [
          def.key,
          new mongoose.Types.ObjectId(),
        ]
      )
    );


  const userIds =
    Object.fromEntries(
      definitions.map(
        def => [
          def.key,
          new mongoose.Types.ObjectId(),
        ]
      )
    );


  const employees = {};


  for (
    const [
      index,
      def
    ]
    of definitions.entries()
  ) {

    const email =
      `${def.firstName}.${def.lastName}`
        .toLowerCase() +
      `@${DEMO_DOMAIN}`;


    const employmentStatus =
      def.employmentStatus ||
      'ACTIVE';


    const accountStatus =
      employmentStatus ===
      'ACTIVE'
        ? ACCOUNT_STATUSES.ACTIVE
        : ACCOUNT_STATUSES.INACTIVE;


    /*
      Linked EMPLOYEE User
    */

    const user =
      await User.create({

        _id:
          userIds[def.key],

        uniqueId:
          `PP360-U-${def.employeeId.slice(-5)}`,

        firstName:
          def.firstName,

        lastName:
          def.lastName,

        email,

        passwordHash,

        role:
          roles.EMPLOYEE,

        accountStatus,

        employeeId:
          employeeIds[def.key],

        /*
         Demo convenience:
         no password-change screen
         during presentation.
        */
        mustChangePassword:
          false,

        lastLogin:
          employmentStatus ===
            'ACTIVE' &&
          index % 2 === 0
            ? new Date(
                '2026-08-28T08:30:00.000Z'
              )
            : null,
      });


    /*
      Workforce Employee
    */

    employees[def.key] =
      await Employee.create({

        _id:
          employeeIds[def.key],

        employeeId:
          def.employeeId,

        user:
          user._id,

        firstName:
          def.firstName,

        lastName:
          def.lastName,

        email,

        phone:
          def.phone,

        department:
          departments[
            def.department
          ]._id,

        jobPosition:
          def.jobPosition,

        manager:
          def.manager
            ? employeeIds[
                def.manager
              ]
            : null,

        employeeType:
          def.employeeType,

        workingSchedule:
          schedules[
            def.schedule
          ]._id,

        joiningDate:
          dateOnly(
            def.joiningDate
          ),

        bankDetails:
          def.bankDetails,

        employmentStatus,
      });
  }


  /*
    Department heads
  */

  await Department
    .findByIdAndUpdate(
      departments.ENG._id,
      {
        manager:
          employees.AARAV._id,
      }
    );


  await Department
    .findByIdAndUpdate(
      departments.HR._id,
      {
        manager:
          employees.NISHA._id,
      }
    );


  await Department
    .findByIdAndUpdate(
      departments.FIN._id,
      {
        manager:
          employees.MANAV._id,
      }
    );


  return employees;
}


/* =========================================================
   CONTRACTS
========================================================= */

async function createContracts({
  employees,
  departments,
  schedules,
  structures,
}) {

  const definitions = [

    /* Aarav — normal executive contract */
    {
      employee:
        'AARAV',

      department:
        'ENG',

      jobPosition:
        'Manager',

      schedule:
        'STANDARD',

      structure:
        'EXECUTIVE',

      wage:
        90000,

      startDate:
        '2025-01-01',

      endDate:
        null,

      status:
        'RUNNING',
    },


    /*
      Priya demonstrates
      historical salary revision.
    */
    {
      employee:
        'PRIYA',

      department:
        'ENG',

      jobPosition:
        'Junior Software Engineer',

      schedule:
        'STANDARD',

      structure:
        'STANDARD',

      wage:
        55000,

      startDate:
        '2025-01-01',

      endDate:
        '2026-07-31',

      status:
        'EXPIRED',
    },


    {
      employee:
        'PRIYA',

      department:
        'ENG',

      jobPosition:
        'Software Engineer',

      schedule:
        'STANDARD',

      structure:
        'STANDARD',

      wage:
        60000,

      startDate:
        '2026-08-01',

      endDate:
        null,

      status:
        'RUNNING',
    },


    {
      employee:
        'ROHAN',

      department:
        'ENG',

      jobPosition:
        'Backend Engineer',

      schedule:
        'STANDARD',

      structure:
        'STANDARD',

      wage:
        55000,

      startDate:
        '2025-02-01',

      endDate:
        null,

      status:
        'RUNNING',
    },


    {
      employee:
        'ADITYA',

      department:
        'ENG',

      jobPosition:
        'Frontend Engineer',

      schedule:
        'STANDARD',

      structure:
        'STANDARD',

      wage:
        65000,

      startDate:
        '2025-01-01',

      endDate:
        null,

      status:
        'RUNNING',
    },


    /*
      Neha:
      ACTIVE Employee,
      but August has no applicable
      RUNNING/EXPIRED Contract.
    */
    {
      employee:
        'NEHA',

      department:
        'ENG',

      jobPosition:
        'Software Engineer',

      schedule:
        'STANDARD',

      structure:
        'STANDARD',

      wage:
        58000,

      startDate:
        '2026-09-01',

      endDate:
        null,

      status:
        'DRAFT',
    },


    /*
      Structure-mismatch demo
      when Standard Payrun selected.
    */
    {
      employee:
        'VIKRAM',

      department:
        'ENG',

      jobPosition:
        'Senior Engineer',

      schedule:
        'STANDARD',

      structure:
        'EXECUTIVE',

      wage:
        95000,

      startDate:
        '2024-01-01',

      endDate:
        null,

      status:
        'RUNNING',
    },


    /*
      Cancelled historical contract
      plus current Running contract.
    */
    {
      employee:
        'ISHA',

      department:
        'ENG',

      jobPosition:
        'QA Engineer',

      schedule:
        'STANDARD',

      structure:
        'STANDARD',

      wage:
        60000,

      startDate:
        '2024-01-01',

      endDate:
        '2024-12-31',

      status:
        'CANCELLED',
    },


    {
      employee:
        'ISHA',

      department:
        'ENG',

      jobPosition:
        'QA Engineer',

      schedule:
        'STANDARD',

      structure:
        'STANDARD',

      wage:
        65000,

      startDate:
        '2025-01-01',

      endDate:
        null,

      status:
        'RUNNING',
    },


    /*
      Inactive employee with
      preserved historical contract.
    */
    {
      employee:
        'RAHUL',

      department:
        'ENG',

      jobPosition:
        'Software Engineer',

      schedule:
        'STANDARD',

      structure:
        'STANDARD',

      wage:
        52000,

      startDate:
        '2025-01-01',

      endDate:
        '2026-07-31',

      status:
        'EXPIRED',
    },


    {
      employee:
        'NISHA',

      department:
        'HR',

      jobPosition:
        'Manager',

      schedule:
        'STANDARD',

      structure:
        'EXECUTIVE',

      wage:
        85000,

      startDate:
        '2024-01-01',

      endDate:
        null,

      status:
        'RUNNING',
    },


    {
      employee:
        'KAVYA',

      department:
        'HR',

      jobPosition:
        'HR Executive',

      schedule:
        'STANDARD',

      structure:
        'STANDARD',

      wage:
        50000,

      startDate:
        '2025-03-01',

      endDate:
        null,

      status:
        'RUNNING',
    },


    {
      employee:
        'POOJA',

      department:
        'HR',

      jobPosition:
        'HR Executive',

      schedule:
        'STANDARD',

      structure:
        'STANDARD',

      wage:
        48000,

      startDate:
        '2025-09-01',

      endDate:
        null,

      status:
        'RUNNING',
    },


    {
      employee:
        'MANAV',

      department:
        'FIN',

      jobPosition:
        'Manager',

      schedule:
        'EARLY',

      structure:
        'EXECUTIVE',

      wage:
        110000,

      startDate:
        '2023-01-01',

      endDate:
        null,

      status:
        'RUNNING',
    },


    /*
      CONTRACT Employee
      still has MONTHLY wage,
      matching your Contract schema.
    */
    {
      employee:
        'ARJUN',

      department:
        'FIN',

      jobPosition:
        'Payroll Analyst',

      schedule:
        'SIX_DAY',

      structure:
        'STANDARD',

      wage:
        65000,

      startDate:
        '2026-01-01',

      endDate:
        null,

      status:
        'RUNNING',
    },


    {
      employee:
        'DEVIKA',

      department:
        'FIN',

      jobPosition:
        'Finance Executive',

      schedule:
        'EARLY',

      structure:
        'STANDARD',

      wage:
        56000,

      startDate:
        '2025-05-01',

      endDate:
        null,

      status:
        'RUNNING',
    },
  ];


  const contracts = [];


  for (
    const def
    of definitions
  ) {

    contracts.push(
      await Contract.create({

        employee:
          employees[
            def.employee
          ]._id,

        department:
          departments[
            def.department
          ]._id,

        jobPosition:
          def.jobPosition,

        workingSchedule:
          schedules[
            def.schedule
          ]._id,

        salaryStructure:
          structures[
            def.structure
          ]._id,

        wage:
          def.wage,

        wageType:
          'MONTHLY',

        startDate:
          dateOnly(
            def.startDate
          ),

        endDate:
          def.endDate
            ? endOfDay(
                def.endDate
              )
            : null,

        status:
          def.status,
      })
    );
  }


  return contracts;
}


/* =========================================================
   TIME OFF TYPES + ALLOCATIONS + REQUESTS
========================================================= */

async function createLeaveData({
  employees,
  internalUsers,
}) {

  /*
   Covers:
   DAYS
   HOURS
   PAID
   UNPAID_DEDUCTION
   NONE
   active/inactive
   allocation/no-allocation
  */

  const types = {

    ANNUAL:
      await TimeOffType.create({

        name:
          'Demo Annual Paid Leave',

        code:
          'DEMO_ANNUAL_PAID',

        description:
          'Paid annual leave requiring an approved allocation.',

        unit:
          'DAYS',

        requiresAllocation:
          true,

        requiresApproval:
          true,

        isPaid:
          true,

        payrollTreatment:
          'PAID',

        active:
          true,
      }),


    SICK:
      await TimeOffType.create({

        name:
          'Demo Sick Paid Leave',

        code:
          'DEMO_SICK_PAID',

        description:
          'Paid sick leave that does not require an allocation.',

        unit:
          'DAYS',

        requiresAllocation:
          false,

        requiresApproval:
          true,

        isPaid:
          true,

        payrollTreatment:
          'PAID',

        active:
          true,
      }),


    UNPAID_DAYS:
      await TimeOffType.create({

        name:
          'Demo Personal Unpaid Leave',

        code:
          'DEMO_UNPAID_DAYS',

        description:
          'Unpaid leave deducted from payroll by scheduled-day equivalent.',

        unit:
          'DAYS',

        requiresAllocation:
          true,

        requiresApproval:
          true,

        isPaid:
          false,

        payrollTreatment:
          'UNPAID_DEDUCTION',

        active:
          true,
      }),


    PAID_HOURS:
      await TimeOffType.create({

        name:
          'Demo Paid Hour Leave',

        code:
          'DEMO_PAID_HOURS',

        description:
          'Paid hourly leave.',

        unit:
          'HOURS',

        requiresAllocation:
          true,

        requiresApproval:
          true,

        isPaid:
          true,

        payrollTreatment:
          'PAID',

        active:
          true,
      }),


    UNPAID_HOURS:
      await TimeOffType.create({

        name:
          'Demo Unpaid Hour Leave',

        code:
          'DEMO_UNPAID_HOURS',

        description:
          'Unpaid hourly leave producing fractional worked-day deduction.',

        unit:
          'HOURS',

        requiresAllocation:
          true,

        requiresApproval:
          true,

        isPaid:
          false,

        payrollTreatment:
          'UNPAID_DEDUCTION',

        active:
          true,
      }),


    NONE:
      await TimeOffType.create({

        name:
          'Demo Administrative Leave',

        code:
          'DEMO_ADMIN_NONE',

        description:
          'Leave policy with no payroll treatment.',

        unit:
          'DAYS',

        requiresAllocation:
          false,

        requiresApproval:
          true,

        isPaid:
          false,

        payrollTreatment:
          'NONE',

        active:
          true,
      }),


    LEGACY:
      await TimeOffType.create({

        name:
          'Demo Legacy Leave',

        code:
          'DEMO_LEGACY_LEAVE',

        description:
          'Inactive leave-type example.',

        unit:
          'DAYS',

        requiresAllocation:
          true,

        requiresApproval:
          true,

        isPaid:
          true,

        payrollTreatment:
          'PAID',

        active:
          false,
      }),
  };


  const approver =
    internalUsers
      .HR_MANAGER
      ._id;


  const validFrom =
    dateOnly(
      '2026-01-01'
    );


  const validUntil =
    endOfDay(
      '2026-12-31'
    );


  async function allocation({
    employee,
    type,
    allocated,
    taken = 0,
    status = 'APPROVED',
  }) {

    return TimeOffAllocation.create({

      employee:
        employees[
          employee
        ]._id,

      timeOffType:
        types[
          type
        ]._id,

      allocatedAmount:
        allocated,

      takenAmount:
        taken,

      remainingAmount:
        allocated -
        taken,

      validFrom,

      validUntil,

      status,

      ...(
        status ===
        'APPROVED'
          ? {
              approvedBy:
                approver,

              approvedAt:
                new Date(
                  '2026-01-02T09:00:00.000Z'
                ),
            }
          : {}
      ),
    });
  }


  /*
   Allocation lifecycle coverage:

   APPROVED
   DRAFT
   CANCELLED
  */

  const allocations = {

    ROHAN_ANNUAL:
      await allocation({
        employee:
          'ROHAN',

        type:
          'ANNUAL',

        allocated:
          10,

        taken:
          1,
      }),


    PRIYA_PAID_HOURS:
      await allocation({
        employee:
          'PRIYA',

        type:
          'PAID_HOURS',

        allocated:
          16,

        taken:
          2,
      }),


    KAVYA_UNPAID:
      await allocation({
        employee:
          'KAVYA',

        type:
          'UNPAID_DAYS',

        allocated:
          5,

        taken:
          2,
      }),


    ARJUN_UNPAID_HOURS:
      await allocation({
        employee:
          'ARJUN',

        type:
          'UNPAID_HOURS',

        allocated:
          8,

        taken:
          4,
      }),


    POOJA_ANNUAL:
      await allocation({
        employee:
          'POOJA',

        type:
          'ANNUAL',

        allocated:
          5,

        taken:
          0,
      }),


    DEVIKA_ANNUAL:
      await allocation({
        employee:
          'DEVIKA',

        type:
          'ANNUAL',

        allocated:
          5,

        taken:
          0,
      }),


    /*
      DRAFT allocation
    */
    ISHA_DRAFT:
      await allocation({
        employee:
          'ISHA',

        type:
          'ANNUAL',

        allocated:
          5,

        status:
          'DRAFT',
      }),


    /*
      CANCELLED allocation
    */
    ADITYA_CANCELLED:
      await allocation({
        employee:
          'ADITYA',

        type:
          'ANNUAL',

        allocated:
          3,

        status:
          'CANCELLED',
      }),
  };


  const decidedAt =
    new Date(
      '2026-08-01T10:00:00.000Z'
    );


  /*
   Leave request lifecycle coverage:

   APPROVED
   PENDING
   REFUSED

   PAID day
   PAID hour
   UNPAID days
   UNPAID hours
   allocation / no allocation
  */

  const requests = [

    /*
      Rohan:
      1 full PAID day.
      Salary must NOT reduce.
    */
    {
      employee:
        employees.ROHAN._id,

      timeOffType:
        types.ANNUAL._id,

      allocation:
        allocations
          .ROHAN_ANNUAL
          ._id,

      startDate:
        dateOnly(
          '2026-08-17'
        ),

      endDate:
        endOfDay(
          '2026-08-17'
        ),

      duration:
        1,

      reason:
        'Family commitment.',

      status:
        'APPROVED',

      decisionBy:
        approver,

      decisionAt:
        decidedAt,
    },


    /*
      Priya:
      2 PAID hours.
    */
    {
      employee:
        employees.PRIYA._id,

      timeOffType:
        types.PAID_HOURS._id,

      allocation:
        allocations
          .PRIYA_PAID_HOURS
          ._id,

      startDate:
        timestamp(
          '2026-08-19',
          '15:00'
        ),

      endDate:
        timestamp(
          '2026-08-19',
          '17:00'
        ),

      duration:
        2,

      reason:
        'Medical appointment.',

      status:
        'APPROVED',

      decisionBy:
        approver,

      decisionAt:
        decidedAt,
    },


    /*
      Kavya:
      2 UNPAID full days.
      Salary must reduce.
    */
    {
      employee:
        employees.KAVYA._id,

      timeOffType:
        types.UNPAID_DAYS._id,

      allocation:
        allocations
          .KAVYA_UNPAID
          ._id,

      startDate:
        dateOnly(
          '2026-08-10'
        ),

      endDate:
        endOfDay(
          '2026-08-11'
        ),

      duration:
        2,

      reason:
        'Personal unpaid leave.',

      status:
        'APPROVED',

      decisionBy:
        approver,

      decisionAt:
        decidedAt,
    },


    /*
      Arjun:
      4 unpaid hours
      on 8-hour workday
      = 0.5 unpaid day.
    */
    {
      employee:
        employees.ARJUN._id,

      timeOffType:
        types.UNPAID_HOURS._id,

      allocation:
        allocations
          .ARJUN_UNPAID_HOURS
          ._id,

      startDate:
        timestamp(
          '2026-08-22',
          '13:00'
        ),

      endDate:
        timestamp(
          '2026-08-22',
          '17:00'
        ),

      duration:
        4,

      reason:
        'Personal half-day unpaid leave.',

      status:
        'APPROVED',

      decisionBy:
        approver,

      decisionAt:
        decidedAt,
    },


    /*
      Pooja:
      PENDING leave.
      Must NOT affect payroll yet.
    */
    {
      employee:
        employees.POOJA._id,

      timeOffType:
        types.ANNUAL._id,

      allocation:
        allocations
          .POOJA_ANNUAL
          ._id,

      startDate:
        dateOnly(
          '2026-08-24'
        ),

      endDate:
        endOfDay(
          '2026-08-25'
        ),

      duration:
        2,

      reason:
        'Travel request awaiting approval.',

      status:
        'PENDING',
    },


    /*
      Devika:
      REFUSED leave.
      Allocation balance remains unchanged.
    */
    {
      employee:
        employees.DEVIKA._id,

      timeOffType:
        types.ANNUAL._id,

      allocation:
        allocations
          .DEVIKA_ANNUAL
          ._id,

      startDate:
        dateOnly(
          '2026-08-27'
        ),

      endDate:
        endOfDay(
          '2026-08-27'
        ),

      duration:
        1,

      reason:
        'Personal event.',

      status:
        'REFUSED',

      decisionBy:
        approver,

      decisionAt:
        new Date(
          '2026-08-20T11:00:00.000Z'
        ),

      decisionComment:
        'Payroll closing coverage required.',
    },


    /*
      Approved paid Sick Leave
      WITHOUT allocation.
    */
    {
      employee:
        employees.DEVIKA._id,

      timeOffType:
        types.SICK._id,

      allocation:
        null,

      startDate:
        dateOnly(
          '2026-08-14'
        ),

      endDate:
        endOfDay(
          '2026-08-14'
        ),

      duration:
        1,

      reason:
        'Sick leave.',

      status:
        'APPROVED',

      decisionBy:
        approver,

      decisionAt:
        decidedAt,
    },
  ];


  await TimeOffRequest
    .create(requests);


  return {
    types,
    allocations,
    requests,
  };
}


/* =========================================================
   AUGUST ATTENDANCE

   Historical month:
   01 Aug 2026 → 31 Aug 2026

   Covers:
   PRESENT
   LATE
   OVERTIME
   MISSING_CHECKOUT
   manual correction
   partial-day attendance

   We intentionally do NOT fake ABSENT
   records because current Attendance
   service does not derive ABSENT.
========================================================= */

async function createAttendance({
  employees,
  schedules,
  internalUsers,
}) {

  const special = {

    /*
      Priya:
      - late
      - partial attendance due
        to paid hourly leave
    */
    PRIYA: {

      '2026-08-05': {
        kind:
          'LATE',
      },

      '2026-08-19': {
        kind:
          'PARTIAL',

        minutes:
          360,

        note:
          'Six hours worked; two paid leave hours.',
      },
    },


    /*
      Rohan:
      - overtime
      - full paid leave
    */
    ROHAN: {

      '2026-08-06': {
        kind:
          'OVERTIME',

        extraMinutes:
          90,
      },

      '2026-08-17': {
        kind:
          'FULL_DAY_LEAVE',
      },
    },


    /*
      Aditya:
      - missing checkout
      - HR manual correction
      - late + overtime
        demonstrating precedence
    */
    ADITYA: {

      '2026-08-12': {
        kind:
          'MISSING_CHECKOUT',
      },

      '2026-08-20': {
        kind:
          'MANUAL_CORRECTION',
      },

      '2026-08-25': {
        kind:
          'LATE_OVERTIME',

        extraMinutes:
          90,
      },
    },


    /*
      Kavya:
      two full unpaid days
    */
    KAVYA: {

      '2026-08-10': {
        kind:
          'FULL_DAY_LEAVE',
      },

      '2026-08-11': {
        kind:
          'FULL_DAY_LEAVE',
      },
    },


    /*
      Arjun:
      4h worked + 4h unpaid leave.
    */
    ARJUN: {

      '2026-08-22': {
        kind:
          'PARTIAL',

        minutes:
          240,

        note:
          'Four hours worked; four unpaid leave hours.',
      },
    },


    /*
      Paid sick day.
    */
    DEVIKA: {

      '2026-08-14': {
        kind:
          'FULL_DAY_LEAVE',
      },
    },
  };


  const scheduleById =
    new Map(
      Object.values(
        schedules
      ).map(
        record => [
          asId(record._id),
          record,
        ]
      )
    );


  let created = 0;


  for (
    const [
      employeeKey,
      employee
    ]
    of Object.entries(
      employees
    )
  ) {

    /*
      No August attendance
      generated for inactive Rahul.
    */

    if (
      employee.employmentStatus !==
      'ACTIVE'
    ) {
      continue;
    }


    const schedule =
      scheduleById.get(
        asId(
          employee
            .workingSchedule
        )
      );


    const plan =
      special[
        employeeKey
      ] || {};


    for (
      const day
      of workingDates(
        schedule
      )
    ) {

      const scenario =
        plan[
          day.key
        ] || {
          kind:
            'PRESENT',
        };


      /*
        Real full-day leave:
        no attendance record.
      */

      if (
        scenario.kind ===
        'FULL_DAY_LEAVE'
      ) {
        continue;
      }


      const scheduleStart =
        timestamp(
          day.key,
          day.line.startTime
        );


      let checkIn =
        new Date(
          scheduleStart
        );


      /*
       IMPORTANT:

       Attendance service calculates:

       actual worked time
       = checkOut - checkIn

       It does NOT subtract
       schedule break.

       Therefore default checkout
       is start + dailyHours.

       09:00 + 8h = 17:00
      */

      let checkOut =
        addMinutes(
          checkIn,
          day.line.dailyHours *
            60
        );


      let manualEdit =
        false;

      let editedBy;

      let correctionReason =
        '';

      let notes =
        scenario.note ||
        'Seeded August 2026 demo attendance.';


      /* ---------------- LATE ---------------- */

      if (
        scenario.kind ===
        'LATE'
      ) {
        checkIn =
          addMinutes(
            scheduleStart,
            15
          );

        checkOut =
          addMinutes(
            checkIn,
            day.line.dailyHours *
              60
          );

        notes =
          'Arrived 15 minutes late; completed expected working duration.';
      }


      /* ---------------- OVERTIME ---------------- */

      if (
        scenario.kind ===
        'OVERTIME'
      ) {
        checkOut =
          addMinutes(
            checkIn,

            day.line.dailyHours *
              60 +

            scenario
              .extraMinutes
          );

        notes =
          'Approved overtime demo.';
      }


      /*
       LATE + OVERTIME

       Current backend chooses LATE
       because lateness is checked
       before overtime.
      */

      if (
        scenario.kind ===
        'LATE_OVERTIME'
      ) {
        checkIn =
          addMinutes(
            scheduleStart,
            15
          );

        checkOut =
          addMinutes(
            checkIn,

            day.line.dailyHours *
              60 +

            scenario
              .extraMinutes
          );

        notes =
          'Late arrival plus overtime; LATE status wins by current precedence.';
      }


      /* ---------------- PARTIAL ---------------- */

      if (
        scenario.kind ===
        'PARTIAL'
      ) {
        checkOut =
          addMinutes(
            checkIn,
            scenario.minutes
          );
      }


      /* ---------------- MISSING CHECKOUT ---------------- */

      if (
        scenario.kind ===
        'MISSING_CHECKOUT'
      ) {
        checkOut =
          null;

        notes =
          'Employee forgot to check out; historical missing-checkout example.';
      }


      /* ---------------- MANUAL CORRECTION ---------------- */

      if (
        scenario.kind ===
        'MANUAL_CORRECTION'
      ) {
        manualEdit =
          true;

        editedBy =
          internalUsers
            .HR_MANAGER
            ._id;

        correctionReason =
          'Corrected from access-control log after employee request.';

        notes =
          'HR-corrected attendance record.';
      }


      const workedMinutes =
        checkOut
          ? (
              checkOut -
              checkIn
            ) /
            60000
          : 0;


      const status =
        attendanceStatus(
          checkIn,
          checkOut,
          scheduleStart,
          day.line.dailyHours *
            60
        );


      await Attendance.create({

        employee:
          employee._id,

        date:
          day.date,

        checkIn,

        checkOut,

        workedMinutes,

        workedHours:
          workedMinutes /
          60,

        status,

        notes,

        manualEdit,

        editedBy,

        correctionReason,
      });


      created++;
    }
  }


  return created;
}


/* =========================================================
   OLD-SEED WARNING

   We do NOT automatically destroy
   the old non-DEMO structures.
========================================================= */

async function warnAboutOldSeedStructures() {

  const oldCodes = [
    'MONTHLY_STANDARD',
    'HOURLY_BASIC',
    'EXECUTIVE_MONTHLY',
  ];


  const old =
    await SalaryStructure
      .find({
        code: {
          $in:
            oldCodes,
        },
      })
      .select('code');


  if (old.length) {

    console.warn(
      '\nNote: older seed structures still exist: ' +
      old
        .map(
          record =>
            record.code
        )
        .join(', ') +
      '. Use a fresh demo DB for the cleanest reviewer dataset.'
    );
  }
}


/* =========================================================
   MAIN SEED
========================================================= */

async function seed() {

  productionGuard();

  const demoPassword =
    requireDemoPassword();


  await mongoose.connect(
    env.mongodbUri
  );


  try {

    console.log(
      '\nCleaning previous PeoplePay360 demo records...'
    );

    await cleanPreviousDemo();


    const passwordHash =
      await hashPassword(
        demoPassword
      );


    /* ================= USERS ================= */

    console.log(
      'Creating internal HR/payroll users...'
    );

    const internalUsers =
      await createInternalUsers(
        passwordHash
      );


    /* ================= MASTER DATA ================= */

    console.log(
      'Creating departments and schedules...'
    );

    const {
      departments,
      schedules,
    } =
      await createDepartmentsAndSchedules();


    /* ================= SALARY CONFIG ================= */

    console.log(
      'Creating Salary Structures and Salary Rules...'
    );

    const structures =
      await createSalaryConfiguration();


    /* ================= EMPLOYEES ================= */

    console.log(
      'Creating Employees and linked Employee Users...'
    );

    const employees =
      await createEmployees({
        departments,
        schedules,
        passwordHash,
      });


    /* ================= CONTRACTS ================= */

    console.log(
      'Creating current and historical Contracts...'
    );

    await createContracts({
      employees,
      departments,
      schedules,
      structures,
    });


    /* ================= TIME OFF ================= */

    console.log(
      'Creating leave types, allocations and requests...'
    );

    await createLeaveData({
      employees,
      internalUsers,
    });


    /* ================= ATTENDANCE ================= */

    console.log(
      'Creating August attendance...'
    );

    const attendanceCount =
      await createAttendance({
        employees,
        schedules,
        internalUsers,
      });


    await warnAboutOldSeedStructures();


    /*
      ADMIN must already come
      from bootstrap startup.
    */

    const bootstrapAdmin =
      await User
        .findOne({
          role:
            roles.ADMIN,
        })
        .select('email');


    /* =================================================
       FINAL SUMMARY
    ================================================= */

    console.log(
      '\nPeoplePay360 demo seed complete.\n'
    );


    console.log(
      JSON.stringify(
        {

          payrollPeriod:
            '2026-08-01 to 2026-08-31',


          bootstrapAdminPresent:
            Boolean(
              bootstrapAdmin
            ),


          internalLogins: {

            hrManager:
              `hr.manager@${DEMO_DOMAIN}`,

            payrollUser:
              `payroll.user@${DEMO_DOMAIN}`,

            payrollManager:
              `payroll.manager@${DEMO_DOMAIN}`,

            inactivePayrollUser:
              `payroll.archived@${DEMO_DOMAIN}`,
          },


          employeeCount:
            Object.keys(
              employees
            ).length,


          attendanceRecords:
            attendanceCount,


          salaryStructures: {

            standard:
              structures
                .STANDARD
                .code,

            executive:
              structures
                .EXECUTIVE
                .code,

            inactiveLegacy:
              structures
                .LEGACY
                .code,
          },


          keyScenarios: {

            PRIYA:
              'salary revision + historical contract + late + paid hourly leave',

            ROHAN:
              'overtime + approved paid full-day leave',

            ADITYA:
              'missing checkout + manual correction + late/overtime precedence',

            NEHA:
              'active employee with only future DRAFT contract -> no August contract',

            VIKRAM:
              'Executive contract -> excluded from Standard-structure Payrun',

            ISHA:
              'missing bank details -> payroll warning',

            KAVYA:
              'two approved unpaid days -> reduced worked days/payable salary',

            RAHUL:
              'inactive employee with preserved historical contract',

            ARJUN:
              'CONTRACT employee + six-day schedule + four unpaid hours -> 0.5 day deduction',

            POOJA:
              'pending paid leave -> no payroll effect yet',

            DEVIKA:
              'approved sick leave without allocation + refused annual leave',
          },
        },

        null,
        2
      )
    );


    if (!bootstrapAdmin) {

      console.warn(
        '\nNo bootstrap ADMIN was found. Start/bootstrap the application before the Admin-role demo.'
      );
    }

  } finally {

    await mongoose.disconnect();
  }
}


/* =========================================================
   RUN
========================================================= */

seed().catch(error => {

  console.error(
    '\nDemo seed failed:',
    error
  );

  process.exitCode = 1;
});