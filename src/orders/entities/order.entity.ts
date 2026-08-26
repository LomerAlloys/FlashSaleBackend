import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Unique } from 'typeorm';

@Entity('orders')
@Unique(['userId', 'productId']) // 1 User สั่งซื้อสินค้า 1 ชนิดได้สูงสุด 1 ชิ้นเท่านั้น
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @Column()
  productId: string;

  @Column({ default: 'processing' })
  status: string;

  @CreateDateColumn()
  createdAt: Date;
}
