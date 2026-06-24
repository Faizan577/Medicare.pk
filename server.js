const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const session = require('express-session');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const { sendEmail } = require('./emailService');

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
    // Enable foreign keys
    db.run("PRAGMA foreign_keys = ON");

    db.run(`CREATE TABLE IF NOT EXISTS users (
        user_id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT NOT NULL,
        phone TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS doctors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS appointments (
        appointment_id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        doctor_id INTEGER NOT NULL,
        appointment_date TEXT NOT NULL,
        status TEXT DEFAULT 'scheduled',
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
        FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS tokens (
        token_id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        doctor_id INTEGER NOT NULL,
        token_number TEXT NOT NULL,
        emergency BOOLEAN DEFAULT 0,
        entered_at TEXT DEFAULT CURRENT_TIMESTAMP,
        position INTEGER,
        queue_status TEXT DEFAULT 'waiting',
        called_at TEXT,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
        FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE
    )`);

    // Migration: add called_at column if it doesn't exist
    db.run("ALTER TABLE tokens ADD COLUMN called_at TEXT", (err) => {
        if (err && !err.message.includes('duplicate column')) {
            console.error('Migration error (called_at):', err.message);
        }
    });

    db.run(`CREATE TABLE IF NOT EXISTS reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        doctor_id INTEGER NOT NULL,
        rating INTEGER NOT NULL,
        comment TEXT,
        review_date TEXT,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
        FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS hospital_reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hospital_name TEXT NOT NULL,
        reviewer_name TEXT NOT NULL,
        rating REAL NOT NULL,
        feedback TEXT,
        emergency_service_rating REAL,
        staff_behavior_rating REAL,
        cleanliness_rating REAL,
        overall_experience_rating REAL,
        review_date TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS notifications (
        notification_id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        message TEXT NOT NULL,
        status TEXT DEFAULT 'unread',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )`);

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
        completed_at TEXT,
        FOREIGN KEY (patient_id) REFERENCES users(user_id) ON DELETE CASCADE,
        FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS prescriptions (
        prescription_id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS follow_ups (
        followup_id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    )`);

    // Seed hospital reviews
    seedHospitalReviews();

    // Seed mock doctor profiles & patient accounts
    seedMockData();

    // Seed default admin and doctor profiles
    db.get("SELECT COUNT(*) as count FROM users WHERE email = 'admin@example.com'", (err, row) => {
        if (row && row.count === 0) {
            const hashed = bcrypt.hashSync('admin', 10);
            db.run("INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)", ['Admin', 'admin@example.com', hashed, 'admin']);
        }
    });

    db.get("SELECT COUNT(*) as count FROM users WHERE email = 'patient@example.com'", (err, row) => {
        if (row && row.count === 0) {
            const hashed = bcrypt.hashSync('patient', 10);
            db.run("INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)", ['John Doe', 'patient@example.com', hashed, 'patient']);
        }
    });

    db.get("SELECT user_id FROM users WHERE email = 'doctor@example.com'", (err, userRow) => {
        if (err) return console.error(err);
        if (!userRow) {
            const hashed = bcrypt.hashSync('doctor', 10);
            db.run("INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)", ['Dr. Smith', 'doctor@example.com', hashed, 'doctor'], function() {
                db.run("INSERT INTO doctors (user_id, specialty, schedule, qualification, experience_years, available_timing, consultation_fee, hospital_name, hospital_rating, hospital_emergency, hospital_pharmacy, hospital_laboratory, hospital_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", 
                    [this.lastID, 'General Medicine', '{}', 'MBBS, FCPS', 10, '09:00 AM - 12:00 PM', 800, 'City Health Clinic', 4.3, 1, 1, 0, '12 Main Street, Sector G-6']);
            });
        } else {
            const userId = userRow.user_id;
            db.get("SELECT id FROM doctors WHERE user_id = ?", [userId], (err, docRow) => {
                if (err) return console.error(err);
                if (!docRow) {
                    db.run("INSERT INTO doctors (user_id, specialty, schedule, qualification, experience_years, available_timing, consultation_fee, hospital_name, hospital_rating, hospital_emergency, hospital_pharmacy, hospital_laboratory, hospital_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", 
                        [userId, 'General Medicine', '{}', 'MBBS, FCPS', 10, '09:00 AM - 12:00 PM', 800, 'City Health Clinic', 4.3, 1, 1, 0, '12 Main Street, Sector G-6']);
                }
            });
        }
    });
});

// Seed data definition and helper
function seedMockData() {
    const seedDoctors = [
        {
            name: "Dr. Sarah Jenkins",
            email: "sarah.cardiology@medicare.pk",
            specialty: "Cardiology",
            qualification: "MBBS, MD Cardiology (Stanford)",
            experience_years: 12,
            available_timing: "09:00 AM - 01:00 PM",
            consultation_fee: 1500,
            profile_picture: "https://images.unsplash.com/photo-1559839734-2b71ea197ec2?auto=format&fit=crop&q=80&w=300",
            hospital_name: "Metro Heart & Vascular Center",
            hospital_rating: 4.8,
            hospital_emergency: 1,
            hospital_pharmacy: 1,
            hospital_laboratory: 1,
            hospital_address: "Block A, North Medical Drive, Sector G-9",
            reviews: [
                { rating: 5, comment: "Excellent cardiologist. Checked my father thoroughly and explained everything very calmly.", review_date: "2026-05-15" },
                { rating: 4, comment: "Very professional doctor, though the clinic was a bit crowded.", review_date: "2026-05-20" },
                { rating: 5, comment: "Saved my life during emergency care. Extremely grateful!", review_date: "2026-06-01" }
            ]
        },
        {
            name: "Dr. Robert Chen",
            email: "robert.neurology@medicare.pk",
            specialty: "Neurology",
            qualification: "MD Neurology, Ph.D. (Johns Hopkins)",
            experience_years: 18,
            available_timing: "02:00 PM - 05:00 PM",
            consultation_fee: 2500,
            profile_picture: "https://images.unsplash.com/photo-1622253692010-333f2da6031d?auto=format&fit=crop&q=80&w=300",
            hospital_name: "Brain & Spine Neurological Hospital",
            hospital_rating: 4.9,
            hospital_emergency: 1,
            hospital_pharmacy: 1,
            hospital_laboratory: 0,
            hospital_address: "88 Neuro Avenue, Sector F-7",
            reviews: [
                { rating: 5, comment: "The absolute best neurologist in the city. Her diagnosis was perfect.", review_date: "2026-05-10" },
                { rating: 5, comment: "Very detailed consultation. Answered all my complex questions.", review_date: "2026-05-28" }
            ]
        },
        {
            name: "Dr. Emily Stone",
            email: "emily.orthopedics@medicare.pk",
            specialty: "Orthopedics",
            qualification: "MS Orthopedic Surgery (UK)",
            experience_years: 10,
            available_timing: "11:00 AM - 03:00 PM",
            consultation_fee: 1800,
            profile_picture: "https://images.unsplash.com/photo-1594824813573-246434de83fb?auto=format&fit=crop&q=80&w=300",
            hospital_name: "Bone & Joint Specialty Clinic",
            hospital_rating: 4.5,
            hospital_emergency: 0,
            hospital_pharmacy: 1,
            hospital_laboratory: 1,
            hospital_address: "12 Orthopedic Way, Phase 5 DHA",
            reviews: [
                { rating: 4, comment: "Very skilled surgeon. Treated my knee pain effectively.", review_date: "2026-05-12" },
                { rating: 5, comment: "Very kind doctor. Hospital has excellent physical therapy department.", review_date: "2026-06-03" }
            ]
        },
        {
            name: "Dr. Alan Turing",
            email: "alan.dermatology@medicare.pk",
            specialty: "Dermatology",
            qualification: "MD, Board Certified Dermatologist",
            experience_years: 8,
            available_timing: "04:00 PM - 07:00 PM",
            consultation_fee: 1200,
            profile_picture: "https://images.unsplash.com/photo-1612349317150-e413f6a5b16d?auto=format&fit=crop&q=80&w=300",
            hospital_name: "Skin & Laser Aesthetics Clinic",
            hospital_rating: 4.3,
            hospital_emergency: 0,
            hospital_pharmacy: 1,
            hospital_laboratory: 0,
            hospital_address: "Plot 34, Sector E-11, Main Double Road",
            reviews: [
                { rating: 4, comment: "My acne is completely gone. Thank you Dr. Alan!", review_date: "2026-05-18" },
                { rating: 5, comment: "Top class treatment, and very clean clinic.", review_date: "2026-05-30" }
            ]
        },
        {
            name: "Dr. Maria Watson",
            email: "maria.gynecology@medicare.pk",
            specialty: "Gynecology",
            qualification: "MBBS, FCPS (OB/GYN)",
            experience_years: 15,
            available_timing: "10:00 AM - 02:00 PM",
            consultation_fee: 2000,
            profile_picture: "https://images.unsplash.com/photo-1527613426441-4da17471b66d?auto=format&fit=crop&q=80&w=300",
            hospital_name: "Cradle & Care Maternity Hospital",
            hospital_rating: 4.7,
            hospital_emergency: 1,
            hospital_pharmacy: 1,
            hospital_laboratory: 1,
            hospital_address: "55 Maternity Drive, Sector H-8",
            reviews: [
                { rating: 5, comment: "Wonderful doctor. Highly experienced and put me at complete ease.", review_date: "2026-05-22" },
                { rating: 5, comment: "Best gynecological care in Islamabad. Excellent facility.", review_date: "2026-06-04" }
            ]
        },
        {
            name: "Dr. Bruce Banner",
            email: "bruce.pediatrics@medicare.pk",
            specialty: "Pediatrics",
            qualification: "MD Pediatrics, FCPS",
            experience_years: 11,
            available_timing: "01:00 PM - 05:00 PM",
            consultation_fee: 1000,
            profile_picture: "https://images.unsplash.com/photo-1537368910025-700350fe46c7?auto=format&fit=crop&q=80&w=300",
            hospital_name: "Children's Health & Vaccine Clinic",
            hospital_rating: 4.6,
            hospital_emergency: 1,
            hospital_pharmacy: 1,
            hospital_laboratory: 1,
            hospital_address: "101 Kids Way, Sector I-8/4",
            reviews: [
                { rating: 4, comment: "Great pediatrician, kids love him. Very friendly.", review_date: "2026-05-25" },
                { rating: 5, comment: "Extremely competent. Diagnosed my daughter's chest infection accurately.", review_date: "2026-06-02" }
            ]
        },
        {
            name: "Dr. Clark Kent",
            email: "clark.ent@medicare.pk",
            specialty: "ENT",
            qualification: "MS Otolaryngology",
            experience_years: 9,
            available_timing: "03:00 PM - 06:00 PM",
            consultation_fee: 1300,
            profile_picture: "https://images.unsplash.com/photo-1637059824899-a441006a6875?auto=format&fit=crop&q=80&w=300",
            hospital_name: "General & ENT Specialist Clinic",
            hospital_rating: 4.2,
            hospital_emergency: 0,
            hospital_pharmacy: 1,
            hospital_laboratory: 1,
            hospital_address: "Block C, Blue Area, Jinnah Avenue",
            reviews: [
                { rating: 4, comment: "Treated my sinus problem perfectly. Very helpful doctor.", review_date: "2026-05-19" },
                { rating: 3, comment: "Consultation was good, but had to wait 30 mins even with appointment.", review_date: "2026-05-24" }
            ]
        },
        {
            name: "Dr. John Watson",
            email: "john.medicine@medicare.pk",
            specialty: "General Medicine",
            qualification: "MBBS, FCPS, Internal Medicine",
            experience_years: 14,
            available_timing: "08:00 AM - 12:00 PM",
            consultation_fee: 1000,
            profile_picture: "https://images.unsplash.com/photo-1614608682850-e0d6ed316d47?auto=format&fit=crop&q=80&w=300",
            hospital_name: "MediCare General Clinic",
            hospital_rating: 4.5,
            hospital_emergency: 1,
            hospital_pharmacy: 1,
            hospital_laboratory: 1,
            hospital_address: "32 Metropolis Boulevard, Sector G-11",
            reviews: [
                { rating: 5, comment: "Excellent family doctor. Very polite and knowledgeable.", review_date: "2026-05-26" },
                { rating: 4, comment: "Good diagnosis, followed up with call to check on recovery.", review_date: "2026-06-05" }
            ]
        }
    ];

    seedDoctors.forEach((doc) => {
        db.get("SELECT user_id FROM users WHERE email = ?", [doc.email], (err, userRow) => {
            if (err) return console.error(err);
            if (!userRow) {
                const hashed = bcrypt.hashSync('doctor', 10);
                db.run("INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)", [doc.name, doc.email, hashed, 'doctor'], function(insErr) {
                    if (insErr) return console.error("Error seeding doctor user:", insErr);
                    const userId = this.lastID;
                    db.run(`INSERT INTO doctors (
                        user_id, specialty, schedule, qualification, experience_years, available_timing, consultation_fee, 
                        profile_picture, hospital_name, hospital_rating, hospital_emergency, hospital_pharmacy, hospital_laboratory, hospital_address
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
                        userId, doc.specialty, '{}', doc.qualification, doc.experience_years, doc.available_timing, doc.consultation_fee,
                        doc.profile_picture, doc.hospital_name, doc.hospital_rating, doc.hospital_emergency, doc.hospital_pharmacy, doc.hospital_laboratory, doc.hospital_address
                    ], function(docInsErr) {
                        if (docInsErr) return console.error("Error seeding doctor profile:", docInsErr);
                        const doctorId = this.lastID;
                        doc.reviews.forEach(rev => {
                            db.run("INSERT INTO reviews (user_id, doctor_id, rating, comment, review_date) VALUES (?, ?, ?, ?, ?)", [
                                1, doctorId, rev.rating, rev.comment, rev.review_date
                            ]);
                        });
                    });
                });
            }
        });
    });
}

function seedHospitalReviews() {
    db.get("SELECT COUNT(*) as count FROM hospital_reviews", (err, row) => {
        if (row && row.count === 0) {
            const reviews = [
                {
                    hospital_name: "Metro Heart & Vascular Center",
                    reviewer_name: "Ahmad Malik",
                    rating: 4.8,
                    feedback: "Outstanding cardiology care. The staff behavior is highly professional, and they have top-notch cleanliness.",
                    emergency_service_rating: 5.0,
                    staff_behavior_rating: 4.5,
                    cleanliness_rating: 5.0,
                    overall_experience_rating: 4.8,
                    review_date: "2026-05-18"
                },
                {
                    hospital_name: "Metro Heart & Vascular Center",
                    reviewer_name: "Sana Farooq",
                    rating: 4.5,
                    feedback: "The cleanliness and emergency response are great. Staff is generally helpful, though queue times are long.",
                    emergency_service_rating: 4.5,
                    staff_behavior_rating: 4.0,
                    cleanliness_rating: 4.8,
                    overall_experience_rating: 4.5,
                    review_date: "2026-06-02"
                },
                {
                    hospital_name: "Brain & Spine Neurological Hospital",
                    reviewer_name: "Hamza Tariq",
                    rating: 4.9,
                    feedback: "World-class brain surgery and neurological care. Extremely clean facility and very polite staff.",
                    emergency_service_rating: 5.0,
                    staff_behavior_rating: 5.0,
                    cleanliness_rating: 4.9,
                    overall_experience_rating: 4.9,
                    review_date: "2026-05-22"
                },
                {
                    hospital_name: "Brain & Spine Neurological Hospital",
                    reviewer_name: "Maria Bibi",
                    rating: 4.7,
                    feedback: "Very supportive staff during patient admission. Cleanliness is up to standards.",
                    emergency_service_rating: 4.5,
                    staff_behavior_rating: 4.8,
                    cleanliness_rating: 4.7,
                    overall_experience_rating: 4.7,
                    review_date: "2026-05-30"
                },
                {
                    hospital_name: "Bone & Joint Specialty Clinic",
                    reviewer_name: "Yasir Khan",
                    rating: 4.4,
                    feedback: "Great orthopedic doctors. The emergency facility is smaller but clean, and staff is cooperative.",
                    emergency_service_rating: 4.0,
                    staff_behavior_rating: 4.5,
                    cleanliness_rating: 4.5,
                    overall_experience_rating: 4.4,
                    review_date: "2026-06-01"
                },
                {
                    hospital_name: "Skin & Laser Aesthetics Clinic",
                    reviewer_name: "Kiran Shah",
                    rating: 4.3,
                    feedback: "Modern aesthetic equipment and clean environment. Behavior of front-desk staff could be improved.",
                    emergency_service_rating: 3.5,
                    staff_behavior_rating: 4.0,
                    cleanliness_rating: 4.7,
                    overall_experience_rating: 4.3,
                    review_date: "2026-05-15"
                },
                {
                    hospital_name: "Cradle & Care Maternity Hospital",
                    reviewer_name: "Ayesha Gill",
                    rating: 4.8,
                    feedback: "Warm and welcoming staff, very clean and comfortable rooms. Highly recommended for maternal care.",
                    emergency_service_rating: 5.0,
                    staff_behavior_rating: 4.8,
                    cleanliness_rating: 4.9,
                    overall_experience_rating: 4.8,
                    review_date: "2026-05-25"
                },
                {
                    hospital_name: "Children's Health & Vaccine Clinic",
                    reviewer_name: "Omer Sheikh",
                    rating: 4.6,
                    feedback: "Excellent pediatric care and vaccinations. Child-friendly play area, clean and well-maintained.",
                    emergency_service_rating: 4.5,
                    staff_behavior_rating: 4.5,
                    cleanliness_rating: 4.7,
                    overall_experience_rating: 4.6,
                    review_date: "2026-06-03"
                },
                {
                    hospital_name: "General & ENT Specialist Clinic",
                    reviewer_name: "Zainab Ali",
                    rating: 4.1,
                    feedback: "Decent facilities, clean premises. The staff is busy and wait times can be substantial.",
                    emergency_service_rating: 3.8,
                    staff_behavior_rating: 3.9,
                    cleanliness_rating: 4.3,
                    overall_experience_rating: 4.1,
                    review_date: "2026-05-20"
                },
                {
                    hospital_name: "MediCare General Clinic",
                    reviewer_name: "Sadia Mumtaz",
                    rating: 4.5,
                    feedback: "Very good general practice and family medicine clinic. Clean rooms and helpful staff.",
                    emergency_service_rating: 4.2,
                    staff_behavior_rating: 4.5,
                    cleanliness_rating: 4.6,
                    overall_experience_rating: 4.5,
                    review_date: "2026-06-05"
                },
                {
                    hospital_name: "City Health Clinic",
                    reviewer_name: "Bilal Ahmed",
                    rating: 4.2,
                    feedback: "Good primary healthcare. Staff behavior is reasonable, clinic is clean and well-lit.",
                    emergency_service_rating: 4.0,
                    staff_behavior_rating: 4.1,
                    cleanliness_rating: 4.3,
                    overall_experience_rating: 4.2,
                    review_date: "2026-05-29"
                }
            ];

            const stmt = db.prepare(`INSERT INTO hospital_reviews (
                hospital_name, reviewer_name, rating, feedback, 
                emergency_service_rating, staff_behavior_rating, 
                cleanliness_rating, overall_experience_rating, review_date
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);

            reviews.forEach(r => {
                stmt.run([
                    r.hospital_name, r.reviewer_name, r.rating, r.feedback,
                    r.emergency_service_rating, r.staff_behavior_rating,
                    r.cleanliness_rating, r.overall_experience_rating, r.review_date
                ]);
            });
            stmt.finalize();
            console.log("Seeded hospital reviews.");
        }
    });
}

// Helper functions
const generateToken = () => `T${Date.now().toString().slice(-6)}`;
const calculateWaitTime = (position) => position * 10; // 10 min per patient

const updateQueuePositions = (doctorId, callback) => {
    db.all("SELECT token_id FROM tokens WHERE doctor_id = ? AND queue_status = 'waiting' ORDER BY entered_at ASC", [doctorId], (err, rows) => {
        if (err) return callback(err);
        if (rows.length === 0) return callback();
        let completedCalls = 0;
        rows.forEach((row, index) => {
            db.run("UPDATE tokens SET position = ? WHERE token_id = ?", [index + 1, row.token_id], () => {
                completedCalls++;
                if (completedCalls === rows.length) {
                    callback();
                }
            });
        });
    });
};

// ---- Grace Period Timer System ----
// Tracks in-memory timers for called tokens: { tokenId -> timeoutHandle }
const graceTimers = {};
const GRACE_PERIOD_MS = 5 * 60 * 1000; // 5 minutes

function startGraceTimer(tokenId, doctorId, patientUserId, tokenNumber) {
    // Cancel any existing timer for this token
    cancelGraceTimer(tokenId);

    const handle = setTimeout(() => {
        delete graceTimers[tokenId];

        // Only act if still in 'called' status
        db.get("SELECT queue_status, user_id FROM tokens WHERE token_id = ?", [tokenId], (err, row) => {
            if (err || !row || row.queue_status !== 'called') return;

            // Auto-transition: called -> late (move to end of waiting queue)
            db.get("SELECT MAX(position) as maxPos FROM tokens WHERE doctor_id = ? AND queue_status = 'waiting'",
                [doctorId], (err2, posRow) => {
                    const newPos = (posRow && posRow.maxPos) ? posRow.maxPos + 1 : 1;
                    const now = new Date().toISOString();

                    db.run(`UPDATE tokens SET queue_status = 'late', position = ?, entered_at = ?, called_at = NULL WHERE token_id = ?`,
                        [newPos, now, tokenId], (updErr) => {
                            if (updErr) return console.error('Grace timer update error:', updErr.message);

                            updateQueuePositions(doctorId, () => {});

                            // Notify patient they missed their turn
                            const notifMsg = `⚠️ You missed your turn for Token ${tokenNumber}. You have been placed at the end of the queue. Please report to the reception to rejoin.`;
                            db.run("INSERT INTO notifications (user_id, message) VALUES (?, ?)", [patientUserId, notifMsg]);

                            // Send email
                            db.get("SELECT name, email FROM users WHERE user_id = ?", [patientUserId], (err3, user) => {
                                if (user && user.email) {
                                    sendEmail(user.email, 'MediCare: Missed Turn — Auto Rejoined Queue',
                                        `Hello ${user.name},\n\nYour token ${tokenNumber} grace period has expired and you missed your turn.\n\nYou have been automatically moved to the end of the waiting queue with status 'Late'.\n\nPlease return to the hospital and inform the admin to rejoin the queue.\n\nThank you,\nMediCare Team`);
                                }
                            });

                            console.log(`[Grace Timer] Token ${tokenNumber} (ID: ${tokenId}) auto-transitioned to 'late'`);
                        });
                });
        });
    }, GRACE_PERIOD_MS);

    graceTimers[tokenId] = handle;
    console.log(`[Grace Timer] Started for Token ${tokenNumber} (ID: ${tokenId}), expires in 5 minutes`);
}

function cancelGraceTimer(tokenId) {
    if (graceTimers[tokenId]) {
        clearTimeout(graceTimers[tokenId]);
        delete graceTimers[tokenId];
    }
}

// Authentication middleware
function authorize(req, res, next) {
    const authHeader = req.headers.authorization;
    const sessionUser = req.session && req.session.user;

    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        try {
            const payload = jwt.verify(token, SECRET_KEY);
            db.get('SELECT user_id, name, email, role, phone FROM users WHERE user_id = ?', [payload.id], (err, user) => {
                if (err || !user) return res.status(401).json({ error: 'Unauthorized' });
                req.user = {
                    id: user.user_id,
                    user_id: user.user_id,
                    name: user.name,
                    email: user.email,
                    role: user.role,
                    phone: user.phone
                };
                next();
            });
        } catch (err) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        return;
    }

    if (sessionUser) {
        req.user = sessionUser;
        return next();
    }

    return res.status(401).json({ error: 'Unauthorized' });
}

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/register', (req, res) => {
    const { name, email, password, role, phone, specialty } = req.body;
    const hashed = bcrypt.hashSync(password, 10);
    db.run("INSERT INTO users (name, email, password, role, phone) VALUES (?, ?, ?, ?, ?)", [name, email, hashed, role, phone], function(err) {
        if (err) return res.status(400).json({ error: 'Email already exists' });
        const userId = this.lastID;
        if (role === 'doctor') {
            db.run("INSERT INTO doctors (user_id, specialty, schedule) VALUES (?, ?, ?)", [userId, specialty, '{}']);
        }
        const token = jwt.sign({ id: userId, role }, SECRET_KEY, { expiresIn: '8h' });
        req.session.user = { id: userId, user_id: userId, name, email, role };
        res.json({ message: 'Registration successful', token, user: { id: userId, user_id: userId, name, email, role } });
    });
});

app.post('/login', (req, res) => {
    const { email, password } = req.body;
    db.get("SELECT * FROM users WHERE email = ?", [email], (err, user) => {
        if (!user || !bcrypt.compareSync(password, user.password)) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        const token = jwt.sign({ id: user.user_id, role: user.role }, SECRET_KEY, { expiresIn: '8h' });
        req.session.user = { id: user.user_id, user_id: user.user_id, name: user.name, email: user.email, role: user.role };
        res.json({ token, user: { id: user.user_id, user_id: user.user_id, name: user.name, email: user.email, role: user.role } });
    });
});

app.post('/logout', (req, res) => {
    if (req.session) {
        req.session.destroy((err) => {
            if (err) return res.status(500).json({ error: 'Failed to logout' });
            res.json({ message: 'Logout successful' });
        });
    } else {
        res.json({ message: 'Logout successful' });
    }
});

app.post('/book-appointment', authorize, (req, res) => {
    const { doctorId, dateTime } = req.body;
    const user = req.user;
    if (!user || user.role !== 'patient') return res.status(403).json({ error: 'Unauthorized' });
    db.run("INSERT INTO appointments (user_id, doctor_id, appointment_date) VALUES (?, ?, ?)", [user.user_id, doctorId, dateTime], function(err) {
        if (err) return res.status(400).json({ error: 'Booking failed' });
        
        const apptId = this.lastID;
        
        // Fetch doctor details and send confirmation email & notification
        db.get("SELECT u.name as doctorName FROM doctors d JOIN users u ON d.user_id = u.user_id WHERE d.id = ?", [doctorId], (err, doctor) => {
            if (doctor) {
                const formattedDate = new Date(dateTime).toLocaleString('en-US', {
                    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
                    hour: '2-digit', minute: '2-digit'
                });
                
                const notifMsg = `Appointment confirmed with ${doctor.doctorName} on ${formattedDate}.`;
                db.run("INSERT INTO notifications (user_id, message) VALUES (?, ?)", [user.user_id, notifMsg]);

                if (user.email) {
                    const subject = 'MediCare: Appointment Confirmed';
                    const message = `Hello ${user.name},\n\nWe are pleased to confirm your upcoming appointment at MediCare.\n\n📌 Appointment Details:\n👨‍⚕️ Doctor: ${doctor.doctorName}\n📅 Date & Time: ${formattedDate}\n\nPlease try to arrive 10 minutes prior to your scheduled time. If you need to reschedule, please use your patient dashboard.\n\nThank you for trusting MediCare for your health needs!\n\nBest Regards,\nThe MediCare Team`;
                    sendEmail(user.email, subject, message);
                }
            }
        });

        res.json({ message: 'Appointment booked successfully', appointmentId: apptId });
    });
});

app.get('/hospitals', (req, res) => {
    const query = `
        SELECT DISTINCT 
            hospital_name,
            hospital_address,
            hospital_rating,
            hospital_emergency,
            hospital_pharmacy,
            hospital_laboratory
        FROM doctors
        WHERE hospital_name IS NOT NULL AND hospital_name != ''
    `;
    db.all(query, (err, rows) => {
        if (err) return res.status(500).json({ error: 'Failed to fetch hospitals: ' + err.message });
        res.json(rows);
    });
});

app.get('/hospitals/:name/departments', (req, res) => {
    const hospitalName = req.params.name;
    db.all("SELECT DISTINCT specialty FROM doctors WHERE hospital_name = ?", [hospitalName], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Failed to fetch departments: ' + err.message });
        res.json(rows.map(r => r.specialty));
    });
});

app.get('/hospitals/:name/reviews', (req, res) => {
    const hospitalName = req.params.name;
    db.all("SELECT id, reviewer_name, rating, feedback, emergency_service_rating, staff_behavior_rating, cleanliness_rating, overall_experience_rating, review_date FROM hospital_reviews WHERE hospital_name = ? ORDER BY review_date DESC", [hospitalName], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Failed to fetch hospital reviews: ' + err.message });
        res.json(rows || []);
    });
});

app.post('/join-queue', authorize, (req, res) => {
    const { doctorId, emergency } = req.body;
    const user = req.user;
    if (!user || user.role !== 'patient') return res.status(403).json({ error: 'Unauthorized' });

    // Check if already in queue (active/waiting) for this doctor
    db.get("SELECT token_number FROM tokens WHERE user_id = ? AND doctor_id = ? AND queue_status IN ('waiting', 'active')", [user.user_id, doctorId], (err, existing) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        if (existing) {
            return res.status(400).json({ error: `You already have an active token (${existing.token_number}) for this doctor.` });
        }

        // Count today's queue entries to generate sequential token
        db.get("SELECT COUNT(*) as count FROM tokens WHERE doctor_id = ? AND date(entered_at) = date('now')", [doctorId], (err, row) => {
            if (err) return res.status(500).json({ error: 'Failed to count queue entries' });
            
            const count = row ? row.count : 0;
            const token = String(count + 1).padStart(2, '0');

            db.run("INSERT INTO tokens (user_id, doctor_id, token_number, emergency, queue_status) VALUES (?, ?, ?, ?, 'waiting')", 
                [user.user_id, doctorId, token, 0], function(insErr) {
                if (insErr) return res.status(400).json({ error: 'Failed to join queue' });
                
                const tokenId = this.lastID;
                updateQueuePositions(doctorId, () => {
                    const detailQuery = `
                        SELECT 
                            t.token_number,
                            u_doc.name as doctor_name,
                            d.hospital_name,
                            d.specialty,
                            t.position,
                            t.entered_at
                        FROM tokens t
                        JOIN doctors d ON t.doctor_id = d.id
                        JOIN users u_doc ON d.user_id = u_doc.user_id
                        WHERE t.token_id = ?
                    `;
                    db.get(detailQuery, [tokenId], (err, details) => {
                        if (err || !details) return res.status(500).json({ error: 'Failed to fetch queue details' });

                        const patientsBefore = details.position - 1;
                        const waitTime = patientsBefore * 5; // 5 mins per waiting patient

                        const notifMsg = `Token ${details.token_number} generated for ${details.doctor_name}. Position: ${details.position}.`;
                        db.run("INSERT INTO notifications (user_id, message) VALUES (?, ?)", [user.user_id, notifMsg]);

                        if (user.email) {
                            sendEmail(user.email, 'MediCare: Token Booked Successfully', 
                                `Hello ${user.name},\n\nYour token ${details.token_number} for ${details.doctor_name} at ${details.hospital_name} is booked successfully!\n\nEstimated wait time: ${waitTime} mins.\nQueue Position: ${details.position}\n\nThank you for using MediCare.`);
                        }

                        res.json({
                            message: 'Joined queue successfully',
                            token: details.token_number,
                            doctorName: details.doctor_name,
                            hospitalName: details.hospital_name,
                            department: details.specialty,
                            date: new Date(details.entered_at).toLocaleDateString(),
                            time: new Date(details.entered_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                            position: details.position,
                            waitTime: waitTime
                        });
                    });
                });
            });
        });
    });
});

app.post('/rejoin-queue', authorize, (req, res) => {
    const { tokenId } = req.body;
    const user = req.user;
    if (!user || user.role !== 'patient') return res.status(403).json({ error: 'Unauthorized' });

    db.get("SELECT * FROM tokens WHERE token_id = ? AND user_id = ?", [tokenId, user.user_id], (err, token) => {
        if (err || !token) return res.status(404).json({ error: 'Token not found' });
        
        // Find max position of waiting tokens
        db.get("SELECT MAX(position) as maxPos FROM tokens WHERE doctor_id = ? AND queue_status = 'waiting'", [token.doctor_id], (err, row) => {
            if (err) return res.status(500).json({ error: 'Database error' });
            
            const newPosition = (row && row.maxPos) ? row.maxPos + 1 : 1;
            
            // Set queue_status to waiting, update position, and update entered_at to current time
            db.run("UPDATE tokens SET queue_status = 'waiting', position = ?, entered_at = CURRENT_TIMESTAMP WHERE token_id = ?", 
                [newPosition, tokenId], (updErr) => {
                if (updErr) return res.status(500).json({ error: 'Failed to rejoin queue' });
                
                updateQueuePositions(token.doctor_id, () => {
                    const detailQuery = `
                        SELECT 
                            t.token_number,
                            u_doc.name as doctor_name,
                            d.hospital_name,
                            d.specialty,
                            t.position,
                            t.entered_at
                        FROM tokens t
                        JOIN doctors d ON t.doctor_id = d.id
                        JOIN users u_doc ON d.user_id = u_doc.user_id
                        WHERE t.token_id = ?
                    `;
                    db.get(detailQuery, [tokenId], (err, details) => {
                        if (err || !details) return res.status(500).json({ error: 'Failed to fetch details' });
                        
                        const patientsBefore = details.position - 1;
                        const waitTime = patientsBefore * 5;
                        
                        const notifMsg = `Token ${details.token_number} rejoined queue for ${details.doctor_name}. Position: ${details.position}.`;
                        db.run("INSERT INTO notifications (user_id, message) VALUES (?, ?)", [user.user_id, notifMsg]);
                        
                        res.json({
                            message: 'Rejoined queue successfully',
                            token: details.token_number,
                            doctorName: details.doctor_name,
                            hospitalName: details.hospital_name,
                            department: details.specialty,
                            position: details.position,
                            waitTime: waitTime
                        });
                    });
                });
            });
        });
    });
});

app.get('/queue-status', authorize, (req, res) => {
    const user = req.user;
    if (!user || user.role !== 'patient') return res.status(403).json({ error: 'Unauthorized' });

    // Check for active, waiting, called, or late tokens
    db.get(`SELECT token_id, doctor_id, token_number, queue_status, position, called_at
            FROM tokens
            WHERE user_id = ? AND queue_status IN ('waiting', 'active', 'called', 'late')
            ORDER BY entered_at DESC LIMIT 1`, [user.user_id], (err, activeRow) => {
        if (err) return res.status(500).json({ error: 'Database error' });

        if (activeRow) {
            if (activeRow.queue_status === 'called') {
                return res.json({
                    position: activeRow.position,
                    status: 'Called',
                    token: activeRow.token_number,
                    doctorId: activeRow.doctor_id,
                    tokenId: activeRow.token_id,
                    calledAt: activeRow.called_at,
                    waitTime: 0
                });
            }
            if (activeRow.queue_status === 'late') {
                return res.json({
                    position: activeRow.position,
                    status: 'Late',
                    token: activeRow.token_number,
                    doctorId: activeRow.doctor_id,
                    tokenId: activeRow.token_id,
                    canRejoin: true,
                    waitTime: 0
                });
            }
            const waitTime = activeRow.queue_status === 'active' ? 0 : (activeRow.position - 1) * 5;
            return res.json({
                position: activeRow.position,
                status: activeRow.queue_status === 'active' ? 'In Progress' : 'Waiting',
                token: activeRow.token_number,
                doctorId: activeRow.doctor_id,
                tokenId: activeRow.token_id,
                waitTime
            });
        }

        // Find most recent completed/cancelled token today
        db.get(`
            SELECT t.token_id, t.doctor_id, t.token_number, t.queue_status, u_doc.name as doctor_name, d.hospital_name
            FROM tokens t 
            JOIN doctors d ON t.doctor_id = d.id
            JOIN users u_doc ON d.user_id = u_doc.user_id
            WHERE t.user_id = ? AND t.queue_status IN ('completed', 'cancelled') AND date(t.entered_at) = date('now')
            ORDER BY t.entered_at DESC LIMIT 1
        `, [user.user_id], (err, recentRow) => {
            if (err) return res.status(500).json({ error: 'Database error' });

            if (recentRow) {
                return res.json({
                    position: null,
                    status: recentRow.queue_status === 'completed' ? 'Completed' : 'Cancelled',
                    token: recentRow.token_number,
                    doctorId: recentRow.doctor_id,
                    tokenId: recentRow.token_id,
                    doctorName: recentRow.doctor_name,
                    hospitalName: recentRow.hospital_name,
                    canRejoin: false
                });
            }

            res.json({ position: null, doctorId: null });
        });
    });
});

app.get('/doctors/:id/live-queue', authorize, (req, res) => {
    const doctorId = req.params.id;
    const user = req.user;

    // Get doctor info
    db.get("SELECT u.name, d.available_timing, d.hospital_name FROM doctors d JOIN users u ON d.user_id = u.user_id WHERE d.id = ?", [doctorId], (err, doctorInfo) => {
        if (err || !doctorInfo) return res.status(404).json({ error: 'Doctor not found' });

        // Get all active or waiting queue entries
        db.all(`
            SELECT t.token_id, t.token_number, t.emergency, t.queue_status, t.position, t.user_id, u.name as patient_name
            FROM tokens t
            JOIN users u ON t.user_id = u.user_id
            WHERE t.doctor_id = ? AND t.queue_status IN ('active', 'waiting')
            ORDER BY t.queue_status ASC, t.position ASC
        `, [doctorId], (err, queueItems) => {
            if (err) return res.status(500).json({ error: 'Failed to fetch queue: ' + err.message });

            const activeItem = queueItems.find(item => item.queue_status === 'active');
            const waitingItems = queueItems.filter(item => item.queue_status === 'waiting');
            const nextItem = waitingItems[0];

            const currentActiveToken = activeItem ? activeItem.token_number : 'None';
            const nextToken = nextItem ? nextItem.token_number : 'None';

            // Find user's status in queue
            const userItem = queueItems.find(item => item.user_id === user.user_id);
            let userToken = 'None';
            let userPosition = null;
            let patientsBefore = 0;
            let waitTime = 0;
            let userStatus = 'Not in Queue';

            if (userItem) {
                userToken = userItem.token_number;
                userStatus = userItem.queue_status === 'active' ? 'In Progress' : 'Waiting';
                userPosition = userItem.position;
                if (userItem.queue_status === 'waiting') {
                    const idx = waitingItems.findIndex(item => item.token_id === userItem.token_id);
                    patientsBefore = idx;
                    waitTime = patientsBefore * 5; // 5 mins per patient
                } else {
                    patientsBefore = 0;
                    waitTime = 0;
                }
            }

            const emergencyPriorityActive = 0;

            res.json({
                doctorName: doctorInfo.name,
                hospitalName: doctorInfo.hospital_name,
                availableTiming: doctorInfo.available_timing,
                currentActiveToken,
                nextToken,
                userToken,
                userPosition,
                patientsBefore,
                waitTime,
                userStatus,
                emergencyPriorityActive,
                queue: queueItems.map(item => ({
                    token: item.token_number,
                    status: item.queue_status,
                    emergency: 0,
                    isUser: item.user_id === user.user_id
                }))
            });
        });
    });
});

app.get('/doctors', (req, res) => {
    const { hospital, department } = req.query;
    let query = `
        SELECT d.id, d.user_id, u.name, d.specialty, d.schedule, d.qualification, d.experience_years, 
               d.available_timing, d.consultation_fee, d.profile_picture, d.hospital_name, d.hospital_rating, 
               d.hospital_emergency, d.hospital_pharmacy, d.hospital_laboratory, d.hospital_address,
               COALESCE(avg_r.avg_rating, 0) AS rating,
               COALESCE(avg_r.total_reviews, 0) AS total_reviews
        FROM doctors d
        JOIN users u ON d.user_id = u.user_id
        LEFT JOIN (
            SELECT doctor_id, AVG(rating) AS avg_rating, COUNT(id) AS total_reviews
            FROM reviews
            GROUP BY doctor_id
        ) avg_r ON d.id = avg_r.doctor_id
        WHERE 1=1
    `;
    const params = [];
    if (hospital) {
        query += " AND d.hospital_name = ?";
        params.push(hospital);
    }
    if (department) {
        query += " AND d.specialty = ?";
        params.push(department);
    }
    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: 'Failed to fetch doctors: ' + err.message });
        res.json(rows);
    });
});

app.get('/doctors/:id/reviews', (req, res) => {
    const doctorId = req.params.id;
    db.all(`
        SELECT r.id, u.name as reviewer_name, r.rating, r.comment, r.review_date 
        FROM reviews r 
        JOIN users u ON r.user_id = u.user_id 
        WHERE r.doctor_id = ? 
        ORDER BY r.review_date DESC
    `, [doctorId], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Failed to fetch reviews: ' + err.message });
        res.json(rows || []);
    });
});

app.get('/doctor-dashboard', authorize, (req, res) => {
    const user = req.user;
    if (!user || user.role !== 'doctor') return res.status(403).json({ error: 'Unauthorized' });
    db.get("SELECT id FROM doctors WHERE user_id = ?", [user.user_id], (err, doctor) => {
        if (err || !doctor) return res.status(404).json({ error: 'Doctor profile not found' });
        
        db.all(`
            SELECT t.token_id as id, t.token_number as token, u.name, t.emergency, t.position, t.queue_status as status 
            FROM tokens t 
            JOIN users u ON t.user_id = u.user_id 
            WHERE t.doctor_id = ? AND t.queue_status IN ('active', 'waiting') 
            ORDER BY t.queue_status ASC, t.position ASC
        `, [doctor.id], (err, queues) => {
            db.all(`
                SELECT a.appointment_id as id, u.name, a.appointment_date as date_time 
                FROM appointments a 
                JOIN users u ON a.user_id = u.user_id 
                WHERE a.doctor_id = ? AND a.status = 'scheduled'
            `, [doctor.id], (err, appointments) => {
                res.json({ queues: queues || [], appointments: appointments || [] });
            });
        });
    });
});

app.post('/call-next/:queueId', authorize, (req, res) => {
    const { queueId } = req.params;
    const user = req.user;
    if (!user || user.role !== 'doctor') return res.status(403).json({ error: 'Unauthorized' });
    db.get("SELECT doctor_id, user_id, queue_status FROM tokens WHERE token_id = ?", [queueId], (err, queue) => {
        if (!queue) return res.status(404).json({ error: 'Queue entry not found' });
        db.get("SELECT id, user_id FROM doctors WHERE id = ?", [queue.doctor_id], (err, doctor) => {
            if (err || !doctor || doctor.user_id !== user.user_id) {
                return res.status(403).json({ error: 'Unauthorized' });
            }

            // Mark any currently active/called patient as completed (if they weren't already handled)
            db.run("UPDATE tokens SET queue_status = 'completed', position = NULL WHERE doctor_id = ? AND queue_status = 'active'", [doctor.id], (updErr) => {
                if (updErr) console.error("Error setting previous active to completed:", updErr.message);

                // Set selected patient to 'called' (grace period begins)
                const calledAt = new Date().toISOString();
                db.run("UPDATE tokens SET queue_status = 'called', called_at = ?, position = NULL WHERE token_id = ?",
                    [calledAt, queueId], (activeErr) => {
                    if (activeErr) return res.status(500).json({ error: 'Failed to call patient' });

                    // Recalculate remaining waiting patient positions
                    updateQueuePositions(doctor.id, () => {
                        // Notify next-in-line patient (position 1 now, since called is removed)
                        db.get(`
                            SELECT t.position, u.email, u.name, u.user_id
                            FROM tokens t
                            JOIN users u ON t.user_id = u.user_id
                            WHERE t.doctor_id = ? AND t.queue_status = 'waiting' AND t.position = 1
                        `, [doctor.id], (err, nextPatient) => {
                            if (nextPatient) {
                                const notifMsg = `Get ready! You are next in line. Your turn is coming up very soon — please stay nearby.`;
                                db.run("INSERT INTO notifications (user_id, message) VALUES (?, ?)", [nextPatient.user_id, notifMsg]);
                                if (nextPatient.email) {
                                    sendEmail(nextPatient.email, 'MediCare Alert: You Are Next!',
                                        `Hello ${nextPatient.name},\n\nYou are now next in the queue! Please be near the clinic area.`);
                                }
                            }
                        });

                        // Notify the called patient — urgent grace period notice
                        db.get(`
                            SELECT u.user_id, u.name, u.email, t.token_number
                            FROM tokens t
                            JOIN users u ON t.user_id = u.user_id
                            WHERE t.token_id = ?
                        `, [queueId], (err, calledPat) => {
                            if (calledPat) {
                                const notifMsg = `🔔 Your turn has arrived! Token ${calledPat.token_number} is being called. Please report to the doctor's room within 5 minutes.`;
                                db.run("INSERT INTO notifications (user_id, message) VALUES (?, ?)", [calledPat.user_id, notifMsg]);
                                if (calledPat.email) {
                                    sendEmail(calledPat.email, 'MediCare: Your Turn Has Arrived!',
                                        `Hello ${calledPat.name},\n\nYour token ${calledPat.token_number} is now being called by the doctor.\n\n⚠️ Please report to the doctor's room within 5 minutes or your turn may be given to the next patient.\n\nThank you,\nMediCare Team`);
                                }
                            }
                        });

                        res.json({ message: 'Patient called successfully', calledAt });
                    });
                });
            });
        });
    });
});

// Mark patient as present (arrived within grace period)
app.post('/mark-patient-present/:queueId', authorize, (req, res) => {
    const { queueId } = req.params;
    const user = req.user;
    if (!user || (user.role !== 'doctor' && user.role !== 'admin')) return res.status(403).json({ error: 'Unauthorized' });

    db.get("SELECT doctor_id, user_id, token_number FROM tokens WHERE token_id = ? AND queue_status = 'called'", [queueId], (err, token) => {
        if (err || !token) return res.status(404).json({ error: 'No called token found' });

        db.get("SELECT id, user_id FROM doctors WHERE id = ?", [token.doctor_id], (err, doctor) => {
            if (err || !doctor) return res.status(404).json({ error: 'Doctor not found' });
            if (user.role !== 'admin' && doctor.user_id !== user.user_id) return res.status(403).json({ error: 'Unauthorized' });

            // Cancel grace timer if running (patient arrived in person)
            cancelGraceTimer(parseInt(queueId));

            db.run("UPDATE tokens SET queue_status = 'active', position = NULL WHERE token_id = ?", [queueId], (updErr) => {
                if (updErr) return res.status(500).json({ error: 'Failed to mark patient as present' });

                // Notify patient
                db.get("SELECT u.user_id, u.name, u.email FROM tokens t JOIN users u ON t.user_id = u.user_id WHERE t.token_id = ?", [queueId], (err, pat) => {
                    if (pat) {
                        const notifMsg = `✅ You have been marked as present for Token ${token.token_number}. Your consultation will begin shortly.`;
                        db.run("INSERT INTO notifications (user_id, message) VALUES (?, ?)", [pat.user_id, notifMsg]);
                    }
                });

                updateQueuePositions(doctor.id, () => {
                    res.json({ message: 'Patient marked as present and set to active' });
                });
            });
        });
    });
});

// Mark patient as late (missed grace period) — auto-rejoin at end of queue
app.post('/mark-patient-late/:queueId', authorize, (req, res) => {
    const { queueId } = req.params;
    const user = req.user;
    if (!user || (user.role !== 'doctor' && user.role !== 'admin')) return res.status(403).json({ error: 'Unauthorized' });

    db.get("SELECT doctor_id, user_id, token_number FROM tokens WHERE token_id = ? AND queue_status IN ('called', 'waiting')", [queueId], (err, token) => {
        if (err || !token) return res.status(404).json({ error: 'Token not found or not in callable state' });

        db.get("SELECT id, user_id FROM doctors WHERE id = ?", [token.doctor_id], (err, doctor) => {
            if (err || !doctor) return res.status(404).json({ error: 'Doctor not found' });
            if (user.role !== 'admin' && doctor.user_id !== user.user_id) return res.status(403).json({ error: 'Unauthorized' });

            // Find the max position among waiting tokens (to place this patient at the end)
            db.get("SELECT MAX(position) as maxPos FROM tokens WHERE doctor_id = ? AND queue_status = 'waiting'", [doctor.id], (err, row) => {
                const newPos = (row && row.maxPos) ? row.maxPos + 1 : 1;
                const now = new Date().toISOString();

                // Cancel any running grace timer
                cancelGraceTimer(parseInt(queueId));

                // Mark as late, move to end of queue (update entered_at so ordering puts them last)
                db.run(`UPDATE tokens SET queue_status = 'late', position = ?, entered_at = ?, called_at = NULL
                        WHERE token_id = ?`, [newPos, now, queueId], (updErr) => {
                    if (updErr) return res.status(500).json({ error: 'Failed to mark patient late' });

                    // Notify the patient
                    db.get("SELECT u.user_id, u.name, u.email FROM tokens t JOIN users u ON t.user_id = u.user_id WHERE t.token_id = ?", [queueId], (err, pat) => {
                        if (pat) {
                            const notifMsg = `⚠️ You missed your turn for Token ${token.token_number}. You have been moved to the end of the waiting queue. Please check your queue position.`;
                            db.run("INSERT INTO notifications (user_id, message) VALUES (?, ?)", [pat.user_id, notifMsg]);
                            if (pat.email) {
                                sendEmail(pat.email, 'MediCare: Missed Turn — Rejoined Queue',
                                    `Hello ${pat.name},\n\nUnfortunately you missed your turn for Token ${token.token_number}.\n\nYou have been automatically moved to the end of the waiting queue. Please check your MediCare dashboard for your new position.\n\nThank you,\nMediCare Team`);
                            }
                        }
                    });

                    updateQueuePositions(doctor.id, () => {
                        // Notify doctor of the next available waiting patient
                        db.get(`SELECT t.token_id, t.token_number, u.name as patient_name
                                FROM tokens t JOIN users u ON t.user_id = u.user_id
                                WHERE t.doctor_id = ? AND t.queue_status = 'waiting'
                                ORDER BY t.position ASC LIMIT 1`, [doctor.id], (err, nextPat) => {
                            res.json({
                                message: 'Patient marked as late and moved to end of queue',
                                nextAvailable: nextPat ? { tokenId: nextPat.token_id, tokenNumber: nextPat.token_number, name: nextPat.patient_name } : null
                            });
                        });
                    });
                });
            });
        });
    });
});

app.post('/complete-visit/:queueId', authorize, (req, res) => {
    const { queueId } = req.params;
    const user = req.user;
    if (!user || user.role !== 'doctor') return res.status(403).json({ error: 'Unauthorized' });

    db.get("SELECT doctor_id, user_id, token_number FROM tokens WHERE token_id = ?", [queueId], (err, queue) => {
        if (!queue) return res.status(404).json({ error: 'Queue entry not found' });
        db.get("SELECT id, user_id FROM doctors WHERE id = ?", [queue.doctor_id], (err, doctor) => {
            if (err || !doctor || doctor.user_id !== user.user_id) {
                return res.status(403).json({ error: 'Unauthorized' });
            }

            db.run("UPDATE tokens SET queue_status = 'completed', position = NULL WHERE token_id = ?", [queueId], (updErr) => {
                if (updErr) return res.status(500).json({ error: 'Failed to complete visit' });

                const notifMsg = `Your consultation for Token ${queue.token_number} has been completed. Thank you for choosing MediCare.`;
                db.run("INSERT INTO notifications (user_id, message) VALUES (?, ?)", [queue.user_id, notifMsg]);

                res.json({ message: 'Patient visit completed' });
            });
        });
    });
});

app.post('/complete-appointment/:apptId', authorize, (req, res) => {
    const { apptId } = req.params;
    const user = req.user;
    if (!user || user.role !== 'doctor') return res.status(403).json({ error: 'Unauthorized' });
    
    db.get("SELECT user_id, doctor_id, appointment_date FROM appointments WHERE appointment_id = ?", [apptId], (err, appt) => {
        if (appt) {
            db.run("UPDATE appointments SET status = 'completed' WHERE appointment_id = ? AND doctor_id IN (SELECT id FROM doctors WHERE user_id = ?)", [apptId, user.user_id], function(updErr) {
                if (!updErr) {
                    const notifMsg = `Your appointment on ${appt.appointment_date} has been marked as completed.`;
                    db.run("INSERT INTO notifications (user_id, message) VALUES (?, ?)", [appt.user_id, notifMsg]);
                }
                res.json({ message: 'Appointment completed' });
            });
        } else {
            res.status(404).json({ error: 'Appointment not found' });
        }
    });
});

app.get('/admin-dashboard', authorize, (req, res) => {
    const user = req.user;
    if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });
    db.all("SELECT d.id, u.name, d.specialty FROM doctors d JOIN users u ON d.user_id = u.user_id", (err, doctors) => {
        db.get("SELECT COUNT(*) as count FROM users WHERE role = 'patient'", (err, patients) => {
            db.get("SELECT COUNT(*) as count FROM appointments", (err, appointments) => {
                res.json({ doctors, totalPatients: patients.count, totalAppointments: appointments.count });
            });
        });
    });
});

app.post('/add-doctor', authorize, (req, res) => {
    const { name, email, specialty } = req.body;
    const user = req.user;
    if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });
    const hashed = bcrypt.hashSync('defaultpass', 10);
    db.run("INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)", [name, email, hashed, 'doctor'], function(err) {
        if (err) return res.status(400).json({ error: 'Email exists' });
        db.run("INSERT INTO doctors (user_id, specialty, schedule) VALUES (?, ?, ?)", [this.lastID, specialty, '{}']);
        res.json({ message: 'Doctor added' });
    });
});

app.delete('/remove-doctor/:doctorId', authorize, (req, res) => {
    const { doctorId } = req.params;
    const user = req.user;
    if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });
    
    // First find the user_id associated with this doctor
    db.get("SELECT user_id FROM doctors WHERE id = ?", [doctorId], (err, doctor) => {
        if (doctor) {
            db.run("DELETE FROM doctors WHERE id = ?", [doctorId], () => {
                db.run("DELETE FROM users WHERE user_id = ?", [doctor.user_id]);
            });
        }
    });
    res.json({ message: 'Doctor removed' });
});

app.get('/profile', authorize, (req, res) => {
    const user = req.user;
    if (user.role === 'doctor') {
        db.get("SELECT u.name, u.email, u.phone, d.specialty FROM users u JOIN doctors d ON u.user_id = d.user_id WHERE u.user_id = ?", [user.user_id], (err, row) => {
            if (err || !row) return res.status(404).json({ error: 'Profile not found' });
            res.json(row);
        });
    } else {
        db.get("SELECT name, email, phone FROM users WHERE user_id = ?", [user.user_id], (err, row) => {
            if (err || !row) return res.status(404).json({ error: 'Profile not found' });
            res.json(row);
        });
    }
});

app.put('/profile', authorize, (req, res) => {
    const user = req.user;
    const { name, phone, specialty } = req.body;
    db.run("UPDATE users SET name = ?, phone = ? WHERE user_id = ?", [name, phone, user.user_id], function(err) {
        if (err) return res.status(500).json({ error: 'Failed to update profile' });
        
        if (user.role === 'doctor' && specialty) {
            db.run("UPDATE doctors SET specialty = ? WHERE user_id = ?", [specialty, user.user_id], (err) => {
                if (err) return res.status(500).json({ error: 'Failed to update specialty' });
                res.json({ message: 'Profile updated successfully' });
            });
        } else {
            res.json({ message: 'Profile updated successfully' });
        }
    });
});

app.post('/leave-queue', authorize, (req, res) => {
    const user = req.user;
    if (!user || user.role !== 'patient') return res.status(403).json({ error: 'Unauthorized' });
    
    // Find patient's active or waiting queue entry
    db.get("SELECT token_id, doctor_id, token_number FROM tokens WHERE user_id = ? AND queue_status IN ('waiting', 'active')", [user.user_id], (err, row) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        if (!row) return res.status(404).json({ error: 'Active queue entry not found' });
        
        db.run("DELETE FROM tokens WHERE token_id = ?", [row.token_id], (delErr) => {
            if (delErr) return res.status(500).json({ error: 'Failed to leave queue' });
            
            const notifMsg = `You left the queue for Token ${row.token_number}.`;
            db.run("INSERT INTO notifications (user_id, message) VALUES (?, ?)", [user.user_id, notifMsg]);

            updateQueuePositions(row.doctor_id, () => {
                res.json({ message: 'Left queue successfully' });
            });
        });
    });
});

// User-specific dashboard history endpoints
app.get('/my-appointments', authorize, (req, res) => {
    const user = req.user;
    if (!user || user.role !== 'patient') return res.status(403).json({ error: 'Unauthorized' });
    db.all(`
        SELECT a.appointment_id, a.doctor_id, u_doc.name as doctor_name, d.hospital_name, d.specialty, a.appointment_date, a.status
        FROM appointments a
        JOIN doctors d ON a.doctor_id = d.id
        JOIN users u_doc ON d.user_id = u_doc.user_id
        WHERE a.user_id = ?
        ORDER BY a.appointment_date DESC
    `, [user.user_id], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Database error: ' + err.message });
        res.json(rows || []);
    });
});

app.get('/my-tokens', authorize, (req, res) => {
    const user = req.user;
    if (!user || user.role !== 'patient') return res.status(403).json({ error: 'Unauthorized' });
    db.all(`
        SELECT t.token_id, t.doctor_id, u_doc.name as doctor_name, d.hospital_name, d.specialty, t.token_number, t.queue_status, t.entered_at, t.position
        FROM tokens t
        JOIN doctors d ON t.doctor_id = d.id
        JOIN users u_doc ON d.user_id = u_doc.user_id
        WHERE t.user_id = ?
        ORDER BY t.entered_at DESC
    `, [user.user_id], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Database error: ' + err.message });
        const processed = (rows || []).map(r => {
            const waitTime = r.queue_status === 'active' ? 0 : (r.position - 1) * 5;
            return {
                token_id: r.token_id,
                doctor_id: r.doctor_id,
                doctor_name: r.doctor_name,
                hospital_name: r.hospital_name,
                specialty: r.specialty,
                token_number: r.token_number,
                queue_status: r.queue_status,
                entered_at: r.entered_at,
                position: r.position,
                waitTime
            };
        });
        res.json(processed);
    });
});

app.get('/my-reviews', authorize, (req, res) => {
    const user = req.user;
    if (!user || user.role !== 'patient') return res.status(403).json({ error: 'Unauthorized' });
    db.all(`
        SELECT r.id as review_id, r.doctor_id, u_doc.name as doctor_name, d.specialty, r.rating, r.comment, r.review_date
        FROM reviews r
        JOIN doctors d ON r.doctor_id = d.id
        JOIN users u_doc ON d.user_id = u_doc.user_id
        WHERE r.user_id = ?
        ORDER BY r.review_date DESC
    `, [user.user_id], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Database error: ' + err.message });
        res.json(rows || []);
    });
});

app.post('/submit-review', authorize, (req, res) => {
    const user = req.user;
    if (!user || user.role !== 'patient') return res.status(403).json({ error: 'Unauthorized' });
    const { doctorId, rating, comment } = req.body;
    const reviewDate = new Date().toISOString().split('T')[0];
    db.run(`
        INSERT INTO reviews (user_id, doctor_id, rating, comment, review_date)
        VALUES (?, ?, ?, ?, ?)
    `, [user.user_id, doctorId, rating, comment, reviewDate], function(err) {
        if (err) return res.status(400).json({ error: 'Failed to submit review: ' + err.message });
        
        const revId = this.lastID;
        const notifMsg = `You submitted a review for your consultation. Thank you for your feedback!`;
        db.run("INSERT INTO notifications (user_id, message) VALUES (?, ?)", [user.user_id, notifMsg]);

        res.json({ message: 'Review submitted successfully', reviewId: revId });
    });
});

app.delete('/my-reviews/:id', authorize, (req, res) => {
    const user = req.user;
    if (!user || user.role !== 'patient') return res.status(403).json({ error: 'Unauthorized' });
    db.run(`
        DELETE FROM reviews WHERE id = ? AND user_id = ?
    `, [req.params.id, user.user_id], function(err) {
        if (err) return res.status(500).json({ error: 'Failed to delete review' });
        if (this.changes === 0) return res.status(404).json({ error: 'Review not found or unauthorized' });
        res.json({ message: 'Review deleted successfully' });
    });
});

app.get('/my-notifications', authorize, (req, res) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    db.all(`
        SELECT notification_id, message, status, created_at
        FROM notifications
        WHERE user_id = ?
        ORDER BY created_at DESC
    `, [user.user_id], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Database error: ' + err.message });
        res.json(rows || []);
    });
});

app.put('/my-notifications/:id/read', authorize, (req, res) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    db.run(`
        UPDATE notifications SET status = 'read' WHERE notification_id = ? AND user_id = ?
    `, [req.params.id, user.user_id], function(err) {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json({ message: 'Notification marked as read' });
    });
});

app.delete('/my-notifications/:id', authorize, (req, res) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    db.run(`
        DELETE FROM notifications WHERE notification_id = ? AND user_id = ?
    `, [req.params.id, user.user_id], function(err) {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json({ message: 'Notification dismissed' });
    });
});

// ============================================================
// DOCTOR PANEL - Enhanced Consultation Workflow
// ============================================================

// Get today's patients for doctor (tokens + upcoming appointments)
app.get('/doctor-today', authorize, (req, res) => {
    const user = req.user;
    if (!user || user.role !== 'doctor') return res.status(403).json({ error: 'Unauthorized' });
    db.get("SELECT id FROM doctors WHERE user_id = ?", [user.user_id], (err, doctor) => {
        if (err || !doctor) return res.status(404).json({ error: 'Doctor profile not found' });

        const today = new Date().toISOString().split('T')[0];

        // Fetch today's tokens
        db.all(`
            SELECT t.token_id, t.token_number, u.name as patient_name, u.user_id as patient_id,
                   u.phone, t.emergency, t.queue_status, t.entered_at, t.position, t.called_at,
                   'token' as type
            FROM tokens t
            JOIN users u ON t.user_id = u.user_id
            WHERE t.doctor_id = ? AND date(t.entered_at) = ?
            ORDER BY t.queue_status ASC, t.position ASC, t.entered_at ASC
        `, [doctor.id, today], (err, tokens) => {
            // Fetch ALL upcoming appointments (today + future, not cancelled/completed)
            db.all(`
                SELECT a.appointment_id, a.appointment_date, u.name as patient_name, u.user_id as patient_id,
                       u.phone, a.status, 'appointment' as type
                FROM appointments a
                JOIN users u ON a.user_id = u.user_id
                WHERE a.doctor_id = ?
                  AND a.status NOT IN ('cancelled', 'completed')
                  AND date(a.appointment_date) >= ?
                ORDER BY a.appointment_date ASC
            `, [doctor.id, today], (err, appointments) => {
                // Fetch active consultation if any
                db.get(`SELECT * FROM consultations WHERE doctor_id = ? AND status = 'in_progress'`, [doctor.id], (err, activeConsultation) => {
                    res.json({
                        tokens: tokens || [],
                        appointments: appointments || [],
                        activeConsultation: activeConsultation || null,
                        doctorId: doctor.id
                    });
                });
            });
        });
    });
});

// Get full patient profile for doctor view
app.get('/patient-profile/:patientId', authorize, (req, res) => {
    const user = req.user;
    if (!user || (user.role !== 'doctor' && user.role !== 'admin')) return res.status(403).json({ error: 'Unauthorized' });
    const patientId = req.params.patientId;

    db.get("SELECT user_id, name, email, phone FROM users WHERE user_id = ? AND role = 'patient'", [patientId], (err, patient) => {
        if (err || !patient) return res.status(404).json({ error: 'Patient not found' });

        // Past consultations
        db.all(`
            SELECT c.consultation_id, c.symptoms, c.diagnosis, c.recommendations, c.notes,
                   c.status, c.created_at, c.completed_at, c.consultation_type,
                   u_doc.name as doctor_name, d.specialty
            FROM consultations c
            JOIN doctors d ON c.doctor_id = d.id
            JOIN users u_doc ON d.user_id = u_doc.user_id
            WHERE c.patient_id = ? AND c.status = 'completed'
            ORDER BY c.completed_at DESC
        `, [patientId], (err, consultations) => {

            // Past prescriptions
            db.all(`
                SELECT p.prescription_id, p.medicine_name, p.dosage, p.duration, p.instructions,
                       p.created_at, u_doc.name as doctor_name, c.diagnosis
                FROM prescriptions p
                JOIN consultations c ON p.consultation_id = c.consultation_id
                JOIN doctors d ON p.doctor_id = d.id
                JOIN users u_doc ON d.user_id = u_doc.user_id
                WHERE p.patient_id = ?
                ORDER BY p.created_at DESC
            `, [patientId], (err, prescriptions) => {

                res.json({
                    patient,
                    consultations: consultations || [],
                    prescriptions: prescriptions || []
                });
            });
        });
    });
});

// Start consultation
app.post('/consultation/start', authorize, (req, res) => {
    const user = req.user;
    if (!user || user.role !== 'doctor') return res.status(403).json({ error: 'Unauthorized' });
    const { patientId, tokenId, appointmentId, consultationType } = req.body;

    db.get("SELECT id FROM doctors WHERE user_id = ?", [user.user_id], (err, doctor) => {
        if (err || !doctor) return res.status(404).json({ error: 'Doctor profile not found' });

        // Check if there's already an in-progress consultation for this doctor
        db.get("SELECT * FROM consultations WHERE doctor_id = ? AND status = 'in_progress'", [doctor.id], (err, existing) => {
            if (existing) {
                // If it's for the SAME patient — resume (return the existing ID)
                if (existing.patient_id === parseInt(patientId)) {
                    return res.json({
                        message: 'Resuming existing consultation',
                        consultationId: existing.consultation_id,
                        resumed: true
                    });
                }
                // Different patient — block
                return res.status(400).json({ error: 'You already have an active consultation for a different patient. Please complete it first.' });
            }

            // Set token to active if token-based
            const proceed = (cb) => {
                if (tokenId) {
                    db.run("UPDATE tokens SET queue_status = 'active' WHERE token_id = ? AND doctor_id = ?", [tokenId, doctor.id], cb);
                } else {
                    cb();
                }
            };

            proceed(() => {
                db.run(`INSERT INTO consultations (patient_id, doctor_id, token_id, appointment_id, consultation_type, status)
                        VALUES (?, ?, ?, ?, ?, 'in_progress')`,
                    [patientId, doctor.id, tokenId || null, appointmentId || null, consultationType || 'token'],
                    function(insErr) {
                        if (insErr) return res.status(500).json({ error: 'Failed to start consultation' });

                        // Notify patient
                        const notifMsg = `Your consultation has started. Please proceed to the doctor's room.`;
                        db.run("INSERT INTO notifications (user_id, message) VALUES (?, ?)", [patientId, notifMsg]);

                        res.json({ message: 'Consultation started', consultationId: this.lastID });
                    }
                );
            });
        });
    });
});


// Complete consultation — save notes, prescriptions, update statuses
app.post('/consultation/complete', authorize, (req, res) => {
    const user = req.user;
    if (!user || user.role !== 'doctor') return res.status(403).json({ error: 'Unauthorized' });
    const { consultationId, symptoms, diagnosis, recommendations, notes, medicines, tokenId, appointmentId, patientId } = req.body;

    db.get("SELECT id FROM doctors WHERE user_id = ?", [user.user_id], (err, doctor) => {
        if (err || !doctor) return res.status(404).json({ error: 'Doctor profile not found' });

        const completedAt = new Date().toISOString();

        // Update consultation record
        db.run(`UPDATE consultations SET symptoms = ?, diagnosis = ?, recommendations = ?, notes = ?,
                status = 'completed', completed_at = ? WHERE consultation_id = ? AND doctor_id = ?`,
            [symptoms, diagnosis, recommendations, notes, completedAt, consultationId, doctor.id],
            (updErr) => {
                if (updErr) return res.status(500).json({ error: 'Failed to save consultation notes' });

                // Save prescriptions
                const savePrescriptions = (cb) => {
                    if (!medicines || medicines.length === 0) return cb();
                    let saved = 0;
                    medicines.forEach(med => {
                        db.run(`INSERT INTO prescriptions (consultation_id, patient_id, doctor_id, medicine_name, dosage, duration, instructions)
                                VALUES (?, ?, ?, ?, ?, ?, ?)`,
                            [consultationId, patientId, doctor.id, med.name, med.dosage, med.duration, med.instructions],
                            () => { saved++; if (saved === medicines.length) cb(); }
                        );
                    });
                };

                savePrescriptions(() => {
                    // Mark token/appointment as completed
                    if (tokenId) {
                        db.run("UPDATE tokens SET queue_status = 'completed', position = NULL WHERE token_id = ?", [tokenId]);
                        // Update queue positions
                        updateQueuePositions(doctor.id, () => {});
                    }
                    if (appointmentId) {
                        db.run("UPDATE appointments SET status = 'completed' WHERE appointment_id = ?", [appointmentId]);
                    }

                    // Notify patient
                    const notifMsg = `Your consultation has been completed. Your prescription and notes have been saved. Check your dashboard for details.`;
                    db.run("INSERT INTO notifications (user_id, message) VALUES (?, ?)", [patientId, notifMsg]);

                    res.json({ message: 'Consultation completed successfully' });
                });
            }
        );
    });
});

// Cancel consultation
app.post('/consultation/cancel', authorize, (req, res) => {
    const user = req.user;
    if (!user || user.role !== 'doctor') return res.status(403).json({ error: 'Unauthorized' });
    const { consultationId, tokenId, patientId } = req.body;

    db.get("SELECT id FROM doctors WHERE user_id = ?", [user.user_id], (err, doctor) => {
        if (err || !doctor) return res.status(404).json({ error: 'Doctor profile not found' });

        db.run("UPDATE consultations SET status = 'cancelled' WHERE consultation_id = ? AND doctor_id = ?",
            [consultationId, doctor.id], (updErr) => {
                if (updErr) return res.status(500).json({ error: 'Failed to cancel consultation' });

                if (tokenId) {
                    db.run("UPDATE tokens SET queue_status = 'waiting', position = NULL WHERE token_id = ?", [tokenId]);
                    updateQueuePositions(doctor.id, () => {});
                }

                if (patientId) {
                    const notifMsg = `Your consultation has been cancelled. Please re-join the queue or contact reception.`;
                    db.run("INSERT INTO notifications (user_id, message) VALUES (?, ?)", [patientId, notifMsg]);
                }

                res.json({ message: 'Consultation cancelled' });
            }
        );
    });
});

// Schedule follow-up
app.post('/follow-up', authorize, (req, res) => {
    const user = req.user;
    if (!user || user.role !== 'doctor') return res.status(403).json({ error: 'Unauthorized' });
    const { consultationId, patientId, followupDate, notes } = req.body;

    db.get("SELECT id FROM doctors WHERE user_id = ?", [user.user_id], (err, doctor) => {
        if (err || !doctor) return res.status(404).json({ error: 'Doctor profile not found' });

        db.run(`INSERT INTO follow_ups (consultation_id, patient_id, doctor_id, followup_date, notes)
                VALUES (?, ?, ?, ?, ?)`,
            [consultationId, patientId, doctor.id, followupDate, notes || ''],
            function(insErr) {
                if (insErr) return res.status(500).json({ error: 'Failed to schedule follow-up' });

                const formattedDate = new Date(followupDate).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
                const notifMsg = `Your doctor has recommended a follow-up visit on ${formattedDate}.`;
                db.run("INSERT INTO notifications (user_id, message) VALUES (?, ?)", [patientId, notifMsg]);

                res.json({ message: 'Follow-up scheduled successfully', followupId: this.lastID });
            }
        );
    });
});

// Get consultation details (for doctor to resume editing before completion)
app.get('/consultation/:id', authorize, (req, res) => {
    const user = req.user;
    if (!user || user.role !== 'doctor') return res.status(403).json({ error: 'Unauthorized' });

    db.get("SELECT id FROM doctors WHERE user_id = ?", [user.user_id], (err, doctor) => {
        if (err || !doctor) return res.status(404).json({ error: 'Doctor not found' });

        db.get(`SELECT * FROM consultations WHERE consultation_id = ? AND doctor_id = ?`,
            [req.params.id, doctor.id], (err, consultation) => {
                if (err || !consultation) return res.status(404).json({ error: 'Consultation not found' });

                db.all(`SELECT * FROM prescriptions WHERE consultation_id = ?`, [req.params.id], (err, prescriptions) => {
                    res.json({ consultation, prescriptions: prescriptions || [] });
                });
            }
        );
    });
});

// ============================================================
// PATIENT - Prescriptions, Consultations, Follow-ups
// ============================================================

app.get('/my-prescriptions', authorize, (req, res) => {
    const user = req.user;
    if (!user || user.role !== 'patient') return res.status(403).json({ error: 'Unauthorized' });

    db.all(`
        SELECT p.prescription_id, p.medicine_name, p.dosage, p.duration, p.instructions, p.created_at,
               u_doc.name as doctor_name, d.specialty, c.diagnosis, c.consultation_id
        FROM prescriptions p
        JOIN consultations c ON p.consultation_id = c.consultation_id
        JOIN doctors d ON p.doctor_id = d.id
        JOIN users u_doc ON d.user_id = u_doc.user_id
        WHERE p.patient_id = ?
        ORDER BY p.created_at DESC
    `, [user.user_id], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json(rows || []);
    });
});

app.get('/my-consultations', authorize, (req, res) => {
    const user = req.user;
    if (!user || user.role !== 'patient') return res.status(403).json({ error: 'Unauthorized' });

    db.all(`
        SELECT c.consultation_id, c.symptoms, c.diagnosis, c.recommendations, c.notes,
               c.status, c.created_at, c.completed_at, c.consultation_type,
               u_doc.name as doctor_name, d.specialty, d.hospital_name
        FROM consultations c
        JOIN doctors d ON c.doctor_id = d.id
        JOIN users u_doc ON d.user_id = u_doc.user_id
        WHERE c.patient_id = ? AND c.status = 'completed'
        ORDER BY c.completed_at DESC
    `, [user.user_id], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json(rows || []);
    });
});

app.get('/my-followups', authorize, (req, res) => {
    const user = req.user;
    if (!user || user.role !== 'patient') return res.status(403).json({ error: 'Unauthorized' });

    db.all(`
        SELECT f.followup_id, f.followup_date, f.notes, f.status, f.created_at,
               u_doc.name as doctor_name, d.specialty, c.diagnosis
        FROM follow_ups f
        JOIN doctors d ON f.doctor_id = d.id
        JOIN users u_doc ON d.user_id = u_doc.user_id
        JOIN consultations c ON f.consultation_id = c.consultation_id
        WHERE f.patient_id = ?
        ORDER BY f.followup_date ASC
    `, [user.user_id], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json(rows || []);
    });
});

// ============================================================
// ADMIN - Enhanced Queue, Appointment, Doctor Management
// ============================================================

// Get all active tokens queue for admin
app.get('/admin-queue', authorize, (req, res) => {
    const user = req.user;
    if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });

    db.all(`
        SELECT t.token_id, t.token_number, t.queue_status, t.position, t.emergency, t.entered_at, t.called_at,
               u.name as patient_name, u.user_id as patient_id, u.phone as patient_phone,
               u_doc.name as doctor_name, d.id as doctor_id, d.specialty, d.hospital_name
        FROM tokens t
        JOIN users u ON t.user_id = u.user_id
        JOIN doctors d ON t.doctor_id = d.id
        JOIN users u_doc ON d.user_id = u_doc.user_id
        WHERE t.queue_status IN ('waiting', 'active', 'called', 'late')
        ORDER BY d.id ASC, t.queue_status DESC, t.position ASC
    `, [], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Failed to fetch queue: ' + err.message });
        res.json(rows || []);
    });
});

// Admin: Call next patient (by specific token or auto next) — starts 5-min grace period
app.post('/admin/call-next', authorize, (req, res) => {
    const user = req.user;
    if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });
    const { tokenId } = req.body;

    db.get("SELECT token_id, doctor_id, user_id, token_number, queue_status FROM tokens WHERE token_id = ?", [tokenId], (err, token) => {
        if (err || !token) return res.status(404).json({ error: 'Token not found' });
        if (!['waiting', 'late'].includes(token.queue_status)) {
            return res.status(400).json({ error: 'Token is not in a callable state' });
        }

        // Cancel any existing called token for this doctor and move it to late
        db.all("SELECT token_id, user_id, token_number FROM tokens WHERE doctor_id = ? AND queue_status = 'called'",
            [token.doctor_id], (err2, calledTokens) => {
                (calledTokens || []).forEach(ct => {
                    cancelGraceTimer(ct.token_id);
                    db.get("SELECT MAX(position) as maxPos FROM tokens WHERE doctor_id = ? AND queue_status = 'waiting'",
                        [token.doctor_id], (e3, posRow) => {
                            const np = (posRow && posRow.maxPos) ? posRow.maxPos + 1 : 1;
                            db.run("UPDATE tokens SET queue_status = 'late', position = ?, entered_at = CURRENT_TIMESTAMP, called_at = NULL WHERE token_id = ?",
                                [np, ct.token_id]);
                        });
                });

                // Set the selected token to 'called' with grace period timestamp
                const calledAt = new Date().toISOString();
                db.run("UPDATE tokens SET queue_status = 'called', called_at = ?, position = NULL WHERE token_id = ?",
                    [calledAt, tokenId], (updErr) => {
                        if (updErr) return res.status(500).json({ error: 'Failed to call patient' });

                        // Start 5-minute grace period server timer
                        startGraceTimer(token.token_id, token.doctor_id, token.user_id, token.token_number);

                        updateQueuePositions(token.doctor_id, () => {
                            // Notify the called patient
                            const notifMsg = `🔔 Your turn has arrived! Token ${token.token_number} is being called. Please report to the doctor's room within 5 minutes or your spot may be given to the next patient.`;
                            db.run("INSERT INTO notifications (user_id, message) VALUES (?, ?)", [token.user_id, notifMsg]);

                            // Send email notification
                            db.get("SELECT name, email FROM users WHERE user_id = ?", [token.user_id], (err3, patUser) => {
                                if (patUser && patUser.email) {
                                    sendEmail(patUser.email, 'MediCare: Your Turn Has Arrived!',
                                        `Hello ${patUser.name},\n\nYour token ${token.token_number} is now being called.\n\n⚠️ Please report to the doctor's room within 5 minutes or your turn will be given to the next patient.\n\nThank you,\nMediCare Team`);
                                }
                            });

                            // Notify the next waiting patient
                            db.get(`SELECT t.user_id, u.name, u.email FROM tokens t JOIN users u ON t.user_id = u.user_id
                                    WHERE t.doctor_id = ? AND t.queue_status = 'waiting' ORDER BY t.position ASC LIMIT 1`,
                                [token.doctor_id], (err4, nextPat) => {
                                    if (nextPat) {
                                        const nextMsg = `Get ready! You are next in line. Your turn is coming up very soon — please stay nearby.`;
                                        db.run("INSERT INTO notifications (user_id, message) VALUES (?, ?)", [nextPat.user_id, nextMsg]);
                                    }
                                });

                            res.json({ message: 'Patient called successfully. 5-minute grace period started.', calledAt });
                        });
                    });
            });
    });
});

// Admin: Mark late patient as arrived (patient physically arrived, rejoin active)
app.post('/admin/rejoin-arrived/:tokenId', authorize, (req, res) => {
    const user = req.user;
    if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });
    const { tokenId } = req.params;

    db.get("SELECT * FROM tokens WHERE token_id = ? AND queue_status IN ('late', 'called')", [tokenId], (err, token) => {
        if (err || !token) return res.status(404).json({ error: 'Token not found or not in late/called status' });

        // Cancel any running grace timer
        cancelGraceTimer(parseInt(tokenId));

        // Place at end of waiting queue with updated timestamp
        db.get("SELECT MAX(position) as maxPos FROM tokens WHERE doctor_id = ? AND queue_status = 'waiting'",
            [token.doctor_id], (err2, posRow) => {
                const newPos = (posRow && posRow.maxPos) ? posRow.maxPos + 1 : 1;
                const now = new Date().toISOString();

                db.run(`UPDATE tokens SET queue_status = 'waiting', position = ?, entered_at = ?, called_at = NULL WHERE token_id = ?`,
                    [newPos, now, tokenId], (updErr) => {
                        if (updErr) return res.status(500).json({ error: 'Failed to rejoin patient' });

                        updateQueuePositions(token.doctor_id, () => {
                            // Notify patient
                            db.get("SELECT u.name, u.email, u.user_id FROM users u WHERE u.user_id = ?", [token.user_id], (err3, pat) => {
                                if (pat) {
                                    const notifMsg = `✅ You have been marked as arrived. Token ${token.token_number} has been rejoined to the waiting queue. Please wait for your turn.`;
                                    db.run("INSERT INTO notifications (user_id, message) VALUES (?, ?)", [pat.user_id, notifMsg]);
                                    if (pat.email) {
                                        sendEmail(pat.email, 'MediCare: You Have Rejoined the Queue',
                                            `Hello ${pat.name},\n\nThe admin has confirmed your arrival. Token ${token.token_number} has been rejoined to the waiting queue.\n\nPlease wait for your turn to be called.\n\nThank you,\nMediCare Team`);
                                    }
                                }
                            });

                            res.json({ message: 'Patient rejoined queue successfully', newPosition: newPos });
                        });
                    });
            });
    });
});

// Admin: Skip token (put back to waiting at end)
app.post('/admin/skip-token/:tokenId', authorize, (req, res) => {
    const user = req.user;
    if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });

    db.get("SELECT * FROM tokens WHERE token_id = ?", [req.params.tokenId], (err, token) => {
        if (err || !token) return res.status(404).json({ error: 'Token not found' });

        // Set skipped token back to waiting at last position
        db.get("SELECT MAX(position) as maxPos FROM tokens WHERE doctor_id = ? AND queue_status = 'waiting'",
            [token.doctor_id], (err, row) => {
                const newPosition = (row && row.maxPos) ? row.maxPos + 1 : 1;
                db.run("UPDATE tokens SET queue_status = 'waiting', position = ? WHERE token_id = ?",
                    [newPosition, req.params.tokenId], (updErr) => {
                        if (updErr) return res.status(500).json({ error: 'Failed to skip token' });

                        const notifMsg = `Your token ${token.token_number} was skipped. You have been moved to the end of the queue.`;
                        db.run("INSERT INTO notifications (user_id, message) VALUES (?, ?)", [token.user_id, notifMsg]);

                        res.json({ message: 'Token skipped' });
                    }
                );
            }
        );
    });
});

// Admin: Mark token completed
app.post('/admin/complete-token/:tokenId', authorize, (req, res) => {
    const user = req.user;
    if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });

    db.get("SELECT * FROM tokens WHERE token_id = ?", [req.params.tokenId], (err, token) => {
        if (err || !token) return res.status(404).json({ error: 'Token not found' });

        db.run("UPDATE tokens SET queue_status = 'completed', position = NULL WHERE token_id = ?",
            [req.params.tokenId], (updErr) => {
                if (updErr) return res.status(500).json({ error: 'Failed to complete token' });

                updateQueuePositions(token.doctor_id, () => {});

                const notifMsg = `Your consultation for Token ${token.token_number} has been marked as completed.`;
                db.run("INSERT INTO notifications (user_id, message) VALUES (?, ?)", [token.user_id, notifMsg]);

                res.json({ message: 'Token marked completed' });
            }
        );
    });
});

// Admin: Get all appointments with full details
app.get('/admin-appointments', authorize, (req, res) => {
    const user = req.user;
    if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });

    db.all(`
        SELECT a.appointment_id, a.appointment_date, a.status,
               u_pat.name as patient_name, u_pat.email as patient_email, u_pat.phone as patient_phone,
               u_doc.name as doctor_name, d.id as doctor_id, d.specialty, d.hospital_name
        FROM appointments a
        JOIN users u_pat ON a.user_id = u_pat.user_id
        JOIN doctors d ON a.doctor_id = d.id
        JOIN users u_doc ON d.user_id = u_doc.user_id
        ORDER BY a.appointment_date DESC
    `, [], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json(rows || []);
    });
});

// Admin: Approve appointment
app.put('/admin/appointments/:id/approve', authorize, (req, res) => {
    const user = req.user;
    if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });

    db.get("SELECT * FROM appointments WHERE appointment_id = ?", [req.params.id], (err, appt) => {
        if (err || !appt) return res.status(404).json({ error: 'Appointment not found' });

        db.run("UPDATE appointments SET status = 'approved' WHERE appointment_id = ?", [req.params.id], (updErr) => {
            if (updErr) return res.status(500).json({ error: 'Failed to approve' });

            const notifMsg = `Your appointment on ${new Date(appt.appointment_date).toLocaleString()} has been approved by admin.`;
            db.run("INSERT INTO notifications (user_id, message) VALUES (?, ?)", [appt.user_id, notifMsg]);

            res.json({ message: 'Appointment approved' });
        });
    });
});

// Admin: Reschedule appointment
app.put('/admin/appointments/:id/reschedule', authorize, (req, res) => {
    const user = req.user;
    if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });
    const { newDateTime } = req.body;

    db.get("SELECT * FROM appointments WHERE appointment_id = ?", [req.params.id], (err, appt) => {
        if (err || !appt) return res.status(404).json({ error: 'Appointment not found' });

        db.run("UPDATE appointments SET appointment_date = ?, status = 'rescheduled' WHERE appointment_id = ?",
            [newDateTime, req.params.id], (updErr) => {
                if (updErr) return res.status(500).json({ error: 'Failed to reschedule' });

                const notifMsg = `Your appointment has been rescheduled to ${new Date(newDateTime).toLocaleString()}.`;
                db.run("INSERT INTO notifications (user_id, message) VALUES (?, ?)", [appt.user_id, notifMsg]);

                res.json({ message: 'Appointment rescheduled' });
            }
        );
    });
});

// Admin: Cancel appointment
app.put('/admin/appointments/:id/cancel', authorize, (req, res) => {
    const user = req.user;
    if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });

    db.get("SELECT * FROM appointments WHERE appointment_id = ?", [req.params.id], (err, appt) => {
        if (err || !appt) return res.status(404).json({ error: 'Appointment not found' });

        db.run("UPDATE appointments SET status = 'cancelled' WHERE appointment_id = ?", [req.params.id], (updErr) => {
            if (updErr) return res.status(500).json({ error: 'Failed to cancel' });

            const notifMsg = `Your appointment on ${new Date(appt.appointment_date).toLocaleString()} has been cancelled by admin.`;
            db.run("INSERT INTO notifications (user_id, message) VALUES (?, ?)", [appt.user_id, notifMsg]);

            res.json({ message: 'Appointment cancelled' });
        });
    });
});

// Admin: Edit doctor info
app.put('/admin/doctors/:id', authorize, (req, res) => {
    const user = req.user;
    if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });
    const { name, specialty, qualification, experience_years, available_timing, consultation_fee, hospital_name, hospital_address } = req.body;

    db.get("SELECT user_id FROM doctors WHERE id = ?", [req.params.id], (err, doctor) => {
        if (err || !doctor) return res.status(404).json({ error: 'Doctor not found' });

        db.run("UPDATE users SET name = ? WHERE user_id = ?", [name, doctor.user_id]);
        db.run(`UPDATE doctors SET specialty = ?, qualification = ?, experience_years = ?, 
                available_timing = ?, consultation_fee = ?, hospital_name = ?, hospital_address = ?
                WHERE id = ?`,
            [specialty, qualification, experience_years, available_timing, consultation_fee, hospital_name, hospital_address, req.params.id],
            (updErr) => {
                if (updErr) return res.status(500).json({ error: 'Failed to update doctor' });
                res.json({ message: 'Doctor updated successfully' });
            }
        );
    });
});

// Admin: Get full doctor details for editing
app.get('/admin/doctors/:id', authorize, (req, res) => {
    const user = req.user;
    if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });

    db.get(`SELECT d.id, d.specialty, d.qualification, d.experience_years, d.available_timing, 
            d.consultation_fee, d.hospital_name, d.hospital_address, u.name, u.email, u.phone
            FROM doctors d JOIN users u ON d.user_id = u.user_id WHERE d.id = ?`,
        [req.params.id], (err, row) => {
            if (err || !row) return res.status(404).json({ error: 'Doctor not found' });
            res.json(row);
        }
    );
});

// Admin: Get overall stats including queue summary
app.get('/admin-stats', authorize, (req, res) => {
    const user = req.user;
    if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });

    const today = new Date().toISOString().split('T')[0];

    db.get("SELECT COUNT(*) as count FROM users WHERE role = 'patient'", (err, patients) => {
        db.get("SELECT COUNT(*) as count FROM appointments", (err, appointments) => {
            db.get("SELECT COUNT(*) as count FROM doctors d JOIN users u ON d.user_id = u.user_id", (err, doctors) => {
                db.get("SELECT COUNT(*) as count FROM tokens WHERE queue_status IN ('waiting', 'active')", (err, activeTokens) => {
                    db.get(`SELECT COUNT(*) as count FROM appointments WHERE date(appointment_date) = ? AND status IN ('scheduled','approved')`, [today], (err, todayAppts) => {
                        db.get(`SELECT COUNT(*) as count FROM consultations WHERE date(created_at) = ? AND status = 'completed'`, [today], (err, todayConsults) => {
                            res.json({
                                totalPatients: patients ? patients.count : 0,
                                totalAppointments: appointments ? appointments.count : 0,
                                totalDoctors: doctors ? doctors.count : 0,
                                activeTokens: activeTokens ? activeTokens.count : 0,
                                todayAppointments: todayAppts ? todayAppts.count : 0,
                                todayConsultations: todayConsults ? todayConsults.count : 0
                            });
                        });
                    });
                });
            });
        });
    });
});

// Admin: Get all doctors with full info
app.get('/admin-doctors', authorize, (req, res) => {
    const user = req.user;
    if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });

    db.all(`
        SELECT d.id, d.specialty, d.qualification, d.experience_years, d.available_timing,
               d.consultation_fee, d.hospital_name, d.hospital_address,
               u.name, u.email, u.phone, u.user_id
        FROM doctors d JOIN users u ON d.user_id = u.user_id
        ORDER BY u.name ASC
    `, [], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json(rows || []);
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});