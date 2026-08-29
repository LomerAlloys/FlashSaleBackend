import http from 'k6/http';
import { check, sleep } from 'k6';

/**
 * ============================================================================
 * 📊 k6 Load Test — Flash Sale System (High-Performance Combined Load)
 * ============================================================================
 * Scenario ตามโจทย์ PDF & CLAUDE.md:
 * 1. Preparation Phase: เตรียม JWT ให้ผู้ใช้ 500 คนล่วงหน้า (user-1 ถึง user-500)
 * 2. Read Load: 1,000 Concurrent VUs วนลูปยิง GET /api/v1/products?page=X&limit=10 นาน 30 วินาที
 * 3. Write Load: 500 Concurrent VUs แย่งซื้อ p-1001 (สต็อก 50 ชิ้น) เริ่มยิงที่วินาทีที่ 5
 *    โดยมีผู้ใช้ ~15% ยิง Request เบิ้ล 2-3 ครั้งพร้อมกัน เพื่อทดสอบ Redis SETNX Concurrency Lock
 * ============================================================================
 */

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080/api/v1';
const TOTAL_USERS = 500;
const DUPLICATE_FRACTION = 0.15; // 15% ยิงซ้ำแบบ Concurrent batch

export const options = {
  scenarios: {
    // 📖 Phase 1: 1,000 Concurrent VUs อ่านรายการสินค้า (30 วินาที)
    read_load: {
      executor: 'constant-vus',
      vus: 1000,
      duration: '30s',
      exec: 'readLoad',
    },
    // 🛍️ Phase 2: 500 Concurrent VUs แย่งซื้อ p-1001 (เริ่มที่วินาทีที่ 5)
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

// 🔑 1. Preparation Phase: ขอ JWT 500 คนล่วงหน้า
export function setup() {
  console.log(`🚀 [Preparation Phase] กำลังออก JWT Tokens ให้กับ 500 Users...`);
  const tokens = [];
  for (let i = 1; i <= TOTAL_USERS; i++) {
    const res = http.post(
      `${BASE_URL}/auth/token`,
      JSON.stringify({ userId: `user-${i}` }),
      { headers: { 'Content-Type': 'application/json' } }
    );
    check(res, { 'auth token issued': (r) => r.status === 200 || r.status === 201 });
    tokens.push(res.json('accessToken'));
  }
  console.log(`✅ [Preparation Complete] ได้รับ 500 JWT Tokens ครบแล้ว เริ่มต้นยิง Combined Load!`);
  return { tokens };
}

// 📖 Read Load: 1000 VUs วนลูปอ่านสินค้า
export function readLoad() {
  const page = (__VU % 4) + 1;
  const res = http.get(`${BASE_URL}/products?page=${page}&limit=10`);
  check(res, {
    'read: status 200': (r) => r.status === 200,
    'read: status success': (r) => r.json('status') === 'success',
  });
}

// 🛍️ Write Load: 500 VUs แย่งซื้อ p-1001 พร้อมยิงเบิ้ล
export function writeLoad(data) {
  const vuIndex = (__VU - 1) % TOTAL_USERS;
  const token = data.tokens[vuIndex];
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
  const body = JSON.stringify({ productId: 'p-1001' });

  if (Math.random() < DUPLICATE_FRACTION) {
    // ยิงซ้ำ 2-3 ครั้งพร้อมกัน (Concurrent duplicate)
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
    const res = http.post(`${BASE_URL}/orders`, body, { headers });
    check(res, {
      'write: accepted (202) or duplicate-blocked (409)': (r) =>
        r.status === 202 || r.status === 409,
    });
  }

  sleep(0.05);
}
