# ⚡ Flash Sale Backend System
*(Mobile Backend Architecture & High-Performance Testing)*

ระบบ Backend สำหรับแอปพลิเคชันมือถือในสถานการณ์ **Flash Sale** ออกแบบด้วยสถาปัตยกรรมแบบ **High Throughput & Low Latency** เพื่อรองรับการยิงคำขอพร้อมกันมหาศาล ป้องกันการกดซื้อซ้ำซ้อน และการันตีว่าสต็อกสินค้าไม่มีทางติดลบ (**Zero Overbooking**)

---

## 📐 1. ภาพรวมสถาปัตยกรรมระบบ (Architecture Overview)

```text
                               ┌───────────────────────────┐
                               │  Client App / k6 Test     │
                               └─────────────┬─────────────┘
                                             │ (Port 8080)
                                             ▼
                               ┌───────────────────────────┐
                               │    Nginx Load Balancer    │ (Least Connections + RAM Microcache)
                               └─────────────┬─────────────┘
                                             │
         ┌───────────────┬──────────────────┼──────────────────┬───────────────┐
         ▼               ▼                  ▼                  ▼               │
  ┌────────────┐  ┌────────────┐     ┌────────────┐     ┌────────────┐         │
  │    api1    │  │    api2    │     │    api3    │     │    api4    │         │
  │  (NestJS)  │  │  (NestJS)  │     │  (NestJS)  │     │  (NestJS)  │         │
  └──────┬─────┘  └──────┬─────┘     └──────┬─────┘     └──────┬─────┘         │
         │               │                  │                  │               │
         └───────────────┴─────────┬────────┴──────────────────┘               │
                                    │ (Redis Caching & Lock, BullMQ enqueue)     │
                                    ▼                                           │
                       ┌────────────────────┐                                  │
                       │    Redis Cache     │                                  │
                       │  (Cache-Aside +    │                                  │
                       │  Lock + Queue)     │                                  │
                       └──────────┬─────────┘                                  │
                                  │ (BullMQ Worker — เดินอยู่ในทุก api instance)   │
                                  ▼                                            │
                       ┌────────────────────┐                                  │
                       │  PostgreSQL DB     │◄─────────────────────────────────┘
                       │  (Single Instance, │      (health check ทุก instance)
                       │  Pessimistic Lock) │
                       └────────────────────┘

               Bull-Board Dashboard: http://localhost:8080/admin/queues
```

> **หมายเหตุ:** ไม่มี DB Replication (Master/Replica) — ใช้ Postgres instance เดียว เพราะ read replica lag ทำให้ `remainingStock` ที่ตอบกลับไม่ตรงความจริง ซึ่งขัดกับข้อกำหนดเรื่องความถูกต้องของสต็อกโดยตรง

### 🌟 ฟีเจอร์สำคัญในระบบ:
1. **Load Balancing (Nginx):** กระจายคำขอไปยัง 4 Backend Instances แบบ Least Connections พร้อม RAM Microcache (`/dev/shm`) สำหรับ `GET /products`
2. **Stateless Authentication (JWT):** ยืนยันตัวตนด้วย JSON Web Token
3. **Read-Heavy Caching (Redis Cache-Aside):** แคชรายการสินค้า และทำการ **Cache Invalidation** ทันทีเมื่อสต็อกมีการอัปเดต
4. **API-Level Concurrency Locking (Redis SETNX):** ล็อกสิทธิ์ด้วย Redis Atomic Operation ป้องกันผู้ใช้คนเดิมกดซื้อซ้ำซ้อน
5. **Asynchronous Order Queue (BullMQ):** ส่งคำสั่งซื้อเข้า Message Queue ตอบกลับ `202 Accepted` ทันทีภายในมิลลิวินาที
6. **Worker DB Stock Deduction:** Worker ตัดสต็อกใน PostgreSQL ด้วย **Pessimistic Write Locking (`pessimistic_write`)** การันตีว่าสต็อกห้ามติดลบเด็ดขาด

---

## 📂 2. โครงสร้างโฟลเดอร์โปรเจกต์ (Project Directory)

```text
FlashSaleBackend/
├── src/
│   ├── auth/                   <-- ระบบ JWT Authentication (POST /api/v1/auth/token)
│   ├── products/               <-- ระบบจัดการและแคชสินค้า (GET /api/v1/products)
│   ├── orders/                 <-- Controller + Service สั่งซื้อ (POST /api/v1/orders, ไม่เขียน DB)
│   ├── worker/                 <-- BullMQ Worker ตัดสต็อก (order.processor.ts)
│   ├── entities/                <-- Product/Order TypeORM entities (ใช้ร่วมกันทั้งระบบ)
│   ├── common/                  <-- Redis provider, JWT guard, exception filter ที่ใช้ร่วมกัน
│   ├── migrations/              <-- TypeORM migrations (schema จริง — ต้องรันเองด้วย npm run migration:run)
│   ├── app.module.ts
│   └── main.ts                 <-- มีการเปิด Bull-Board Monitoring
├── db/
│   └── init.sql                <-- สำเนา SQL อ้างอิง (ต้นแบบจริงคือ src/migrations/)
├── loadtest/
│   ├── loadtest.js              <-- k6 Load Test Script
│   ├── test-demo.js             <-- สคริปต์ทดสอบ/chaos suite แบบ interactive
│   └── verify.js                <-- เช็คผลลัพธ์จริงใน DB (stock/order count)
├── docker-compose.yml           <-- Nginx + 4 API Instances + PostgreSQL (เดี่ยว, ไม่มี replica) + Redis
├── nginx.conf                  <-- ค่าคอนฟิก Nginx Load Balancer
├── .env                        <-- การตั้งค่าตัวแปรระบบ
└── package.json
```

---

## 🚀 3. ขั้นตอนการติดตั้งและรันระบบ (Getting Started)

หลังจากทำการ Clone Repository นี้มาแล้ว:

```bash
git clone <repository_url>
cd FlashSaleBackend
```

### 🔹 วิธีที่ 1: รันทั้งระบบด้วย Docker Compose (1-Click Start)

```bash
docker compose up -d --build
```

**คำสั่งเดียวจบ** — ไม่ต้องรัน migration แยกเองอีกแล้ว ระบบจะไล่ทำตามลำดับนี้ให้อัตโนมัติทั้งหมดผ่าน Docker Compose healthcheck + `depends_on`:

1. `postgres` / `redis` บูตขึ้นจนพร้อมรับ connection จริง (`healthcheck`)
2. service `migrate` (one-off) รัน TypeORM migration สร้าง schema + seed สินค้า 20 รายการ ให้จบก่อน
3. `api1`-`api4` ถึงจะเริ่มบูต แล้วรอจน `/api/v1/health` ตอบ 200 จริง (healthcheck) ก่อนนับว่าพร้อม
4. `nginx` ถึงจะเริ่มทำงานหลังจาก api ทั้ง 4 ตัว healthy ครบ

เช็คสถานะ:
```bash
docker compose ps   # ทุกตัวต้องขึ้น Up (healthy) ยกเว้น migrate ที่ควรเป็น Exited (0) = สำเร็จ
```

> ℹ️ เดิมเคยลองให้ Postgres auto-run schema เองผ่าน `docker-entrypoint-initdb.d` (`init.sql`) แต่พบว่า**ไม่เสถียร** (บางรอบไม่มีข้อมูลเข้ามา) จึงตัดออกแล้วยึด TypeORM migration (`src/migrations/`) เป็นแหล่งเดียวเท่านั้น ตามกฎ "schema มาจากทางเดียว"

---

### 🔹 วิธีที่ 2: รันเฉพาะฐานข้อมูล แล้วรัน NestJS บนเครื่อง (Development Mode)

```bash
# 1. ติดตั้ง Dependencies
npm install

# 2. เปิดเฉพาะ Postgres DB และ Redis ใน Docker
docker compose up -d postgres redis

# 3. รัน migration (โหมดนี้รันนอก Docker เลยต้องสั่งเอง ไม่มี migrate service ช่วย)
npm run migration:run

# 4. รัน NestJS ในโหมด Watch (Port 3000)
npm run start:dev
```

---

## 🔥 4. Warm-up ก่อนยิง Load Test จริง (สำคัญมาก — อย่าข้าม!)

> **สรุปสั้นๆ:** อย่ายิง k6 ทันทีหลัง `docker compose up -d --build` แม้ `docker compose ps` จะขึ้น
> `healthy` ครบแล้วก็ตาม — ให้วอร์มระบบก่อนเสมอ ไม่งั้น write p95 รอบแรกจะสูงผิดปกติ (cold start)
> ทั้งที่โค้ด/config ไม่มีอะไรผิด

### ทำไมต้องวอร์ม?

ทดสอบจริงบนเซิร์ฟเวอร์ (4 vCPU) เจอผลต่างกันชัดเจนระหว่าง "ยิงทันทีหลัง build" กับ "ยิงตอนระบบอุ่นแล้ว"
โดยที่**ไม่ได้แก้โค้ดหรือ config อะไรเลยระหว่างสองรอบนี้**:

| สถานะระบบตอนยิง k6 | write p95 | ผ่าน `<1500ms` ไหม |
|---|---|---|
| Container เพิ่ง `Up` ได้ ~1 นาที (cold) | **1.58s** | ❌ ไม่ผ่าน |
| ยิงซ้ำทันทีหลังจากนั้น (container เดิม ไม่ restart) | **736ms** | ✅ ผ่านสบายๆ |

สาเหตุที่ระบบ "เย็น" ตอบช้ากว่าปกติชั่วคราว:
- **Node.js V8 JIT** ยังไม่ optimize hot path ของโค้ด (request แรกๆ รันแบบ interpret ช้ากว่า compiled code)
- **TypeORM/pg connection pool** (25 connection ต่อ api instance × 4 = สูงสุด 100) ยังไม่มี connection
  จริงเปิดค้างไว้เลย — เพิ่งมาเปิดตอนโดน request burst แรกพร้อมกันหลายสิบ connection รวด
- **ioredis** เพิ่งต่อ Redis ครั้งแรก ยังไม่มี pipeline/connection ที่ warm อยู่แล้ว

`healthcheck` ของ Docker Compose เช็คแค่ "service ตอบสนองได้" (`/api/v1/health` ตอบ 200) ไม่ได้แปลว่า
"ระบบพร้อมรับ 500 concurrent writes พร้อมกันแบบเต็มประสิทธิภาพ" สองอย่างนี้คนละเรื่องกัน

### วิธีวอร์ม (รันหลัง `docker compose ps` ขึ้น healthy ครบ, ก่อนรัน k6 จริง)

ใช้ **user/product ที่ไม่ใช่ตัวที่โหลดเทสต์จริงใช้** (`p-1001`) เพื่อไม่ให้ไปแตะสต็อกที่โจทย์จะเช็ค —
วอร์มด้วย `p-1002` แทน (สต็อก 20 ชิ้น เยอะพอไม่มีทางหมดจากการวอร์ม 5 ครั้ง):

**PowerShell:**
```powershell
Write-Host "🔥 กำลังวอร์มระบบ 20-30 วินาที..."
$warmToken = (Invoke-RestMethod -Uri "http://localhost:8080/api/v1/auth/token" -Method Post -ContentType "application/json" -Body '{"userId":"warmup-user"}').accessToken

1..30 | ForEach-Object {
    Invoke-RestMethod -Uri "http://localhost:8080/api/v1/products?page=1&limit=10" -Method Get | Out-Null
}
1..5 | ForEach-Object {
    try {
        Invoke-RestMethod -Uri "http://localhost:8080/api/v1/orders" -Method Post `
            -Headers @{ "Authorization" = "Bearer $warmToken" } -ContentType "application/json" `
            -Body '{"productId":"p-1002"}' | Out-Null
    } catch {}  # 409 ถ้าเคยวอร์มไปแล้วก่อนหน้า ไม่ใช่ปัญหา
}
Start-Sleep -Seconds 5   # ให้ worker/DB pool settle อีกนิด
Write-Host "✅ วอร์มเสร็จ พร้อมยิง k6 จริงแล้ว"
```

**Bash:**
```bash
echo "🔥 กำลังวอร์มระบบ..."
TOKEN=$(curl -s -X POST http://localhost:8080/api/v1/auth/token \
  -H "Content-Type: application/json" -d '{"userId":"warmup-user"}' | jq -r .accessToken)

for i in $(seq 1 30); do curl -s "http://localhost:8080/api/v1/products?page=1&limit=10" > /dev/null; done
for i in $(seq 1 5); do
  curl -s -X POST http://localhost:8080/api/v1/orders \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{"productId":"p-1002"}' > /dev/null
done
sleep 5
echo "✅ วอร์มเสร็จ พร้อมยิง k6 จริงแล้ว"
```

ลำดับขั้นตอนที่ถูกต้องทั้งหมด:

```bash
docker compose down -v && docker compose up -d --build   # 1. เริ่มสะอาด, stock เต็ม
# รอจน docker compose ps ขึ้น healthy ครบ แล้วค่อยรันสคริปต์วอร์มด้านบน (ใช้ p-1002)
# 2. วอร์มระบบ (สคริปต์ข้างบน)
# 3. ยิง k6 จริงได้เลย — p-1001 ยังเหลือ 50 อยู่ เพราะวอร์มไม่ได้แตะมัน
```

**ห้ามสลับลำดับ**: ถ้า `down -v` ใหม่หลังวอร์มไปแล้ว จะเสียการวอร์มทั้งหมดกลับไปเย็นเหมือนเดิม

---

## 🔌 5. รายละเอียด API Endpoints & วิธีการทดสอบด้วย PowerShell

Prefix หลักของทุก API คือ **`/api/v1`**

### 1️⃣ ขอ JWT Token (Authentication)
* **Endpoint:** `POST /api/v1/auth/token`
* **PowerShell Command:**
  ```powershell
  $token = (Invoke-RestMethod -Uri "http://localhost:8080/api/v1/auth/token" -Method Post -ContentType "application/json" -Body '{"userId": "user-001"}').accessToken
  Write-Host "🔑 ได้รับ Token เรียบร้อยแล้ว:" $token
  ```
* **Response (200 OK):**
  ```json
  {
    "status": "success",
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR..."
  }
  ```

---

### 2️⃣ ดึงรายการสินค้า (Read-Heavy Cache-Aside)
* **Endpoint:** `GET /api/v1/products?page=1&limit=10`
* **PowerShell Command:**
  ```powershell
  Invoke-RestMethod -Uri "http://localhost:8080/api/v1/products?page=1&limit=5" -Method Get | ConvertTo-Json -Depth 3
  ```
* **Response (200 OK):**
  ```json
  {
    "status": "success",
    "data": [
      {
        "productId": "p-1001",
        "name": "Limited Edition Sneaker",
        "price": 2990,
        "availableStock": 50,
        "remainingStock": 50,
        "isFlashSaleActive": true
      }
    ],
    "meta": {
      "total": 20,
      "page": 1,
      "limit": 5,
      "totalPages": 4
    }
  }
  ```

---

### 3️⃣ สั่งซื้อสินค้า Flash Sale (Write-Heavy Asynchronous Order)
* **Endpoint:** `POST /api/v1/orders`
* **Headers:** `Authorization: Bearer <accessToken>`
* **PowerShell Command:**
  ```powershell
  Invoke-RestMethod -Uri "http://localhost:8080/api/v1/orders" -Method Post -Headers @{ "Authorization" = "Bearer $token" } -ContentType "application/json" -Body '{"productId": "p-1001"}' | ConvertTo-Json
  ```
* **Response (202 Accepted):**
  ```json
  {
    "status": "processing",
    "orderJobId": "job-1",
    "message": "Your order is in the queue."
  }
  ```

*(หมายเหตุ: หากรันแบบ Local Dev Mode สามารถเปลี่ยน URL จาก `http://localhost:8080/api/v1/...` เป็น `http://localhost:3000/api/v1/...`)*

---

## 🧪 6. สคริปต์ทดสอบระบบ (Testing & Verification)

### 🔹 สคริปต์ทดสอบอัตโนมัติ / Chaos Suite (Interactive)
เมนูให้เลือกทดสอบทีละสถานการณ์ (spam attack, overbooking, edge cases, ฯลฯ) หรือรันครบทุกเคสรวดเดียว:

```bash
node loadtest/test-demo.js
```

---

### 🔹 สคริปต์ k6 Load Test
เตรียม JWT 500 users → GET 1,000 concurrent → POST 500 concurrent แย่งกันกดสั่งซื้อสินค้า `p-1001`:

> ⚠️ **อย่าลืมวอร์มระบบก่อน (ดูข้อ 4 ด้านบน)** ไม่งั้น write p95 รอบแรกจะขึ้นสูงผิดปกติ

**ถ้ามี k6 ติดตั้งในเครื่องแล้ว (รันชี้เข้า localhost):**
```bash
k6 run loadtest/loadtest.js
```

**ถ้าไม่มี k6 ในเครื่อง (ใช้ Docker แทน — ใช้คำสั่งนี้ยิงเซิร์ฟเวอร์จริงข้ามเครื่องได้ด้วย):**
```powershell
Get-Content .\loadtest\loadtest.js | docker run --rm -i grafana/k6 run -e BASE_URL=http://<SERVER_IP>:8080/api/v1 -
```

---

### 🔹 ตรวจผลลัพธ์จริงในฐานข้อมูล (หลังยิง k6 แล้ว)
เช็คว่าสต็อกเหลือ 0 พอดี และมี order จาก user ไม่ซ้ำกันครบตามสต็อก:

```bash
node loadtest/verify.js
```

หรือเช็คตรงใน Postgres เลย (คอลัมน์เป็น camelCase ต้องใส่ `"..."` ครอบชื่อ ไม่งั้น Postgres จะ
fold เป็นตัวพิมพ์เล็กแล้วหา column ไม่เจอ):

```bash
docker compose exec postgres psql -U myuser -d flash_sale_db -c "
  SELECT \"remainingStock\" FROM products WHERE \"productId\"='p-1001';
  SELECT COUNT(*) AS total_orders, COUNT(DISTINCT \"userId\") AS unique_users, MAX(cnt) AS max_per_user
  FROM (SELECT \"userId\", COUNT(*) cnt FROM orders WHERE \"productId\"='p-1001' GROUP BY \"userId\") t;
"
```

เกณฑ์ผ่าน: `remainingStock=0` พอดี, `total_orders=50`, `unique_users=50`, `max_per_user=1`

---

## 🩺 7. Troubleshooting — เจอปัญหาที่ไม่ได้มาจากโค้ด

รวมปัญหาที่เคยเจอจริงตอนรันบนเซิร์ฟเวอร์จริง ซึ่งไม่ใช่บั๊กของแอป แต่ทำให้ผล Load Test ดูเหมือนพัง —
เช็คตรงนี้ก่อนสงสัยว่าโค้ดมีปัญหา

### Write p95 พังเฉพาะรอบแรกหลัง `docker compose up`
→ นี่คือ **cold start** (ดูรายละเอียดเต็มในข้อ 4) ให้วอร์มระบบก่อนยิงจริงเสมอ

### Write p95 พังหนักผิดปกติ ทั้งที่เพิ่งวอร์มไปแล้ว / เคยผ่านมาก่อน
→ เช็คว่ามี process อื่นแย่ง CPU อยู่หรือเปล่า โดยเฉพาะถ้าเซิร์ฟเวอร์มีคนต่อ VS Code Remote-SSH
เข้ามาทำงานด้วย (แล้วปิดหน้าต่างไม่สะอาด process อาจค้างไม่ตายตาม):

```bash
uptime                              # ดู load average — ถ้าใกล้/เกินจำนวน core ตลอดเวลา = มีอะไรกิน CPU ค้าง
top -bn1 -o %CPU | head -15         # ดู process ที่กิน CPU สูงสุด
ps -eo pid,etime,cmd | grep claude  # เคยเจอ `claude auth status --json` ค้างกิน CPU 90-100%
                                     # ตัวละ ~2 ชม. เพราะ VS Code Remote-SSH session หลุดแบบไม่ clean
```

ถ้าเจอ process ค้างแบบนี้ (etime นานผิดปกติ, %CPU สูงติดต่อกัน) `kill -9 <PID>` ทิ้งได้เลย ไม่กระทบ
ข้อมูลหรือ container ของแอป — เป็นแค่ debug tool ที่ค้าง ไม่ใช่ส่วนหนึ่งของระบบ Flash Sale

### Read p95 พังไปด้วยทั้งที่ไม่ควรแตะ backend เลย (มี Nginx cache แล้ว)
→ เช็คว่า `nginx.conf` ยังเป็น `worker_processes 2;` อยู่ไหม (ห้ามใช้ `auto` ถ้า deploy บนเครื่องที่
อาจถูกจำกัด CPU quota ด้วย cgroup เพราะ `nproc` ในคอนเทนเนอร์จะเห็น core ของ**โฮสต์**ทั้งหมด ไม่ใช่
โควต้าจริงที่ได้ ทำให้ spawn worker process เกินจำเป็นจนแย่ง CPU กันเอง):

```bash
docker compose exec nginx sh -c "ps aux | grep 'nginx: worker' | wc -l"   # ควรได้เลขน้อยๆ (~4)
```

---

## 📊 8. Observability & Queue Dashboard (Bull-Board)

สามารถเปิดดูสถานะการทำงานของคิว (Jobs in Queue, Active, Completed, Failed) ได้ผ่านหน้าเว็บ Dashboard:

👉 **[http://localhost:8080/admin/queues](http://localhost:8080/admin/queues)** (หรือ `http://localhost:3000/admin/queues`)
