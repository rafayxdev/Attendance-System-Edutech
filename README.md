# EduTech Attendance System

This repository contains the React + Node migration of the EduTech attendance system.

## What is included

- React frontend for login, guest attendance, staff attendance, and admin dashboard.
- Node.js + Express backend with JWT auth, attendance rules, admin stats, CSV export, and image storage in PostgreSQL.
- PostgreSQL schema for users, attendance logs, access policy, email logs, and audit logs.
- Email receipt support through Nodemailer with Gmail SMTP fallback.
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
6. If you want real email receipts, set `GMAIL_USER`, `GMAIL_APP_PASSWORD`, and optionally `EMAIL_FROM`.
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

Email receipts are generated on the backend with an HTML template. If Gmail credentials are not set, the project still works but emails are skipped and logged to the console.

For production, configure Gmail SMTP for receipts:

- `GMAIL_USER` - Gmail address used to send mail
- `GMAIL_APP_PASSWORD` - Google App Password for that mailbox
- `EMAIL_FROM` - optional sender display name, defaults to `EduTech Interns <edutechinterns@gmail.com>`

If you do not set Gmail credentials, receipt emails are skipped and the API still works.

## Access control

The app supports both network and location gating:

- IP prefix allowlist
- Campus latitude/longitude radius
- Home/testing profile

## Deployment env list

API host:

- `DATABASE_URL`
- `JWT_SECRET`
- `NODE_ENV=production`
- `ACCESS_PROFILE=university` for campus deploys, or `home` for local-style testing
- `ACCESS_GATE_ENFORCED=true`
- `ALLOWED_IP_PREFIXES` if you want to override the defaults
- `APP_TIMEZONE=Asia/Karachi` if you want the default explicitly
- `APP_PUBLIC_URL=https://your-web-domain`
- `API_PUBLIC_URL=https://your-api-domain`
- `CAMPUS_LAT`
- `CAMPUS_LNG`
- `CAMPUS_RADIUS_METERS`
- `GMAIL_USER`
- `GMAIL_APP_PASSWORD`
- `EMAIL_FROM` optional
- `DEMO_ADMIN_EMAIL`
- `DEMO_ADMIN_PASSWORD`

Web host:

- `VITE_API_URL=https://your-api-domain`

## Seed accounts

The seed script creates demo credentials from environment variables:

- Admin: `DEMO_ADMIN_EMAIL` / `DEMO_ADMIN_PASSWORD`

The app does not seed a demo staff account anymore. Create staff/users from the admin panel after login.

Guest attendance does not require an account.
