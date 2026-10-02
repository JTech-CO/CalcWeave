/** Fixed SHA-256 over UTF-8, used by the synchronous standalone artifact. No environment globals. */
export function sha256(text: string): string {
  const bytes: number[] = [];
  for (const character of text) {
    const raw = character.codePointAt(0)!;
    const point = raw >= 0xd800 && raw <= 0xdfff ? 0xfffd : raw;
    if (point < 0x80) bytes.push(point);
    else if (point < 0x800) bytes.push(0xc0 | point >>> 6, 0x80 | point & 0x3f);
    else if (point < 0x10000) bytes.push(0xe0 | point >>> 12, 0x80 | point >>> 6 & 0x3f, 0x80 | point & 0x3f);
    else bytes.push(0xf0 | point >>> 18, 0x80 | point >>> 12 & 0x3f, 0x80 | point >>> 6 & 0x3f, 0x80 | point & 0x3f);
  }
  const length = bytes.length;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const bitLength = length * 8;
  const high = Math.floor(bitLength / 4294967296), low = bitLength >>> 0;
  for (const value of [high, low]) for (let shift = 24; shift >= 0; shift -= 8) bytes.push(value >>> shift & 0xff);
  const constants = [
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
  ];
  const state = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const rotate = (value: number, count: number): number => value >>> count | value << (32 - count);
  const words = new Array<number>(64);
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const position = offset + index * 4;
      words[index] = ((bytes[position]! << 24) | (bytes[position + 1]! << 16) | (bytes[position + 2]! << 8) | bytes[position + 3]!) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const a = words[index - 15]!, b = words[index - 2]!;
      const s0 = rotate(a, 7) ^ rotate(a, 18) ^ a >>> 3;
      const s1 = rotate(b, 17) ^ rotate(b, 19) ^ b >>> 10;
      words[index] = (words[index - 16]! + s0 + words[index - 7]! + s1) >>> 0;
    }
    let [a,b,c,d,e,f,g,h] = state as [number,number,number,number,number,number,number,number];
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
      const choice = e & f ^ ~e & g;
      const temporary1 = (h + s1 + choice + constants[index]! + words[index]!) >>> 0;
      const s0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
      const majority = a & b ^ a & c ^ b & c;
      const temporary2 = (s0 + majority) >>> 0;
      h=g; g=f; f=e; e=(d+temporary1)>>>0; d=c; c=b; b=a; a=(temporary1+temporary2)>>>0;
    }
    for (const [index, value] of [a,b,c,d,e,f,g,h].entries()) state[index] = (state[index]! + value) >>> 0;
  }
  return state.map((value) => value.toString(16).padStart(8, '0')).join('');
}
