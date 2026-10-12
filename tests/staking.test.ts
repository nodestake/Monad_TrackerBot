import test from 'node:test';
import assert from 'node:assert/strict';
import {STAKING_ADDRESS} from '../src/monad.ts';
import {STAKING_EVENTS,STAKING_SELECTORS,stakingWord,stakingCandidate,confirmedStaking,uniqueStaking,
  decodeEpoch,decodeValidatorPage,decodeValidator,decodeDelegator,decodeWithdrawal,withdrawalIdentity,validatorId} from '../src/staking.ts';
const owner='0x'+'a'.repeat(40),actor='0x'+'b'.repeat(40);
const blockHash='0x'+'c'.repeat(64),txHash='0x'+'d'.repeat(64);
const abi=(...values:bigint[])=>'0x'+values.map(n=>stakingWord(n)).join('');
function log(name='Delegate',fields:Record<string,string>={},extra:Record<string,unknown>={}) {
  const schema=STAKING_EVENTS.find(e=>e.name===name)!;
  const defaults:Record<string,string>={validatorId:'97',delegator:owner,authAddress:owner,from:actor,amount:'1000000000000000001',
    activationEpoch:'2193',epoch:'2192',oldEpoch:'2192',newEpoch:'2193',withdrawEpoch:'2194',withdrawId:'0',flags:'1',
    oldCommission:'50000000000000000',newCommission:'100000000000000000',commission:'50000000000000000',...fields};
  const word=(name:string,type:string)=>type==='address'?defaults[name]!.slice(2).padStart(64,'0'):stakingWord(defaults[name]!);
  return {address:STAKING_ADDRESS,blockHash,transactionHash:txHash,blockNumber:'0x64',transactionIndex:'0x0',logIndex:'0x2',removed:false,
    topics:[schema.topic,...schema.inputs.filter(i=>i.indexed).map(i=>'0x'+word(i.name,i.type))],
    data:'0x'+schema.inputs.filter(i=>!i.indexed).map(i=>word(i.name,i.type)).join(''),...extra};
}
const block={number:'0x64',hash:blockHash,transactions:[txHash]};
const receipt=(logs:unknown[]=[log()],extra:Record<string,unknown>={})=>({blockHash,transactionHash:txHash,blockNumber:'0x64',transactionIndex:'0x0',status:'0x1',logs,...extra});
function validatorAbi(secp='11'.repeat(33),bls='22'.repeat(48)) {
  const dynamic=(bytes:string)=>stakingWord(BigInt(bytes.length/2))+bytes.padEnd(Math.ceil(bytes.length/64)*64,'0');
  const a=dynamic(secp),b=dynamic(bls);
  return '0x'+owner.slice(2).padStart(64,'0')+[1n,100n,2n,5n*10n**16n,3n,90n,4n*10n**16n,95n,5n*10n**16n,384n,384n+BigInt(a.length/2)].map(n=>stakingWord(n)).join('')+a+b;
}
test('all nine official staking event shapes have distinct stable identities and exact fields',()=>{
  assert.equal(STAKING_EVENTS.length,9);assert.equal(new Set(STAKING_EVENTS.map(e=>e.topic)).size,9);
  assert.equal(STAKING_SELECTORS.delegate,'0x84994fec');assert.equal(STAKING_SELECTORS.getEpoch,'0x757991a8');
  for(const schema of STAKING_EVENTS){const event=stakingCandidate(log(schema.name))!;assert.equal(event.name,schema.name);assert.match(event.id,/^143:/);assert.equal(Object.keys(event.fields).length,schema.inputs.length);}
  assert.equal(stakingCandidate(log())!.fields.amount,'1000000000000000001');
});
test('canonical receipt proof requires finalized block membership and the exact log',()=>{
  const event=confirmedStaking(log(),receipt(),block,100n);assert.equal(event.fields.delegator,owner);
  assert.equal(event.id,`143:${blockHash}:${txHash}:2:staking:Delegate`);
  assert.equal(confirmedStaking(log(),receipt(),{...block,transactions:[{hash:txHash,from:actor}]},100n).id,event.id);
});
test('system epoch logs use the same finalized receipt and membership proof',()=>{
  const raw=log('EpochChanged');const event=confirmedStaking(raw,receipt([raw]),block,100n);
  assert.deepEqual(event.fields,{oldEpoch:'2192',newEpoch:'2193'});
  assert.throws(()=>confirmedStaking(raw,receipt([raw]),{...block,transactions:[]},100n));
});
test('event delegator is independent of transaction sender; Delegate alone is not a deposit classification',()=>{
  const event=confirmedStaking(log(),receipt(),{...block,transactions:[{hash:txHash,from:actor,to:actor,input:STAKING_SELECTORS.compound}]},100n);
  assert.equal(event.fields.delegator,owner);assert.equal(event.name,'Delegate');assert.equal('depositKind' in event,false);
});
test('withdrawal IDs are reusable groups; their origin event identities remain distinct',()=>{
  const first=stakingCandidate(log('Undelegate'))!,second=stakingCandidate(log('Undelegate',{}, {transactionHash:'0x'+'e'.repeat(64)}))!;
  const end=stakingCandidate(log('Withdraw'))!;
  assert.equal(withdrawalIdentity(first),withdrawalIdentity(second));assert.equal(withdrawalIdentity(first),withdrawalIdentity(end));
  assert.notEqual(first.id,second.id);assert.throws(()=>withdrawalIdentity(stakingCandidate(log())!));
});
test('uint64 IDs and uint256 amounts never round; withdrawal IDs and commission are bounded',()=>{
  const max=(2n**64n-1n).toString();assert.equal(validatorId(max),max);
  assert.equal(stakingCandidate(log('Delegate',{validatorId:max,amount:(2n**256n-1n).toString()}))!.fields.validatorId,max);
  assert.equal(stakingCandidate(log('Withdraw',{withdrawId:'255'}))!.fields.withdrawId,'255');
  for(const id of ['0','01','-1','1.2',(2n**64n).toString()])assert.throws(()=>validatorId(id));
  assert.throws(()=>stakingCandidate(log('Withdraw',{withdrawId:'256'})));
  assert.throws(()=>stakingCandidate(log('Delegate',{activationEpoch:(2n**64n).toString()})));
  assert.throws(()=>stakingCandidate(log('CommissionChanged',{newCommission:(10n**18n+1n).toString()})));
  assert.throws(()=>stakingWord('01'));assert.throws(()=>stakingWord(-1n));assert.throws(()=>stakingWord(256n,8));
});
test('other contracts and signatures are excluded but malformed recognized logs fail closed',()=>{
  assert.equal(stakingCandidate(log('Delegate',{}, {address:actor})),null);
  assert.equal(stakingCandidate(log('Delegate',{}, {topics:['0x'+'f'.repeat(64)]})),null);
  for(const extra of [{data:'0x'},{data:'0x01'},{topics:[STAKING_EVENTS.find(e=>e.name==='Delegate')!.topic]},
    {topics:[STAKING_EVENTS.find(e=>e.name==='Delegate')!.topic,'0x'+stakingWord(97n),'0x'+stakingWord(2n**200n)]},
    {removed:true},{removed:undefined},{logIndex:null},{transactionHash:'0x1'}])assert.throws(()=>stakingCandidate(log('Delegate',{},extra)));
  assert.throws(()=>stakingCandidate(log('Delegate',{validatorId:'0'})));
});
test('null, failed, unfinalized, noncanonical and missing or duplicate receipt logs are rejected',()=>{
  assert.throws(()=>confirmedStaking(log(),receipt(),block,99n));
  for(const value of [null,receipt([]),receipt([log(),log()]),receipt([log('Delegate',{amount:'9'})]),receipt([log()],{status:'0x0'}),
    receipt([log()],{blockHash:'0x'+'f'.repeat(64)}),receipt([log()],{transactionHash:'0x'+'f'.repeat(64)}),
    receipt([log()],{blockNumber:'0x65'}),receipt([log()],{transactionIndex:'0x1'})])assert.throws(()=>confirmedStaking(log(),value,block,100n));
  assert.throws(()=>confirmedStaking(log(),receipt(),{...block,transactions:['0x'+'f'.repeat(64)]},100n));
});
test('multiple same-transaction events survive numeric ordering; conflicting repeats are rejected',()=>{
  const a=stakingCandidate(log('Delegate',{}, {logIndex:'0xa'}))!,b=stakingCandidate(log('Undelegate'))!;
  assert.deepEqual(uniqueStaking([a,b,a]).map(e=>e.logIndex),['2','10']);
  assert.throws(()=>uniqueStaking([a,{...a,fields:{...a.fields,amount:'9'}}]));
});
test('epoch decoding distinguishes delay and enforces uint64 and boolean encodings',()=>{
  assert.deepEqual(decodeEpoch(abi(2192n,1n)),{epoch:'2192',inEpochDelayPeriod:true});
  assert.equal(decodeEpoch(abi(2192n,0n)).inEpochDelayPeriod,false);
  for(const raw of [abi(2192n),abi(2192n,2n),abi(2n**64n,0n),abi(2192n,0n,0n)])assert.throws(()=>decodeEpoch(raw));
});
test('validator pages preserve uint64 IDs and require canonical bounded arrays',()=>{
  assert.deepEqual(decodeValidatorPage(abi(0n,100n,96n,2n,97n,2n**64n-1n)),{isDone:false,next:'100',ids:['97',(2n**64n-1n).toString()]});
  assert.deepEqual(decodeValidatorPage(abi(1n,0n,96n,0n)),{isDone:true,next:'0',ids:[]});
  assert.equal(decodeValidatorPage(abi(0n,2n**40n,96n,1n,97n),64).next,(2n**40n).toString());
  for(const raw of [abi(2n,0n,96n,0n),abi(1n,0n,64n,0n),abi(1n,0n,96n,1n),abi(1n,0n,96n,1n,0n),abi(1n,0n,96n,2n,97n,97n),abi(1n,2n**32n,96n,0n)])assert.throws(()=>decodeValidatorPage(raw));
});
test('validator execution, consensus and snapshot state stay separate with strict dynamic public keys',()=>{
  const state=decodeValidator(validatorAbi());assert.equal(state.authAddress,owner);
  assert.equal(state.stake,'100');assert.equal(state.consensusStake,'90');assert.equal(state.snapshotStake,'95');
  assert.equal(state.commission,'50000000000000000');assert.equal(state.consensusCommission,'40000000000000000');
  assert.equal(state.secpPubkey,'0x'+'11'.repeat(33));assert.equal(state.blsPubkey,'0x'+'22'.repeat(48));
  assert.equal(decodeValidator(validatorAbi('','')).secpPubkey,'0x');
  const good=validatorAbi();
  for(const raw of [good+'00',good.slice(0,-2)+'01','0x',good.slice(0,2+10*64)+stakingWord(352n)+good.slice(2+11*64)])assert.throws(()=>decodeValidator(raw));
});
test('delegator fields remain exact and pending deltas do not imply effective consensus stake',()=>{
  const state=decodeDelegator(abi(100n,2n,3n,4n,5n,2193n,2194n));
  assert.equal(state.stake,'100');assert.equal(state.deltaStake,'4');assert.equal(state.nextDeltaEpoch,'2194');
  assert.equal('consensusStake' in state,false);
  assert.throws(()=>decodeDelegator(abi(100n,2n,3n,4n,5n,2n**64n,2194n)));
});
test('withdrawal query records the raw epoch without asserting availability from an ambiguous field',()=>{
  const state=decodeWithdrawal(abi(100n,2n,2192n));assert.deepEqual(state,{withdrawalAmount:'100',accRewardPerToken:'2',withdrawEpoch:'2192'});
  assert.equal('isWithdrawable' in state,false);assert.equal(decodeWithdrawal(abi(0n,0n,0n)).withdrawalAmount,'0');
  assert.throws(()=>decodeWithdrawal(abi(100n,2n,2n**64n)));
});
