import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { confirmedExternalTransfer, confirmedFailedExternalTransfer, address, formatMon } from '../src/monad.ts';
import { TRANSFER_TOPIC, addressTopic, confirmedTransfer, transferCandidate, uniqueTransfers, formatTokenAmount, decodeDecimals, decodeTokenText } from '../src/erc20.ts';
import { APPROVAL_TOPIC, approvalCandidate, confirmedApproval } from '../src/approval.ts';
import { parseCommand } from '../src/commands.ts';
import { parseMinimumMon, nativeNotificationText } from '../src/notifications.ts';
import { withLanguage, t } from '../src/i18n.ts';
import { telegramHtml } from '../src/telegram-text.ts';
import { signatureHash } from '../src/evm-abi.ts';
import { STAKING_EVENTS, STAKING_SELECTORS, confirmedStaking } from '../src/staking.ts';
import { paginateStaking, stakingPageText } from '../src/staking-notifications.ts';
import { alice, bob, token, txHash, blockHash, transaction, receipt, block, rewardLog } from '../examples/fixtures.ts';

test('MON amounts preserve all 18 decimals without floating point', () => {
  assert.equal(formatMon(10n ** 30n + 1n), '1000000000000.000000000000000001');
  assert.equal(confirmedExternalTransfer(transaction, receipt, block, 100n)?.mon, '1.000000000000000001');
  assert.equal(parseMinimumMon('0.000000000000000001'), '1');
  for (const value of ['-1', '1e-3', '.1', '01', '0.0000000000000000001']) {
    assert.throws(() => parseMinimumMon(value));
  }
});

test('MON receipt presence cannot bypass finality or canonical block checks', () => {
  assert.throws(() => confirmedExternalTransfer(transaction, receipt, block, 99n), /not_finalized/);
  assert.throws(() => confirmedExternalTransfer(transaction, { ...receipt, blockHash: '0x' + 'c'.repeat(64) }, block, 100n), /canonical_mismatch/);
  assert.throws(() => confirmedExternalTransfer(transaction, receipt, { ...block, transactions: [] }, 100n), /transaction_not_in_block/);
  assert.equal(confirmedExternalTransfer({ ...transaction, to: null }, receipt, block, 100n), null);
  assert.equal(confirmedExternalTransfer({ ...transaction, value: '0x0' }, receipt, block, 100n), null);
});

test('a failed MON transfer is an attempt, not a successful receipt', () => {
  const failedReceipt = { ...receipt, status: '0x0' };
  assert.equal(confirmedExternalTransfer(transaction, failedReceipt, block, 100n), null);
  const failed = confirmedFailedExternalTransfer(transaction, failedReceipt, block, 100n)!;
  assert.equal(failed.feeWei, '21000');
  assert.match(nativeNotificationText([{
    name: 'Demo wallet', address: alice, from_address: alice, to_address: bob,
    wei: failed.wei, tx_hash: txHash, block_number: 100, block_time: 0,
    transaction_status: 'failed', fee_wei: failed.feeWei,
  }], 0), /not transferred/);
});

function tokenLog(topic = TRANSFER_TOPIC, data = '0x' + '0'.repeat(63) + '1') {
  return {
    address: token, blockHash, transactionHash: txHash, blockNumber: '0x64',
    transactionIndex: '0x0', logIndex: '0x0', removed: false,
    topics: [topic, addressTopic(alice), addressTopic(bob)], data,
  };
}

test('ERC20 confirmation requires the exact successful receipt log', () => {
  const log = tokenLog();
  const proof = { ...receipt, logs: [log] };
  assert.equal(confirmedTransfer(log, proof, block, 100n).rawAmount, '1');
  assert.throws(() => confirmedTransfer(log, { ...proof, status: '0x0' }, block, 100n), /receipt_unsuccessful/);
  assert.throws(() => confirmedTransfer(log, { ...proof, logs: [] }, block, 100n), /receipt_log_missing/);
  assert.throws(() => confirmedTransfer(log, proof, block, 99n), /not_finalized/);
  assert.throws(() => transferCandidate({ ...log, removed: true }), /removed_or_provisional/);
  assert.equal(transferCandidate({ ...log, topics: [...log.topics, '0x' + '0'.repeat(64)] }), null);
});

test('ERC20 duplicates are stable, ordered, and conflict checked', () => {
  const a = transferCandidate(tokenLog())!;
  const b = transferCandidate({ ...tokenLog(), logIndex: '0xa' })!;
  assert.deepEqual(uniqueTransfers([b, a, a]).map(event => event.logIndex), ['0', '10']);
  assert.throws(() => uniqueTransfers([a, { ...a, rawAmount: '2' }]), /conflicting_duplicate/);
  assert.equal(transferCandidate({ ...tokenLog(), topics: [TRANSFER_TOPIC, addressTopic('0x' + '0'.repeat(40)), addressTopic(bob)] })?.kind, 'mint');
});

test('token metadata is bounded and unknown decimals stay explicit', () => {
  assert.equal(formatTokenAmount('1000001', 6), '1.000001');
  assert.equal(formatTokenAmount('1000001', null), '1000001 raw units');
  assert.equal(decodeDecimals('0x' + '0'.repeat(62) + '12'), 18);
  const encoded = '0x' + Buffer.from('DEMO').toString('hex').padEnd(64, '0');
  assert.equal(decodeTokenText(encoded), 'DEMO');
  assert.throws(() => decodeTokenText('0x' + '01'.repeat(32)));
  assert.throws(() => formatTokenAmount((2n ** 256n).toString(), 18));
});

test('approval events distinguish maximum and revoked allowances', () => {
  const maximum = tokenLog(APPROVAL_TOPIC, '0x' + 'f'.repeat(64));
  const revoked = tokenLog(APPROVAL_TOPIC, '0x' + '0'.repeat(64));
  assert.equal(approvalCandidate(maximum)?.kind, 'maximum');
  assert.equal(approvalCandidate(revoked)?.kind, 'revoked');
  assert.equal(confirmedApproval(maximum, { ...receipt, logs: [maximum] }, block, 100n).from, alice);
  assert.throws(() => confirmedApproval(maximum, { ...receipt, logs: [revoked] }, block, 100n), /receipt_log_mismatch/);
});

test('wallet commands validate addresses, names, thresholds, and language', () => {
  assert.deepEqual(parseCommand(`/add ${alice} Demo wallet`), { kind: 'add', address: alice, name: 'Demo wallet' });
  assert.equal(parseCommand(`/add@Monad_TrackerBot ${alice}`).kind, 'add');
  assert.deepEqual(parseCommand('/language zh'), { kind: 'language', language: 'zh' });
  assert.deepEqual(parseCommand(`/pause ${alice}`), { kind: 'pause', address: alice });
  assert.deepEqual(parseCommand(`/approval ${alice} off`), { kind: 'approval', address: alice, enabled: false });
  assert.deepEqual(parseCommand(`/min ${alice} 0.1`), { kind: 'min', address: alice, wei: '100000000000000000' });
  assert.throws(() => parseCommand(`/add ${alice} ${'a'.repeat(33)}`), /invalid_wallet_name/);
  assert.throws(() => parseCommand('/language fr'), /invalid_language/);
  assert.throws(() => address('0x123'), /invalid_address/);
  assert.throws(() => parseCommand(`/pause ${alice} extra`), /invalid_command/);
});

test('parallel language contexts cannot leak between users', async () => {
  const result = await Promise.all(['en', 'zh'].map(language => withLanguage(language, async () => {
    await new Promise(resolve => setTimeout(resolve, 1));
    return t('我的钱包');
  })));
  assert.deepEqual(result, ['My wallet', '我的钱包']);
});

test('notification formatting escapes user text and keeps safe explorer links', () => {
  const html = telegramHtml(`<b>Demo & wallet</b> ${alice} https://monadscan.com/tx/${txHash}`);
  assert.match(html, /&lt;b&gt;Demo &amp; wallet&lt;\/b&gt;/);
  assert.ok(html.includes(`href="https://monadscan.com/address/${alice}"`));
  assert.ok(html.includes(`href="https://monadscan.com/tx/${txHash}"`));
  assert.match(html, /View transaction/);
});

test('MON notifications render both directions and both languages', () => {
  const item = { name: 'Demo wallet', address: bob, from_address: alice, to_address: bob,
    wei: '1000000000000000001', tx_hash: txHash, block_number: 100, block_time: 0 };
  assert.match(withLanguage('en', () => nativeNotificationText([item], 0)), /1\.000000000000000001 MON · Received/);
  assert.match(withLanguage('zh', () => nativeNotificationText([item], 0)), /转入/);
  assert.match(nativeNotificationText([{ ...item, address: alice }], 0), /Sent/);
});

test('reward-claim notifications use the confirmed event delegator and exact amount', () => {
  const raw = rewardLog();
  const event = confirmedStaking(raw, { ...receipt, logs: [raw] }, block, 100n);
  const items = [{ event, members: [{ kind: 'wallet' as const, target: alice, name: 'Demo wallet', version: 1 }] }];
  assert.equal(event.fields.delegator, alice);
  assert.match(withLanguage('en', () => stakingPageText(items, 1, 1)), /Rewards claimed 0\.25 MON/);
  assert.match(withLanguage('zh', () => stakingPageText(items, 1, 1)), /奖励领取记录/);
  const pages = paginateStaking(Array(100).fill(items[0]));
  assert.ok(pages.length > 1);
  assert.equal(pages.flat().length, 100);
  pages.forEach((page, index) => assert.ok(stakingPageText(page, index + 1, pages.length).length <= 3900));
});

test('public ABI signatures agree with independently computed Keccak hashes', () => {
  assert.equal(signatureHash('Transfer(address,address,uint256)'), TRANSFER_TOPIC);
  for (const event of STAKING_EVENTS) assert.equal(signatureHash(event.signature), event.topic);
  const reference = JSON.parse(readFileSync(new URL('../abi/staking.json', import.meta.url), 'utf8'));
  for (const fn of reference.functions) assert.equal(signatureHash(fn.signature).slice(0, 10), STAKING_SELECTORS[fn.name]);
});
