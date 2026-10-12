import { confirmedExternalTransfer } from '../src/monad.ts';
import { parseCommand } from '../src/commands.ts';
import { nativeNotificationText } from '../src/notifications.ts';
import { confirmedStaking } from '../src/staking.ts';
import { stakingPageText } from '../src/staking-notifications.ts';
import { withLanguage } from '../src/i18n.ts';
import { alice, bob, block, transaction, receipt, rewardLog } from './fixtures.ts';

console.log('Monad TrackerBot — offline demo with synthetic data\n');
console.log('Add wallet:', parseCommand(`/add ${alice} Demo wallet`));
console.log('Set minimum:', parseCommand(`/min ${alice} 0.1`));

const transfer = confirmedExternalTransfer(transaction, receipt, block, 100n)!;
const rawReward = rewardLog();
const reward = confirmedStaking(rawReward, { ...receipt, logs: [rawReward] }, block, 100n);
const now = Date.UTC(2026, 0, 1);

for (const language of ['en', 'zh'] as const) {
  withLanguage(language, () => {
    console.log(`\n--- ${language === 'en' ? 'English' : '中文'} ---\n`);
    console.log(nativeNotificationText([{
      name: 'Demo wallet', address: bob, from_address: alice, to_address: bob,
      wei: transfer.wei, tx_hash: transfer.txHash, block_number: 100, block_time: now,
    }], now));
    console.log('\n' + stakingPageText([{
      event: reward,
      members: [{ kind: 'wallet', target: alice, name: 'Demo wallet', version: 1 }],
    }], 1, 1));
  });
}
