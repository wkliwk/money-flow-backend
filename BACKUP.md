# MongoDB Backup & Restore

## Overview

Daily automated backups of the Money Flow MongoDB database to Cloudflare R2 (S3-compatible object storage). Backups run via GitHub Actions on a cron schedule.

## Architecture

```
MongoDB Atlas (M0) --> mongodump (GitHub Actions) --> gzip --> Cloudflare R2 bucket
```

- **Schedule**: Daily at 03:00 UTC (14:00 AEST)
- **Retention**: 30 days (older backups auto-deleted)
- **Storage**: Cloudflare R2 free tier (10GB storage, 1M Class B requests/month)
- **Format**: gzip-compressed mongodump archive (all collections)
- **Notifications**: Telegram on success/failure

## Collections Backed Up

All collections in the database are included:
- users
- expenses
- accounts
- friendships
- alerts
- networths
- recurringexpenses
- transactiontemplates
- itemprices
- weeklypulses

## Required GitHub Secrets

| Secret | Description |
|---|---|
| `MONGODB_URI` | Full MongoDB connection string (already set for CI) |
| `R2_ACCESS_KEY_ID` | Cloudflare R2 API token key ID |
| `R2_SECRET_ACCESS_KEY` | Cloudflare R2 API token secret |
| `R2_ENDPOINT` | R2 endpoint URL, e.g. `https://<account-id>.r2.cloudflarestorage.com` |
| `R2_BUCKET` | R2 bucket name, e.g. `money-flow-backups` |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token (already set) |
| `TELEGRAM_CHAT_ID` | Telegram chat ID (already set) |

## Setup: Cloudflare R2

1. Go to Cloudflare Dashboard > R2 Object Storage
2. Create a bucket named `money-flow-backups`
3. Go to R2 > Manage R2 API Tokens > Create API Token
4. Grant the token read/write access to the bucket
5. Copy the Access Key ID, Secret Access Key, and the S3 endpoint URL
6. Add all four R2 secrets to the GitHub repo: Settings > Secrets and variables > Actions

## Manual Trigger

To run a backup manually (e.g., before a migration):

```bash
gh workflow run daily-backup.yml --repo wkliwk/money-flow-backend
```

Or use the GitHub Actions UI: Actions > Daily MongoDB Backup > Run workflow.

## Restore Procedure

### Prerequisites

- `mongorestore` installed locally (`brew install mongodb-database-tools` on macOS)
- AWS CLI installed (`brew install awscli`)
- R2 credentials configured

### Step 1: Configure AWS CLI for R2

```bash
aws configure --profile r2
# Access Key ID: <R2_ACCESS_KEY_ID>
# Secret Access Key: <R2_SECRET_ACCESS_KEY>
# Region: auto
# Output format: json
```

### Step 2: List Available Backups

```bash
aws s3 ls s3://money-flow-backups/backups/ \
  --endpoint-url https://<account-id>.r2.cloudflarestorage.com \
  --profile r2
```

### Step 3: Download the Backup

```bash
aws s3 cp s3://money-flow-backups/backups/money-flow-backup-2026-04-04_030012.gz ./restore.gz \
  --endpoint-url https://<account-id>.r2.cloudflarestorage.com \
  --profile r2
```

### Step 4: Restore to MongoDB

**Restore to production (full overwrite):**

```bash
mongorestore --uri="<MONGODB_URI>" --gzip --archive=restore.gz --drop
```

The `--drop` flag drops each collection before restoring. Omit it to merge.

**Restore to a local MongoDB for inspection:**

```bash
mongorestore --host=localhost:27017 --gzip --archive=restore.gz --drop
```

**Restore a single collection:**

```bash
mongorestore --uri="<MONGODB_URI>" --gzip --archive=restore.gz \
  --nsInclude="money-flow.expenses" --drop
```

### Step 5: Verify

After restoring, check data integrity:

```bash
mongosh "<MONGODB_URI>" --eval "
  db.getCollectionNames().forEach(c => {
    print(c + ': ' + db[c].countDocuments() + ' documents');
  });
"
```

## Disaster Recovery Runbook

1. Identify the issue (data corruption, accidental deletion, etc.)
2. Determine which backup to restore from (list backups by date)
3. If partial data loss: restore only the affected collection with `--nsInclude`
4. If full data loss: restore the most recent backup with `--drop`
5. Verify document counts match expectations
6. Notify via Telegram that restore is complete
7. Post incident report on the GitHub issue

## Cost

Cloudflare R2 free tier:
- 10 GB storage (estimated backup size: ~5-50 MB/day = ~150 MB-1.5 GB for 30 days)
- 1,000,000 Class B requests/month (we use ~60: 30 uploads + 30 deletes)
- No egress fees

This should remain well within free tier for the foreseeable future.
