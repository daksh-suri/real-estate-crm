# Real Estate CRM — Vynexa.ai

A production-oriented Real Estate CRM built as a modular monolith. This repository provides the foundation for upcoming domain modules (Identity, Organizations, Contacts, Properties, Leads, Deals, Reservations, Payments, Documents, and Tasks).

Detailed architecture and design specifications reside in `docs/`:
- `docs/CRM_Architecture_Audit_Report.md` (Phase 1 Audit)
- `docs/CRM_Architecture_Audit_Phase2.md` (Phase 2 Decision Record)
- `docs/CRM_Implementation_Blueprint_Phase3.md` (Phase 3 Implementation Blueprint — Primary Source of Truth)

---

## Technology Stack

- **Frontend**: React (v18), JavaScript, Vite
- **Backend**: Node.js, Express, JavaScript (CommonJS)
- **Database**: PostgreSQL
- **ORM**: Prisma (v6)
- **Architecture**: Modular Monolith

---

## Repository Structure

```
.
├── .github/
│   └── workflows/
│       └── ci.yml               # GitHub Actions CI pipeline
├── client/                      # React frontend application
│   ├── src/
│   │   ├── components/          # Foundation UI components (AppShell)
│   │   ├── App.jsx              # Root component
│   │   ├── main.jsx             # React DOM entry point
│   │   └── index.css            # Core design system styles
│   ├── index.html               # Vite HTML template
│   ├── vite.config.js           # Vite build & dev server config
│   └── package.json
├── server/                      # Node.js + Express backend
│   ├── src/
│   │   ├── config/              # Centralized environment & app config
│   │   ├── middleware/          # Error handling and 404 middleware
│   │   ├── routes/              # Express route definitions (GET /health)
│   │   ├── app.js               # Express application setup
│   │   └── server.js            # Server listener & shutdown hooks
│   ├── tests/                   # Integration and smoke tests
│   └── package.json
├── prisma/
│   └── schema.prisma            # PostgreSQL datasource & Prisma configuration
├── .env.example                 # Template for required environment variables
├── .gitignore                   # Git ignore rules for secrets, builds, dependencies
├── eslint.config.mjs            # ESLint 9 configuration (Node + React)
└── package.json                 # Root orchestration & workspace configuration
```

---

## Prerequisites

- **Node.js**: v18.0.0 or later (v20+ recommended)
- **npm**: v9.0.0 or later
- **PostgreSQL**: v14+ (for future database checkpoints)

---

## Getting Started

### 1. Install Dependencies

Install all dependencies across root, client, and server workspaces:

```bash
npm install
```

### 2. Configure Environment Variables

Copy the environment template and adjust if necessary:

```bash
cp .env.example .env
```

Key environment variables:
- `PORT`: HTTP port for Express server (default: `5000`)
- `NODE_ENV`: Runtime environment (`development`, `production`, `test`)
- `CORS_ORIGIN`: Allowed frontend origin (default: `http://localhost:5173`)
- `DATABASE_URL`: PostgreSQL connection string

---

## Running the Application

### Development Mode

Run both backend and frontend concurrently:
```bash
npm run dev
```

Or run services individually:
```bash
# Backend only (runs on http://localhost:5000 with nodemon)
npm run dev:server

# Frontend only (runs on http://localhost:5173 with Vite)
npm run dev:client
```

### Health Check Endpoint

Verify the backend process is running:
```bash
curl http://localhost:5000/health
```

Sample response:
```json
{
  "status": "ok",
  "uptime": 12.34,
  "timestamp": "2026-09-17T11:45:00.000Z",
  "service": "real-estate-crm-api"
}
```

---

## Production Commands

```bash
# Build frontend for production
npm run build

# Start backend in production mode
npm run start:server
```

---

## Prisma Commands

```bash
# Generate Prisma Client
npm run prisma:generate

# Run development migrations (requires running PostgreSQL)
npm run prisma:migrate

# Open Prisma Studio web inspector
npm run prisma:studio
```

---

## Code Quality & Testing

### Linting
```bash
# Check code style with ESLint
npm run lint

# Auto-fix lint issues
npm run lint:fix
```

### Testing
```bash
# Run Jest test suite (smoke & integration tests)
npm test
```

---

## Implementation Status

- [x] **Checkpoint 1: Project Initialization** (Current)
- [ ] **Checkpoint 2: Database Foundation & Tenant Scoping** (Next)
- [ ] **Checkpoint 3: Authentication & Authorization**
- [ ] **Checkpoint 4: Organizations & Teams**
- [ ] **Checkpoint 5+: Domain Modules** (Contacts, Properties, Leads, Deals, Reservations, etc.)
