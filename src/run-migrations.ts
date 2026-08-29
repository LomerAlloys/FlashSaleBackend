import { AppDataSource } from './data-source';

// รัน migration ผ่าน TypeORM DataSource API โดยตรง (ไม่ผ่าน typeorm CLI/yargs)
// ใช้ในคอนเทนเนอร์ (Node 18) ที่ require() โมดูล ESM อย่าง yargs ของ typeorm CLI ไม่ได้
AppDataSource.initialize()
  .then(async () => {
    const executed = await AppDataSource.runMigrations();
    console.log(`Migrations executed: ${executed.length}`);
    executed.forEach((m) => console.log(`  - ${m.name}`));
    await AppDataSource.destroy();
    process.exit(0);
  })
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
