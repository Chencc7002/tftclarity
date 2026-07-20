function concatBytes(left, right) {
  const result = new Uint8Array(left.length + right.length);
  result.set(left, 0);
  result.set(right, left.length);
  return result;
}

function createUtf8Decoder() {
  let remainder = new Uint8Array(0);

  return {
    decode(arrayBuffer, flush) {
      const incoming = arrayBuffer
        ? new Uint8Array(arrayBuffer)
        : new Uint8Array(0);
      const bytes = concatBytes(remainder, incoming);
      const output = [];
      let index = 0;

      while (index < bytes.length) {
        const first = bytes[index];
        let width = 1;
        let codePoint = first;
        if ((first & 0xe0) === 0xc0) {
          width = 2;
          codePoint = first & 0x1f;
        } else if ((first & 0xf0) === 0xe0) {
          width = 3;
          codePoint = first & 0x0f;
        } else if ((first & 0xf8) === 0xf0) {
          width = 4;
          codePoint = first & 0x07;
        }
        if (index + width > bytes.length && !flush) break;
        if (index + width > bytes.length) {
          output.push("\ufffd");
          index += 1;
          continue;
        }
        let valid = true;
        for (let offset = 1; offset < width; offset += 1) {
          const next = bytes[index + offset];
          if ((next & 0xc0) !== 0x80) {
            valid = false;
            break;
          }
          codePoint = (codePoint << 6) | (next & 0x3f);
        }
        output.push(valid ? String.fromCodePoint(codePoint) : "\ufffd");
        index += valid ? width : 1;
      }
      remainder = index < bytes.length ? bytes.slice(index) : new Uint8Array(0);
      if (flush && remainder.length) {
        output.push("\ufffd");
        remainder = new Uint8Array(0);
      }
      return output.join("");
    }
  };
}

module.exports = { createUtf8Decoder };
