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
                                             │ (Port 8080)
                                             ▼
                               ┌───────────────────────────┐
                               │    Nginx Load Balancer    │ (least_conn)
                               └─────────────┬─────────────┘
                                             │
                  ┌──────────────────────────┼──────────────────────────┐
                  ▼                          ▼                          ▼
       ┌────────────────────┐     ┌────────────────────┐     ┌────────────────────┐
       │   api1 (NestJS)    │     │   api2 (NestJS)    │     │   api3 (NestJS)    │
       │    (Instance 1)    │     │    (Instance 2)    │     │    (Instance 3)    │
       └──────────┬─────────┘     └──────────┬─────────┘     └──────────┬─────────┘
                  │                          │                          │
                  ├──────────────────────────┼──────────────────────────┤
                  │ (Redis Caching & Lock)   │ (BullMQ Order Queue)     │ (Pessimistic Lock)
                  ▼                          ▼                          ▼
       ┌────────────────────┐     ┌────────────────────┐     ┌────────────────────┐
       │    Redis Cache     │     │   BullMQ Queue     │     │  PostgreSQL (1 node)│
       │   (Cache-Aside)    │     │  (Order Worker)     │     │  ไม่ใช้ replica     │
       └────────────────────┘     └────────────────────┘     └────────────────────┘
                                             │
                                             ▼
                               ┌───────────────────────────┐
                               │   Bull-Board Dashboard    │
                               │ http://localhost:8080/admin/queues
                               └───────────────────────────┘
```

> **หมายเหตุ:** ไม่มี DB Replication (Master/Replica) — ใช้ Postgres instance เดียว เพราะ read replica lag ทำให้ `remainingStock` ที่ตอบกลับไม่ตรงความจริง ซึ่งขัดกับข้อกำหนดเรื่องความถูกต้องของสต็อกโดยตรง

### 🌟 ฟีเจอร์สำคัญในระบบ:
1. **Load Balancing (Nginx):** กระจายคำขอไปยัง 3 Backend Instances แบบ **Least Connection**
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
│   ├── auth/                   <-- JWT (POST /api/v1/auth/token)
│   ├── products/               <-- Cache-Aside GET /api/v1/products
│   ├── orders/                 <-- lock + enqueue (POST /api/v1/orders)
│   ├── worker/                 <-- BullMQ ตัดสต็อก
│   ├── app.module.ts
│   └── main.ts                 <-- Bull-Board ที่ /admin/queues
├── db/init.sql                 <-- schema + seed (Postgres โหลดตอน init)
├── docker-compose.yml           <-- Nginx + NestJS × 3 + PostgreSQL ตัวเดียว + Redis
├── nginx.conf                  <-- least_conn
├── loadtest/                   <-- k6 + demo scripts
└── package.json
```

---

## 🚀 3. ขั้นตอนการติดตั้งและรันระบบ (Getting Started)

หลังจากทำการ Clone Repository นี้มาแล้ว:

```bash
git clone <repository_url>
cd FlashSaleBackend
```

### 🔹 วิธีที่ 1: รันทั้งระบบด้วย Docker Compose (แนะนำ)

```bash
# สั่ง Build และรันบริการทั้งหมด (Nginx + 3 APIs + Postgres + Redis)
docker compose up -d --build

# เช็คสถานะ Containers
docker ps

# ล้าง volume เพื่อให้ Postgres โหลด db/init.sql ใหม่
# docker compose down -v
```

> ⚠️ **สำคัญมาก — ต้องรัน migration ทุกครั้งที่เพิ่งสร้าง volume ใหม่ (`docker compose down -v` ตามด้วย `up`)**
> เพราะ `synchronize: false` เสมอ (ตามกฎของโปรเจกต์) จะไม่มีใครสร้างตาราง `products`/`orders` ให้อัตโนมัติ ถ้าไม่รัน migration จะเจอ error แบบ `relation "products" does not exist`
>
> ```bash
> npm install               # ครั้งแรกครั้งเดียว หรือเมื่อมี dependency ใหม่
> npm run migration:run     # รันทุกครั้งหลัง volume ใหม่ — สร้าง schema + seed สินค้า 20 รายการ
> ```
>
> (มีไฟล์ `db/init.sql` / root `init.sql` ที่ Postgres จะ auto-run เองได้ตอน volume ว่างสนิทเช่นกัน แต่ **ไม่เสถียร** — เจอเคสที่รันแล้วไม่มีข้อมูลเข้ามา จึงยึด `npm run migration:run` เป็นวิธีหลักที่ต้องรันเองเสมอ อย่าพึ่ง auto-init เพียงอย่างเดียว)

---

### 🔹 วิธีที่ 2: รันเฉพาะฐานข้อมูล แล้วรัน NestJS บนเครื่อง (Development Mode)

```bash
# 1. ติดตั้ง Dependencies
npm install

# 2. เปิดเฉพาะ Postgres และ Redis ใน Docker
docker compose up -d postgres redis

# 4. รัน NestJS ในโหมด Watch (Port 3000)
npm run start:dev
```

---

## 🔌 4. รายละเอียด API Endpoints & วิธีการทดสอบด้วย PowerShell

Prefix หลักของทุก API คือ **`/api/v1`**

### 1️⃣ ขอ JWT Token (Authentication)
* **Endpoint:** `POST /api/v1/auth/token`
* **PowerShell Command:**
  ```powershell
  $token = (Invoke-RestMethod -Uri "http://localhost:8080/api/v1/auth/token" -Method Post -ContentType "application/json" -Body '{"userId": "user-001"}').accessToken
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

*(หมายเหตุ: ผ่าน Nginx ใช้พอร์ต **8080** · รัน NestJS ตรง ๆ ใช้ `http://localhost:3000/api/v1/...` · `orderJobId` เป็น `job-{userId}_{productId}` เพราะ BullMQ ห้าม `:` ใน jobId)*

---

## 🧪 5. สคริปต์ทดสอบระบบ (Testing & Verification)

### 🔹 สคริปต์ทดสอบอัตโนมัติ / Chaos Suite (Interactive)
เมนูให้เลือกทดสอบทีละสถานการณ์ (spam attack, overbooking, edge cases, ฯลฯ) หรือรันครบทุกเคสรวดเดียว:

```bash
node loadtest/test-demo.js
node loadtest/test-demo.js
```

---

### 🔹 สคริปต์ k6 Load Test
เตรียม JWT 500 users → GET 1,000 concurrent → POST 500 concurrent แย่งกันกดสั่งซื้อสินค้า `p-1001`:

```bash
k6 run loadtest/loadtest.js
```

---

### 🔹 ตรวจผลลัพธ์จริงในฐานข้อมูล (หลังยิง k6 แล้ว)
เช็คว่าสต็อกเหลือ 0 พอดี และมี order จาก user ไม่ซ้ำกันครบตามสต็อก:

```bash
k6 run loadtest/loadtest.js
```

---

## 📊 6. Observability & Queue Dashboard (Bull-Board)

สามารถเปิดดูสถานะการทำงานของคิว (Jobs in Queue, Active, Completed, Failed) ได้ผ่านหน้าเว็บ Dashboard:

👉 **[http://localhost:8080/admin/queues](http://localhost:8080/admin/queues)** (หรือ `http://localhost:3000/admin/queues`)
👉 **[http://localhost:8080/admin/queues](http://localhost:8080/admin/queues)** (หรือ `http://localhost:3000/admin/queues`)
