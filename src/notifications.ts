import { t } from './i18n.ts';
import { ServiceError } from './errors.ts';
import { formatMon } from './monad.ts';

const earlierText = (blockTime: number): string =>
  new Date(blockTime).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

export function parseMinimumMon(value:string):string {
  // Decimal input only; no floating point, exponent notation or silent rounding.
  if(!/^(0|[1-9]\d{0,59})(\.\d{1,18})?$/.test(value))throw new ServiceError('invalid_minimum_mon');
  const [whole,fraction='']=value.split('.');
  const wei=BigInt(whole!)*10n**18n+BigInt(fraction.padEnd(18,'0'));
  if(wei>2n**256n-1n)throw new ServiceError('invalid_minimum_mon');
  return wei.toString();
}

export interface NotificationWallet {
  language?:'en'|'zh';name:string;address:string;from_address:string;to_address:string;wei:string;
  tx_hash:string;block_number:number;block_time:number;
  transaction_status?:'success'|'failed';fee_wei?:string|null;
}
export function nativeNotificationText(wallets:NotificationWallet[],now=Date.now(),historical=false):string {
  const event=wallets[0];if(!event)throw new ServiceError('notification_no_wallet');
  const earlier=historical?t('补采')+' · '+earlierText(event.block_time)+'\n\n':now-event.block_time>120_000?t('补报 · '):'';
  if(event.transaction_status==='failed') {
    if(event.address!==event.from_address||event.fee_wei==null)throw new ServiceError('invalid_failed_notification');
    return t`${earlier}❌ MON 发送失败\n${event.name}\n尝试发送：${formatMon(BigInt(event.wei))} MON（未转出）\n手续费：${formatMon(BigInt(event.fee_wei))} MON\n收款地址：${event.to_address}\nhttps://monadscan.com/tx/${event.tx_hash}`;
  }
  const direction=(w:NotificationWallet)=>w.from_address===w.to_address?t('自转'):w.address===w.to_address?t('转入'):t('转出');
  const title=wallets.length>1?t('钱包间转账'):direction(event);
  const names=wallets.map(w=>`${w.name} · ${direction(w)}\n${w.address}`).join('\n');
  const counterparty=wallets.length===1&&event.from_address!==event.to_address?t('\n对方：')+(event.address===event.to_address?event.from_address:event.to_address):'';
  return t`${earlier}${formatMon(BigInt(event.wei))} MON · ${title}\n${names}${counterparty}\n已最终确认\nhttps://monadscan.com/tx/${event.tx_hash}`;
}
