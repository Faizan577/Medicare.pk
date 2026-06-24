const sqlite3 = require('sqlite3').verbose();

async function runIsolationTest() {
    try {
        const fetch = global.fetch;

        const req = async (url, method, body, token) => {
            const headers = { 'Content-Type': 'application/json' };
            if (token) headers['Authorization'] = `Bearer ${token}`;
            const res = await fetch(`http://localhost:3000${url}`, {
                method,
                headers,
                body: body ? JSON.stringify(body) : undefined
            });
            const text = await res.text();
            try { return JSON.parse(text); } catch { return text; }
        };

        console.log("=== STARTING DATA ISOLATION TEST ===");

        // 1. Register & Login Patient A
        console.log("1. Registering Patient A...");
        const regA = await req('/register', 'POST', {
            name: 'Patient A', email: 'patientA@example.com', password: 'password', role: 'patient', phone: '111111111'
        });
        let tokenA = regA.token;
        if (!tokenA) {
            console.log("Patient A already exists. Logging in...");
            const loginA = await req('/login', 'POST', { email: 'patientA@example.com', password: 'password' });
            tokenA = loginA.token;
        }
        console.log("Patient A Token:", !!tokenA);

        // 2. Register & Login Patient B
        console.log("2. Registering Patient B...");
        const regB = await req('/register', 'POST', {
            name: 'Patient B', email: 'patientB@example.com', password: 'password', role: 'patient', phone: '222222222'
        });
        let tokenB = regB.token;
        if (!tokenB) {
            console.log("Patient B already exists. Logging in...");
            const loginB = await req('/login', 'POST', { email: 'patientB@example.com', password: 'password' });
            tokenB = loginB.token;
        }
        console.log("Patient B Token:", !!tokenB);

        // Fetch doctors list
        const doctors = await req('/doctors', 'GET');
        const doctor = doctors[0];
        console.log("Using Doctor for bookings:", doctor.name, "ID:", doctor.id);

        // 3. Patient A books an appointment and generates a token
        console.log("\n3. Patient A booking appointment and generating token...");
        await req('/leave-queue', 'POST', {}, tokenA); // Clean queue just in case
        const apptA = await req('/book-appointment', 'POST', { doctorId: doctor.id, dateTime: '2026-06-12T10:00' }, tokenA);
        const tokA = await req('/join-queue', 'POST', { doctorId: doctor.id, emergency: false }, tokenA);
        console.log("Patient A Appointment ID:", apptA.appointmentId, "Token Number:", tokA.token);

        // 4. Patient B books an appointment and generates a token
        console.log("\n4. Patient B booking appointment and generating token...");
        await req('/leave-queue', 'POST', {}, tokenB); // Clean queue just in case
        const apptB = await req('/book-appointment', 'POST', { doctorId: doctor.id, dateTime: '2026-06-15T14:30' }, tokenB);
        const tokB = await req('/join-queue', 'POST', { doctorId: doctor.id, emergency: false }, tokenB);
        console.log("Patient B Appointment ID:", apptB.appointmentId, "Token Number:", tokB.token);

        // 5. Query Patient A's appointments and tokens
        console.log("\n5. Querying Patient A's appointments, tokens, and notifications...");
        const myApptsA = await req('/my-appointments', 'GET', null, tokenA);
        const myToksA = await req('/my-tokens', 'GET', null, tokenA);
        const myNotifsA = await req('/my-notifications', 'GET', null, tokenA);

        console.log("Patient A Appointments count:", myApptsA.length);
        console.log("Patient A Tokens count:", myToksA.length);
        console.log("Patient A Notifications count:", myNotifsA.length);

        // Assert Patient A cannot see Patient B's data
        const hasBDataInA = myApptsA.some(a => a.appointment_id === apptB.appointmentId) || 
                            myToksA.some(t => t.token_number === tokB.token && t.user_id !== regA.user?.user_id);
        if (hasBDataInA) {
            throw new Error("FAIL: Patient A can see Patient B's private data!");
        }
        console.log("SUCCESS: Patient A's data is fully isolated from Patient B.");

        // 6. Query Patient B's appointments and tokens
        console.log("\n6. Querying Patient B's appointments, tokens, and notifications...");
        const myApptsB = await req('/my-appointments', 'GET', null, tokenB);
        const myToksB = await req('/my-tokens', 'GET', null, tokenB);
        const myNotifsB = await req('/my-notifications', 'GET', null, tokenB);

        console.log("Patient B Appointments count:", myApptsB.length);
        console.log("Patient B Tokens count:", myToksB.length);
        console.log("Patient B Notifications count:", myNotifsB.length);

        // Assert Patient B cannot see Patient A's data
        const hasADataInB = myApptsB.some(a => a.appointment_id === apptA.appointmentId) || 
                            myToksB.some(t => t.token_number === tokA.token && t.user_id !== regB.user?.user_id);
        if (hasADataInB) {
            throw new Error("FAIL: Patient B can see Patient A's private data!");
        }
        console.log("SUCCESS: Patient B's data is fully isolated from Patient A.");

        // 7. Reviews Isolation Test
        console.log("\n7. Testing reviews isolation...");
        const revA = await req('/submit-review', 'POST', { doctorId: doctor.id, rating: 5, comment: 'Patient A review comment' }, tokenA);
        console.log("Patient A submitted Review ID:", revA.reviewId);

        // Patient B retrieves reviews
        const myRevsB = await req('/my-reviews', 'GET', null, tokenB);
        const hasARevInB = myRevsB.some(r => r.review_id === revA.reviewId);
        if (hasARevInB) {
            throw new Error("FAIL: Patient B sees Patient A's submitted review in their 'my-reviews' history!");
        }
        console.log("SUCCESS: Patient B's reviews list is isolated.");

        // Patient B tries to delete Patient A's review
        console.log("Attempting to delete Patient A's review using Patient B's token...");
        const delRes = await req(`/my-reviews/${revA.reviewId}`, 'DELETE', null, tokenB);
        console.log("Delete response for unauthorized user B:", delRes);
        if (delRes.message === 'Review deleted successfully') {
            throw new Error("FAIL: Patient B was allowed to delete Patient A's review!");
        }
        console.log("SUCCESS: Unauthorized review deletion was blocked.");

        // Clean up review as Patient A
        await req(`/my-reviews/${revA.reviewId}`, 'DELETE', null, tokenA);
        console.log("Review cleaned up successfully.");

        console.log("\n=== DATA ISOLATION TEST PASSED SUCCESSFULLY ===");

    } catch (err) {
        console.error("Test execution failed:", err.message || err);
        process.exit(1);
    }
}

runIsolationTest();
