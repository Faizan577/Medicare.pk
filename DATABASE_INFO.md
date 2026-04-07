# 🗄️ Queue Management System - Database Information

## 📍 Database Location

**File Name:** `queue.db`
**Full Path:** `D:\Desktop\6th Semester\Entrepneurship\Queue_Management\queue.db`
**Type:** SQLite 3 Database
**Size:** 32 KB
**Status:** ✅ Active and Running

## 🔐 Authentication Data Storage

### Where Passwords Are Stored

All authentication data is stored in the **`users`** table:

| Column | Type | Details |
|--------|------|---------|
| `id` | INTEGER | Primary Key (auto-increment) |
| `name` | TEXT | User's full name |
| `email` | TEXT | Login email (UNIQUE constraint) |
| `password_hash` | TEXT | 🔒 **BCRYPTED PASSWORD** (not plain text) |
| `role` | TEXT | `patient` \| `doctor` \| `admin` |
| `phone` | TEXT | Contact number (optional) |

## 📊 All Database Tables

### 1. **users** - Authentication & User Information
- Stores user credentials and profile
- Primary key: `id`
- Unique constraint on `email` (prevents duplicate accounts)
- Passwords are hashed with bcryptjs (10 rounds)

### 2. **doctors** - Doctor Profiles
- Links doctors to users table
- Stores specialty and schedule information
- Foreign key: `user_id` → `users.id`

### 3. **appointments** - Appointment Bookings
- Stores appointment records
- Foreign keys: `patient_id`, `doctor_id`
- Tracks appointment status (scheduled/completed)

### 4. **queue** - Patient Queue Management
- Manages real-time patient queue
- Unique token for each queue entry
- Tracks position and emergency status
- Foreign keys: `patient_id`, `doctor_id`

## 🔒 Password Security

✅ **Passwords are BCRYPTED** - Not stored in plain text
✅ **One-way encryption** - Cannot be recovered, only verified
✅ **10 rounds of hashing** - Industry-standard security
✅ **Original password never stored** - Only hash stored
✅ **Login comparison** - Entered password is hashed and compared with stored hash

## 🧪 Test Credentials (Pre-loaded in Database)

### Admin Account
```
Email:    admin@example.com
Password: admin
Role:     admin
```

### Doctor Account
```
Email:    doctor@example.com
Password: doctor
Role:     doctor
```

**Note:** These accounts are automatically created on first server start.

## 💾 How to Access & Manage Database

### Option 1: SQLite Browser (Recommended for Beginners)
1. Download: https://sqlitebrowser.org/
2. Open the `queue.db` file
3. Browse all tables visually
4. View/edit data and write SQL queries

### Option 2: Command Line
```bash
# Navigate to project folder
sqlite3 queue.db

# View all users
SELECT * FROM users;

# View specific user
SELECT * FROM users WHERE email = 'admin@example.com';

# Count total users
SELECT COUNT(*) FROM users;

# View doctors
SELECT * FROM doctors;
```

### Option 3: Through Application
- All database operations happen automatically via Express routes
- User registration: `POST /register` → inserts into users table
- User login: `POST /login` → queries users table
- No manual database management needed

## 📡 How Authentication Works

### Registration Flow
1. User fills form on `auth.html`
2. Frontend sends `POST /register` request with email & password
3. Server receives request in `server.js` (line 133)
4. Password is **hashed using bcryptjs**
5. User record **inserted into users table** (email, password_hash, name, role)
6. JWT token is generated
7. Token returned to frontend
8. Token stored in browser's `localStorage`

### Login Flow
1. User enters email & password
2. Frontend sends `POST /login` request
3. Server queries `users` table by email
4. Compares **entered password hash** with **stored hash**
5. If match: JWT token generated
6. Token returned and stored in `localStorage`
7. Token included in all dashboard requests

### Authorization Flow
1. User accesses protected page (e.g., `/patient.html`)
2. Dashboard reads token from `localStorage`
3. Each API request includes JWT token in headers
4. Server validates token (line 102 in `server.js`)
5. If valid: allows access to protected routes
6. If invalid: redirects to login page

## 🔍 Security Features

✅ **Passwords hashed with bcryptjs (10 rounds)**
✅ **Email must be unique (no duplicate accounts)**
✅ **JWT tokens for stateless authentication**
✅ **JWT tokens expire after 8 hours**
✅ **Session-based authentication also available**
✅ **Foreign key constraints maintain data integrity**
✅ **CORS enabled for API security**
✅ **SQL injection protected by parameterized queries**

## 📝 Code Reference (server.js)

| Line | Purpose |
|------|---------|
| 22 | Database connection to queue.db |
| 29-36 | CREATE users table (authentication) |
| 38-44 | CREATE doctors table |
| 46-54 | CREATE appointments table |
| 56-66 | CREATE queue table |
| 69-74 | Insert default admin account |
| 76-83 | Insert default doctor account |
| 102-126 | Authentication middleware (JWT validation) |
| 133-143 | `/register` endpoint (creates new user in DB) |
| 146-156 | `/login` endpoint (validates credentials) |

## 📋 API Endpoints Using Database

### Authentication
- `POST /register` → Inserts into users table
- `POST /login` → Queries users table, validates password

### Patient Features
- `POST /book-appointment` → Inserts into appointments table
- `POST /join-queue` → Inserts into queue table
- `GET /queue-status` → Queries queue table

### Doctor Features
- `GET /doctor-dashboard` → Queries queue & appointments tables
- `POST /call-next/:queueId` → Updates queue table
- `POST /complete-appointment/:apptId` → Updates appointments table

### Admin Features
- `GET /admin-dashboard` → Queries all tables
- `POST /add-doctor` → Inserts into doctors table
- `DELETE /remove-doctor/:id` → Deletes from doctors table

## ✅ Database Status

- **Server:** ✓ Running at http://localhost:3000
- **Database:** ✓ Active and accessible
- **Tables:** ✓ 4 tables created and ready
- **Test Data:** ✓ Admin & Doctor accounts pre-loaded
- **Security:** ✓ Passwords hashed, JWT authentication enabled
- **Data Persistence:** ✓ All data persists between server restarts

## 🚀 Quick Start

1. **Access Database Browser:** Download SQLite Browser from https://sqlitebrowser.org/
2. **Open Database:** Open `queue.db` file
3. **Login to App:** Go to http://localhost:3000
4. **Test Credentials:** Use admin@example.com / admin
5. **View Data:** Check users table in SQLite Browser

---

**Created:** 2026-04-07
**Last Updated:** 2026-04-07
**Status:** Production Ready ✅
