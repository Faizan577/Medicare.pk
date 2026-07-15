const sqlite3 = require('./db').verbose();
const bcrypt = require('bcryptjs');
const db = new sqlite3.Database('./queue.db');

// Reset all doctor passwords to a standard easy password
// Each doctor gets password = "Doctor@123"
const newPassword = 'Doctor@123';

bcrypt.hash(newPassword, 10, (err, hash) => {
    if (err) { console.error(err); return; }

    db.run(`UPDATE users SET password = ? WHERE role = 'doctor'`, [hash], function(err2) {
        if (err2) { console.error(err2); db.close(); return; }
        console.log(`\n✅ Password reset for ${this.changes} doctor(s)`);
        console.log(`   New password for ALL doctors: ${newPassword}`);
        console.log('\n--- Doctor Login Credentials ---');
        db.all(`SELECT u.name, u.email FROM users u WHERE u.role = 'doctor' ORDER BY u.user_id`, [], (err3, rows) => {
            rows.forEach(r => console.log(`  ${r.email}  |  ${newPassword}`));
            db.close();
        });
    });
});
