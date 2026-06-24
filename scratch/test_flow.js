async function runE2ETest() {
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

        console.log("1. Logging in as Patient...");
        let patientToken;
        try {
            const resPatientReg = await req('/register', 'POST', {
                name: 'E2E Patient', email: 'e2e_patient@example.com', password: 'password', role: 'patient', phone: '987654321'
            });
            patientToken = resPatientReg.token;
        } catch (e) {}
        if (!patientToken) {
            const resPatient = await req('/login', 'POST', { email: 'e2e_patient@example.com', password: 'password' });
            patientToken = resPatient.token;
        }
        console.log("Patient login token available:", !!patientToken);

        console.log("\n2. Fetching Doctors to find Dr. Smith (ID 20)...");
        const doctors = await req('/doctors', 'GET');
        const drSmith = doctors.find(d => d.name === 'Dr. Smith');
        if (!drSmith) {
            throw new Error("Dr. Smith not found in doctors list!");
        }
        console.log("Found Dr. Smith with ID:", drSmith.id);

        console.log("\n3. Patient joining Dr. Smith's queue...");
        // Since we might already be in queue, let's leave first if possible
        await req('/leave-queue', 'POST', {}, patientToken);
        const joinRes = await req('/join-queue', 'POST', { doctorId: drSmith.id, emergency: false }, patientToken);
        console.log("Join Queue Response:", joinRes);
        if (!joinRes.token) {
            throw new Error("Failed to join queue or get a token: " + JSON.stringify(joinRes));
        }

        console.log("\n4. Logging in as Dr. Smith...");
        const resDoctor = await req('/login', 'POST', { email: 'doctor@example.com', password: 'doctor' });
        const doctorToken = resDoctor.token;
        console.log("Doctor login token available:", !!doctorToken);

        console.log("\n5. Fetching Dr. Smith's Dashboard...");
        let dash = await req('/doctor-dashboard', 'GET', null, doctorToken);
        console.log("Doctor Dashboard before calling:", JSON.stringify(dash, null, 2));

        const patientQueueItem = dash.queues.find(q => q.token === joinRes.token);
        if (!patientQueueItem) {
            throw new Error(`Token ${joinRes.token} not found on Doctor Dashboard!`);
        }
        console.log(`Found patient queue item on dashboard. Status: ${patientQueueItem.status}, ID: ${patientQueueItem.id}`);

        console.log(`\n6. Calling patient with Queue ID ${patientQueueItem.id}...`);
        const callRes = await req(`/call-next/${patientQueueItem.id}`, 'POST', {}, doctorToken);
        console.log("Call Patient Response:", callRes);

        console.log("\n7. Fetching Live Queue for Dr. Smith...");
        const liveQueue = await req(`/doctors/${drSmith.id}/live-queue`, 'GET', null, patientToken);
        console.log("Live Queue status for patient:", {
            currentActiveToken: liveQueue.currentActiveToken,
            nextToken: liveQueue.nextToken,
            userStatus: liveQueue.userStatus,
            waitTime: liveQueue.waitTime,
            patientsBefore: liveQueue.patientsBefore
        });

        console.log("\n8. Completing patient's visit...");
        const compRes = await req(`/complete-visit/${patientQueueItem.id}`, 'POST', {}, doctorToken);
        console.log("Complete Visit Response:", compRes);

        console.log("\n9. Fetching Doctor Dashboard after completion...");
        dash = await req('/doctor-dashboard', 'GET', null, doctorToken);
        console.log("Doctor Dashboard after completion:", JSON.stringify(dash, null, 2));

        console.log("\n=== E2E Integration Test Completed Successfully ===");
    } catch (err) {
        console.error("E2E Test Failed:", err);
    }
}

runE2ETest();
