const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const session = require('express-session');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_KEY = 'your_secret_key'; // Use env in production

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({ secret: SECRET_KEY, resave: false, saveUninitialized: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Database setup
const db = new sqlite3.Database('./queue.db', (err) => {
    if (err) console.error(err.message);
    console.log('Connected to SQLite database.');
});

// Create tables
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL,
        phone TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS doctors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        specialty TEXT,
        schedule TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS appointments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER NOT NULL,
        doctor_id INTEGER NOT NULL,
        date_time TEXT NOT NULL,
        status TEXT DEFAULT 'scheduled',
        FOREIGN KEY (patient_id) REFERENCES users(id),
        FOREIGN KEY (doctor_id) REFERENCES doctors(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER NOT NULL,
        doctor_id INTEGER NOT NULL,
        token TEXT UNIQUE NOT NULL,
        emergency BOOLEAN DEFAULT 0,
        entered_at TEXT DEFAULT CURRENT_TIMESTAMP,
        position INTEGER,
        FOREIGN KEY (patient_id) REFERENCES users(id),
        FOREIGN KEY (doctor_id) REFERENCES doctors(id)
    )`);

    // Sample data
    db.get("SELECT COUNT(*) as count FROM users WHERE email = 'admin@example.com'", (err, row) => {
        if (row.count === 0) {
            const hashed = bcrypt.hashSync('admin', 10);
            db.run("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)", ['Admin', 'admin@example.com', hashed, 'admin']);
        }
    });

    db.get("SELECT COUNT(*) as count FROM users WHERE email = 'doctor@example.com'", (err, row) => {
        if (row.count === 0) {
            const hashed = bcrypt.hashSync('doctor', 10);
            db.run("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)", ['Dr. Smith', 'doctor@example.com', hashed, 'doctor'], function() {
                db.run("INSERT INTO doctors (user_id, specialty, schedule) VALUES (?, ?, ?)", [this.lastID, 'General', '{}']);
            });
        }
    });
});

// Helper functions
const generateToken = () => `T${Date.now().toString().slice(-6)}`;

const calculateWaitTime = (position) => position * 10; // 10 min per patient

const updateQueuePositions = (doctorId, callback) => {
    db.all("SELECT id FROM queue WHERE doctor_id = ? ORDER BY emergency DESC, entered_at ASC", [doctorId], (err, rows) => {
        if (err) return callback(err);
        rows.forEach((row, index) => {
            db.run("UPDATE queue SET position = ? WHERE id = ?", [index + 1, row.id]);
        });
        callback();
    });
};

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/register', (req, res) => {
    const { name, email, password, role, phone, specialty } = req.body;
    const hashed = bcrypt.hashSync(password, 10);
    db.run("INSERT INTO users (name, email, password_hash, role, phone) VALUES (?, ?, ?, ?, ?)", [name, email, hashed, role, phone], function(err) {
        if (err) return res.status(400).json({ error: 'Email already exists' });
        if (role === 'doctor') {
            db.run("INSERT INTO doctors (user_id, specialty, schedule) VALUES (?, ?, ?)", [this.lastID, specialty, '{}']);
        }
        res.json({ message: 'Registration successful' });
    });
});

app.post('/login', (req, res) => {
    const { email, password } = req.body;
    db.get("SELECT * FROM users WHERE email = ?", [email], (err, user) => {
        if (!user || !bcrypt.compareSync(password, user.password_hash)) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        const token = jwt.sign({ id: user.id, role: user.role }, SECRET_KEY);
        req.session.user = user;
        res.json({ token, user });
    });
});

app.post('/book-appointment', (req, res) => {
    const { doctorId, dateTime } = req.body;
    const user = req.session.user;
    if (!user || user.role !== 'patient') return res.status(403).json({ error: 'Unauthorized' });
    db.run("INSERT INTO appointments (patient_id, doctor_id, date_time) VALUES (?, ?, ?)", [user.id, doctorId, dateTime], function(err) {
        if (err) return res.status(400).json({ error: 'Booking failed' });
        res.json({ message: 'Appointment booked successfully', appointmentId: this.lastID });
    });
});

app.post('/join-queue', (req, res) => {
    const { doctorId, emergency } = req.body;
    const user = req.session.user;
    if (!user || user.role !== 'patient') return res.status(403).json({ error: 'Unauthorized' });
    const token = generateToken();
    db.run("INSERT INTO queue (patient_id, doctor_id, token, emergency) VALUES (?, ?, ?, ?)", [user.id, doctorId, token, emergency ? 1 : 0], function(err) {
        if (err) return res.status(400).json({ error: 'Failed to join queue' });
        updateQueuePositions(doctorId, () => {
            res.json({ message: 'Joined queue', token });
        });
    });
});

app.get('/queue-status', (req, res) => {
    const user = req.session.user;
    if (!user || user.role !== 'patient') return res.status(403).json({ error: 'Unauthorized' });
    db.get("SELECT position FROM queue WHERE patient_id = ?", [user.id], (err, row) => {
        if (!row) return res.json({ position: null });
        const waitTime = calculateWaitTime(row.position);
        res.json({ position: row.position, waitTime });
    });
});

app.get('/doctors', (req, res) => {
    db.all("SELECT d.id, u.name, d.specialty FROM doctors d JOIN users u ON d.user_id = u.id", (err, rows) => {
        res.json(rows);
    });
});

app.get('/doctor-dashboard', (req, res) => {
    const user = req.session.user;
    if (!user || user.role !== 'doctor') return res.status(403).json({ error: 'Unauthorized' });
    db.get("SELECT id FROM doctors WHERE user_id = ?", [user.id], (err, doctor) => {
        db.all("SELECT q.id, q.token, u.name, q.emergency, q.position FROM queue q JOIN users u ON q.patient_id = u.id WHERE q.doctor_id = ? ORDER BY q.position", [doctor.id], (err, queues) => {
            db.all("SELECT a.id, u.name, a.date_time FROM appointments a JOIN users u ON a.patient_id = u.id WHERE a.doctor_id = ? AND a.status = 'scheduled'", [doctor.id], (err, appointments) => {
                res.json({ queues, appointments });
            });
        });
    });
});

app.post('/call-next/:queueId', (req, res) => {
    const { queueId } = req.params;
    const user = req.session.user;
    if (!user || user.role !== 'doctor') return res.status(403).json({ error: 'Unauthorized' });
    db.get("SELECT doctor_id, patient_id FROM queue WHERE id = ?", [queueId], (err, queue) => {
        if (!queue) return res.status(404).json({ error: 'Queue entry not found' });
        db.get("SELECT user_id FROM doctors WHERE id = ?", [queue.doctor_id], (err, doctor) => {
            if (doctor.user_id !== user.id) return res.status(403).json({ error: 'Unauthorized' });
            // Notify patient (simulate)
            console.log(`Notify patient ${queue.patient_id}: Your turn!`);
            db.run("DELETE FROM queue WHERE id = ?", [queueId], () => {
                updateQueuePositions(queue.doctor_id, () => {
                    res.json({ message: 'Called next patient' });
                });
            });
        });
    });
});

app.post('/complete-appointment/:apptId', (req, res) => {
    const { apptId } = req.params;
    const user = req.session.user;
    if (!user || user.role !== 'doctor') return res.status(403).json({ error: 'Unauthorized' });
    db.run("UPDATE appointments SET status = 'completed' WHERE id = ? AND doctor_id IN (SELECT id FROM doctors WHERE user_id = ?)", [apptId, user.id], function() {
        res.json({ message: 'Appointment completed' });
    });
});

app.get('/admin-dashboard', (req, res) => {
    const user = req.session.user;
    if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });
    db.all("SELECT d.id, u.name, d.specialty FROM doctors d JOIN users u ON d.user_id = u.id", (err, doctors) => {
        db.get("SELECT COUNT(*) as count FROM users WHERE role = 'patient'", (err, patients) => {
            db.get("SELECT COUNT(*) as count FROM appointments", (err, appointments) => {
                res.json({ doctors, totalPatients: patients.count, totalAppointments: appointments.count });
            });
        });
    });
});

app.post('/add-doctor', (req, res) => {
    const { name, email, specialty } = req.body;
    const user = req.session.user;
    if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });
    const hashed = bcrypt.hashSync('defaultpass', 10);
    db.run("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)", [name, email, hashed, 'doctor'], function(err) {
        if (err) return res.status(400).json({ error: 'Email exists' });
        db.run("INSERT INTO doctors (user_id, specialty, schedule) VALUES (?, ?, ?)", [this.lastID, specialty, '{}']);
        res.json({ message: 'Doctor added' });
    });
});

app.delete('/remove-doctor/:doctorId', (req, res) => {
    const { doctorId } = req.params;
    const user = req.session.user;
    if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });
    db.run("DELETE FROM doctors WHERE id = ?", [doctorId]);
    res.json({ message: 'Doctor removed' });
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});