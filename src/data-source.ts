import { DataSource } from 'typeorm';
import { config } from 'dotenv';

config(); // โหลดค่าจาก .env

// รองรับทั้ง 2 ทาง: รันผ่าน ts-node (dev, ตรงจาก src/*.ts)
// และรันจาก JS ที่ build แล้ว (production/migrate container, ต้องชี้ dist/*.js เท่านั้น
// เพราะ plain node parse TypeScript import syntax ไม่ได้)
const isCompiled = __filename.endsWith('.js');

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  entities: [isCompiled ? 'dist/**/*.entity.js' : 'src/**/*.entity.ts'],
  migrations: [isCompiled ? 'dist/migrations/*.js' : 'src/migrations/*.ts'],
  synchronize: false,
});
