import {ServiceError} from './errors.ts';
import {address} from './monad.ts';
// Keccak-256 (Ethereum), not NIST SHA3. Used for fixed ABI signatures only.
const mask=(1n<<64n)-1n;
const rotations=[0,1,62,28,27,36,44,6,55,20,3,10,43,25,39,41,45,15,21,8,18,2,61,56,14];
const constants=[0x1n,0x8082n,0x800000000000808an,0x8000000080008000n,0x808bn,0x80000001n,0x8000000080008081n,0x8000000000008009n,0x8an,0x88n,0x80008009n,0x8000000an,0x8000808bn,0x800000000000008bn,0x8000000000008089n,0x8000000000008003n,0x8000000000008002n,0x8000000000000080n,0x800an,0x800000008000000an,0x8000000080008081n,0x8000000000008080n,0x80000001n,0x8000000080008008n];
export function signatureHash(text:string):string {
 const bytes=[...new TextEncoder().encode(text),1];while(bytes.length%136!==135)bytes.push(0);bytes.push(128);
 const a=Array<bigint>(25).fill(0n),rot=(x:bigint,n:number)=>((x<<BigInt(n))|(x>>BigInt(64-n)))&mask;
 for(let offset=0;offset<bytes.length;offset+=136){
  for(let i=0;i<136;i++)a[Math.floor(i/8)]^=BigInt(bytes[offset+i]!)<<BigInt(i%8*8);
  for(const rc of constants){
   const c=Array.from({length:5},(_,x)=>a[x]!^a[x+5]!^a[x+10]!^a[x+15]!^a[x+20]!);
   for(let x=0;x<5;x++){const d=c[(x+4)%5]!^rot(c[(x+1)%5]!,1);for(let y=0;y<5;y++)a[x+5*y]^=d;}
   const b=Array<bigint>(25).fill(0n);for(let x=0;x<5;x++)for(let y=0;y<5;y++)b[y+5*((2*x+3*y)%5)]=rot(a[x+5*y]!,rotations[x+5*y]!);
   for(let x=0;x<5;x++)for(let y=0;y<5;y++)a[x+5*y]=b[x+5*y]!^((~b[(x+1)%5+5*y]!)&b[(x+2)%5+5*y]!);
   a[0]^=rc;
  }
 }
 return '0x'+Array.from({length:32},(_,i)=>Number((a[Math.floor(i/8)]!>>BigInt(i%8*8))&255n).toString(16).padStart(2,'0')).join('');
}
export function abi(value:unknown,maxWords=1024):string {
 if(typeof value!=='string'||!/^0x(?:[a-fA-F0-9]{64})*$/.test(value)||value.length>2+maxWords*64)throw new ServiceError('invalid_abi_data');return value.slice(2).toLowerCase();
}
export function word(data:string,index:number,bits=256):bigint {
 if(!Number.isSafeInteger(index)||index<0||index*64+64>data.length)throw new ServiceError('abi_bounds');
 const n=BigInt('0x'+data.slice(index*64,index*64+64));if(n>=(1n<<BigInt(bits)))throw new ServiceError('abi_integer_width');return n;
}
export function abiAddress(data:string,index:number):string {return address('0x'+word(data,index,160).toString(16).padStart(40,'0'));}
export function indexedAddress(value:unknown):string {return abiAddress(abi(value,1),0);}
export function abiOffset(data:string,index:number,min:number):number {
 const n=word(data,index);if(n%32n||n<BigInt(min*32)||n>BigInt(data.length/2-32))throw new ServiceError('abi_offset');return Number(n/32n);
}
