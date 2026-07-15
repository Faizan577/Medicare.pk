const sqlite3 = require('sqlite3').verbose();
const { Client } = require('pg');
const url = require('url');
require('dotenv').config();

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/medicare';

async function setupDatabase() {
    // 1. Parse connection string to get details for postgres default db connection
    const parsed = url.parse(connectionString);
    const auth = parsed.auth ? parsed.auth.split(':') : ['postgres', 'postgres'];
    const user = auth[0];
    const password = auth[1];
    const host = parsed.hostname || 'localhost';
    const port = parsed.port || 5432;
    const dbName = parsed.pathname ? parsed.pathname.split('/')[1] : 'medicare';

    console.log(`Connecting to PostgreSQL at ${host}:${port} to check/create database "${dbName}"...`);

    const checkClient = new Client({
        user,
        password,
        host,
        port,
        database: 'postgres'
    });

    try {
        await checkClient.connect();
        const res = await checkClient.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [dbName]);
        if (res.rowCount === 0) {
            await checkClient.query(`CREATE DATABASE "${dbName}"`);
            console.log(`✅ Created target database "${dbName}"`);
        } else {
            console.log(`ℹ️ Database "${dbName}" already exists.`);
        }
    } catch (err) {
        console.error('❌ Error checking/creating database:', err.message);
        throw err;
    } finally {
        await checkClient.end();
    }
}

const TABLES = [
    {
        name: 'users',
        pk: 'user_id',
        schema: `CREATE TABLE IF NOT EXISTS users (
            user_id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT NOT NULL,
            phone TEXT
        )`
    },
    {
        name: 'doctors',
        pk: 'id',
        schema: `CREATE TABLE IF NOT EXISTS doctors (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            specialty TEXT,
            schedule TEXT,
            qualification TEXT,
            experience_years INTEGER,
            available_timing TEXT,
            consultation_fee REAL,
            profile_picture TEXT,
            hospital_name TEXT,
            hospital_rating REAL,
            hospital_emergency INTEGER DEFAULT 0,
            hospital_pharmacy INTEGER DEFAULT 0,
            hospital_laboratory INTEGER DEFAULT 0,
            hospital_address TEXT,
            FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
        )`
    },
    {
        name: 'appointments',
        pk: 'appointment_id',
        schema: `CREATE TABLE IF NOT EXISTS appointments (
            appointment_id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            doctor_id INTEGER NOT NULL,
            appointment_date TEXT NOT NULL,
            status TEXT DEFAULT 'scheduled',
            FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
            FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE
        )`
    },
    {
        name: 'tokens',
        pk: 'token_id',
        schema: `CREATE TABLE IF NOT EXISTS tokens (
            token_id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            doctor_id INTEGER NOT NULL,
            token_number TEXT NOT NULL,
            emergency BOOLEAN DEFAULT FALSE,
            entered_at TEXT DEFAULT CURRENT_TIMESTAMP,
            position INTEGER,
            queue_status TEXT DEFAULT 'waiting',
            called_at TEXT,
            FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
            FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE
        )`
    },
    {
        name: 'reviews',
        pk: 'id',
        schema: `CREATE TABLE IF NOT EXISTS reviews (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            doctor_id INTEGER NOT NULL,
            rating INTEGER NOT NULL,
            comment TEXT,
            review_date TEXT,
            FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
            FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE
        )`
    },
    {
        name: 'hospital_reviews',
        pk: 'id',
        schema: `CREATE TABLE IF NOT EXISTS hospital_reviews (
            id SERIAL PRIMARY KEY,
            hospital_name TEXT NOT NULL,
            reviewer_name TEXT NOT NULL,
            rating REAL NOT NULL,
            feedback TEXT,
            emergency_service_rating REAL,
            staff_behavior_rating REAL,
            cleanliness_rating REAL,
            overall_experience_rating REAL,
            review_date TEXT
        )`
    },
    {
        name: 'notifications',
        pk: 'notification_id',
        schema: `CREATE TABLE IF NOT EXISTS notifications (
            notification_id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            message TEXT NOT NULL,
            status TEXT DEFAULT 'unread',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
        )`
    },
    {
        name: 'consultations',
        pk: 'consultation_id',
        schema: `CREATE TABLE IF NOT EXISTS consultations (
            consultation_id SERIAL PRIMARY KEY,
            patient_id INTEGER NOT NULL,
            doctor_id INTEGER NOT NULL,
            token_id INTEGER,
            appointment_id INTEGER,
            consultation_type TEXT DEFAULT 'token',
            symptoms TEXT,
            diagnosis TEXT,
            recommendations TEXT,
            notes TEXT,
            status TEXT DEFAULT 'in_progress',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            completed_at TEXT,
            FOREIGN KEY (patient_id) REFERENCES users(user_id) ON DELETE CASCADE,
            FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE
        )`
    },
    {
        name: 'prescriptions',
        pk: 'prescription_id',
        schema: `CREATE TABLE IF NOT EXISTS prescriptions (
            prescription_id SERIAL PRIMARY KEY,
            consultation_id INTEGER NOT NULL,
            patient_id INTEGER NOT NULL,
            doctor_id INTEGER NOT NULL,
            medicine_name TEXT NOT NULL,
            dosage TEXT,
            duration TEXT,
            instructions TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (consultation_id) REFERENCES consultations(consultation_id) ON DELETE CASCADE,
            FOREIGN KEY (patient_id) REFERENCES users(user_id) ON DELETE CASCADE,
            FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE
        )`
    },
    {
        name: 'follow_ups',
        pk: 'followup_id',
        schema: `CREATE TABLE IF NOT EXISTS follow_ups (
            followup_id SERIAL PRIMARY KEY,
            consultation_id INTEGER NOT NULL,
            patient_id INTEGER NOT NULL,
            doctor_id INTEGER NOT NULL,
            followup_date TEXT NOT NULL,
            notes TEXT,
            status TEXT DEFAULT 'pending',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (consultation_id) REFERENCES consultations(consultation_id) ON DELETE CASCADE,
            FOREIGN KEY (patient_id) REFERENCES users(user_id) ON DELETE CASCADE,
            FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE
        )`
    }
];

async function run() {
    try {
        await setupDatabase();
    } catch (e) {
        console.warn('⚠️ Could not verify target database existence. Proceeding with migration anyway...');
    }

    const pgClient = new Client({ connectionString });
    await pgClient.connect();
    console.log('✅ Connected to target PostgreSQL database.');

    const sqliteDb = new sqlite3.Database('./queue.db', sqlite3.OPEN_READONLY, (err) => {
        if (err) {
            console.error('❌ Failed to open SQLite queue.db database:', err.message);
            process.exit(1);
        }
    });

    console.log('✅ Opened source SQLite queue.db database.');

    try {
        // Create tables first
        for (const t of TABLES) {
            console.log(`Creating table ${t.name} if not exists...`);
            await pgClient.query(t.schema);
        }

        // Copy data for each table in order
        for (const t of TABLES) {
            console.log(`Migrating data for table "${t.name}"...`);

            // Check if source table exists in sqlite
            const tableExists = await new Promise((resolve) => {
                sqliteDb.get(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [t.name], (err, row) => {
                    resolve(!!row);
                });
            });

            if (!tableExists) {
                console.log(`ℹ️ Table "${t.name}" does not exist in SQLite database. Skipping migration for this table.`);
                continue;
            }

            // Fetch SQLite rows
            const rows = await new Promise((resolve, reject) => {
                sqliteDb.all(`SELECT * FROM ${t.name}`, [], (err, result) => {
                    if (err) reject(err);
                    else resolve(result || []);
                });
            });

            if (rows.length === 0) {
                console.log(`ℹ️ Table "${t.name}" has 0 rows in SQLite. Skipping row insertion.`);
                continue;
            }

            console.log(`Found ${rows.length} rows in "${t.name}" from SQLite. Copying...`);

            // Clear destination table (optional, but good for clean migrations)
            await pgClient.query(`TRUNCATE TABLE ${t.name} RESTART IDENTITY CASCADE`);

            const cols = Object.keys(rows[0]);
            const insertSql = `INSERT INTO ${t.name} (${cols.join(', ')}) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(', ')})`;

            for (const r of rows) {
                const vals = cols.map(c => {
                    let val = r[c];
                    // Map numeric booleans for PostgreSQL boolean columns if needed
                    if (t.name === 'tokens' && c === 'emergency') {
                        return val === 1 || val === true || val === '1';
                    }
                    return val;
                });
                await pgClient.query(insertSql, vals);
            }
            console.log(`✅ Successfully copied ${rows.length} rows to "${t.name}"`);

            // Update sequences for tables with SERIAL primary keys
            const seqName = `${t.name}_${t.pk}_seq`;
            const seqCheck = await pgClient.query(`
                SELECT c.relname FROM pg_class c 
                JOIN pg_namespace n ON n.oid = c.relnamespace 
                WHERE c.relkind = 'S' AND c.relname = $1
            `, [seqName]);

            if (seqCheck.rowCount > 0) {
                console.log(`Updating sequence "${seqName}"...`);
                await pgClient.query(`SELECT setval('${seqName}', COALESCE(MAX(${t.pk}), 1)) FROM ${t.name}`);
            }
        }

        console.log('\n🎉 Database migration to PostgreSQL completed successfully!');
    } catch (err) {
        console.error('❌ Migration failed:', err);
    } finally {
        sqliteDb.close();
        await pgClient.end();
    }
}

run();
