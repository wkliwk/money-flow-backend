# Money Flow — Product Document

## Overview

**What:** Personal expense tracking app with AI-powered features — NLP expense parsing, receipt OCR, bank statement scanning, budgets, recurring expenses, net worth tracking, and weekly insights.

**Who:** Individuals who want simple, powerful expense tracking without the complexity of full accounting software.

**Core problem:** Logging expenses is tedious. Money Flow reduces friction with NLP parsing ("coffee 4.50 at Starbucks"), receipt photos, and smart templates while providing useful insights into spending patterns.

---

## Features

### 1. Authentication

**Description:** Email/password registration and login, plus Google and Apple OAuth.

**Endpoints:**
- `POST /auth/register` — email + password signup
- `POST /auth/login` — email + password login
- `POST /auth/google` — Google OAuth
- `POST /auth/apple` — Apple Sign-In

**Acceptance criteria:**
- [ ] Users can register with email/password
- [ ] Users can log in and receive JWT token
- [ ] Google OAuth works end-to-end
- [ ] Apple Sign-In works end-to-end
- [ ] JWT tokens expire and can be refreshed

---

### 2. Expense CRUD

**Description:** Create, read, update, delete expenses. Supports NLP parsing (natural language input like "lunch 12.50 at subway").

**Endpoints:**
- `GET /expenses` — list with pagination, date range, category, type filters
- `GET /expenses/:id` — single expense
- `POST /expenses` — create (supports NLP text or structured input)
- `PUT /expenses/:id` — update
- `DELETE /expenses/:id` — delete

**Acceptance criteria:**
- [ ] Expenses have: description, amount, category, date, paymentMethod, type (expense/income), notes
- [ ] NLP parsing extracts amount, description, category from free text
- [ ] Pagination with limit/offset
- [ ] Filter by date range, category, type

---

### 3. Expense Analytics

**Description:** Aggregated spending data — totals by category, trends over time, spending patterns.

**Endpoints:**
- `GET /expenses/analytics` — category breakdowns, daily/weekly/monthly aggregations
- `GET /expenses/last-amounts` — recent amounts for quick-add suggestions
- `GET /expenses/price-history/:item` — price trend for a specific item

**Acceptance criteria:**
- [ ] Category-level spending totals for any date range
- [ ] Daily/weekly/monthly trend data
- [ ] Price history for individual items

---

### 4. Budgets

**Description:** Set monthly spending limits per category with alerts.

**Endpoints:**
- `GET /budgets` — all budgets
- `GET /budgets/summary` — budget vs actual spending
- `POST /budgets/:category/alerts` — set alert threshold
- `PUT /budgets/:category` — update budget amount

**Acceptance criteria:**
- [ ] Set budget per category
- [ ] Summary shows spent vs budget with percentage
- [ ] Alerts at configurable thresholds

---

### 5. Recurring Expenses

**Description:** Track subscriptions and recurring bills with automatic reminders.

**Endpoints:**
- `GET /recurring` — list all
- `POST /recurring` — create
- `GET /recurring/:id` — single
- `PUT /recurring/:id` — update
- `DELETE /recurring/:id` — delete

**Acceptance criteria:**
- [ ] Recurring expenses have: description, amount, frequency (daily/weekly/monthly/yearly), nextDueDate
- [ ] CRUD operations work correctly

---

### 6. Transaction Templates

**Description:** Save frequently used expenses as templates for one-tap logging.

**Endpoints:**
- `GET /templates` — list all
- `POST /templates` — create from expense data
- `GET /templates/:id` — single
- `PUT /templates/:id` — update
- `DELETE /templates/:id` — delete
- `POST /templates/apply/:id` — create expense from template
- `POST /templates/apply-multiple` — batch apply templates

**Acceptance criteria:**
- [ ] Templates store expense fields (description, amount, category, etc.)
- [ ] Applying a template creates a new expense with current date
- [ ] Batch apply multiple templates at once

---

### 7. Receipt OCR

**Description:** Upload receipt photo, extract expense data via AI.

**Endpoints:**
- `POST /receipts/scan` — upload receipt image, returns parsed expense data

**Acceptance criteria:**
- [ ] Accepts image uploads (JPEG, PNG)
- [ ] AI extracts: merchant, amount, date, items
- [ ] Returns structured data ready to create expense

---

### 8. Bank Statement Import

**Description:** Upload bank statement (CSV/PDF), parse transactions, reconcile with existing expenses.

**Endpoints:**
- `POST /import/statement` — upload statement file
- `POST /import/statement/apply` — apply parsed transactions
- `POST /import/expenses` — bulk import expenses from CSV

**Acceptance criteria:**
- [ ] Parses CSV and PDF bank statements
- [ ] Shows preview of parsed transactions
- [ ] User can select which to import
- [ ] Deduplication against existing expenses

---

### 9. Export

**Description:** Export expenses as CSV.

**Endpoints:**
- `GET /export/csv` — download expenses as CSV

**Acceptance criteria:**
- [ ] CSV includes all expense fields
- [ ] Supports date range filter

---

### 10. Accounts

**Description:** Track multiple financial accounts (bank, credit card, cash, investment).

**Endpoints:**
- `GET /accounts` — list all
- `POST /accounts` — create
- `PUT /accounts/:id` — update
- `DELETE /accounts/:id` — delete

**Acceptance criteria:**
- [ ] Account types: bank, credit card, cash, investment, other
- [ ] Each account has name, type, balance, currency

---

### 11. Net Worth Tracking

**Description:** Periodic snapshots of total assets minus liabilities.

**Endpoints:**
- `GET /net-worth` — all snapshots
- `GET /net-worth/latest` — most recent
- `POST /net-worth` — create snapshot
- `PUT /net-worth/:snapshotId` — update
- `DELETE /net-worth/:snapshotId` — delete

**Acceptance criteria:**
- [ ] Snapshots record total assets, liabilities, and net worth
- [ ] Historical trend visible

---

### 12. Friends System

**Description:** Add friends for future expense splitting.

**Endpoints:**
- `POST /friends` — send friend request
- `GET /friends` — list friends
- `GET /friends/pending` — pending requests
- `POST /friends/:id/accept` — accept request
- `POST /friends/:id/reject` — reject request
- `DELETE /friends/:id` — remove friend

**Acceptance criteria:**
- [ ] Send/accept/reject friend requests
- [ ] List confirmed friends and pending requests

---

### 13. Insights & Weekly Pulse

**Description:** AI-generated spending insights and weekly summary reports.

**Endpoints:**
- `GET /insights/weekly-pulse` — current week's pulse
- `GET /insights/previous-pulse` — last week's pulse
- `POST /insights/weekly-pulse/generate` — trigger generation
- `GET /reports/monthly` — monthly spending report
- `GET /reports/budget-summary` — budget performance
- `POST /reports/weekly-digest` — trigger weekly digest

**Acceptance criteria:**
- [ ] Weekly pulse summarizes spending trends, anomalies, and tips
- [ ] Monthly report shows category breakdowns and comparisons
- [ ] Budget summary shows over/under status per category

---

### 14. Item Price Index

**Description:** Track and compare prices of items across purchases.

**Endpoints:**
- `POST /item-prices/extract` — extract item prices from expense
- `GET /item-prices` — look up price history
- `GET /item-prices/suggest` — price suggestions for items

**Acceptance criteria:**
- [ ] Extracts individual items and prices from expense descriptions
- [ ] Tracks price changes over time
- [ ] Suggests expected prices based on history

---

### 15. User Profile

**Description:** User settings and preferences.

**Endpoints:**
- `GET /users/me` — get profile
- `PATCH /users/me` — update profile (name, currency, preferences)

**Acceptance criteria:**
- [ ] Users can set preferred currency
- [ ] Profile includes name and settings

---

### 16. Background Jobs

**Description:** Scheduled tasks for automated processing.

**Endpoints:**
- `POST /jobs/monthly-summary` — trigger monthly summary generation

**Acceptance criteria:**
- [ ] Monthly summary job runs on schedule
- [ ] Generates aggregate reports for the month

---

### 17. Exchange Rates

**Description:** Currency exchange rate data for multi-currency support.

**Endpoints:**
- `GET /exchange-rates` — current rates

**Acceptance criteria:**
- [ ] Returns current exchange rates
- [ ] Supports common currencies

---

## Out of Scope

- **No multi-user shared accounts** — single-user only (friends system is for future splitting)
- **No investment portfolio tracking** — net worth only, not individual stock/crypto positions
- **No bill payment** — tracking only, no actual payments
- **No tax filing** — expense categorization but no tax prep features
