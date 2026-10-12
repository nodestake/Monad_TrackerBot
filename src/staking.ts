// Read-only decoding and validation of Monad staking events and state.
import {ServiceError,record} from './errors.ts';
import {CHAIN_ID,STAKING_ADDRESS,address,hash,quantity} from './monad.ts';
import reference from '../abi/staking.json' with {type:'json'};

export const STAKING_EVENTS=reference.events;
export const STAKING_SELECTORS=Object.fromEntries(reference.functions.map(f=>[f.name,f.selector]));
const MAX_UINT64=2n**64n-1n;
const MAX_COMMISSION=10n**18n;
const WORD=/^[0-9a-fA-F]{64}$/;
function decodeWord(value:unknown,type:string):string {
  if(typeof value!=='string'||!WORD.test(value))throw new ServiceError('invalid_staking_word');
  const n=BigInt('0x'+value);
  if(type==='address') {
    if(n>=2n**160n)throw new ServiceError('invalid_staking_address_padding');
    return address('0x'+value.slice(-40));
  }
  const bits=type==='uint8'?8:type==='uint32'?32:type==='uint64'?64:type==='uint256'?256:0;
  if(!bits||n>=2n**BigInt(bits))throw new ServiceError('invalid_staking_integer');
  return n.toString();
}
function abiWords(value:unknown,maxWords=256):string[] {
  if(typeof value!=='string'||!/^0x[0-9a-fA-F]*$/.test(value)||(value.length-2)%64||value.length>2+maxWords*64)throw new ServiceError('invalid_staking_abi');
  return value.slice(2).match(/.{64}/g)??[];
}
function tuple(value:unknown,types:string[]):string[] {
  const words=abiWords(value);
  if(words.length!==types.length)throw new ServiceError('invalid_staking_tuple');
  return types.map((type,i)=>decodeWord(words[i],type));
}
export function stakingWord(value:string|bigint,bits:8|32|64|256=256):string {
  if(typeof value==='string'&&!/^(0|[1-9][0-9]*)$/.test(value))throw new ServiceError('invalid_staking_argument');
  const n=BigInt(value);
  if(n<0n||n>=2n**BigInt(bits))throw new ServiceError('invalid_staking_argument');
  return n.toString(16).padStart(64,'0');
}
export interface StakingCandidate {
  id:string;name:string;blockNumber:string;blockHash:string;txHash:string;transactionIndex:string;logIndex:string;
  fields:Record<string,string>;topics:string[];data:string;
}
export function stakingCandidate(value:unknown):StakingCandidate|null {
  const log=record(value);
  if(address(log.address)!==STAKING_ADDRESS)return null;
  if(!Array.isArray(log.topics))throw new ServiceError('invalid_staking_topics');
  const topics=log.topics;
  const signature=typeof topics[0]==='string'?topics[0].toLowerCase():'';
  const schema=STAKING_EVENTS.find(e=>e.topic===signature);
  if(!schema)return null;
  const indexed=schema.inputs.filter(i=>i.indexed),dataFields=schema.inputs.filter(i=>!i.indexed);
  const words=abiWords(log.data);
  if(topics.length!==indexed.length+1||words.length!==dataFields.length)throw new ServiceError('invalid_staking_event_shape');
  if(log.removed!==false)throw new ServiceError('removed_or_provisional_log');
  const fields:Record<string,string>={};
  indexed.forEach((input,i)=>{const topic=hash(topics[i+1]);fields[input.name]=decodeWord(topic.slice(2),input.type);});
  dataFields.forEach((input,i)=>{fields[input.name]=decodeWord(words[i],input.type);});
  if(fields.validatorId==='0')throw new ServiceError('invalid_staking_validator_id');
  for(const key of ['commission','oldCommission','newCommission'])if(fields[key]!==undefined&&BigInt(fields[key]!)>MAX_COMMISSION)throw new ServiceError('invalid_staking_commission');
  const blockHash=hash(log.blockHash),txHash=hash(log.transactionHash),logIndex=quantity(log.logIndex).toString();
  return {id:`${CHAIN_ID}:${blockHash}:${txHash}:${logIndex}:staking:${schema.name}`,name:schema.name,
    blockNumber:quantity(log.blockNumber).toString(),blockHash,txHash,transactionIndex:quantity(log.transactionIndex).toString(),logIndex,
    fields,topics:topics.map(hash),data:String(log.data).toLowerCase()};
}
export function uniqueStaking(events:StakingCandidate[]):StakingCandidate[] {
  const seen=new Map<string,StakingCandidate>();
  for(const event of events){const old=seen.get(event.id);if(old&&JSON.stringify(old)!==JSON.stringify(event))throw new ServiceError('conflicting_duplicate_staking_log');seen.set(event.id,event);}
  return [...seen.values()].sort((a,b)=>{
    for(const key of ['blockNumber','transactionIndex','logIndex'] as const){const x=BigInt(a[key]),y=BigInt(b[key]);if(x!==y)return x<y?-1:1;}
    return a.id.localeCompare(b.id);
  });
}
export function confirmedStaking(value:unknown,receiptValue:unknown,blockValue:unknown,finalized:bigint):StakingCandidate {
  const event=stakingCandidate(value);if(!event)throw new ServiceError('not_staking_event');
  const receipt=record(receiptValue),block=record(blockValue),height=quantity(block.number);
  if(height>finalized)throw new ServiceError('not_finalized');
  if(event.blockNumber!==height.toString()||event.blockHash!==hash(block.hash)||hash(receipt.blockHash)!==event.blockHash||hash(receipt.transactionHash)!==event.txHash||
    quantity(receipt.blockNumber)!==height||quantity(receipt.transactionIndex).toString()!==event.transactionIndex)throw new ServiceError('canonical_mismatch');
  const index=BigInt(event.transactionIndex);
  if(!Array.isArray(block.transactions)||index>=BigInt(block.transactions.length))throw new ServiceError('transaction_not_in_block');
  const tx=block.transactions[Number(index)];if(hash(typeof tx==='string'?tx:record(tx).hash)!==event.txHash)throw new ServiceError('transaction_not_in_block');
  if(quantity(receipt.status)!==1n)throw new ServiceError('receipt_unsuccessful');
  if(!Array.isArray(receipt.logs))throw new ServiceError('receipt_logs_unavailable');
  const matching=receipt.logs.map(record).filter(l=>quantity(l.logIndex).toString()===event.logIndex);
  if(matching.length!==1)throw new ServiceError('receipt_log_missing_or_duplicate');
  const actual=stakingCandidate(matching[0]);if(!actual||JSON.stringify(actual)!==JSON.stringify(event))throw new ServiceError('receipt_log_mismatch');
  return event;
}
export function decodeEpoch(value:unknown):{epoch:string;inEpochDelayPeriod:boolean} {
  const words=abiWords(value);if(words.length!==2)throw new ServiceError('invalid_staking_epoch');
  const epoch=decodeWord(words[0],'uint64'),flag=BigInt('0x'+words[1]);
  if(flag>1n)throw new ServiceError('invalid_staking_epoch');
  return {epoch,inEpochDelayPeriod:flag===1n};
}
export function decodeValidatorPage(value:unknown,nextBits:32|64=32):{isDone:boolean;next:string;ids:string[]} {
  const words=abiWords(value,104);
  if(words.length<4||BigInt('0x'+words[0])>1n||BigInt('0x'+words[2])!==96n)throw new ServiceError('invalid_staking_page');
  const n=BigInt('0x'+words[3]);if(n>100n||words.length!==Number(n)+4)throw new ServiceError('invalid_staking_page');
  const ids=words.slice(4).map(w=>decodeWord(w,'uint64'));
  if(ids.includes('0')||new Set(ids).size!==ids.length)throw new ServiceError('invalid_staking_page');
  return {isDone:BigInt('0x'+words[0])===1n,next:decodeWord(words[1],nextBits===32?'uint32':'uint64'),ids};
}
export function decodeDelegator(value:unknown) {
  const names=['stake','accRewardPerToken','unclaimedRewards','deltaStake','nextDeltaStake','deltaEpoch','nextDeltaEpoch'];
  const values=tuple(value,['uint256','uint256','uint256','uint256','uint256','uint64','uint64']);
  return Object.fromEntries(names.map((name,i)=>[name,values[i]!]));
}
export function decodeWithdrawal(value:unknown) {
  const [withdrawalAmount,accRewardPerToken,withdrawEpoch]=tuple(value,['uint256','uint256','uint64']);
  // Raw ABI field only: do not treat this value alone as a maturity deadline.
  return {withdrawalAmount:withdrawalAmount!,accRewardPerToken:accRewardPerToken!,withdrawEpoch:withdrawEpoch!};
}
export function decodeValidator(value:unknown):Record<string,string> {
  const words=abiWords(value,36);
  if(words.length<14)throw new ServiceError('invalid_staking_validator');
  const names=['authAddress','flags','stake','accRewardPerToken','commission','unclaimedRewards','consensusStake','consensusCommission','snapshotStake','snapshotCommission'];
  const values=words.slice(0,10).map((w,i)=>decodeWord(w,i===0?'address':i===1?'uint64':'uint256'));
  const state=Object.fromEntries(names.map((name,i)=>[name,values[i]!]));
  for(const key of ['commission','consensusCommission','snapshotCommission'])if(BigInt(state[key]!)>MAX_COMMISSION)throw new ServiceError('invalid_staking_commission');
  let offset=12;
  const bytes=(slot:number)=>{
    if(BigInt('0x'+words[slot])!==BigInt(offset*32)||offset>=words.length)throw new ServiceError('invalid_staking_dynamic_bytes');
    const length=BigInt('0x'+words[offset]);if(length>256n)throw new ServiceError('invalid_staking_dynamic_bytes');
    const count=Math.ceil(Number(length)/32),raw=words.slice(offset+1,offset+1+count).join('');
    if(raw.length!==count*64||!/^[0]*$/.test(raw.slice(Number(length)*2)))throw new ServiceError('invalid_staking_dynamic_bytes');
    offset+=1+count;return '0x'+raw.slice(0,Number(length)*2).toLowerCase();
  };
  const secpPubkey=bytes(10),blsPubkey=bytes(11);
  if(offset!==words.length)throw new ServiceError('invalid_staking_dynamic_bytes');
  return {...state,secpPubkey,blsPubkey};
}
export function withdrawalIdentity(event:StakingCandidate):string {
  if(event.name!=='Undelegate'&&event.name!=='Withdraw')throw new ServiceError('not_withdrawal_event');
  return `${CHAIN_ID}:${event.fields.validatorId}:${event.fields.delegator}:${event.fields.withdrawId}`;
}
export function validatorId(value:string):string {
  if(!/^[1-9][0-9]*$/.test(value)||value.length>20||BigInt(value)>MAX_UINT64)throw new ServiceError('invalid_staking_validator_id');
  return value;
}
