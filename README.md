# Time-Off Microservice

This is the backend microservice for handling time-off requests for the ReadyOn platform. It uses a local SQLite database for fast balance checks and synchronizes with an external HCM system (Workday, SAP, etc.) as the source of truth.

## Features

- **Employee Endpoints**: View balances, submit time-off requests, and cancel pending/approved requests.
- **Manager Endpoints**: List team requests, approve, and reject requests.
- **HCM Sync**: Support for both real-time individual updates and batch balance overwrites.
- **Defensive Design**: Built with multiple layers of defense to handle HCM downtime, timeouts, and asynchronous balance changes.
- **Leave Types**: Supports multiple dimensions (e.g., PTO, Sick Leave) per employee per location.

## Technology Stack

- **Framework**: NestJS
- **Database**: SQLite
- **ORM**: TypeORM
- **Testing**: Jest & Supertest (Unit + E2E)

---

## Getting Started

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy the example env file:
```bash
cp .env.example .env
```

### 3. Start the Mock HCM Server

The project includes a fully functional Mock HCM server to simulate external systems:

```bash
# In a separate terminal terminal:
cd mock-hcm
npm install
npm start
```
*The mock server runs on `http://localhost:3001`.*

### 4. Start the Microservice

```bash
# Development mode
npm run start:dev
```
*The microservice runs on `http://localhost:3000`.*

---

## API Documentation (Swagger)

Once the service is running, navigate to the auto-generated Swagger documentation to explore and test the endpoints:

**http://localhost:3000/api/docs**

---

## Testing & Coverage

This project was built with a strong emphasis on test rigor and agentic development. 

Run the test suites:

```bash
# Unit tests with coverage report
npm run test:cov

# Full E2E integration tests (uses in-memory SQLite and mocked HCM provider)
npm run test:e2e
```

**Coverage Targets Met:**
- Overall: > 90%
- Services/Business Logic: > 95%

---

## Architecture Decisions & Constraints

For a full breakdown of the system design, core workflows, sync strategy, and concurrency handling, please see the included **Technical Requirements Document (TRD)** located at:

`./TRD_TimeOff_Microservice.md`

Key highlights:
- **Optimistic Locking**: Used on the `time_off_request` table to prevent race conditions during concurrent manager approvals.
- **Pending Days Concept**: The `available_balance` is calculated on the fly as `total_balance - pending_days` to prevent double-booking before HCM approval.
- **Post-Sync Flagging**: If a batch sync reduces an employee's balance below what they have requested, affected `PENDING` requests are flagged as `PENDING_REVIEW` for the manager.
