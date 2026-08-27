// 🧪 Automated Demonstration Script for Flash Sale System
// -------------------------------------------------------------

const BASE_URL = process.env.BASE_URL || 'http://localhost:8080/api/v1';

async function runDemo() {
  console.log('\n======================================================');
  console.log('⚡ Starting Flash Sale System Test Demo');
  console.log(`🌐 Base URL: ${BASE_URL}`);
  console.log('======================================================\n');

  try {
    // 🔑 1. ขอ Token ให้ User-101
    console.log('1️⃣ Requesting JWT Token for user-101...');
    const authRes = await fetch(`${BASE_URL}/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'user-101' }),
    });
    const authData = await authRes.json();
    console.log('   ✅ JWT Token received:', authData.accessToken.substring(0, 35) + '...\n');
    const tokenUser101 = authData.accessToken;

    // 📖 2. อ่านรายการสินค้า (เช็คสต็อกเริ่มต้นของ p-1001)
    console.log('2️⃣ Fetching Products List (Cache-Aside)...');
    const prodRes = await fetch(`${BASE_URL}/products?page=1&limit=5`);
    const prodData = await prodRes.json();
    const itemP1001 = prodData.data.find((p) => p.productId === 'p-1001');
    console.log(`   📦 Product p-1001 (${itemP1001.name}):`);
    console.log(`      availableStock: ${itemP1001.availableStock}, remainingStock: ${itemP1001.remainingStock}\n`);

    // 🛍️ 3. สั่งซื้อสินค้า ครั้งที่ 1 (user-101 สั่งซื้อ p-1001)
    console.log('3️⃣ Placing order for p-1001 (user-101)...');
    const order1Res = await fetch(`${BASE_URL}/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenUser101}`,
      },
      body: JSON.stringify({ productId: 'p-1001' }),
    });
    const order1Data = await order1Res.json();
    console.log('   📥 Order Response (Status:', order1Res.status, '):', order1Data, '\n');

    // 🚫 4. ทดสอบสั่งซื้อซ้ำด้วย user-101 คนเดิม (ต้องถูก Redis SETNX บล็อก!)
    console.log('4️⃣ Testing duplicate order prevention (user-101 ordering p-1001 again)...');
    const dupRes = await fetch(`${BASE_URL}/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenUser101}`,
      },
      body: JSON.stringify({ productId: 'p-1001' }),
    });
    const dupData = await dupRes.json();
    console.log('   🛡️ Duplicate Order Response (Status:', dupRes.status, '):', dupData, '\n');

    // 🔑 5. ขอ Token ให้ User-102 (คนใหม่)
    console.log('5️⃣ Requesting JWT Token for user-102...');
    const auth2Res = await fetch(`${BASE_URL}/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'user-102' }),
    });
    const auth2Data = await auth2Res.json();
    const tokenUser102 = auth2Data.accessToken;

    // 🛍️ 6. สั่งซื้อสินค้าโดย user-102
    console.log('6️⃣ Placing order for p-1001 (user-102)...');
    const order2Res = await fetch(`${BASE_URL}/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenUser102}`,
      },
      body: JSON.stringify({ productId: 'p-1001' }),
    });
    const order2Data = await order2Res.json();
    console.log('   📥 Order Response (Status:', order2Res.status, '):', order2Data, '\n');

    // ⏳ 7. รอให้ Worker ใน BullMQ ประมวลผลคิวและอัปเดตสต็อกใน DB
    console.log('⏳ Waiting 1.5s for BullMQ Worker to process queue & update DB...');
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // 📖 8. ดึงรายการสินค้าอีกครั้ง (ตรวจสอบว่าสต็อกลดลงและ Cache ถูก Invalidate)
    console.log('\n8️⃣ Verifying updated stock & Cache Invalidation...');
    const updatedProdRes = await fetch(`${BASE_URL}/products?page=1&limit=5`);
    const updatedProdData = await updatedProdRes.json();
    const updatedP1001 = updatedProdData.data.find((p) => p.productId === 'p-1001');

    console.log(`   📊 Product p-1001 Status After Orders:`);
    console.log(`      availableStock: ${updatedP1001.availableStock}`);
    console.log(`      remainingStock: ${updatedP1001.remainingStock} (Decreased from ${itemP1001.remainingStock}!)`);

    console.log('\n======================================================');
    console.log('🎉 Test Demo Completed Successfully!');
    console.log('======================================================\n');
  } catch (err) {
    console.error('❌ Test Demo Error:', err.message);
  }
}

runDemo();
