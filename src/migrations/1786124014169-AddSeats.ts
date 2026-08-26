import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSeats1786124014169 implements MigrationInterface {
    name = 'AddSeats1786124014169'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "students" ADD "remainingSeats" integer NOT NULL DEFAULT '0'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "students" DROP COLUMN "remainingSeats"`);
    }

}
