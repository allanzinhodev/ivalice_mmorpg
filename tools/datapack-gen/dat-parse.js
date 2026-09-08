// Parser que espelha ThingType::unserialize do client.
const fs=require('fs');
const b=fs.readFileSync(process.argv[2]);
let o=0;
const sig=b.readUInt32LE(o); o+=4;
const nItems=b.readUInt16LE(o); o+=2;
const nOut=b.readUInt16LE(o); o+=2;
const nEff=b.readUInt16LE(o); o+=2;
const nMis=b.readUInt16LE(o); o+=2;
console.log(`sig=0x${sig.toString(16)} items=${nItems} outfits=${nOut} effects=${nEff} missiles=${nMis}`);

function parseThing(label, hasFrameGroups){
  const start=o;
  const attrs=[];
  while(o<b.length){
    const a=b[o];
    if(a===0xFF){o++;break;}
    o++;
    // atributos com payload (8.60 / tfs1.4)
    if(a===0)      { attrs.push(`ground(speed=${b.readUInt16LE(o)})`); o+=2; }
    else if(a===8) { attrs.push('writable'); o+=2; }
    else if(a===9) { attrs.push('writableOnce'); o+=2; }
    else if(a===16){ attrs.push('light'); o+=4; }
    else if(a===19){ attrs.push('elevation'); o+=2; }
    else if(a===24){ attrs.push(`displacement(${b.readUInt16LE(o)},${b.readUInt16LE(o+2)})`); o+=4; }
    else if(a===27){ attrs.push('minimapColor'); o+=2; }
    else if(a===28){ attrs.push('lensHelp'); o+=2; }
    else if(a===29){ attrs.push('cloth'); o+=2; }
    else if(a===30){ attrs.push('market'); /* market tem payload variavel */ }
    else attrs.push(String(a));
  }
  const groups = hasFrameGroups ? b[o++] : 1;
  let totalSprites=0, info=[];
  for(let g=0; g<groups; g++){
    if(hasFrameGroups) o++; // frameGroupType
    const w=b[o], h=b[o+1]; o+=2;
    if(w>1||h>1) o++;
    const layers=b[o], px=b[o+1], py=b[o+2], pz=b[o+3], phases=b[o+4]; o+=5;
    if(phases>1){ // Animator::unserialize: async(u8)+loop(i32)+start(u8) + phases*(min,max u32)
      o += 1+4+1 + phases*8;
    }
    const n=w*h*layers*px*py*pz*phases;
    const sprites=[];
    for(let k=0;k<n;k++){ sprites.push(b.readUInt32LE(o)); o+=4; }
    totalSprites+=n;
    info.push(`${w}x${h} layers=${layers} pat=${px},${py},${pz} phases=${phases} sprites=[${sprites.join(',')}]`);
  }
  console.log(`  ${label}: attrs=[${attrs.join(' ')}] groups=${groups} ${info.join(' | ')}`);
  return o-start;
}

console.log('--- ITENS ---');
for(let i=100;i<=nItems;i++) parseThing('id '+i, false);
console.log('--- OUTFITS (frame groups) ---');
for(let i=1;i<=nOut;i++) parseThing('outfit '+i, true);
console.log('--- EFFECTS ---');
for(let i=1;i<=nEff;i++) parseThing('effect '+i, false);
console.log('--- MISSILES ---');
for(let i=1;i<=nMis;i++) parseThing('missile '+i, false);
console.log(`offset final=${o} tamanho=${b.length} ${o===b.length?'OK':'<<< SOBRA/FALTA'}`);
