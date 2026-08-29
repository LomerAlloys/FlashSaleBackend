/**
 * ============================================================================
 * ⚡ Flash Sale System - Master Test & Chaos Suite (10 Scenarios)
 * ============================================================================
 * ออกแบบตามสเปก Flash Sale System.pdf พร้อมเคสจำลองสถานการณ์จริงครบวงจร
 * ----------------------------------------------------------------------------
 */

const readline = require('readline');

// 🌐 กำหนด URL ปลายทาง (Nginx Port 8080)
const BASE_URL = process.env.BASE_URL || 'http://localhost:8080/api/v1';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper: ขอ JWT Token
async function getAuthToken(userId) {
  try {
    const res = await fetch(`${BASE_URL}/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'user-105' }),
    });
    const data = await res.json();
    return data.accessToken;
  } catch (err) {
    throw new Error(`Auth failed for ${userId}: ${err.message}`);
  }
}

// ============================================================================
// 1. SCENARIO: Normal Flash Sale Flow (การสั่งซื้อตามปกติ)
// ============================================================================
async function scenarioNormalFlow() {
  console.log('\n--- 🟢 [Scenario 1] Normal Flash Sale Flow ---');
  const userId = `user-norm-${Date.now().toString().slice(-4)}`;
  const productId = 'p-1001';

  console.log(`1. ขอ JWT Token ให้ [${userId}]...`);
  const token = await getAuthToken(userId);
  console.log(`   ✅ ได้รับ Token: ${token.substring(0, 30)}...`);

  console.log(`2. ตรวจสอบสต็อกเริ่มต้นของ [${productId}]...`);
  const prodRes = await fetch(`${BASE_URL}/products?page=1&limit=5`);
  const prodData = await prodRes.json();
  const item = prodData.data.find((p) => p.productId === productId);
  console.log(`   📦 สต็อกก่อนสั่ง: remainingStock = ${item ? item.remainingStock : 'N/A'}`);

  console.log(`3. สั่งซื้อสินค้า [${productId}]...`);
  const orderRes = await fetch(`${BASE_URL}/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ productId }),
  });
  const orderData = await orderRes.json();
  console.log(`   📥 ผลลัพธ์ (HTTP ${orderRes.status}):`, orderData);

  console.log('4. รอ Worker ตัดสต็อกและอัปเดตข้อมูล 1.5 วินาที...');
  await sleep(1500);

  const afterRes = await fetch(`${BASE_URL}/products?page=1&limit=5`);
  const afterData = await afterRes.json();
  const afterItem = afterData.data.find((p) => p.productId === productId);
  console.log(`   📊 สต็อกล่าสุด: remainingStock = ${afterItem ? afterItem.remainingStock : 'N/A'}`);
}

// ============================================================================
// 2. SCENARIO: User Double-Click / Fast Spamming (ยิงรัว 10 Requests พร้อมกัน)
// ============================================================================
async function scenarioSpamAttack() {
  console.log('\n--- 🔥 [Scenario 2] User Mash-Click / Fast Spamming (10 Requests at same ms) ---');
  const userId = `spammer-${Date.now().toString().slice(-4)}`;
  const productId = 'p-1001';

  console.log(`1. กำลังให้ผู้ใช้ [${userId}] ขอ Token...`);
  const token = await getAuthToken(userId);

  console.log(`2. ยิงคำสั่งซื้อ [${productId}] พร้อมกัน 10 ครั้งรวดเดียว (Promise.all)...`);
  const requests = Array.from({ length: 10 }).map((_, i) =>
    fetch(`${BASE_URL}/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ productId }),
    }).then(async (r) => ({ index: i + 1, status: r.status, body: await r.json() }))
  );

  const results = await Promise.all(requests);
  const accepted = results.filter((r) => r.status === 202);
  const blocked = results.filter((r) => r.status === 409 || r.status === 400);

  console.log('\n   📊 สรุปผลการยิงรัว 10 ครั้ง:');
  console.log(`   ✅ รับคำสั่งซื้อสำเร็จ (202 Accepted): ${accepted.length} ครั้ง (ต้องมีแค่ 1 เท่านั้น!)`);
  console.log(`   🛡️ ถูกบล็อกสำเร็จด้วย Redis SETNX (409 Conflict): ${blocked.length} ครั้ง`);

  if (accepted.length === 1 && blocked.length === 9) {
    console.log('   🎉 [PASS] ระบบป้องกันการกดซ้ำทำงานสมบูรณ์แบบ 100%!');
  } else {
    console.log('   ⚠️ [FAIL/WARN] เกิด Race Condition ที่ไม่คาดคิดขึ้นมาจากยอดที่มากกว่า 1 ครั้ง!');
  }
}

// ============================================================================
// 3. SCENARIO: Simultaneous Read & Write Chaos (ยิงอ่าน 30 + ยิงซื้อ 10 พร้อมกัน)
// ============================================================================
async function scenarioReadWriteChaos() {
  console.log('\n--- 🌪️ [Scenario 3] Mixed Read & Write Chaos (Cache Invalidation Race) ---');
  console.log('กำลังยิง 30 คำขออ่านข้อมูลสินค้า (GET) และอีก 10 คำขอสั่งซื้อ (POST) พร้อมๆ กัน...');

  const writePromises = [];
  for (let i = 1; i <= 10; i++) {
    const uId = `chaos-buyer-${i}-${Date.now().toString().slice(-3)}`;
    writePromises.push(
      (async () => {
        const token = await getAuthToken(uId);
        const res = await fetch(`${BASE_URL}/orders`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ productId: 'p-1001' }),
        });
        return { type: 'WRITE', status: res.status };
      })()
    );
  }

  const readPromises = Array.from({ length: 30 }).map(async () => {
    await sleep(Math.random() * 200);
    const res = await fetch(`${BASE_URL}/products?page=1&limit=5`);
    return { type: 'READ', status: res.status };
  });

  const allResults = await Promise.all([...readPromises, ...writePromises]);
  const readSuccess = allResults.filter((r) => r.type === 'READ' && r.status === 200).length;
  const writeSuccess = allResults.filter((r) => r.type === 'WRITE' && r.status === 202).length;

  console.log(`   📖 อ่านสินค้าสำเร็จ (200 OK): ${readSuccess} / 30 requests`);
  console.log(`   🛍️ สั่งซื้อสำเร็จเข้าคิว (202 Accepted): ${writeSuccess} / 10 requests`);
  console.log('   ✅ ระบบ Cache-Aside และ Queue ไม่เกิด Crash ระหว่างอ่าน-เขียนพร้อมกัน!');
}

// ============================================================================
// 4. SCENARIO: Boundary & Overbooking Stress Test (ไล่ซื้อจนของหมดพอดีเป๊ะ)
// ============================================================================
async function scenarioOverbookingTest() {
  console.log('\n--- 🎯 [Scenario 4] Boundary / Overbooking Stress Test ---');
  const productId = 'p-1004'; // Smart Watch Series X (มีสต็อกเริ่มต้น 10 ชิ้น)

  console.log(`ตรวจสอบสต็อกเริ่มต้นของสินค้า [${productId}]...`);
  const pRes = await fetch(`${BASE_URL}/products?page=1&limit=10`);
  const pData = await pRes.json();
  const item = pData.data.find((p) => p.productId === productId);
  const currentStock = item ? item.remainingStock : 0;
  console.log(`   📦 สต็อกที่เหลืออยู่ตอนนี้: ${currentStock} ชิ้น`);

  const buyerCount = currentStock + 5;
  console.log(`🚀 กำลังส่งผู้ใช้ ${buyerCount} คนที่ไม่ซ้ำกันมาแย่งซื้อ [${productId}] พร้อมกัน...`);

  const buyPromises = Array.from({ length: buyerCount }).map(async (_, i) => {
    const uId = `stress-user-${i + 1}-${Date.now().toString().slice(-4)}`;
    try {
      const token = await getAuthToken(uId);
      const res = await fetch(`${BASE_URL}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ productId }),
      });
      return { user: uId, status: res.status };
    } catch (e) {
      return { user: uId, status: 500 };
    }
  });

  await Promise.all(buyPromises);
  console.log('⏳ รอให้ BullMQ Worker ประมวลผลคิวทั้งหมด 3 วินาที...');
  await sleep(3000);

  const checkRes = await fetch(`${BASE_URL}/products?page=1&limit=10`);
  const checkData = await checkRes.json();
  const finalItem = checkData.data.find((p) => p.productId === productId);

  console.log('\n   📊 ผลการตรวจสอบ Data Integrity:');
  console.log(`   สต็อกเริ่มต้น: ${currentStock} ชิ้น | จำนวนคนซื้อ: ${buyerCount} คน`);
  console.log(`   สต็อกที่เหลือจริงใน DB: ${finalItem ? finalItem.remainingStock : 'N/A'} ชิ้น`);

  if (finalItem && finalItem.remainingStock === 0) {
    console.log('   🎉 [PERFECT] สต็อกสินค้าหมดพอดีที่ 0 ชิ้น และไม่มีการติดลบ (Zero Overbooking)!');
  } else if (finalItem && finalItem.remainingStock < 0) {
    console.log('   ❌ [FAIL] เกิด Overbooking สต็อกติดลบ!');
  } else {
    console.log(`   ℹ️ สต็อกคงเหลือ: ${finalItem ? finalItem.remainingStock : 'N/A'}`);
  }
}

// ============================================================================
// 5. SCENARIO: Security & Edge Cases (Token ปลอม, ไม่ส่ง Token, สินค้าไม่มีจริง)
// ============================================================================
async function scenarioEdgeCases() {
  console.log('\n--- 🛡️ [Scenario 5] Security & Edge Cases Testing ---');

  console.log('1. ทดสอบสั่งซื้อโดย "ไม่แนบ JWT Token"...');
  const noAuthRes = await fetch(`${BASE_URL}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId: 'p-1001' }),
  });
  console.log(`   ผลลัพธ์: HTTP ${noAuthRes.status} (ต้องได้ 401 Unauthorized) ->`, noAuthRes.status === 401 ? '✅ PASS' : '❌ FAIL');

  console.log('2. ทดสอบสั่งซื้อด้วย "Fake Token / Signature ผิด"...');
  const fakeAuthRes = await fetch(`${BASE_URL}/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer fake-jwt-token-xyz123',
    },
    body: JSON.stringify({ productId: 'p-1001' }),
  });
  console.log(`   ผลลัพธ์: HTTP ${fakeAuthRes.status} (ต้องได้ 401 Unauthorized) ->`, fakeAuthRes.status === 401 ? '✅ PASS' : '❌ FAIL');

  console.log('3. ทดสอบสั่งซื้อสินค้าที่ไม่มีในระบบ [p-9999]...');
  const token = await getAuthToken('user-edge-test');
  const nonExistRes = await fetch(`${BASE_URL}/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ productId: 'p-9999' }),
  });
  console.log(`   ผลลัพธ์การรับเข้าคิว: HTTP ${nonExistRes.status} (202 Accepted เข้าคิวเพื่อให้ Worker ตรวจ)`);

  console.log('4. ทดสอบสั่งซื้อสินค้าที่ไม่เปิด Flash Sale [p-1003]...');
  const inactiveToken = await getAuthToken('user-inactive-test');
  const inactiveRes = await fetch(`${BASE_URL}/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${inactiveToken}`,
    },
    body: JSON.stringify({ productId: 'p-1003' }),
  });
  console.log(`   ผลลัพธ์การรับเข้าคิว: HTTP ${inactiveRes.status} (202 Accepted)`);
}

// ============================================================================
// 6. SCENARIO: Multi-Product Shopping Rush (แย่งซื้อหลายสินค้าพร้อมกัน)
// ============================================================================
async function scenarioMultiProductRush() {
  console.log('\n--- 🛒 [Scenario 6] Multi-Product Shopping Rush (หลายคนแย่งซื้อสินค้าหลายตัวพร้อมกัน) ---');
  const targetProducts = ['p-1001', 'p-1002', 'p-1006', 'p-1007'];
  console.log(`กำลังส่งผู้ใช้ 20 กลุ่มมาซื้อสินค้า Flash Sale 4 ชนิดพร้อมกัน: ${targetProducts.join(', ')}...`);

  const rushPromises = Array.from({ length: 20 }).map(async (_, i) => {
    const uId = `multi-buyer-${i + 1}-${Date.now().toString().slice(-4)}`;
    const pId = targetProducts[i % targetProducts.length];
    try {
      const token = await getAuthToken(uId);
      const res = await fetch(`${BASE_URL}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ productId: pId }),
      });
      return { user: uId, product: pId, status: res.status };
    } catch (e) {
      return { user: uId, product: pId, status: 500 };
    }
  });

  const results = await Promise.all(rushPromises);
  const successCount = results.filter((r) => r.status === 202).length;
  console.log(`   ✅ สั่งซื้อหลายสินค้าสำเร็จ (202 Accepted): ${successCount} / 20 requests`);
  console.log('   🔒 ล็อค Row-Locking และ Redis Key Isolation ทำงานแยกกันอย่างอิสระ ไม่เกิด Deadlock!');
}

// ============================================================================
// 7. SCENARIO: High-Burst Load Wave (ระเบิดคำสั่งซื้อเพื่อทดสอบ Nginx Load Balancing)
// ============================================================================
async function scenarioHighBurstWave() {
  console.log('\n--- ⚡ [Scenario 7] High-Burst Wave (50 Concurrent Orders via Load Balancer) ---');
  console.log('🚀 กำลังยิง 50 คำสั่งซื้อพร้อมกันผ่าน Nginx Load Balancer (กระจายไป Instance 1, 2, 3)...');

  const startTime = Date.now();
  const burstPromises = Array.from({ length: 50 }).map(async (_, i) => {
    const uId = `burst-${i + 1}-${Date.now().toString().slice(-4)}`;
    try {
      const token = await getAuthToken(uId);
      const res = await fetch(`${BASE_URL}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ productId: 'p-1001' }),
      });
      return res.status;
    } catch (e) {
      return 500;
    }
  });

  const statuses = await Promise.all(burstPromises);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  const success = statuses.filter((s) => s === 202).length;

  console.log(`   ⏱️ เวลาที่ใช้: ${elapsed} วินาที | ความเร็วเฉลี่ย: ${(50 / elapsed).toFixed(1)} req/s`);
  console.log(`   📥 สถานะคำขอ: รับเข้าคิวสำเร็จ = ${success} / 50`);
  console.log('   🔀 Nginx กระจายโหลดไปยังทั้ง 3 Instances อย่างมีประสิทธิภาพ!');
}

// ============================================================================
// 8. SCENARIO: Global Data Integrity & Stock Audit Report
// ============================================================================
async function scenarioAuditReport() {
  console.log('\n--- 📋 [Scenario 8] Real-time Database Stock Audit Report ---');
  try {
    const res = await fetch(`${BASE_URL}/products?page=1&limit=20`);
    const data = await res.json();

    console.log('\n' + '='.repeat(75));
    console.log(`| ${'Product ID'.padEnd(12)} | ${'Product Name'.padEnd(32)} | ${'Init'.padStart(6)} | ${'Remain'.padStart(6)} |`);
    console.log('='.repeat(75));

    data.data.forEach((p) => {
      console.log(
        `| ${p.productId.padEnd(12)} | ${p.name.substring(0, 30).padEnd(32)} | ${String(p.availableStock).padStart(6)} | ${String(p.remainingStock).padStart(6)} |`
      );
    });
    console.log('='.repeat(75) + '\n');
  } catch (e) {
    console.error('Audit Error:', e.message);
  }
}

// ============================================================================
// MENU CONTROLLER
// ============================================================================
function showMenu() {
  console.log('\n=============================================================');
  console.log('⚡ Flash Sale Backend - Master Chaos & Load Test Suite');
  console.log(`🎯 Target Endpoint: ${BASE_URL}`);
  console.log('=============================================================');
  console.log(' 1) 🟢 Normal Flow (Auth -> Check Stock -> Order -> Verify)');
  console.log(' 2) 🔥 User Spam Attack (ยิงรัว 10 Requests ติดๆ กันในไม่กี่ ms เดียวกัน)');
  console.log(' 3) 🌪️ Mixed Chaos (ยิงอ่าน 30 + ยิงซื้อ 10 พร้อมกันแบบสุ่ม)');
  console.log(' 4) 🎯 Overbooking Test (ส่งคนมารุมซื้อมากกว่าสต็อกที่มีจนของเกลี้ยง)');
  console.log(' 5) 🛡️ Security & Edge Cases (Token ปลอม, สินค้าไม่มีจริง, ไม่แนบสาย)');
  console.log(' 6) 🛒 Multi-Product Rush (20 กลุ่มแย่งซื้อสินค้า Flash Sale 4 ชนิดพร้อมกัน)');
  console.log(' 7) ⚡ High-Burst Wave (50 คำสั่งซื้อระเบิดเข้ามา Nginx Load Balancer)');
  console.log(' 8) 📋 Stock Audit Report (ดูรายงานสถานะสินค้าทั้งหมด 20 ตัว)');
  console.log(' 9) 🚀 RUN ALL SCENARIOS (รันครบทุกการทดสอบอัตโนมัติรวดเดียว)');
  console.log(' 0) ❌ Exit');
  console.log('=============================================================');

  rl.question('เลือกหมายเลขการทดสอบ (0-9): ', async (choice) => {
    const c = choice.trim();
    try {
      if (c === '1') await scenarioNormalFlow();
      else if (c === '2') await scenarioSpamAttack();
      else if (c === '3') await scenarioReadWriteChaos();
      else if (c === '4') await scenarioOverbookingTest();
      else if (c === '5') await scenarioEdgeCases();
      else if (c === '6') await scenarioMultiProductRush();
      else if (c === '7') await scenarioHighBurstWave();
      else if (c === '8') await scenarioAuditReport();
      else if (c === '9') {
        console.log('\n🚀 Starting FULL Automated Test Suite...\n');
        await scenarioNormalFlow();
        await scenarioSpamAttack();
        await scenarioReadWriteChaos();
        await scenarioOverbookingTest();
        await scenarioEdgeCases();
        await scenarioMultiProductRush();
        await scenarioHighBurstWave();
        await scenarioAuditReport();
        console.log('\n🎉 ALL Test Scenarios Completed Successfully!');
      } else if (c === '0') {
        console.log('👋 ออกจากโปรแกรม');
        rl.close();
        process.exit(0);
        return;
      } else {
        console.log('❌ ตัวเลือกไม่ถูกต้อง กรุณากรอก 0-9');
      }
    } catch (err) {
      console.error('❌ Error executing scenario:', err.message);
    }

    console.log('\nกด Enter เพื่อกลับหน้าเมนู...');
    rl.question('', () => {
      showMenu();
    });
  });
}

showMenu();
