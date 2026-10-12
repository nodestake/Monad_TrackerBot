// Synthetic values for the offline demo and tests; no live account data.
import { STAKING_ADDRESS } from '../src/monad.ts';
import { STAKING_EVENTS, stakingWord } from '../src/staking.ts';

export const alice = '0x' + '1'.repeat(40);
export const bob = '0x' + '2'.repeat(40);
export const token = '0x' + '3'.repeat(40);
export const txHash = '0x' + 'a'.repeat(64);
export const blockHash = '0x' + 'b'.repeat(64);
export const block = { number: '0x64', hash: blockHash, transactions: [txHash] };
export const transaction = {
  hash: txHash, blockHash, blockNumber: '0x64',
  from: alice, to: bob, value: '0xde0b6b3a7640001', gas: '0x5208',
};
export const receipt = {
  transactionHash: txHash, blockHash, blockNumber: '0x64',
  transactionIndex: '0x0', status: '0x1', gasUsed: '0x5208',
  effectiveGasPrice: '0x1', logs: [] as unknown[],
};

export function rewardLog() {
  const schema = STAKING_EVENTS.find(event => event.name === 'ClaimRewards')!;
  return {
    address: STAKING_ADDRESS, blockHash, transactionHash: txHash,
    blockNumber: '0x64', transactionIndex: '0x0', logIndex: '0x0', removed: false,
    topics: [schema.topic, '0x' + stakingWord(7n), '0x' + alice.slice(2).padStart(64, '0')],
    data: '0x' + stakingWord(25n * 10n ** 16n) + stakingWord(100n),
  };
}
