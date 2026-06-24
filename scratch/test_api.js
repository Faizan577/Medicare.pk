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

        const resDoctor = await req('/login', 'POST', { email: 'ali22@gmail.com', password: 'password' }); // Wait, I don't know Ali's password. It's probably hashed. I can't login directly via API unless I know the password.
    } catch (err) {
        console.error('Error:', err);
    }
}
test();
