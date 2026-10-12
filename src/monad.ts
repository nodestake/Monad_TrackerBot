import { ServiceError, record } from "./errors.ts";

export const CHAIN_ID = 143;
export const STAKING_ADDRESS = "0x0000000000000000000000000000000000001000";

export function quantity(value: unknown): bigint {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) {
    throw new ServiceError("invalid_quantity");
  }
  return BigInt(value);
}

export function hex(value: bigint): string { return `0x${value.toString(16)}`; }

export function hash(value: unknown): string {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new ServiceError("invalid_hash");
  }
  return value.toLowerCase();
}

export function address(value: unknown): string {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new ServiceError("invalid_address");
  }
  return value.toLowerCase();
}

export function formatMon(wei: bigint): string {
  const unit = 10n ** 18n;
  const fraction = (wei % unit).toString().padStart(18, "0").replace(/0+$/, "");
  return `${wei / unit}${fraction ? `.${fraction}` : ""}`;
}

export interface NativeTransfer {
  id: string;
  txHash: string;
  blockHash: string;
  blockNumber: string;
  from: string;
  to: string;
  wei: string;
  mon: string;
}

// Caller must fetch this canonical block by NUMBER, at or below a finalized anchor.
export function confirmedExternalTransfer(
  transaction: unknown, receipt: unknown, canonicalBlock: unknown, finalizedHeight: bigint,
): NativeTransfer | null {
  const {tx,rcpt,height,blockHash,txHash,status}=confirmedTransaction(transaction,receipt,canonicalBlock,finalizedHeight);
  if (status === 0n || tx.to === null || quantity(tx.value) === 0n) return null;
  const wei = quantity(tx.value);
  return {
    id: `${CHAIN_ID}:${blockHash}:${txHash}:native:external`,
    txHash, blockHash, blockNumber: height.toString(),
    from: address(tx.from), to: address(tx.to), wei: wei.toString(), mon: formatMon(wei),
  };
}

export interface FailedNativeTransfer extends NativeTransfer {
  feeWei:string;gasLimit:string;gasUsed:string;effectiveGasPrice:string;
}

// A reverted value is an attempt, never a balance movement. Monad charges gas limit.
export function confirmedFailedExternalTransfer(
  transaction:unknown,receipt:unknown,canonicalBlock:unknown,finalizedHeight:bigint,
):FailedNativeTransfer|null {
  const {tx,rcpt,height,blockHash,txHash,status}=confirmedTransaction(transaction,receipt,canonicalBlock,finalizedHeight);
  if(status!==0n||tx.to===null||quantity(tx.value)===0n)return null;
  const gasLimit=quantity(tx.gas),gasUsed=quantity(rcpt.gasUsed),price=quantity(rcpt.effectiveGasPrice);
  if(gasLimit===0n||gasUsed>gasLimit)throw new ServiceError('invalid_failed_transaction_fee');
  const wei=quantity(tx.value);
  return {id:`${CHAIN_ID}:${blockHash}:${txHash}:native:failed`,txHash,blockHash,blockNumber:height.toString(),
    from:address(tx.from),to:address(tx.to),wei:wei.toString(),mon:formatMon(wei),
    feeWei:(gasLimit*price).toString(),gasLimit:gasLimit.toString(),gasUsed:gasUsed.toString(),effectiveGasPrice:price.toString()};
}

function confirmedTransaction(transaction:unknown,receipt:unknown,canonicalBlock:unknown,finalizedHeight:bigint) {
  const tx = record(transaction), rcpt = record(receipt), block = record(canonicalBlock);
  const height = quantity(block.number);
  if (height > finalizedHeight) throw new ServiceError("not_finalized");
  const blockHash = hash(block.hash), txHash = hash(tx.hash);
  if (hash(rcpt.transactionHash) !== txHash || hash(rcpt.blockHash) !== blockHash ||
      hash(tx.blockHash) !== blockHash || quantity(rcpt.blockNumber) !== height || quantity(tx.blockNumber) !== height) {
    throw new ServiceError("canonical_mismatch");
  }
  if (!Array.isArray(block.transactions) || !block.transactions.some(item =>
    hash(typeof item === "string" ? item : record(item).hash) === txHash)) {
    throw new ServiceError("transaction_not_in_block");
  }
  const status = quantity(rcpt.status);
  if (status !== 0n && status !== 1n) throw new ServiceError("invalid_receipt_status");
  return {tx,rcpt,height,blockHash,txHash,status};
}
