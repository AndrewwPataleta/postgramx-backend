import { EscrowStatus } from '../deals/deal-escrow-status.constants';
import { TonTransferStatus } from './ton-transfer-status.constants';
import { TonTransferType } from './ton-transfer-type.constants';

export const TON_PENDING_TRANSFER_TYPES = [
  TonTransferType.PAYOUT,
  TonTransferType.FEE,
] as const;

export const TON_MONITORED_OUTGOING_STATUSES = [
  TonTransferStatus.CREATED,
  TonTransferStatus.BROADCASTED,
] as const;

export const TON_FINALIZE_OUTGOING_STATUSES = [
  TonTransferStatus.CREATED,
  TonTransferStatus.BROADCASTED,
  TonTransferStatus.CONFIRMED,
] as const;

export const TRACKED_ESCROW_STATUSES = [
  EscrowStatus.AWAITING_PAYMENT,
  EscrowStatus.PAID_PARTIAL,
] as const;
