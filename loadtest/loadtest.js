import http from 'k6/http';
import { check, sleep } from 'k6';

/**
 * ============================================================================
 * 📊 k6 Load Test & Observability — Flash Sale System
 * ============================================================================
 * ข้อกำหนดในการทำ Load Test (ตามโจทย์ 3 ข้อ):
 * 1. Preparation Phase: Script ต้องวนลูปขอ JWT จาก /api/v1/auth/token สำหรับ
 *    ผู้ใช้ที่ไม่ซ้ำกัน 500 คน (เช่น user-1 ถึง user-500) เพื่อเตรียมไว้ใช้ในขั้นตอนต่อไป
 * 2. Read Load: ยิง HTTP GET ไปที่ /api/v1/products?page=X&limit=Y จำนวน 1,000 Concurrent users
 * 3. Write Load: ยิง HTTP POST ไปที่ /api/v1/orders จำนวน 500 Concurrent requests พร้อมแนบ JWT
 *    (โดยใช้ JWT ของ User ที่ไม่ซ้ำกัน) เพื่อจำลองคน 500 คนแย่งกันกดซื้อสินค้า p-1001 (ซึ่งมีสต็อกจำกัดเพียง 50 ชิ้น)
 *    และมีการจำลองให้ User บางคนยิง Request เบิ้ลมา 2-3 ครั้งพร้อมๆ กัน เพื่อทดสอบระบบป้องกันสิทธิ์ซ้ำซ้อน
 * ============================================================================
 */

// 🌐 Base URL (รับผ่าน -e BASE_URL= หรือ default เป็น Nginx Port 8080)
const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080/api/v1';
const TOTAL_USERS = 500;
const DUPLICATE_FRACTION = 0.15; // 15% ของผู้ใช้จะยิงคำสั่งซื้อซ้ำ 2-3 ครั้งพร้อมกัน (Concurrent batch)

export const options = {
  scenarios: {
    // 📖 ข้อที่ 2: Read Load (1,000 Concurrent Users อ่านรายการสินค้า 30 วินาที)
    read_load: {
      executor: 'constant-vus',
      vus: 1000,
      duration: '30s',
      exec: 'readLoad',
    },
    // 🛍️ ข้อที่ 3: Write Load (500 Concurrent Users แย่งซื้อ p-1001 เริ่มที่วินาทีที่ 5)
    write_load: {
      executor: 'per-vu-iterations',
      vus: TOTAL_USERS,
      iterations: 1,
      startTime: '5s',
      maxDuration: '1m',
      exec: 'writeLoad',
    },
  },
  thresholds: {
    'http_req_duration{scenario:read_load}': ['p(95)<500'],
    'http_req_duration{scenario:write_load}': ['p(95)<1500'],
    http_req_failed: ['rate<0.05'],
  },
};

// 🔑 1. Preparation Phase: วนลูปขอ JWT ให้กับ 500 ผู้ใช้ที่ไม่ซ้ำกันล่วงหน้า
export function setup() {
  console.log(`🚀 [1. Preparation Phase] กำลังวนลูปขอ JWT สำหรับผู้ใช้ไม่ซ้ำกัน 500 คน (user-1 ถึง user-${TOTAL_USERS})...`);
  const tokens = [];
  for (let i = 1; i <= TOTAL_USERS; i++) {
    const res = http.post(
      `${BASE_URL}/auth/token`,
      JSON.stringify({ userId: `user-${i}` }),
      { headers: { 'Content-Type': 'application/json' } }
    );
    check(res, { 'auth token issued (200/201)': (r) => r.status === 200 || r.status === 201 });
    tokens.push(res.json('accessToken'));
  }
  console.log(`✅ [Preparation Complete] ได้รับ JWT Tokens ครบทั้ง 500 คนแล้ว พร้อมเริ่มการยิงโหลด!`);
  return { tokens };
}

// 📖 2. Read Load: 1,000 Concurrent VUs ยิง HTTP GET /api/v1/products?page=X&limit=Y
export function readLoad() {
  const page = (__VU % 4) + 1;
  const limit = 10;
  const res = http.get(`${BASE_URL}/products?page=${page}&limit=${limit}`);
  check(res, {
    'read: status 200': (r) => r.status === 200,
    'read: status success': (r) => r.json('status') === 'success',
  });
}

// 🛍️ 3. Write Load: 500 Concurrent requests ยิง HTTP POST /api/v1/orders แย่งซื้อ p-1001 พร้อมยิงเบิ้ล
export function writeLoad(data) {
  const vuIndex = (__VU - 1) % TOTAL_USERS;
  const token = data.tokens[vuIndex];
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
  const body = JSON.stringify({ productId: 'p-1001' });

  if (Math.random() < DUPLICATE_FRACTION) {
    // จำลองผู้ใช้กดย้ำรวดเดียว 2-3 ครั้งพร้อมกัน (Concurrent duplicate batch)
    const shots = 2 + Math.floor(Math.random() * 2);
    const batchReqs = {};
    for (let i = 0; i < shots; i++) {
      batchReqs[`shot_${i}`] = {
        method: 'POST',
        url: `${BASE_URL}/orders`,
        body,
        params: { headers },
      };
    }
    const responses = http.batch(batchReqs);
    Object.values(responses).forEach((res) => {
      check(res, {
        'write: accepted (202) or duplicate-blocked (409)': (r) =>
          r.status === 202 || r.status === 409,
      });
    });
  } else {
    // สั่งซื้อตามปกติ 1 ครั้ง
    const res = http.post(`${BASE_URL}/orders`, body, { headers });
    check(res, {
      'write: accepted (202) or duplicate-blocked (409)': (r) =>
        r.status === 202 || r.status === 409,
    });
  }

  sleep(0.05);
}
