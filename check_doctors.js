const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./queue.db');

db.all(`
    SELECT u.user_id, u.name, u.email, u.password, d.id as doctor_id, d.specialty, d.hospital_name
    FROM users u
    LEFT JOIN doctors d ON d.user_id = u.user_id
    WHERE u.role = 'doctor'
    ORDER BY u.user_id
`, [], (err, rows) => {
    if (err) { console.error(err); db.close(); return; }
    console.log('\n====== ALL DOCTORS ======');
    rows.forEach(r => {
        console.log(`\nDoctor ID: ${r.doctor_id} | User ID: ${r.user_id}`);
        console.log(`  Name     : ${r.name}`);
        console.log(`  Email    : ${r.email}`);
        console.log(`  Specialty: ${r.specialty}`);
        console.log(`  Hospital : ${r.hospital_name}`);
        console.log(`  Password : ${r.password.substring(0,20)}... (hashed)`);
    });

    // Also show appointments with which doctor
    db.all(`
        SELECT a.appointment_id, a.appointment_date, a.status, a.doctor_id,
               u_pat.name as patient_name, u_doc.name as doctor_name, u_doc.email as doctor_email
        FROM appointments a
        JOIN users u_pat ON a.user_id = u_pat.user_id
        JOIN doctors d ON a.doctor_id = d.id
        JOIN users u_doc ON d.user_id = u_doc.user_id
        ORDER BY a.appointment_id DESC
    `, [], (err2, appts) => {
        console.log('\n====== APPOINTMENTS & WHICH DOCTOR ======');
        appts.forEach(a => {
            console.log(`  Appt ${a.appointment_id}: Patient="${a.patient_name}" -> Doctor="${a.doctor_name}" (${a.doctor_email}) | Date: ${a.appointment_date} | Status: ${a.status}`);
        });

        // Also tokens
        db.all(`
            SELECT t.token_id, t.token_number, t.queue_status, t.doctor_id,
                   u_pat.name as patient_name, u_doc.name as doctor_name, u_doc.email as doctor_email
            FROM tokens t
            JOIN users u_pat ON t.user_id = u_pat.user_id
            JOIN doctors d ON t.doctor_id = d.id
            JOIN users u_doc ON d.user_id = u_doc.user_id
            WHERE t.queue_status IN ('waiting', 'active')
        `, [], (err3, tokens) => {
            console.log('\n====== ACTIVE TOKENS & WHICH DOCTOR ======');
            tokens.forEach(t => {
                console.log(`  Token ${t.token_number}: Patient="${t.patient_name}" -> Doctor="${t.doctor_name}" (${t.doctor_email}) | Status: ${t.queue_status}`);
            });
            db.close();
        });
    });
});
