async function test() {
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

        const resDoctor = await req('/login', 'POST', { email: 'doctor@example.com', password: 'doctor' });
        const doctorToken = resDoctor.token;
        console.log('Doctor token:', !!doctorToken);

        let patientToken;
        try {
            const resPatientReg = await req('/register', 'POST', {
                name: 'Test Patient', email: 'patient@example.com', password: 'password', role: 'patient', phone: '123456'
            });
            patientToken = resPatientReg.token;
            if (!patientToken) throw new Error("No token on register");
        } catch (e) {
            const resPatient = await req('/login', 'POST', { email: 'patient@example.com', password: 'password' });
            patientToken = resPatient.token;
        }
        console.log('Patient token:', !!patientToken);

        const doctors = await req('/doctors', 'GET');
        console.log('Doctors available:', doctors);
        const docId = doctors[0].id;

        const resJoin = await req('/join-queue', 'POST', { doctorId: docId, emergency: false }, patientToken);
        console.log('Join queue result:', resJoin);

        const resDash = await req('/doctor-dashboard', 'GET', null, doctorToken);
        console.log('Doctor dashboard result:', resDash);
    } catch (err) {
        console.error('Error:', err);
    }
}

test();
