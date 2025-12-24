const http = require('http');
const db = require('./database');
const crypto = require('crypto');

console.log('--- DIAGNOSTIC SCRIPT: REGISTER & LOGIN ---');

const testUser = {
    username: `TestUser_${crypto.randomBytes(4).toString('hex')}`,
    email: `test_${crypto.randomBytes(4).toString('hex')}@example.com`,
    password: 'password123'
};

function makeRequest(path, body) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 3000,
            path: path,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode, body: data }));
        });

        req.on('error', reject);
        req.write(JSON.stringify(body));
        req.end();
    });
}

async function run() {
    try {
        console.log(`[TEST] Registering user: ${testUser.username}`);
        const regRes = await makeRequest('/api/auth/register', testUser);
        console.log(`[REGISTER] Status: ${regRes.status}`);
        console.log(`[REGISTER] Body: ${regRes.body}`);

        if (regRes.status !== 200) {
            console.error('[FAIL] Registration failed.');
            return;
        }

        console.log(`[TEST] Logging in user: ${testUser.email}`);
        const loginRes = await makeRequest('/api/auth/login', {
            email: testUser.email,
            password: testUser.password
        });
        console.log(`[LOGIN] Status: ${loginRes.status}`);
        console.log(`[LOGIN] Body: ${loginRes.body}`);

        if (loginRes.status === 200) {
            console.log('[SUCCESS] Backend Auth Flow is WORKING.');
        } else {
            console.error('[FAIL] Login failed.');
        }

    } catch (e) {
        console.error('[ERROR] Request failed:', e.message);
    }
}

run();
