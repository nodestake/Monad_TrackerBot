import {t,maximumTextLength} from './i18n.ts';
import {formatMon} from './monad.ts';
import {ServiceError} from './errors.ts';
import type {StakingCandidate} from './staking.ts';
export interface StakingMember {kind:'wallet'|'validator';target:string;name:string;version:number}
export interface StakingDisplay {event:StakingCandidate;members:StakingMember[]}
const titles:Record<string,string>={Delegate:'🟢 Delegate · 委托增加',Undelegate:'🟡 Undelegate · 解除委托',Withdraw:'提款已完成',ClaimRewards:'奖励领取记录',CommissionChanged:'执行佣金变化',ValidatorStatusChanged:'Validator 链上 flags 变化',ValidatorCreated:'Validator 已创建'};
export function stakingEventText(item:StakingDisplay,reserve=false,compact=false):string {
  const f=item.event.fields,name=(m:StakingMember)=>reserve?'😀'.repeat(32):m.name;
  const validator=item.members.find(m=>m.kind==='validator');
  const sign=item.event.name==='Delegate'?'+':item.event.name==='Undelegate'?'−':'';
  return `${t(titles[item.event.name]??item.event.name)}${f.amount!==undefined?' '+sign+formatMon(BigInt(f.amount))+' MON':''}\n${validator?name(validator)+' · #':'Validator #'}${f.validatorId}`+
    (f.delegator?t('\n委托人：')+f.delegator:'')+(!compact&&f.activationEpoch?t('\n生效 Epoch：')+f.activationEpoch:'')+
    (!compact&&f.withdrawId!==undefined?t('\n提款编号：')+f.withdrawId:'')+(f.flags!==undefined?t('\nflags：')+f.flags:'')+
    (f.newCommission!==undefined?t('\n执行佣金（1e18 基数）：')+f.oldCommission+' → '+f.newCommission:'')+
    item.members.filter(m=>m.kind==='wallet').map(m=>t('\n钱包：')+name(m)).join('')+
    (!compact&&item.event.name==='Delegate'?t('\nDelegate 也包含复投。'):'');
}
export function paginateStaking(items:StakingDisplay[]):StakingDisplay[][] {
  const pages:StakingDisplay[][]=[];let current:StakingDisplay[]=[],size=0;
  for(const item of items){const length=maximumTextLength(()=>stakingEventText(item,true))+2;if(length>3300)throw new ServiceError('staking_message_capacity');
    if(size+length>3300&&current.length){pages.push(current);current=[];size=0;}current.push(item);size+=length;}
  if(current.length)pages.push(current);return pages;
}
export function stakingPageText(items:StakingDisplay[],page:number,pages:number,compact=false):string {
  if(!items.length)throw new ServiceError('staking_no_members');
  const e=items[0]!.event,text=`${items.map(i=>stakingEventText(i,false,compact)).join('\n\n')}${compact?'':t('\n区块：')+e.blockNumber}${pages>1?t('\n第 ')+page+'/'+pages+t(' 页'):''}\nhttps://monadscan.com/tx/${e.txHash}`;
  if(text.length>3900)throw new ServiceError('staking_message_capacity');return text;
}
