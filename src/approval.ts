// Standard Approval events only; the event reports an amount, not a previous allowance or an allowance query.
// A three-topic Approval is a candidate, not proof of an ERC20 contract's identity.
import { ServiceError, record } from "./errors.ts";
import { CHAIN_ID, address, hash, quantity } from "./monad.ts";

export const APPROVAL_TOPIC = "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925";
export const ZERO_ADDRESS = `0x${"0".repeat(40)}`;
const WORD = /^0x[0-9a-fA-F]{64}$/;

export interface ApprovalCandidate {
  id: string;
  contract: string;
  blockNumber: string;
  blockHash: string;
  txHash: string;
  transactionIndex: string;
  logIndex: string;
  from: string;
  to: string;
  rawAmount: string;
  kind: "set" | "revoked" | "maximum";
  topics: string[];
  data: string;
}

export function addressTopic(value: string): string {
  return `0x${"0".repeat(24)}${address(value).slice(2)}`;
}

function topicAddress(value: unknown): string {
  if (typeof value !== "string" || !/^0x0{24}[0-9a-fA-F]{40}$/.test(value)) {
    throw new ServiceError("invalid_indexed_address");
  }
  return address(`0x${value.slice(-40)}`);
}

export function approvalCandidate(value: unknown): ApprovalCandidate | null {
  const log = record(value);
  if (!Array.isArray(log.topics)) throw new ServiceError("invalid_log_topics");
  if (typeof log.topics[0] !== "string" || log.topics[0].toLowerCase() !== APPROVAL_TOPIC) return null;
  // The standard ERC721 Approval indexes tokenId as a fourth topic.
  if (log.topics.length === 4) return null;
  if (log.topics.length !== 3 || typeof log.data !== "string" || !WORD.test(log.data)) {
    throw new ServiceError("invalid_approval_shape");
  }
  if (log.removed !== false) throw new ServiceError("removed_or_provisional_log");
  const blockHash = hash(log.blockHash), txHash = hash(log.transactionHash);
  const logIndex = quantity(log.logIndex).toString();
  const from = topicAddress(log.topics[1]), to = topicAddress(log.topics[2]);
  return {
    id: `${CHAIN_ID}:${blockHash}:${txHash}:${logIndex}:approval`,
    contract: address(log.address), blockNumber: quantity(log.blockNumber).toString(),
    blockHash, txHash, transactionIndex: quantity(log.transactionIndex).toString(), logIndex,
    from, to, rawAmount: BigInt(log.data).toString(),
    kind: BigInt(log.data)===0n ? "revoked" : BigInt(log.data)===(2n**256n-1n) ? "maximum" : "set",
    topics: log.topics.map(hash), data: log.data.toLowerCase(),
  };
}

export function uniqueApprovals(events: ApprovalCandidate[]): ApprovalCandidate[] {
  const result = new Map<string, ApprovalCandidate>();
  for (const event of events) {
    const previous = result.get(event.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(event)) {
      throw new ServiceError("conflicting_duplicate_log");
    }
    result.set(event.id, event);
  }
  return [...result.values()].sort((a, b) => {
    for (const field of ["blockNumber", "transactionIndex", "logIndex"] as const) {
      const x = BigInt(a[field]), y = BigInt(b[field]);
      if (x !== y) return x < y ? -1 : 1;
    }
    return a.id.localeCompare(b.id);
  });
}

export function confirmedApproval(
  value: unknown, receiptValue: unknown, canonicalBlock: unknown, finalizedHeight: bigint,
): ApprovalCandidate {
  const event = approvalCandidate(value);
  if (!event) throw new ServiceError("not_approval_candidate");
  const receipt = record(receiptValue), block = record(canonicalBlock);
  const height = quantity(block.number);
  if (height > finalizedHeight) throw new ServiceError("not_finalized");
  if (height.toString() !== event.blockNumber || hash(block.hash) !== event.blockHash ||
      hash(receipt.transactionHash) !== event.txHash || hash(receipt.blockHash) !== event.blockHash ||
      quantity(receipt.blockNumber) !== height || quantity(receipt.transactionIndex).toString() !== event.transactionIndex) {
    throw new ServiceError("canonical_mismatch");
  }
  const index = BigInt(event.transactionIndex);
  if (!Array.isArray(block.transactions) || index >= BigInt(block.transactions.length)) {
    throw new ServiceError("transaction_not_in_block");
  }
  const tx = block.transactions[Number(index)];
  if (hash(typeof tx === "string" ? tx : record(tx).hash) !== event.txHash) throw new ServiceError("transaction_not_in_block");
  if (quantity(receipt.status) !== 1n) throw new ServiceError("receipt_unsuccessful");
  if (!Array.isArray(receipt.logs)) throw new ServiceError("receipt_logs_unavailable");
  const matches = receipt.logs.map(record).filter(log => quantity(log.logIndex).toString() === event.logIndex);
  if (matches.length !== 1) throw new ServiceError("receipt_log_missing_or_duplicate");
  const match = approvalCandidate(matches[0]);
  if (!match || JSON.stringify(match) !== JSON.stringify(event)) throw new ServiceError("receipt_log_mismatch");
  return event;
}
