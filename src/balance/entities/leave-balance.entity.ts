import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Unique,
} from 'typeorm';

@Entity('leave_balance')
@Unique(['employeeId', 'locationId', 'leaveType'])
export class LeaveBalance {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'employee_id' })
  employeeId: string;

  @Column({ name: 'location_id' })
  locationId: string;

  @Column({ name: 'leave_type' })
  leaveType: string;

  @Column({ name: 'balance_days', type: 'decimal', precision: 5, scale: 1, default: 0 })
  balanceDays: number;

  @Column({ name: 'last_synced_at', type: 'datetime', nullable: true })
  lastSyncedAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
