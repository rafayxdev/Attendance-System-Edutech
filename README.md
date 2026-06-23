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

## What you need to do

1. Create a PostgreSQL database. Supabase or Neon free tier both work.
2. Copy `.env.example` to `.env` and fill in the real values.
3. Set `DATABASE_URL` to your PostgreSQL connection string.
4. Set `JWT_SECRET` to a long random secret.
5. Choose access mode:
   - `ACCESS_PROFILE=home` for your local testing setup
   - `ACCESS_PROFILE=university` for the campus deployment
6. If you want real email receipts, set `GMAIL_USER`, `GMAIL_APP_PASSWORD`, and optionally `EMAIL_FROM`.
7. Install dependencies with npm.

## Local setup

```bash
npm install
npm run dev
```

This starts both the API (`http://localhost:4000`) and the web app (`http://localhost:5173`) together.

If you prefer separate terminals:

```bash
npm run dev:api
npm run dev:web
```

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

Web host:

- `VITE_API_URL=https://your-api-domain`

Guest attendance does not require an account.

## Vercel Deployment

This project is configured for one-click deployment on Vercel.

### One-click deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Frafayxdev%2FAttendance-System-Edutech)

### Manual deploy steps

1. Push this repository to GitHub.
2. Go to [vercel.com/new](https://vercel.com/new) and import the repository.
3. The `vercel.json` at the root handles monorepo configuration automatically.
4. **Set environment variables** in the Vercel dashboard:

   | Variable | Description |
   |---|---|
   | `DATABASE_URL` | PostgreSQL connection string (Supabase/Neon) |
   | `JWT_SECRET` | Long random string for JWT signing |
   | `NODE_ENV` | Set to `production` |
   | `ACCESS_PROFILE` | `home` or `university` |
   | `ACCESS_GATE_ENFORCED` | `false` to disable location/IP gating |
   | `APP_TIMEZONE` | e.g. `Asia/Karachi` |
   | `VITE_API_URL` | Your Vercel deployment URL (same as frontend) |
   | `GMAIL_USER` | (Optional) Gmail for email receipts |
   | `GMAIL_APP_PASSWORD` | (Optional) Google App Password |

5. Deploy! The build will:
   - Install npm dependencies
   - Generate Prisma client
   - Build the React frontend
   - The API is deployed as a Vercel serverless function (route `/api/*`)
   - The frontend is deployed as a static SPA (all other routes)

> :memo: The first deploy will fail until you set `DATABASE_URL` in the Vercel project environment variables.

### Environment variables

Copy `.env.example` and fill in your values:

```bash
cp .env.example .env
```

### Local development

```bash
npm install
npm run dev:api   # Terminal 1 - API on port 4000
npm run dev:web   # Terminal 2 - Web on port 5173
```

### Troubleshooting

- **API returns 404**: Ensure `VITE_API_URL` is set correctly and the API routes work at `/api/*`
- **Prisma errors**: Verify `DATABASE_URL` is correct and the database allows connections from Vercel's IP range
- **CORS errors**: The API allows all origins in development; for production, restrict as needed
