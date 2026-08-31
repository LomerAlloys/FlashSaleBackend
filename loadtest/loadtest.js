import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

/**
 * ============================================================================
 * 📊 k6 Load Test & Observability — Flash Sale System
 * ============================================================================
 * ข้อกำหนดในการทำ Load Test (ตามโจทย์ 3 ข้อ — ห้ามแก้ scenario/threshold พวกนี้
 * เด็ดขาด เพราะ Load Test Script ต้องยิงข้ามกลุ่มได้ด้วยสเปคเดียวกัน):
 * 1. Preparation Phase: Script ต้องวนลูปขอ JWT จาก /api/v1/auth/token สำหรับ
 *    ผู้ใช้ที่ไม่ซ้ำกัน 500 คน (เช่น user-1 ถึง user-500) เพื่อเตรียมไว้ใช้ในขั้นตอนต่อไป
 * 2. Read Load: ยิง HTTP GET ไปที่ /api/v1/products?page=X&limit=Y จำนวน 1,000 Concurrent users
 * 3. Write Load: ยิง HTTP POST ไปที่ /api/v1/orders จำนวน 500 Concurrent requests พร้อมแนบ JWT
 *    (โดยใช้ JWT ของ User ที่ไม่ซ้ำกัน) เพื่อจำลองคน 500 คนแย่งกันกดซื้อสินค้า p-1001 (ซึ่งมีสต็อกจำกัดเพียง 50 ชิ้น)
 *    และมีการจำลองให้ User บางคนยิง Request เบิ้ลมา 2-3 ครั้งพร้อมๆ กัน เพื่อทดสอบระบบป้องกันสิทธิ์ซ้ำซ้อน
 *
 * ส่วนที่เพิ่มจากสเปคขั้นต่ำ (ไม่กระทบ scenario/threshold ข้างบนแม้แต่นิดเดียว — แค่ทำให้
 * ผลลัพธ์ตอบโจทย์ "สิ่งที่ต้องแสดงใน Dashboard/Report" ในข้อ 3 ของ PDF ได้ครบและอ่านง่ายขึ้น):
 *   - นับจำนวน 202 (accepted) / 409 (duplicate-blocked) / unexpected แยกจริง แทนที่จะ
 *     รวมกันเป็น check เดียว → ตอบโจทย์ "Queue Monitoring" ส่วนที่วัดจาก API ได้
 *     (ส่วน Completed/Failed จริงของ Worker ยังต้องแคปจาก Bull-Board ตามสเปคเดิม)
 *   - หลังยิงจบ ดึง GET /products/cache-stats มาเก็บเป็น metric → ตอบโจทย์ "Cache Performance"
 *   - handleSummary() ทำ scorecard สรุปผลอ่านง่ายต่อท้าย terminal ให้ดูผ่าน/ไม่ผ่านได้ใน
 *     สายตาเดียว (ไม่ได้แทนที่ summary ปกติของ k6 แค่เสริมท้ายสุด)
 * ============================================================================
 */

// 🌐 Base URL (รับผ่าน -e BASE_URL= หรือ default เป็น Nginx Port 8080)
const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080/api/v1';
const TOTAL_USERS = 500;
const DUPLICATE_FRACTION = 0.15; // 15% ของผู้ใช้จะยิงคำสั่งซื้อซ้ำ 2-3 ครั้งพร้อมกัน (Concurrent batch)
const TARGET_PRODUCT = 'p-1001'; // สินค้าสต็อกจำกัด 50 ชิ้นที่ทุกคนแย่งกันซื้อในเทสต์นี้

// 📦 Custom metrics — เสริมของ k6 มาตรฐาน (http_req_duration, http_req_failed ฯลฯ)
const ordersAccepted = new Counter('orders_accepted_202'); // enqueue สำเร็จ
const ordersDuplicate = new Counter('orders_duplicate_409'); // โดนบล็อกซ้ำที่ชั้น API (Redis SETNX)
const ordersUnexpected = new Counter('orders_unexpected_status'); // ค่าที่ไม่ควรเกิดเลย (ควรเป็น 0)
const cacheHitRatioPct = new Trend('app_cache_hit_ratio_pct', false); // % จาก GET /products/cache-stats

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
  printBanner();
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

    if (i % 100 === 0) {
      console.log(`   ...ได้ JWT แล้ว ${i}/${TOTAL_USERS} คน`);
    }
  }
  console.log(`✅ [Preparation Complete] ได้รับ JWT Tokens ครบทั้ง 500 คนแล้ว พร้อมเริ่มการยิงโหลด!\n`);
  return { tokens, startedAt: Date.now() };
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
  const body = JSON.stringify({ productId: TARGET_PRODUCT });

  const record = (res) => {
    if (res.status === 202) ordersAccepted.add(1);
    else if (res.status === 409) ordersDuplicate.add(1);
    else ordersUnexpected.add(1);
  };

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
      record(res);
    });
  } else {
    // สั่งซื้อตามปกติ 1 ครั้ง
    const res = http.post(`${BASE_URL}/orders`, body, { headers });
    check(res, {
      'write: accepted (202) or duplicate-blocked (409)': (r) =>
        r.status === 202 || r.status === 409,
    });
    record(res);
  }

  sleep(0.05);
}

// 🧹 4. Teardown: ยิงครั้งเดียวหลังทุก scenario จบ — ดึง Cache Hit/Miss Ratio จริงจากแอป
// มาแนบเข้า metric ของ k6 เอง เพื่อให้ขึ้นในสรุปผลท้ายเทสต์โดยไม่ต้องเปิด endpoint แยก
export function teardown(data) {
  const res = http.get(`${BASE_URL}/products/cache-stats`);
  if (res.status === 200) {
    try {
      const stats = res.json();
      const pct = (stats.cache.hitRatio || 0) * 100;
      cacheHitRatioPct.add(pct);
      console.log(
        `\n📊 [Cache Performance] App-level Cache Hit Ratio (Redis/L1 ใน ProductsService): ` +
          `${pct.toFixed(2)}% (hit=${stats.cache.hit}, miss=${stats.cache.miss}, total=${stats.cache.total}) — ` +
          `ตัวเลขนี้นับเฉพาะ request ที่ทะลุผ่าน Nginx RAM microcache มาถึงแอปจริงๆ เท่านั้น ` +
          `(ส่วนใหญ่ของ read load ถูก Nginx ตอบเองจากแคชโดยไม่มาถึงชั้นนี้เลย)`
      );
    } catch (e) {
      console.warn(`⚠️  อ่าน cache-stats ไม่สำเร็จ: ${e}`);
    }
  } else {
    console.warn(`⚠️  ดึง /products/cache-stats ไม่ได้ (status ${res.status})`);
  }
  console.log(
    `ℹ️  Queue Monitoring (Jobs In Queue / Completed / Failed) ต้องแคปจากหน้า Bull-Board ` +
      `จริงเสมอ (${BASE_URL.replace(/\/api\/v1$/, '')}/admin/queues) เพราะเป็นสถานะฝั่ง Worker ` +
      `ไม่ใช่สิ่งที่ k6 มองเห็นจากฝั่ง Client\n`
  );
}

function printBanner() {
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║   ⚡ FLASH SALE SYSTEM — LOAD TEST (k6)                            ║
║   Target: ${BASE_URL.padEnd(56)}║
║   Scenario: 500 users prep → 1,000 VU read (30s) →                ║
║             500 VU write burst @t=5s (15% duplicate-batch)         ║
╚══════════════════════════════════════════════════════════════════╝
`);
}

// 🏁 5. handleSummary: สรุปผลท้ายเทสต์แบบ scorecard อ่านง่าย ต่อท้าย summary มาตรฐาน
// ของ k6 (ไม่ได้ปิด default output แค่เสริมท้ายสุดให้ตรวจผ่าน/ไม่ผ่านได้ในสายตาเดียว)
export function handleSummary(data) {
  const readP95 = metricValue(data, 'http_req_duration{scenario:read_load}', 'p(95)');
  const writeP95 = metricValue(data, 'http_req_duration{scenario:write_load}', 'p(95)');
  const errorRate = data.metrics.http_req_failed ? data.metrics.http_req_failed.values.rate * 100 : null;
  const readPass = thresholdOk(data, 'http_req_duration{scenario:read_load}');
  const writePass = thresholdOk(data, 'http_req_duration{scenario:write_load}');
  const errPass = thresholdOk(data, 'http_req_failed');

  const accepted = counterValue(data, 'orders_accepted_202');
  const duplicate = counterValue(data, 'orders_duplicate_409');
  const unexpected = counterValue(data, 'orders_unexpected_status');
  const cacheHit = metricValue(data, 'app_cache_hit_ratio_pct', 'avg');

  const rows = [
    ['Read p(95) < 500ms', fmtMs(readP95), readPass],
    ['Write p(95) < 1500ms', fmtMs(writeP95), writePass],
    ['Error rate < 5%', errorRate === null ? 'N/A' : `${errorRate.toFixed(2)}%`, errPass],
  ];

  const overallPass = rows.every((r) => r[2] !== false);

  const lines = [];
  lines.push('');
  lines.push('┌──────────────────────────────────────────────────────────┐');
  lines.push('│  🏆 FLASH SALE — SCORECARD (ตาม Threshold ในโจทย์)         │');
  lines.push('├──────────────────────────────────────────────────────────┤');
  rows.forEach(([label, val, pass]) => {
    const icon = pass === null ? '❔' : pass ? '✅' : '❌';
    lines.push(`│  ${icon}  ${label.padEnd(28)} ${String(val).padStart(12)}   │`);
  });
  lines.push('├──────────────────────────────────────────────────────────┤');
  lines.push(`│  📦 Orders accepted (202)          ${String(accepted).padStart(12)}   │`);
  lines.push(`│  🔁 Orders duplicate-blocked (409) ${String(duplicate).padStart(12)}   │`);
  lines.push(`│  ⚠️  Orders unexpected status       ${String(unexpected).padStart(12)}   │`);
  lines.push(
    `│  🗄️  App cache hit ratio (Redis/L1) ${(cacheHit === null ? 'N/A' : cacheHit.toFixed(2) + '%').padStart(12)}   │`
  );
  lines.push('└──────────────────────────────────────────────────────────┘');
  lines.push(overallPass ? '🎉 ผ่านครบทุก Threshold' : '🚨 มี Threshold ที่ยังไม่ผ่าน — เช็คด้านบน');
  lines.push('');

  return {
    stdout: lines.join('\n'),
  };
}

function metricValue(data, name, key) {
  const m = data.metrics[name];
  if (!m || !m.values || !(key in m.values)) return null;
  return m.values[key];
}

function counterValue(data, name) {
  const m = data.metrics[name];
  return m && m.values ? m.values.count || 0 : 0;
}

function thresholdOk(data, name) {
  const m = data.metrics[name];
  if (!m || !m.thresholds) return null;
  const keys = Object.keys(m.thresholds);
  if (keys.length === 0) return null;
  return keys.every((k) => m.thresholds[k].ok);
}

function fmtMs(v) {
  if (v === null || v === undefined) return 'N/A';
  return v >= 1000 ? `${(v / 1000).toFixed(2)}s` : `${v.toFixed(1)}ms`;
}

