# EduTech Attendance System

This repository contains the React + Node migration of the EduTech attendance system.

## What is included

- React frontend for login, guest attendance, staff attendance, and admin dashboard.
- Node.js + Express backend with JWT auth, attendance rules, admin stats, CSV export, and image storage in PostgreSQL.
- PostgreSQL schema for users, attendance logs, access policy, email logs, and audit logs.
- Email receipt support through Resend.
- Camera/image capture support by uploading compressed images directly into the database as binary data.

## Project structure

- `apps/web` - React client
- `apps/api` - backend API and Prisma schema
- `Previous Project Files` - the original Google Apps Script export for reference

## What you need to do

1. Create a PostgreSQL database. Supabase or Neon free tier both work.
2. Copy `.env.example` to `.env` and fill in the real values.
3. Set `DATABASE_URL` to your PostgreSQL connection string.
4. Set `JWT_SECRET` to a long random secret.
5. Choose access mode:
   - `ACCESS_PROFILE=home` for your local testing setup
   - `ACCESS_PROFILE=university` for the campus deployment
6. If you want real email receipts, set `RESEND_API_KEY` and `RESEND_FROM`.
7. Run the Prisma migration and seed script.
8. Install dependencies with npm.

## Local setup

```bash
npm install
npm run seed -w @edutech/api
npm run dev:api
npm run dev:web
```

If you prefer to run both later, you can use separate terminals for the API and the web app.

## Database notes

The system stores captured attendance images directly in PostgreSQL using a binary column. That keeps everything in one free database, but it also means you should keep the image size small. The frontend compresses captures before upload.

## Email notes

Email receipts are generated on the backend with an HTML template. If `RESEND_API_KEY` is not set, the project still works but emails are skipped and logged to the console.

## Access control

The app supports both network and location gating:

- IP prefix allowlist
- Campus latitude/longitude radius
- Home/testing profile

Set `VITE_BYPASS_ACCESS_GATE=true` for local UI testing.

## Seed accounts

The seed script creates demo credentials from environment variables:

- Admin: `DEMO_ADMIN_EMAIL` / `DEMO_ADMIN_PASSWORD`
- Staff: `DEMO_USER_EMAIL` / `DEMO_USER_PASSWORD`

Guest attendance does not require an account.
