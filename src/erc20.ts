// Standard Transfer parsing and bounded optional metadata; all reads stay read-only.
// A three-topic Transfer is a candidate, not proof of an ERC20 contract's identity.
import { ServiceError, record } from "./errors.ts";
import { CHAIN_ID, address, hash, quantity } from "./monad.ts";

export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
export const ZERO_ADDRESS = `0x${"0".repeat(40)}`;
const WORD = /^0x[0-9a-fA-F]{64}$/;

export interface TransferCandidate {
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
  kind: "transfer" | "mint" | "burn" | "self";
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

export function transferCandidate(value: unknown): TransferCandidate | null {
  const log = record(value);
  if (!Array.isArray(log.topics)) throw new ServiceError("invalid_log_topics");
  if (typeof log.topics[0] !== "string" || log.topics[0].toLowerCase() !== TRANSFER_TOPIC) return null;
  // The standard ERC721 Transfer indexes tokenId as a fourth topic.
  if (log.topics.length === 4) return null;
  if (log.topics.length !== 3 || typeof log.data !== "string" || !WORD.test(log.data)) {
    throw new ServiceError("invalid_transfer_shape");
  }
  if (log.removed !== false) throw new ServiceError("removed_or_provisional_log");
  const blockHash = hash(log.blockHash), txHash = hash(log.transactionHash);
  const logIndex = quantity(log.logIndex).toString();
  const from = topicAddress(log.topics[1]), to = topicAddress(log.topics[2]);
  return {
    id: `${CHAIN_ID}:${blockHash}:${txHash}:${logIndex}:transfer`,
    contract: address(log.address), blockNumber: quantity(log.blockNumber).toString(),
    blockHash, txHash, transactionIndex: quantity(log.transactionIndex).toString(), logIndex,
    from, to, rawAmount: BigInt(log.data).toString(),
    kind: from === to ? "self" : from === ZERO_ADDRESS ? "mint" : to === ZERO_ADDRESS ? "burn" : "transfer",
    topics: log.topics.map(hash), data: log.data.toLowerCase(),
  };
}

export function uniqueTransfers(events: TransferCandidate[]): TransferCandidate[] {
  const result = new Map<string, TransferCandidate>();
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

export function confirmedTransfer(
  value: unknown, receiptValue: unknown, canonicalBlock: unknown, finalizedHeight: bigint,
): TransferCandidate {
  const event = transferCandidate(value);
  if (!event) throw new ServiceError("not_transfer_candidate");
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
  const match = transferCandidate(matches[0]);
  if (!match || JSON.stringify(match) !== JSON.stringify(event)) throw new ServiceError("receipt_log_mismatch");
  return event;
}

export function decodeDecimals(value: unknown): number {
  if (typeof value !== "string" || !WORD.test(value) || BigInt(value) > 255n) {
    throw new ServiceError("invalid_token_decimals");
  }
  return Number(BigInt(value));
}

// Optional metadata: strict single-value ABI, bounded bytes, UTF-8 and display controls.
export function decodeTokenText(value: unknown): string {
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/.test(value) || value.length > 450) {
    throw new ServiceError("invalid_token_text");
  }
  const bytes = Uint8Array.from(value.slice(2).match(/../g)!, byte => Number.parseInt(byte, 16));
  let content: Uint8Array;
  if (bytes.length === 32) {
    const zero = bytes.indexOf(0);
    const end = zero < 0 ? 32 : zero;
    if (bytes.slice(end).some(byte => byte !== 0)) throw new ServiceError("invalid_token_text");
    content = bytes.slice(0, end);
  } else {
    if (bytes.length < 96 || bytes.length % 32 !== 0 || BigInt(`0x${value.slice(2, 66)}`) !== 32n) {
      throw new ServiceError("invalid_token_text");
    }
    const length = BigInt(`0x${value.slice(66, 130)}`);
    if (length < 1n || length > 128n || bytes.length !== 64 + Math.ceil(Number(length) / 32) * 32 ||
        bytes.slice(64 + Number(length)).some(byte => byte !== 0)) throw new ServiceError("invalid_token_text");
    content = bytes.slice(64, 64 + Number(length));
  }
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(content).trim(); }
  catch { throw new ServiceError("invalid_token_text"); }
  if (!text || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(text)) {
    throw new ServiceError("invalid_token_text");
  }
  return text;
}

export function formatTokenAmount(raw: string, decimals: number | null): string {
  if (!/^(?:0|[1-9][0-9]*)$/.test(raw) || raw.length > 78 || BigInt(raw) >= 2n ** 256n) {
    throw new ServiceError("invalid_token_amount");
  }
  if (decimals === null) return `${raw} raw units`;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new ServiceError("invalid_token_decimals");
  if (decimals === 0) return raw;
  const padded = raw.padStart(decimals + 1, "0");
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return `${padded.slice(0, -decimals)}${fraction ? `.${fraction}` : ""}`;
}
