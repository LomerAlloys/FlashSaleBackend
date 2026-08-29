import { MigrationInterface, QueryRunner } from "typeorm";

export class InitSchema1787802529312 implements MigrationInterface {
    name = 'InitSchema1787802529312'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

        // docker-compose โหลด db/init.sql ตอน init volume แล้ว — อย่า CREATE ซ้ำ
        if (!(await queryRunner.hasTable('orders'))) {
            await queryRunner.query(`CREATE TABLE "orders" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" character varying NOT NULL, "productId" character varying NOT NULL, "status" character varying NOT NULL DEFAULT 'processing', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_585301298a872ec1a71edfe63a6" UNIQUE ("userId", "productId"), CONSTRAINT "PK_710e2d4957aa5878dfe94e4ac2f" PRIMARY KEY ("id"))`);
        }
        if (!(await queryRunner.hasTable('products'))) {
            await queryRunner.query(`CREATE TABLE "products" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "productId" character varying NOT NULL, "name" character varying NOT NULL, "description" text, "price" numeric(10,2) NOT NULL, "availableStock" integer NOT NULL, "remainingStock" integer NOT NULL, "isFlashSaleActive" boolean NOT NULL DEFAULT false, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_7b3b507508cd0f86a5b2e923459" UNIQUE ("productId"), CONSTRAINT "CHK_55ee0eba82442da3b94e7f4c5a" CHECK ("remainingStock" >= 0), CONSTRAINT "PK_0806c755e0aca124e67c0cf6d7d" PRIMARY KEY ("id"))`);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "products"`);
        await queryRunner.query(`DROP TABLE "orders"`);
    }

}
