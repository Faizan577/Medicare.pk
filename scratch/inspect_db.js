const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./queue.db');

db.get("SELECT * FROM users WHERE email = 'doctor@example.com'", (err, user) => {
    console.log("User doctor@example.com:", user);
    if (user) {
        db.get("SELECT * FROM doctors WHERE user_id = ?", [user.id], (err, doctor) => {
            console.log("Doctor profile for user_id " + user.id + ":", doctor);
            db.close();
        });
    } else {
        db.close();
    }
});
