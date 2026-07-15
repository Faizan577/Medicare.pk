const sqlite3 = require('./db').verbose();
const db = new sqlite3.Database('./queue.db');

db.serialize(() => {
    db.run('PRAGMA foreign_keys = ON');

    db.run(`CREATE TABLE IF NOT EXISTS consultations (
        consultation_id INTEGER PRIMARY KEY AUTOINCREMENT,
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
        completed_at TEXT
    )`, (err) => { if (err) console.error('consultations:', err.message); else console.log('consultations table OK'); });

    db.run(`CREATE TABLE IF NOT EXISTS prescriptions (
        prescription_id INTEGER PRIMARY KEY AUTOINCREMENT,
        consultation_id INTEGER NOT NULL,
        patient_id INTEGER NOT NULL,
        doctor_id INTEGER NOT NULL,
        medicine_name TEXT NOT NULL,
        dosage TEXT,
        duration TEXT,
        instructions TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`, (err) => { if (err) console.error('prescriptions:', err.message); else console.log('prescriptions table OK'); });

    db.run(`CREATE TABLE IF NOT EXISTS follow_ups (
        followup_id INTEGER PRIMARY KEY AUTOINCREMENT,
        consultation_id INTEGER NOT NULL,
        patient_id INTEGER NOT NULL,
        doctor_id INTEGER NOT NULL,
        followup_date TEXT NOT NULL,
        notes TEXT,
        status TEXT DEFAULT 'pending',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
        if (err) console.error('follow_ups:', err.message);
        else console.log('follow_ups table OK');
        db.close(() => console.log('All tables ready!'));
    });
});
