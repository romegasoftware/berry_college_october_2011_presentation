/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set shiftwidth=2 tabstop=2 autoindent cindent expandtab: */

'use strict';

var ERRORS = 0, WARNINGS = 1, TODOS = 5;
var verbosity = WARNINGS;

function log(msg) {
  if (console && console.log)
    console.log(msg);
  else if (print)
    print(msg);
}

function warn(msg) {
  if (verbosity >= WARNINGS)
    log('Warning: ' + msg);
}

function backtrace() {
  var stackStr;
  try {
    throw new Error();
  } catch (e) {
    stackStr = e.stack;
  }
  return stackStr.split('\n').slice(1).join('\n');
}

function error(msg) {
  log(backtrace());
  throw new Error(msg);
}

function TODO(what) {
  if (verbosity >= TODOS)
    log('TODO: ' + what);
}

function malformed(msg) {
  error('Malformed PDF: ' + msg);
}

function assert(cond, msg) {
  if (!cond)
    error(msg);
}

// In a well-formed PDF, |cond| holds.  If it doesn't, subsequent
// behavior is undefined.
function assertWellFormed(cond, msg) {
  if (!cond)
    malformed(msg);
}

function shadow(obj, prop, value) {
  Object.defineProperty(obj, prop, { value: value,
                                     enumerable: true,
                                     configurable: true,
                                     writable: false });
  return value;
}

function bytesToString(bytes) {
  var str = '';
  var length = bytes.length;
  for (var n = 0; n < length; ++n)
    str += String.fromCharCode(bytes[n]);
  return str;
}

function stringToBytes(str) {
  var length = str.length;
  var bytes = new Uint8Array(length);
  for (var n = 0; n < length; ++n)
    bytes[n] = str.charCodeAt(n) & 0xFF;
  return bytes;
}

var PDFStringTranslateTable = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0x2D8, 0x2C7, 0x2C6, 0x2D9, 0x2DD, 0x2DB, 0x2DA, 0x2DC, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x2022, 0x2020, 0x2021, 0x2026, 0x2014,
  0x2013, 0x192, 0x2044, 0x2039, 0x203A, 0x2212, 0x2030, 0x201E, 0x201C,
  0x201D, 0x2018, 0x2019, 0x201A, 0x2122, 0xFB01, 0xFB02, 0x141, 0x152, 0x160,
  0x178, 0x17D, 0x131, 0x142, 0x153, 0x161, 0x17E, 0, 0x20AC
];

function stringToPDFString(str) {
  var i, n = str.length, str2 = '';
  if (str[0] === '\xFE' && str[1] === '\xFF') {
    // UTF16BE BOM
    for (i = 2; i < n; i += 2)
      str2 += String.fromCharCode(
        (str.charCodeAt(i) << 8) | str.charCodeAt(i + 1));
  } else {
    for (i = 0; i < n; ++i) {
      var code = PDFStringTranslateTable[str.charCodeAt(i)];
      str2 += code ? String.fromCharCode(code) : str.charAt(i);
    }
  }
  return str2;
}

//
// getPdf()
// Convenience function to perform binary Ajax GET
// Usage: getPdf('http://...', callback)
//        getPdf({
//                 url:String ,
//                 [,progress:Function, error:Function]
//               },
//               callback)
//
function getPdf(arg, callback) {
  var params = arg;
  if (typeof arg === 'string')
    params = { url: arg };

  var xhr = new XMLHttpRequest();
  xhr.open('GET', params.url);
  xhr.mozResponseType = xhr.responseType = 'arraybuffer';
  xhr.expected = (document.URL.indexOf('file:') === 0) ? 0 : 200;

  if ('progress' in params)
    xhr.onprogrss = params.progress || undefined;

  if ('error' in params)
    xhr.onerror = params.error || undefined;

  xhr.onreadystatechange = function getPdfOnreadystatechange() {
    if (xhr.readyState === 4 && xhr.status === xhr.expected) {
      var data = (xhr.mozResponseArrayBuffer || xhr.mozResponse ||
                  xhr.responseArrayBuffer || xhr.response);
      callback(data);
    }
  };
  xhr.send(null);
}

var Stream = (function streamStream() {
  function constructor(arrayBuffer, start, length, dict) {
    this.bytes = new Uint8Array(arrayBuffer);
    this.start = start || 0;
    this.pos = this.start;
    this.end = (start + length) || this.bytes.length;
    this.dict = dict;
  }

  // required methods for a stream. if a particular stream does not
  // implement these, an error should be thrown
  constructor.prototype = {
    get length() {
      return this.end - this.start;
    },
    getByte: function stream_getByte() {
      if (this.pos >= this.end)
        return null;
      return this.bytes[this.pos++];
    },
    // returns subarray of original buffer
    // should only be read
    getBytes: function stream_getBytes(length) {
      var bytes = this.bytes;
      var pos = this.pos;
      var strEnd = this.end;

      if (!length)
        return bytes.subarray(pos, strEnd);

      var end = pos + length;
      if (end > strEnd)
        end = strEnd;

      this.pos = end;
      return bytes.subarray(pos, end);
    },
    lookChar: function stream_lookChar() {
      if (this.pos >= this.end)
        return null;
      return String.fromCharCode(this.bytes[this.pos]);
    },
    getChar: function stream_getChar() {
      if (this.pos >= this.end)
        return null;
      return String.fromCharCode(this.bytes[this.pos++]);
    },
    skip: function stream_skip(n) {
      if (!n)
        n = 1;
      this.pos += n;
    },
    reset: function stream_reset() {
      this.pos = this.start;
    },
    moveStart: function stream_moveStart() {
      this.start = this.pos;
    },
    makeSubStream: function stream_makeSubstream(start, length, dict) {
      return new Stream(this.bytes.buffer, start, length, dict);
    },
    isStream: true
  };

  return constructor;
})();

var StringStream = (function stringStream() {
  function constructor(str) {
    var length = str.length;
    var bytes = new Uint8Array(length);
    for (var n = 0; n < length; ++n)
      bytes[n] = str.charCodeAt(n);
    Stream.call(this, bytes);
  }

  constructor.prototype = Stream.prototype;

  return constructor;
})();

// super class for the decoding streams
var DecodeStream = (function decodeStream() {
  function constructor() {
    this.pos = 0;
    this.bufferLength = 0;
    this.eof = false;
    this.buffer = null;
  }

  constructor.prototype = {
    ensureBuffer: function decodestream_ensureBuffer(requested) {
      var buffer = this.buffer;
      var current = buffer ? buffer.byteLength : 0;
      if (requested < current)
        return buffer;
      var size = 512;
      while (size < requested)
        size <<= 1;
      var buffer2 = new Uint8Array(size);
      for (var i = 0; i < current; ++i)
        buffer2[i] = buffer[i];
      return (this.buffer = buffer2);
    },
    getByte: function decodestream_getByte() {
      var pos = this.pos;
      while (this.bufferLength <= pos) {
        if (this.eof)
          return null;
        this.readBlock();
      }
      return this.buffer[this.pos++];
    },
    getBytes: function decodestream_getBytes(length) {
      var end, pos = this.pos;

      if (length) {
        this.ensureBuffer(pos + length);
        end = pos + length;

        while (!this.eof && this.bufferLength < end)
          this.readBlock();

        var bufEnd = this.bufferLength;
        if (end > bufEnd)
          end = bufEnd;
      } else {
        while (!this.eof)
          this.readBlock();

        end = this.bufferLength;

        // checking if bufferLength is still 0 then
        // the buffer has to be initialized
        if (!end)
          this.buffer = new Uint8Array(0);
      }

      this.pos = end;
      return this.buffer.subarray(pos, end);
    },
    lookChar: function decodestream_lookChar() {
      var pos = this.pos;
      while (this.bufferLength <= pos) {
        if (this.eof)
          return null;
        this.readBlock();
      }
      return String.fromCharCode(this.buffer[this.pos]);
    },
    getChar: function decodestream_getChar() {
      var pos = this.pos;
      while (this.bufferLength <= pos) {
        if (this.eof)
          return null;
        this.readBlock();
      }
      return String.fromCharCode(this.buffer[this.pos++]);
    },
    makeSubStream: function decodestream_makeSubstream(start, length, dict) {
      var end = start + length;
      while (this.bufferLength <= end && !this.eof)
        this.readBlock();
      return new Stream(this.buffer, start, length, dict);
    },
    skip: function decodestream_skip(n) {
      if (!n)
        n = 1;
      this.pos += n;
    },
    reset: function decodestream_reset() {
      this.pos = 0;
    }
  };

  return constructor;
})();

var FakeStream = (function fakeStream() {
  function constructor(stream) {
    this.dict = stream.dict;
    DecodeStream.call(this);
  }

  constructor.prototype = Object.create(DecodeStream.prototype);
  constructor.prototype.readBlock = function fakeStreamReadBlock() {
    var bufferLength = this.bufferLength;
    bufferLength += 1024;
    var buffer = this.ensureBuffer(bufferLength);
    this.bufferLength = bufferLength;
  };

  constructor.prototype.getBytes = function fakeStreamGetBytes(length) {
    var end, pos = this.pos;

    if (length) {
      this.ensureBuffer(pos + length);
      end = pos + length;

      while (!this.eof && this.bufferLength < end)
        this.readBlock();

      var bufEnd = this.bufferLength;
      if (end > bufEnd)
        end = bufEnd;
    } else {
      this.eof = true;
      end = this.bufferLength;
    }

    this.pos = end;
    return this.buffer.subarray(pos, end);
  };

  return constructor;
})();

var StreamsSequenceStream = (function streamSequenceStream() {
  function constructor(streams) {
    this.streams = streams;
    DecodeStream.call(this);
  }

  constructor.prototype = Object.create(DecodeStream.prototype);

  constructor.prototype.readBlock = function streamSequenceStreamReadBlock() {
    var streams = this.streams;
    if (streams.length == 0) {
      this.eof = true;
      return;
    }
    var stream = streams.shift();
    var chunk = stream.getBytes();
    var bufferLength = this.bufferLength;
    var newLength = bufferLength + chunk.length;
    var buffer = this.ensureBuffer(newLength);
    buffer.set(chunk, bufferLength);
    this.bufferLength = newLength;
  };

  return constructor;
})();

var FlateStream = (function flateStream() {
  var codeLenCodeMap = new Uint32Array([
    16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15
  ]);

  var lengthDecode = new Uint32Array([
    0x00003, 0x00004, 0x00005, 0x00006, 0x00007, 0x00008, 0x00009, 0x0000a,
    0x1000b, 0x1000d, 0x1000f, 0x10011, 0x20013, 0x20017, 0x2001b, 0x2001f,
    0x30023, 0x3002b, 0x30033, 0x3003b, 0x40043, 0x40053, 0x40063, 0x40073,
    0x50083, 0x500a3, 0x500c3, 0x500e3, 0x00102, 0x00102, 0x00102
  ]);

  var distDecode = new Uint32Array([
    0x00001, 0x00002, 0x00003, 0x00004, 0x10005, 0x10007, 0x20009, 0x2000d,
    0x30011, 0x30019, 0x40021, 0x40031, 0x50041, 0x50061, 0x60081, 0x600c1,
    0x70101, 0x70181, 0x80201, 0x80301, 0x90401, 0x90601, 0xa0801, 0xa0c01,
    0xb1001, 0xb1801, 0xc2001, 0xc3001, 0xd4001, 0xd6001
  ]);

  var fixedLitCodeTab = [new Uint32Array([
    0x70100, 0x80050, 0x80010, 0x80118, 0x70110, 0x80070, 0x80030, 0x900c0,
    0x70108, 0x80060, 0x80020, 0x900a0, 0x80000, 0x80080, 0x80040, 0x900e0,
    0x70104, 0x80058, 0x80018, 0x90090, 0x70114, 0x80078, 0x80038, 0x900d0,
    0x7010c, 0x80068, 0x80028, 0x900b0, 0x80008, 0x80088, 0x80048, 0x900f0,
    0x70102, 0x80054, 0x80014, 0x8011c, 0x70112, 0x80074, 0x80034, 0x900c8,
    0x7010a, 0x80064, 0x80024, 0x900a8, 0x80004, 0x80084, 0x80044, 0x900e8,
    0x70106, 0x8005c, 0x8001c, 0x90098, 0x70116, 0x8007c, 0x8003c, 0x900d8,
    0x7010e, 0x8006c, 0x8002c, 0x900b8, 0x8000c, 0x8008c, 0x8004c, 0x900f8,
    0x70101, 0x80052, 0x80012, 0x8011a, 0x70111, 0x80072, 0x80032, 0x900c4,
    0x70109, 0x80062, 0x80022, 0x900a4, 0x80002, 0x80082, 0x80042, 0x900e4,
    0x70105, 0x8005a, 0x8001a, 0x90094, 0x70115, 0x8007a, 0x8003a, 0x900d4,
    0x7010d, 0x8006a, 0x8002a, 0x900b4, 0x8000a, 0x8008a, 0x8004a, 0x900f4,
    0x70103, 0x80056, 0x80016, 0x8011e, 0x70113, 0x80076, 0x80036, 0x900cc,
    0x7010b, 0x80066, 0x80026, 0x900ac, 0x80006, 0x80086, 0x80046, 0x900ec,
    0x70107, 0x8005e, 0x8001e, 0x9009c, 0x70117, 0x8007e, 0x8003e, 0x900dc,
    0x7010f, 0x8006e, 0x8002e, 0x900bc, 0x8000e, 0x8008e, 0x8004e, 0x900fc,
    0x70100, 0x80051, 0x80011, 0x80119, 0x70110, 0x80071, 0x80031, 0x900c2,
    0x70108, 0x80061, 0x80021, 0x900a2, 0x80001, 0x80081, 0x80041, 0x900e2,
    0x70104, 0x80059, 0x80019, 0x90092, 0x70114, 0x80079, 0x80039, 0x900d2,
    0x7010c, 0x80069, 0x80029, 0x900b2, 0x80009, 0x80089, 0x80049, 0x900f2,
    0x70102, 0x80055, 0x80015, 0x8011d, 0x70112, 0x80075, 0x80035, 0x900ca,
    0x7010a, 0x80065, 0x80025, 0x900aa, 0x80005, 0x80085, 0x80045, 0x900ea,
    0x70106, 0x8005d, 0x8001d, 0x9009a, 0x70116, 0x8007d, 0x8003d, 0x900da,
    0x7010e, 0x8006d, 0x8002d, 0x900ba, 0x8000d, 0x8008d, 0x8004d, 0x900fa,
    0x70101, 0x80053, 0x80013, 0x8011b, 0x70111, 0x80073, 0x80033, 0x900c6,
    0x70109, 0x80063, 0x80023, 0x900a6, 0x80003, 0x80083, 0x80043, 0x900e6,
    0x70105, 0x8005b, 0x8001b, 0x90096, 0x70115, 0x8007b, 0x8003b, 0x900d6,
    0x7010d, 0x8006b, 0x8002b, 0x900b6, 0x8000b, 0x8008b, 0x8004b, 0x900f6,
    0x70103, 0x80057, 0x80017, 0x8011f, 0x70113, 0x80077, 0x80037, 0x900ce,
    0x7010b, 0x80067, 0x80027, 0x900ae, 0x80007, 0x80087, 0x80047, 0x900ee,
    0x70107, 0x8005f, 0x8001f, 0x9009e, 0x70117, 0x8007f, 0x8003f, 0x900de,
    0x7010f, 0x8006f, 0x8002f, 0x900be, 0x8000f, 0x8008f, 0x8004f, 0x900fe,
    0x70100, 0x80050, 0x80010, 0x80118, 0x70110, 0x80070, 0x80030, 0x900c1,
    0x70108, 0x80060, 0x80020, 0x900a1, 0x80000, 0x80080, 0x80040, 0x900e1,
    0x70104, 0x80058, 0x80018, 0x90091, 0x70114, 0x80078, 0x80038, 0x900d1,
    0x7010c, 0x80068, 0x80028, 0x900b1, 0x80008, 0x80088, 0x80048, 0x900f1,
    0x70102, 0x80054, 0x80014, 0x8011c, 0x70112, 0x80074, 0x80034, 0x900c9,
    0x7010a, 0x80064, 0x80024, 0x900a9, 0x80004, 0x80084, 0x80044, 0x900e9,
    0x70106, 0x8005c, 0x8001c, 0x90099, 0x70116, 0x8007c, 0x8003c, 0x900d9,
    0x7010e, 0x8006c, 0x8002c, 0x900b9, 0x8000c, 0x8008c, 0x8004c, 0x900f9,
    0x70101, 0x80052, 0x80012, 0x8011a, 0x70111, 0x80072, 0x80032, 0x900c5,
    0x70109, 0x80062, 0x80022, 0x900a5, 0x80002, 0x80082, 0x80042, 0x900e5,
    0x70105, 0x8005a, 0x8001a, 0x90095, 0x70115, 0x8007a, 0x8003a, 0x900d5,
    0x7010d, 0x8006a, 0x8002a, 0x900b5, 0x8000a, 0x8008a, 0x8004a, 0x900f5,
    0x70103, 0x80056, 0x80016, 0x8011e, 0x70113, 0x80076, 0x80036, 0x900cd,
    0x7010b, 0x80066, 0x80026, 0x900ad, 0x80006, 0x80086, 0x80046, 0x900ed,
    0x70107, 0x8005e, 0x8001e, 0x9009d, 0x70117, 0x8007e, 0x8003e, 0x900dd,
    0x7010f, 0x8006e, 0x8002e, 0x900bd, 0x8000e, 0x8008e, 0x8004e, 0x900fd,
    0x70100, 0x80051, 0x80011, 0x80119, 0x70110, 0x80071, 0x80031, 0x900c3,
    0x70108, 0x80061, 0x80021, 0x900a3, 0x80001, 0x80081, 0x80041, 0x900e3,
    0x70104, 0x80059, 0x80019, 0x90093, 0x70114, 0x80079, 0x80039, 0x900d3,
    0x7010c, 0x80069, 0x80029, 0x900b3, 0x80009, 0x80089, 0x80049, 0x900f3,
    0x70102, 0x80055, 0x80015, 0x8011d, 0x70112, 0x80075, 0x80035, 0x900cb,
    0x7010a, 0x80065, 0x80025, 0x900ab, 0x80005, 0x80085, 0x80045, 0x900eb,
    0x70106, 0x8005d, 0x8001d, 0x9009b, 0x70116, 0x8007d, 0x8003d, 0x900db,
    0x7010e, 0x8006d, 0x8002d, 0x900bb, 0x8000d, 0x8008d, 0x8004d, 0x900fb,
    0x70101, 0x80053, 0x80013, 0x8011b, 0x70111, 0x80073, 0x80033, 0x900c7,
    0x70109, 0x80063, 0x80023, 0x900a7, 0x80003, 0x80083, 0x80043, 0x900e7,
    0x70105, 0x8005b, 0x8001b, 0x90097, 0x70115, 0x8007b, 0x8003b, 0x900d7,
    0x7010d, 0x8006b, 0x8002b, 0x900b7, 0x8000b, 0x8008b, 0x8004b, 0x900f7,
    0x70103, 0x80057, 0x80017, 0x8011f, 0x70113, 0x80077, 0x80037, 0x900cf,
    0x7010b, 0x80067, 0x80027, 0x900af, 0x80007, 0x80087, 0x80047, 0x900ef,
    0x70107, 0x8005f, 0x8001f, 0x9009f, 0x70117, 0x8007f, 0x8003f, 0x900df,
    0x7010f, 0x8006f, 0x8002f, 0x900bf, 0x8000f, 0x8008f, 0x8004f, 0x900ff
  ]), 9];

  var fixedDistCodeTab = [new Uint32Array([
    0x50000, 0x50010, 0x50008, 0x50018, 0x50004, 0x50014, 0x5000c, 0x5001c,
    0x50002, 0x50012, 0x5000a, 0x5001a, 0x50006, 0x50016, 0x5000e, 0x00000,
    0x50001, 0x50011, 0x50009, 0x50019, 0x50005, 0x50015, 0x5000d, 0x5001d,
    0x50003, 0x50013, 0x5000b, 0x5001b, 0x50007, 0x50017, 0x5000f, 0x00000
  ]), 5];

  function constructor(stream) {
    var bytes = stream.getBytes();
    var bytesPos = 0;

    this.dict = stream.dict;
    var cmf = bytes[bytesPos++];
    var flg = bytes[bytesPos++];
    if (cmf == -1 || flg == -1)
      error('Invalid header in flate stream: ' + cmf + ', ' + flg);
    if ((cmf & 0x0f) != 0x08)
      error('Unknown compression method in flate stream: ' + cmf + ', ' + flg);
    if ((((cmf << 8) + flg) % 31) != 0)
      error('Bad FCHECK in flate stream: ' + cmf + ', ' + flg);
    if (flg & 0x20)
      error('FDICT bit set in flate stream: ' + cmf + ', ' + flg);

    this.bytes = bytes;
    this.bytesPos = bytesPos;

    this.codeSize = 0;
    this.codeBuf = 0;

    DecodeStream.call(this);
  }

  constructor.prototype = Object.create(DecodeStream.prototype);

  constructor.prototype.getBits = function flateStreamGetBits(bits) {
    var codeSize = this.codeSize;
    var codeBuf = this.codeBuf;
    var bytes = this.bytes;
    var bytesPos = this.bytesPos;

    var b;
    while (codeSize < bits) {
      if (typeof (b = bytes[bytesPos++]) == 'undefined')
        error('Bad encoding in flate stream');
      codeBuf |= b << codeSize;
      codeSize += 8;
    }
    b = codeBuf & ((1 << bits) - 1);
    this.codeBuf = codeBuf >> bits;
    this.codeSize = codeSize -= bits;
    this.bytesPos = bytesPos;
    return b;
  };

  constructor.prototype.getCode = function flateStreamGetCode(table) {
    var codes = table[0];
    var maxLen = table[1];
    var codeSize = this.codeSize;
    var codeBuf = this.codeBuf;
    var bytes = this.bytes;
    var bytesPos = this.bytesPos;

    while (codeSize < maxLen) {
      var b;
      if (typeof (b = bytes[bytesPos++]) == 'undefined')
        error('Bad encoding in flate stream');
      codeBuf |= (b << codeSize);
      codeSize += 8;
    }
    var code = codes[codeBuf & ((1 << maxLen) - 1)];
    var codeLen = code >> 16;
    var codeVal = code & 0xffff;
    if (codeSize == 0 || codeSize < codeLen || codeLen == 0)
      error('Bad encoding in flate stream');
    this.codeBuf = (codeBuf >> codeLen);
    this.codeSize = (codeSize - codeLen);
    this.bytesPos = bytesPos;
    return codeVal;
  };

  constructor.prototype.generateHuffmanTable =
    function flateStreamGenerateHuffmanTable(lengths) {
    var n = lengths.length;

    // find max code length
    var maxLen = 0;
    for (var i = 0; i < n; ++i) {
      if (lengths[i] > maxLen)
        maxLen = lengths[i];
    }

    // build the table
    var size = 1 << maxLen;
    var codes = new Uint32Array(size);
    for (var len = 1, code = 0, skip = 2;
         len <= maxLen;
         ++len, code <<= 1, skip <<= 1) {
      for (var val = 0; val < n; ++val) {
        if (lengths[val] == len) {
          // bit-reverse the code
          var code2 = 0;
          var t = code;
          for (var i = 0; i < len; ++i) {
            code2 = (code2 << 1) | (t & 1);
            t >>= 1;
          }

          // fill the table entries
          for (var i = code2; i < size; i += skip)
            codes[i] = (len << 16) | val;

          ++code;
        }
      }
    }

    return [codes, maxLen];
  };

  constructor.prototype.readBlock = function flateStreamReadBlock() {
    // read block header
    var hdr = this.getBits(3);
    if (hdr & 1)
      this.eof = true;
    hdr >>= 1;

    if (hdr == 0) { // uncompressed block
      var bytes = this.bytes;
      var bytesPos = this.bytesPos;
      var b;

      if (typeof (b = bytes[bytesPos++]) == 'undefined')
        error('Bad block header in flate stream');
      var blockLen = b;
      if (typeof (b = bytes[bytesPos++]) == 'undefined')
        error('Bad block header in flate stream');
      blockLen |= (b << 8);
      if (typeof (b = bytes[bytesPos++]) == 'undefined')
        error('Bad block header in flate stream');
      var check = b;
      if (typeof (b = bytes[bytesPos++]) == 'undefined')
        error('Bad block header in flate stream');
      check |= (b << 8);
      if (check != (~blockLen & 0xffff))
        error('Bad uncompressed block length in flate stream');

      this.codeBuf = 0;
      this.codeSize = 0;

      var bufferLength = this.bufferLength;
      var buffer = this.ensureBuffer(bufferLength + blockLen);
      var end = bufferLength + blockLen;
      this.bufferLength = end;
      for (var n = bufferLength; n < end; ++n) {
        if (typeof (b = bytes[bytesPos++]) == 'undefined') {
          this.eof = true;
          break;
        }
        buffer[n] = b;
      }
      this.bytesPos = bytesPos;
      return;
    }

    var litCodeTable;
    var distCodeTable;
    if (hdr == 1) { // compressed block, fixed codes
      litCodeTable = fixedLitCodeTab;
      distCodeTable = fixedDistCodeTab;
    } else if (hdr == 2) { // compressed block, dynamic codes
      var numLitCodes = this.getBits(5) + 257;
      var numDistCodes = this.getBits(5) + 1;
      var numCodeLenCodes = this.getBits(4) + 4;

      // build the code lengths code table
      var codeLenCodeLengths = new Uint8Array(codeLenCodeMap.length);

      for (var i = 0; i < numCodeLenCodes; ++i)
        codeLenCodeLengths[codeLenCodeMap[i]] = this.getBits(3);
      var codeLenCodeTab = this.generateHuffmanTable(codeLenCodeLengths);

      // build the literal and distance code tables
      var len = 0;
      var i = 0;
      var codes = numLitCodes + numDistCodes;
      var codeLengths = new Uint8Array(codes);
      while (i < codes) {
        var code = this.getCode(codeLenCodeTab);
        if (code == 16) {
          var bitsLength = 2, bitsOffset = 3, what = len;
        } else if (code == 17) {
          var bitsLength = 3, bitsOffset = 3, what = (len = 0);
        } else if (code == 18) {
          var bitsLength = 7, bitsOffset = 11, what = (len = 0);
        } else {
          codeLengths[i++] = len = code;
          continue;
        }

        var repeatLength = this.getBits(bitsLength) + bitsOffset;
        while (repeatLength-- > 0)
          codeLengths[i++] = what;
      }

      litCodeTable =
        this.generateHuffmanTable(codeLengths.subarray(0, numLitCodes));
      distCodeTable =
        this.generateHuffmanTable(codeLengths.subarray(numLitCodes, codes));
    } else {
      error('Unknown block type in flate stream');
    }

    var buffer = this.buffer;
    var limit = buffer ? buffer.length : 0;
    var pos = this.bufferLength;
    while (true) {
      var code1 = this.getCode(litCodeTable);
      if (code1 < 256) {
        if (pos + 1 >= limit) {
          buffer = this.ensureBuffer(pos + 1);
          limit = buffer.length;
        }
        buffer[pos++] = code1;
        continue;
      }
      if (code1 == 256) {
        this.bufferLength = pos;
        return;
      }
      code1 -= 257;
      code1 = lengthDecode[code1];
      var code2 = code1 >> 16;
      if (code2 > 0)
        code2 = this.getBits(code2);
      var len = (code1 & 0xffff) + code2;
      code1 = this.getCode(distCodeTable);
      code1 = distDecode[code1];
      code2 = code1 >> 16;
      if (code2 > 0)
        code2 = this.getBits(code2);
      var dist = (code1 & 0xffff) + code2;
      if (pos + len >= limit) {
        buffer = this.ensureBuffer(pos + len);
        limit = buffer.length;
      }
      for (var k = 0; k < len; ++k, ++pos)
        buffer[pos] = buffer[pos - dist];
    }
  };

  return constructor;
})();

var PredictorStream = (function predictorStream() {
  function constructor(stream, params) {
    var predictor = this.predictor = params.get('Predictor') || 1;

    if (predictor <= 1)
      return stream; // no prediction
    if (predictor !== 2 && (predictor < 10 || predictor > 15))
      error('Unsupported predictor: ' + predictor);

    if (predictor === 2)
      this.readBlock = this.readBlockTiff;
    else
      this.readBlock = this.readBlockPng;

    this.stream = stream;
    this.dict = stream.dict;

    var colors = this.colors = params.get('Colors') || 1;
    var bits = this.bits = params.get('BitsPerComponent') || 8;
    var columns = this.columns = params.get('Columns') || 1;

    this.pixBytes = (colors * bits + 7) >> 3;
    this.rowBytes = (columns * colors * bits + 7) >> 3;

    DecodeStream.call(this);
    return this;
  }

  constructor.prototype = Object.create(DecodeStream.prototype);

  constructor.prototype.readBlockTiff =
    function predictorStreamReadBlockTiff() {
    var rowBytes = this.rowBytes;

    var bufferLength = this.bufferLength;
    var buffer = this.ensureBuffer(bufferLength + rowBytes);
    var currentRow = buffer.subarray(bufferLength, bufferLength + rowBytes);

    var bits = this.bits;
    var colors = this.colors;

    var rawBytes = this.stream.getBytes(rowBytes);

    var inbuf = 0, outbuf = 0;
    var inbits = 0, outbits = 0;

    if (bits === 1) {
      for (var i = 0; i < rowBytes; ++i) {
        var c = rawBytes[i];
        inbuf = (inbuf << 8) | c;
        // bitwise addition is exclusive or
        // first shift inbuf and then add
        currentRow[i] = (c ^ (inbuf >> colors)) & 0xFF;
        // truncate inbuf (assumes colors < 16)
        inbuf &= 0xFFFF;
      }
    } else if (bits === 8) {
      for (var i = 0; i < colors; ++i)
        currentRow[i] = rawBytes[i];
      for (; i < rowBytes; ++i)
        currentRow[i] = currentRow[i - colors] + rawBytes[i];
    } else {
      var compArray = new Uint8Array(colors + 1);
      var bitMask = (1 << bits) - 1;
      var j = 0, k = 0;
      var columns = this.columns;
      for (var i = 0; i < columns; ++i) {
        for (var kk = 0; kk < colors; ++kk) {
          if (inbits < bits) {
            inbuf = (inbuf << 8) | (rawBytes[j++] & 0xFF);
            inbits += 8;
          }
          compArray[kk] = (compArray[kk] +
                           (inbuf >> (inbits - bits))) & bitMask;
          inbits -= bits;
          outbuf = (outbuf << bits) | compArray[kk];
          outbits += bits;
          if (outbits >= 8) {
            currentRow[k++] = (outbuf >> (outbits - 8)) & 0xFF;
            outbits -= 8;
          }
        }
      }
      if (outbits > 0) {
        currentRow[k++] = (outbuf << (8 - outbits)) +
        (inbuf & ((1 << (8 - outbits)) - 1));
      }
    }
    this.bufferLength += rowBytes;
  };

  constructor.prototype.readBlockPng = function predictorStreamReadBlockPng() {
    var rowBytes = this.rowBytes;
    var pixBytes = this.pixBytes;

    var predictor = this.stream.getByte();
    var rawBytes = this.stream.getBytes(rowBytes);

    var bufferLength = this.bufferLength;
    var buffer = this.ensureBuffer(bufferLength + rowBytes);

    var currentRow = buffer.subarray(bufferLength, bufferLength + rowBytes);
    var prevRow = buffer.subarray(bufferLength - rowBytes, bufferLength);
    if (prevRow.length == 0)
      prevRow = new Uint8Array(rowBytes);

    switch (predictor) {
      case 0:
        for (var i = 0; i < rowBytes; ++i)
          currentRow[i] = rawBytes[i];
        break;
      case 1:
        for (var i = 0; i < pixBytes; ++i)
          currentRow[i] = rawBytes[i];
        for (; i < rowBytes; ++i)
          currentRow[i] = (currentRow[i - pixBytes] + rawBytes[i]) & 0xFF;
        break;
      case 2:
        for (var i = 0; i < rowBytes; ++i)
          currentRow[i] = (prevRow[i] + rawBytes[i]) & 0xFF;
        break;
      case 3:
        for (var i = 0; i < pixBytes; ++i)
          currentRow[i] = (prevRow[i] >> 1) + rawBytes[i];
        for (; i < rowBytes; ++i) {
          currentRow[i] = (((prevRow[i] + currentRow[i - pixBytes]) >> 1) +
                           rawBytes[i]) & 0xFF;
        }
        break;
      case 4:
        // we need to save the up left pixels values. the simplest way
        // is to create a new buffer
        for (var i = 0; i < pixBytes; ++i) {
          var up = prevRow[i];
          var c = rawBytes[i];
          currentRow[i] = up + c;
        }
        for (; i < rowBytes; ++i) {
          var up = prevRow[i];
          var upLeft = prevRow[i - pixBytes];
          var left = currentRow[i - pixBytes];
          var p = left + up - upLeft;

          var pa = p - left;
          if (pa < 0)
            pa = -pa;
          var pb = p - up;
          if (pb < 0)
            pb = -pb;
          var pc = p - upLeft;
          if (pc < 0)
            pc = -pc;

          var c = rawBytes[i];
          if (pa <= pb && pa <= pc)
            currentRow[i] = left + c;
          else if (pb <= pc)
            currentRow[i] = up + c;
          else
            currentRow[i] = upLeft + c;
        }
        break;
      default:
        error('Unsupported predictor: ' + predictor);
    }
    this.bufferLength += rowBytes;
  };

  return constructor;
})();

// A JpegStream can't be read directly. We use the platform to render
// the underlying JPEG data for us.
var JpegStream = (function jpegStream() {
  function isAdobeImage(bytes) {
    var maxBytesScanned = Math.max(bytes.length - 16, 1024);
    // Looking for APP14, 'Adobe'
    for (var i = 0; i < maxBytesScanned; ++i) {
      if (bytes[i] == 0xFF && bytes[i + 1] == 0xEE &&
          bytes[i + 2] == 0x00 && bytes[i + 3] == 0x0E &&
          bytes[i + 4] == 0x41 && bytes[i + 5] == 0x64 &&
          bytes[i + 6] == 0x6F && bytes[i + 7] == 0x62 &&
          bytes[i + 8] == 0x65 && bytes[i + 9] == 0x00)
          return true;
      // scanning until frame tag
      if (bytes[i] == 0xFF && bytes[i + 1] == 0xC0)
        break;
    }
    return false;
  }

  function fixAdobeImage(bytes) {
    // Inserting 'EMBED' marker after JPEG signature
    var embedMarker = new Uint8Array([0xFF, 0xEC, 0, 8, 0x45, 0x4D, 0x42, 0x45,
                                      0x44, 0]);
    var newBytes = new Uint8Array(bytes.length + embedMarker.length);
    newBytes.set(bytes, embedMarker.length);
    // copy JPEG header
    newBytes[0] = bytes[0];
    newBytes[1] = bytes[1];
    newBytes.set(embedMarker, 2);
    return newBytes;
  }

  function constructor(bytes, dict) {
    // TODO: per poppler, some images may have "junk" before that
    // need to be removed
    this.dict = dict;

    if (isAdobeImage(bytes))
      bytes = fixAdobeImage(bytes);

    // create DOM image
    var img = new Image();
    img.onload = (function jpegStreamOnload() {
      this.loaded = true;
      if (this.onLoad)
        this.onLoad();
    }).bind(this);
    img.src = 'data:image/jpeg;base64,' + window.btoa(bytesToString(bytes));
    this.domImage = img;
  }

  constructor.prototype = {
    getImage: function jpegStreamGetImage() {
      return this.domImage;
    },
    getChar: function jpegStreamGetChar() {
      error('internal error: getChar is not valid on JpegStream');
    }
  };

  return constructor;
})();

// Simple object to track the loading images
// Initialy for every that is in loading call imageLoading()
// and, when images onload is fired, call imageLoaded()
// When all images are loaded, the onLoad event is fired.
var ImagesLoader = (function imagesLoader() {
  function constructor() {
    this.loading = 0;
  }

  constructor.prototype = {
    imageLoading: function imagesLoaderImageLoading() {
      ++this.loading;
    },

    imageLoaded: function imagesLoaderImageLoaded() {
      if (--this.loading == 0 && this.onLoad) {
        this.onLoad();
        delete this.onLoad;
      }
    },

    bind: function imagesLoaderBind(jpegStream) {
      if (jpegStream.loaded)
        return;
      this.imageLoading();
      jpegStream.onLoad = this.imageLoaded.bind(this);
    },

    notifyOnLoad: function imagesLoaderNotifyOnLoad(callback) {
      if (this.loading == 0)
        callback();
      this.onLoad = callback;
    }
  };

  return constructor;
})();

var DecryptStream = (function decryptStream() {
  function constructor(str, decrypt) {
    this.str = str;
    this.dict = str.dict;
    this.decrypt = decrypt;

    DecodeStream.call(this);
  }

  var chunkSize = 512;

  constructor.prototype = Object.create(DecodeStream.prototype);

  constructor.prototype.readBlock = function decryptStreamReadBlock() {
    var chunk = this.str.getBytes(chunkSize);
    if (!chunk || chunk.length == 0) {
      this.eof = true;
      return;
    }
    var decrypt = this.decrypt;
    chunk = decrypt(chunk);

    var bufferLength = this.bufferLength;
    var i, n = chunk.length;
    var buffer = this.ensureBuffer(bufferLength + n);
    for (i = 0; i < n; i++)
      buffer[bufferLength++] = chunk[i];
    this.bufferLength = bufferLength;
  };

  return constructor;
})();

var Ascii85Stream = (function ascii85Stream() {
  function constructor(str) {
    this.str = str;
    this.dict = str.dict;
    this.input = new Uint8Array(5);

    DecodeStream.call(this);
  }

  constructor.prototype = Object.create(DecodeStream.prototype);

  constructor.prototype.readBlock = function ascii85StreamReadBlock() {
    var tildaCode = '~'.charCodeAt(0);
    var zCode = 'z'.charCodeAt(0);
    var str = this.str;

    var c = str.getByte();
    while (Lexer.isSpace(String.fromCharCode(c)))
      c = str.getByte();

    if (!c || c === tildaCode) {
      this.eof = true;
      return;
    }

    var bufferLength = this.bufferLength, buffer;

    // special code for z
    if (c == zCode) {
      buffer = this.ensureBuffer(bufferLength + 4);
      for (var i = 0; i < 4; ++i)
        buffer[bufferLength + i] = 0;
      this.bufferLength += 4;
    } else {
      var input = this.input;
      input[0] = c;
      for (var i = 1; i < 5; ++i) {
        c = str.getByte();
        while (Lexer.isSpace(String.fromCharCode(c)))
          c = str.getByte();

        input[i] = c;

        if (!c || c == tildaCode)
          break;
      }
      buffer = this.ensureBuffer(bufferLength + i - 1);
      this.bufferLength += i - 1;

      // partial ending;
      if (i < 5) {
        for (; i < 5; ++i)
          input[i] = 0x21 + 84;
        this.eof = true;
      }
      var t = 0;
      for (var i = 0; i < 5; ++i)
        t = t * 85 + (input[i] - 0x21);

      for (var i = 3; i >= 0; --i) {
        buffer[bufferLength + i] = t & 0xFF;
        t >>= 8;
      }
    }
  };

  return constructor;
})();

var AsciiHexStream = (function asciiHexStream() {
  function constructor(str) {
    this.str = str;
    this.dict = str.dict;

    DecodeStream.call(this);
  }

  var hexvalueMap = {
      9: -1, // \t
      32: -1, // space
      48: 0,
      49: 1,
      50: 2,
      51: 3,
      52: 4,
      53: 5,
      54: 6,
      55: 7,
      56: 8,
      57: 9,
      65: 10,
      66: 11,
      67: 12,
      68: 13,
      69: 14,
      70: 15,
      97: 10,
      98: 11,
      99: 12,
      100: 13,
      101: 14,
      102: 15
  };

  constructor.prototype = Object.create(DecodeStream.prototype);

  constructor.prototype.readBlock = function asciiHexStreamReadBlock() {
    var gtCode = '>'.charCodeAt(0), bytes = this.str.getBytes(), c, n,
        decodeLength, buffer, bufferLength, i, length;

    decodeLength = (bytes.length + 1) >> 1;
    buffer = this.ensureBuffer(this.bufferLength + decodeLength);
    bufferLength = this.bufferLength;

    for (i = 0, length = bytes.length; i < length; i++) {
      c = hexvalueMap[bytes[i]];
      while (c == -1 && (i + 1) < length) {
        c = hexvalueMap[bytes[++i]];
      }

      if ((i + 1) < length && (bytes[i + 1] !== gtCode)) {
        n = hexvalueMap[bytes[++i]];
        buffer[bufferLength++] = c * 16 + n;
      } else {
        // EOD marker at an odd number, behave as if a 0 followed the last
        // digit.
        if (bytes[i] !== gtCode) {
          buffer[bufferLength++] = c * 16;
        }
      }
    }

    this.bufferLength = bufferLength;
    this.eof = true;
  };

  return constructor;
})();

var CCITTFaxStream = (function ccittFaxStream() {

  var ccittEOL = -2;
  var twoDimPass = 0;
  var twoDimHoriz = 1;
  var twoDimVert0 = 2;
  var twoDimVertR1 = 3;
  var twoDimVertL1 = 4;
  var twoDimVertR2 = 5;
  var twoDimVertL2 = 6;
  var twoDimVertR3 = 7;
  var twoDimVertL3 = 8;

  var twoDimTable = [
    [-1, -1], [-1, -1],                   // 000000x
    [7, twoDimVertL3],                    // 0000010
    [7, twoDimVertR3],                    // 0000011
    [6, twoDimVertL2], [6, twoDimVertL2], // 000010x
    [6, twoDimVertR2], [6, twoDimVertR2], // 000011x
    [4, twoDimPass], [4, twoDimPass],     // 0001xxx
    [4, twoDimPass], [4, twoDimPass],
    [4, twoDimPass], [4, twoDimPass],
    [4, twoDimPass], [4, twoDimPass],
    [3, twoDimHoriz], [3, twoDimHoriz],   // 001xxxx
    [3, twoDimHoriz], [3, twoDimHoriz],
    [3, twoDimHoriz], [3, twoDimHoriz],
    [3, twoDimHoriz], [3, twoDimHoriz],
    [3, twoDimHoriz], [3, twoDimHoriz],
    [3, twoDimHoriz], [3, twoDimHoriz],
    [3, twoDimHoriz], [3, twoDimHoriz],
    [3, twoDimHoriz], [3, twoDimHoriz],
    [3, twoDimVertL1], [3, twoDimVertL1], // 010xxxx
    [3, twoDimVertL1], [3, twoDimVertL1],
    [3, twoDimVertL1], [3, twoDimVertL1],
    [3, twoDimVertL1], [3, twoDimVertL1],
    [3, twoDimVertL1], [3, twoDimVertL1],
    [3, twoDimVertL1], [3, twoDimVertL1],
    [3, twoDimVertL1], [3, twoDimVertL1],
    [3, twoDimVertL1], [3, twoDimVertL1],
    [3, twoDimVertR1], [3, twoDimVertR1], // 011xxxx
    [3, twoDimVertR1], [3, twoDimVertR1],
    [3, twoDimVertR1], [3, twoDimVertR1],
    [3, twoDimVertR1], [3, twoDimVertR1],
    [3, twoDimVertR1], [3, twoDimVertR1],
    [3, twoDimVertR1], [3, twoDimVertR1],
    [3, twoDimVertR1], [3, twoDimVertR1],
    [3, twoDimVertR1], [3, twoDimVertR1],
    [1, twoDimVert0], [1, twoDimVert0],   // 1xxxxxx
    [1, twoDimVert0], [1, twoDimVert0],
    [1, twoDimVert0], [1, twoDimVert0],
    [1, twoDimVert0], [1, twoDimVert0],
    [1, twoDimVert0], [1, twoDimVert0],
    [1, twoDimVert0], [1, twoDimVert0],
    [1, twoDimVert0], [1, twoDimVert0],
    [1, twoDimVert0], [1, twoDimVert0],
    [1, twoDimVert0], [1, twoDimVert0],
    [1, twoDimVert0], [1, twoDimVert0],
    [1, twoDimVert0], [1, twoDimVert0],
    [1, twoDimVert0], [1, twoDimVert0],
    [1, twoDimVert0], [1, twoDimVert0],
    [1, twoDimVert0], [1, twoDimVert0],
    [1, twoDimVert0], [1, twoDimVert0],
    [1, twoDimVert0], [1, twoDimVert0],
    [1, twoDimVert0], [1, twoDimVert0],
    [1, twoDimVert0], [1, twoDimVert0],
    [1, twoDimVert0], [1, twoDimVert0],
    [1, twoDimVert0], [1, twoDimVert0],
    [1, twoDimVert0], [1, twoDimVert0],
    [1, twoDimVert0], [1, twoDimVert0],
    [1, twoDimVert0], [1, twoDimVert0],
    [1, twoDimVert0], [1, twoDimVert0],
    [1, twoDimVert0], [1, twoDimVert0],
    [1, twoDimVert0], [1, twoDimVert0],
    [1, twoDimVert0], [1, twoDimVert0],
    [1, twoDimVert0], [1, twoDimVert0],
    [1, twoDimVert0], [1, twoDimVert0],
    [1, twoDimVert0], [1, twoDimVert0],
    [1, twoDimVert0], [1, twoDimVert0],
    [1, twoDimVert0], [1, twoDimVert0]
  ];

  var whiteTable1 = [
    [-1, -1],                               // 00000
    [12, ccittEOL],                         // 00001
    [-1, -1], [-1, -1],                     // 0001x
    [-1, -1], [-1, -1], [-1, -1], [-1, -1], // 001xx
    [-1, -1], [-1, -1], [-1, -1], [-1, -1], // 010xx
    [-1, -1], [-1, -1], [-1, -1], [-1, -1], // 011xx
    [11, 1792], [11, 1792],                 // 1000x
    [12, 1984],                             // 10010
    [12, 2048],                             // 10011
    [12, 2112],                             // 10100
    [12, 2176],                             // 10101
    [12, 2240],                             // 10110
    [12, 2304],                             // 10111
    [11, 1856], [11, 1856],                 // 1100x
    [11, 1920], [11, 1920],                 // 1101x
    [12, 2368],                             // 11100
    [12, 2432],                             // 11101
    [12, 2496],                             // 11110
    [12, 2560]                              // 11111
  ];

  var whiteTable2 = [
    [-1, -1], [-1, -1], [-1, -1], [-1, -1],     // 0000000xx
    [8, 29], [8, 29],                           // 00000010x
    [8, 30], [8, 30],                           // 00000011x
    [8, 45], [8, 45],                           // 00000100x
    [8, 46], [8, 46],                           // 00000101x
    [7, 22], [7, 22], [7, 22], [7, 22],         // 0000011xx
    [7, 23], [7, 23], [7, 23], [7, 23],         // 0000100xx
    [8, 47], [8, 47],                           // 00001010x
    [8, 48], [8, 48],                           // 00001011x
    [6, 13], [6, 13], [6, 13], [6, 13],         // 000011xxx
    [6, 13], [6, 13], [6, 13], [6, 13],
    [7, 20], [7, 20], [7, 20], [7, 20],         // 0001000xx
    [8, 33], [8, 33],                           // 00010010x
    [8, 34], [8, 34],                           // 00010011x
    [8, 35], [8, 35],                           // 00010100x
    [8, 36], [8, 36],                           // 00010101x
    [8, 37], [8, 37],                           // 00010110x
    [8, 38], [8, 38],                           // 00010111x
    [7, 19], [7, 19], [7, 19], [7, 19],         // 0001100xx
    [8, 31], [8, 31],                           // 00011010x
    [8, 32], [8, 32],                           // 00011011x
    [6, 1], [6, 1], [6, 1], [6, 1],             // 000111xxx
    [6, 1], [6, 1], [6, 1], [6, 1],
    [6, 12], [6, 12], [6, 12], [6, 12],         // 001000xxx
    [6, 12], [6, 12], [6, 12], [6, 12],
    [8, 53], [8, 53],                           // 00100100x
    [8, 54], [8, 54],                           // 00100101x
    [7, 26], [7, 26], [7, 26], [7, 26],         // 0010011xx
    [8, 39], [8, 39],                           // 00101000x
    [8, 40], [8, 40],                           // 00101001x
    [8, 41], [8, 41],                           // 00101010x
    [8, 42], [8, 42],                           // 00101011x
    [8, 43], [8, 43],                           // 00101100x
    [8, 44], [8, 44],                           // 00101101x
    [7, 21], [7, 21], [7, 21], [7, 21],         // 0010111xx
    [7, 28], [7, 28], [7, 28], [7, 28],         // 0011000xx
    [8, 61], [8, 61],                           // 00110010x
    [8, 62], [8, 62],                           // 00110011x
    [8, 63], [8, 63],                           // 00110100x
    [8, 0], [8, 0],                             // 00110101x
    [8, 320], [8, 320],                         // 00110110x
    [8, 384], [8, 384],                         // 00110111x
    [5, 10], [5, 10], [5, 10], [5, 10],         // 00111xxxx
    [5, 10], [5, 10], [5, 10], [5, 10],
    [5, 10], [5, 10], [5, 10], [5, 10],
    [5, 10], [5, 10], [5, 10], [5, 10],
    [5, 11], [5, 11], [5, 11], [5, 11],         // 01000xxxx
    [5, 11], [5, 11], [5, 11], [5, 11],
    [5, 11], [5, 11], [5, 11], [5, 11],
    [5, 11], [5, 11], [5, 11], [5, 11],
    [7, 27], [7, 27], [7, 27], [7, 27],         // 0100100xx
    [8, 59], [8, 59],                           // 01001010x
    [8, 60], [8, 60],                           // 01001011x
    [9, 1472],                                  // 010011000
    [9, 1536],                                  // 010011001
    [9, 1600],                                  // 010011010
    [9, 1728],                                  // 010011011
    [7, 18], [7, 18], [7, 18], [7, 18],         // 0100111xx
    [7, 24], [7, 24], [7, 24], [7, 24],         // 0101000xx
    [8, 49], [8, 49],                           // 01010010x
    [8, 50], [8, 50],                           // 01010011x
    [8, 51], [8, 51],                           // 01010100x
    [8, 52], [8, 52],                           // 01010101x
    [7, 25], [7, 25], [7, 25], [7, 25],         // 0101011xx
    [8, 55], [8, 55],                           // 01011000x
    [8, 56], [8, 56],                           // 01011001x
    [8, 57], [8, 57],                           // 01011010x
    [8, 58], [8, 58],                           // 01011011x
    [6, 192], [6, 192], [6, 192], [6, 192],     // 010111xxx
    [6, 192], [6, 192], [6, 192], [6, 192],
    [6, 1664], [6, 1664], [6, 1664], [6, 1664], // 011000xxx
    [6, 1664], [6, 1664], [6, 1664], [6, 1664],
    [8, 448], [8, 448],                         // 01100100x
    [8, 512], [8, 512],                         // 01100101x
    [9, 704],                                   // 011001100
    [9, 768],                                   // 011001101
    [8, 640], [8, 640],                         // 01100111x
    [8, 576], [8, 576],                         // 01101000x
    [9, 832],                                   // 011010010
    [9, 896],                                   // 011010011
    [9, 960],                                   // 011010100
    [9, 1024],                                  // 011010101
    [9, 1088],                                  // 011010110
    [9, 1152],                                  // 011010111
    [9, 1216],                                  // 011011000
    [9, 1280],                                  // 011011001
    [9, 1344],                                  // 011011010
    [9, 1408],                                  // 011011011
    [7, 256], [7, 256], [7, 256], [7, 256],     // 0110111xx
    [4, 2], [4, 2], [4, 2], [4, 2],             // 0111xxxxx
    [4, 2], [4, 2], [4, 2], [4, 2],
    [4, 2], [4, 2], [4, 2], [4, 2],
    [4, 2], [4, 2], [4, 2], [4, 2],
    [4, 2], [4, 2], [4, 2], [4, 2],
    [4, 2], [4, 2], [4, 2], [4, 2],
    [4, 2], [4, 2], [4, 2], [4, 2],
    [4, 2], [4, 2], [4, 2], [4, 2],
    [4, 3], [4, 3], [4, 3], [4, 3],             // 1000xxxxx
    [4, 3], [4, 3], [4, 3], [4, 3],
    [4, 3], [4, 3], [4, 3], [4, 3],
    [4, 3], [4, 3], [4, 3], [4, 3],
    [4, 3], [4, 3], [4, 3], [4, 3],
    [4, 3], [4, 3], [4, 3], [4, 3],
    [4, 3], [4, 3], [4, 3], [4, 3],
    [4, 3], [4, 3], [4, 3], [4, 3],
    [5, 128], [5, 128], [5, 128], [5, 128],     // 10010xxxx
    [5, 128], [5, 128], [5, 128], [5, 128],
    [5, 128], [5, 128], [5, 128], [5, 128],
    [5, 128], [5, 128], [5, 128], [5, 128],
    [5, 8], [5, 8], [5, 8], [5, 8],             // 10011xxxx
    [5, 8], [5, 8], [5, 8], [5, 8],
    [5, 8], [5, 8], [5, 8], [5, 8],
    [5, 8], [5, 8], [5, 8], [5, 8],
    [5, 9], [5, 9], [5, 9], [5, 9],             // 10100xxxx
    [5, 9], [5, 9], [5, 9], [5, 9],
    [5, 9], [5, 9], [5, 9], [5, 9],
    [5, 9], [5, 9], [5, 9], [5, 9],
    [6, 16], [6, 16], [6, 16], [6, 16],         // 101010xxx
    [6, 16], [6, 16], [6, 16], [6, 16],
    [6, 17], [6, 17], [6, 17], [6, 17],         // 101011xxx
    [6, 17], [6, 17], [6, 17], [6, 17],
    [4, 4], [4, 4], [4, 4], [4, 4],             // 1011xxxxx
    [4, 4], [4, 4], [4, 4], [4, 4],
    [4, 4], [4, 4], [4, 4], [4, 4],
    [4, 4], [4, 4], [4, 4], [4, 4],
    [4, 4], [4, 4], [4, 4], [4, 4],
    [4, 4], [4, 4], [4, 4], [4, 4],
    [4, 4], [4, 4], [4, 4], [4, 4],
    [4, 4], [4, 4], [4, 4], [4, 4],
    [4, 5], [4, 5], [4, 5], [4, 5],             // 1100xxxxx
    [4, 5], [4, 5], [4, 5], [4, 5],
    [4, 5], [4, 5], [4, 5], [4, 5],
    [4, 5], [4, 5], [4, 5], [4, 5],
    [4, 5], [4, 5], [4, 5], [4, 5],
    [4, 5], [4, 5], [4, 5], [4, 5],
    [4, 5], [4, 5], [4, 5], [4, 5],
    [4, 5], [4, 5], [4, 5], [4, 5],
    [6, 14], [6, 14], [6, 14], [6, 14],         // 110100xxx
    [6, 14], [6, 14], [6, 14], [6, 14],
    [6, 15], [6, 15], [6, 15], [6, 15],         // 110101xxx
    [6, 15], [6, 15], [6, 15], [6, 15],
    [5, 64], [5, 64], [5, 64], [5, 64],         // 11011xxxx
    [5, 64], [5, 64], [5, 64], [5, 64],
    [5, 64], [5, 64], [5, 64], [5, 64],
    [5, 64], [5, 64], [5, 64], [5, 64],
    [4, 6], [4, 6], [4, 6], [4, 6],             // 1110xxxxx
    [4, 6], [4, 6], [4, 6], [4, 6],
    [4, 6], [4, 6], [4, 6], [4, 6],
    [4, 6], [4, 6], [4, 6], [4, 6],
    [4, 6], [4, 6], [4, 6], [4, 6],
    [4, 6], [4, 6], [4, 6], [4, 6],
    [4, 6], [4, 6], [4, 6], [4, 6],
    [4, 6], [4, 6], [4, 6], [4, 6],
    [4, 7], [4, 7], [4, 7], [4, 7],             // 1111xxxxx
    [4, 7], [4, 7], [4, 7], [4, 7],
    [4, 7], [4, 7], [4, 7], [4, 7],
    [4, 7], [4, 7], [4, 7], [4, 7],
    [4, 7], [4, 7], [4, 7], [4, 7],
    [4, 7], [4, 7], [4, 7], [4, 7],
    [4, 7], [4, 7], [4, 7], [4, 7],
    [4, 7], [4, 7], [4, 7], [4, 7]
  ];

  var blackTable1 = [
    [-1, -1], [-1, -1],                             // 000000000000x
    [12, ccittEOL], [12, ccittEOL],                 // 000000000001x
    [-1, -1], [-1, -1], [-1, -1], [-1, -1],         // 00000000001xx
    [-1, -1], [-1, -1], [-1, -1], [-1, -1],         // 00000000010xx
    [-1, -1], [-1, -1], [-1, -1], [-1, -1],         // 00000000011xx
    [-1, -1], [-1, -1], [-1, -1], [-1, -1],         // 00000000100xx
    [-1, -1], [-1, -1], [-1, -1], [-1, -1],         // 00000000101xx
    [-1, -1], [-1, -1], [-1, -1], [-1, -1],         // 00000000110xx
    [-1, -1], [-1, -1], [-1, -1], [-1, -1],         // 00000000111xx
    [11, 1792], [11, 1792], [11, 1792], [11, 1792], // 00000001000xx
    [12, 1984], [12, 1984],                         // 000000010010x
    [12, 2048], [12, 2048],                         // 000000010011x
    [12, 2112], [12, 2112],                         // 000000010100x
    [12, 2176], [12, 2176],                         // 000000010101x
    [12, 2240], [12, 2240],                         // 000000010110x
    [12, 2304], [12, 2304],                         // 000000010111x
    [11, 1856], [11, 1856], [11, 1856], [11, 1856], // 00000001100xx
    [11, 1920], [11, 1920], [11, 1920], [11, 1920], // 00000001101xx
    [12, 2368], [12, 2368],                         // 000000011100x
    [12, 2432], [12, 2432],                         // 000000011101x
    [12, 2496], [12, 2496],                         // 000000011110x
    [12, 2560], [12, 2560],                         // 000000011111x
    [10, 18], [10, 18], [10, 18], [10, 18],         // 0000001000xxx
    [10, 18], [10, 18], [10, 18], [10, 18],
    [12, 52], [12, 52],                             // 000000100100x
    [13, 640],                                      // 0000001001010
    [13, 704],                                      // 0000001001011
    [13, 768],                                      // 0000001001100
    [13, 832],                                      // 0000001001101
    [12, 55], [12, 55],                             // 000000100111x
    [12, 56], [12, 56],                             // 000000101000x
    [13, 1280],                                     // 0000001010010
    [13, 1344],                                     // 0000001010011
    [13, 1408],                                     // 0000001010100
    [13, 1472],                                     // 0000001010101
    [12, 59], [12, 59],                             // 000000101011x
    [12, 60], [12, 60],                             // 000000101100x
    [13, 1536],                                     // 0000001011010
    [13, 1600],                                     // 0000001011011
    [11, 24], [11, 24], [11, 24], [11, 24],         // 00000010111xx
    [11, 25], [11, 25], [11, 25], [11, 25],         // 00000011000xx
    [13, 1664],                                     // 0000001100100
    [13, 1728],                                     // 0000001100101
    [12, 320], [12, 320],                           // 000000110011x
    [12, 384], [12, 384],                           // 000000110100x
    [12, 448], [12, 448],                           // 000000110101x
    [13, 512],                                      // 0000001101100
    [13, 576],                                      // 0000001101101
    [12, 53], [12, 53],                             // 000000110111x
    [12, 54], [12, 54],                             // 000000111000x
    [13, 896],                                      // 0000001110010
    [13, 960],                                      // 0000001110011
    [13, 1024],                                     // 0000001110100
    [13, 1088],                                     // 0000001110101
    [13, 1152],                                     // 0000001110110
    [13, 1216],                                     // 0000001110111
    [10, 64], [10, 64], [10, 64], [10, 64],         // 0000001111xxx
    [10, 64], [10, 64], [10, 64], [10, 64]
  ];

  var blackTable2 = [
    [8, 13], [8, 13], [8, 13], [8, 13],     // 00000100xxxx
    [8, 13], [8, 13], [8, 13], [8, 13],
    [8, 13], [8, 13], [8, 13], [8, 13],
    [8, 13], [8, 13], [8, 13], [8, 13],
    [11, 23], [11, 23],                     // 00000101000x
    [12, 50],                               // 000001010010
    [12, 51],                               // 000001010011
    [12, 44],                               // 000001010100
    [12, 45],                               // 000001010101
    [12, 46],                               // 000001010110
    [12, 47],                               // 000001010111
    [12, 57],                               // 000001011000
    [12, 58],                               // 000001011001
    [12, 61],                               // 000001011010
    [12, 256],                              // 000001011011
    [10, 16], [10, 16], [10, 16], [10, 16], // 0000010111xx
    [10, 17], [10, 17], [10, 17], [10, 17], // 0000011000xx
    [12, 48],                               // 000001100100
    [12, 49],                               // 000001100101
    [12, 62],                               // 000001100110
    [12, 63],                               // 000001100111
    [12, 30],                               // 000001101000
    [12, 31],                               // 000001101001
    [12, 32],                               // 000001101010
    [12, 33],                               // 000001101011
    [12, 40],                               // 000001101100
    [12, 41],                               // 000001101101
    [11, 22], [11, 22],                     // 00000110111x
    [8, 14], [8, 14], [8, 14], [8, 14],     // 00000111xxxx
    [8, 14], [8, 14], [8, 14], [8, 14],
    [8, 14], [8, 14], [8, 14], [8, 14],
    [8, 14], [8, 14], [8, 14], [8, 14],
    [7, 10], [7, 10], [7, 10], [7, 10],     // 0000100xxxxx
    [7, 10], [7, 10], [7, 10], [7, 10],
    [7, 10], [7, 10], [7, 10], [7, 10],
    [7, 10], [7, 10], [7, 10], [7, 10],
    [7, 10], [7, 10], [7, 10], [7, 10],
    [7, 10], [7, 10], [7, 10], [7, 10],
    [7, 10], [7, 10], [7, 10], [7, 10],
    [7, 10], [7, 10], [7, 10], [7, 10],
    [7, 11], [7, 11], [7, 11], [7, 11],     // 0000101xxxxx
    [7, 11], [7, 11], [7, 11], [7, 11],
    [7, 11], [7, 11], [7, 11], [7, 11],
    [7, 11], [7, 11], [7, 11], [7, 11],
    [7, 11], [7, 11], [7, 11], [7, 11],
    [7, 11], [7, 11], [7, 11], [7, 11],
    [7, 11], [7, 11], [7, 11], [7, 11],
    [7, 11], [7, 11], [7, 11], [7, 11],
    [9, 15], [9, 15], [9, 15], [9, 15],     // 000011000xxx
    [9, 15], [9, 15], [9, 15], [9, 15],
    [12, 128],                              // 000011001000
    [12, 192],                              // 000011001001
    [12, 26],                               // 000011001010
    [12, 27],                               // 000011001011
    [12, 28],                               // 000011001100
    [12, 29],                               // 000011001101
    [11, 19], [11, 19],                     // 00001100111x
    [11, 20], [11, 20],                     // 00001101000x
    [12, 34],                               // 000011010010
    [12, 35],                               // 000011010011
    [12, 36],                               // 000011010100
    [12, 37],                               // 000011010101
    [12, 38],                               // 000011010110
    [12, 39],                               // 000011010111
    [11, 21], [11, 21],                     // 00001101100x
    [12, 42],                               // 000011011010
    [12, 43],                               // 000011011011
    [10, 0], [10, 0], [10, 0], [10, 0],     // 0000110111xx
    [7, 12], [7, 12], [7, 12], [7, 12],     // 0000111xxxxx
    [7, 12], [7, 12], [7, 12], [7, 12],
    [7, 12], [7, 12], [7, 12], [7, 12],
    [7, 12], [7, 12], [7, 12], [7, 12],
    [7, 12], [7, 12], [7, 12], [7, 12],
    [7, 12], [7, 12], [7, 12], [7, 12],
    [7, 12], [7, 12], [7, 12], [7, 12],
    [7, 12], [7, 12], [7, 12], [7, 12]
  ];

  var blackTable3 = [
    [-1, -1], [-1, -1], [-1, -1], [-1, -1], // 0000xx
    [6, 9],                                 // 000100
    [6, 8],                                 // 000101
    [5, 7], [5, 7],                         // 00011x
    [4, 6], [4, 6], [4, 6], [4, 6],         // 0010xx
    [4, 5], [4, 5], [4, 5], [4, 5],         // 0011xx
    [3, 1], [3, 1], [3, 1], [3, 1],         // 010xxx
    [3, 1], [3, 1], [3, 1], [3, 1],
    [3, 4], [3, 4], [3, 4], [3, 4],         // 011xxx
    [3, 4], [3, 4], [3, 4], [3, 4],
    [2, 3], [2, 3], [2, 3], [2, 3],         // 10xxxx
    [2, 3], [2, 3], [2, 3], [2, 3],
    [2, 3], [2, 3], [2, 3], [2, 3],
    [2, 3], [2, 3], [2, 3], [2, 3],
    [2, 2], [2, 2], [2, 2], [2, 2],         // 11xxxx
    [2, 2], [2, 2], [2, 2], [2, 2],
    [2, 2], [2, 2], [2, 2], [2, 2],
    [2, 2], [2, 2], [2, 2], [2, 2]
  ];

  function constructor(str, params) {
    this.str = str;
    this.dict = str.dict;

    params = params || new Dict();

    this.encoding = params.get('K') || 0;
    this.eoline = params.get('EndOfLine') || false;
    this.byteAlign = params.get('EncodedByteAlign') || false;
    this.columns = params.get('Columns') || 1728;
    this.rows = params.get('Rows') || 0;
    var eoblock = params.get('EndOfBlock');
    if (eoblock == null)
      eoblock = true;
    this.eoblock = eoblock;
    this.black = params.get('BlackIs1') || false;

    this.codingLine = new Uint32Array(this.columns + 1);
    this.refLine = new Uint32Array(this.columns + 2);

    this.codingLine[0] = this.columns;
    this.codingPos = 0;

    this.row = 0;
    this.nextLine2D = this.encoding < 0;
    this.inputBits = 0;
    this.inputBuf = 0;
    this.outputBits = 0;
    this.buf = EOF;

    var code1;
    while ((code1 = this.lookBits(12)) == 0) {
      this.eatBits(1);
    }
    if (code1 == 1) {
      this.eatBits(12);
    }
    if (this.encoding > 0) {
      this.nextLine2D = !this.lookBits(1);
      this.eatBits(1);
    }

    DecodeStream.call(this);
  }

  constructor.prototype = Object.create(DecodeStream.prototype);

  constructor.prototype.readBlock = function ccittFaxStreamReadBlock() {
    while (!this.eof) {
      var c = this.lookChar();
      this.buf = EOF;
      this.ensureBuffer(this.bufferLength + 1);
      this.buffer[this.bufferLength++] = c;
    }
  };

  constructor.prototype.addPixels =
    function ccittFaxStreamAddPixels(a1, blackPixels) {
    var codingLine = this.codingLine;
    var codingPos = this.codingPos;

    if (a1 > codingLine[codingPos]) {
      if (a1 > this.columns) {
        warn('row is wrong length');
        this.err = true;
        a1 = this.columns;
      }
      if ((codingPos & 1) ^ blackPixels) {
        ++codingPos;
      }

      codingLine[codingPos] = a1;
    }
    this.codingPos = codingPos;
  };

  constructor.prototype.addPixelsNeg =
    function ccittFaxStreamAddPixelsNeg(a1, blackPixels) {
    var codingLine = this.codingLine;
    var codingPos = this.codingPos;

    if (a1 > codingLine[codingPos]) {
      if (a1 > this.columns) {
        warn('row is wrong length');
        this.err = true;
        a1 = this.columns;
      }
      if ((codingPos & 1) ^ blackPixels)
        ++codingPos;

      codingLine[codingPos] = a1;
    } else if (a1 < codingLine[codingPos]) {
      if (a1 < 0) {
        warn('invalid code');
        this.err = true;
        a1 = 0;
      }
      while (codingPos > 0 && a1 < codingLine[codingPos - 1])
        --codingPos;
      codingLine[codingPos] = a1;
    }

    this.codingPos = codingPos;
  };

  constructor.prototype.lookChar = function ccittFaxStreamLookChar() {
    if (this.buf != EOF)
      return this.buf;

    var refLine = this.refLine;
    var codingLine = this.codingLine;
    var columns = this.columns;

    var refPos, blackPixels, bits;

    if (this.outputBits == 0) {
      if (this.eof)
        return null;

      this.err = false;

      var code1, code2, code3;
      if (this.nextLine2D) {
        for (var i = 0; codingLine[i] < columns; ++i)
          refLine[i] = codingLine[i];

        refLine[i++] = columns;
        refLine[i] = columns;
        codingLine[0] = 0;
        this.codingPos = 0;
        refPos = 0;
        blackPixels = 0;

        while (codingLine[this.codingPos] < columns) {
          code1 = this.getTwoDimCode();
          switch (code1) {
            case twoDimPass:
              this.addPixels(refLine[refPos + 1], blackPixels);
              if (refLine[refPos + 1] < columns)
                refPos += 2;
              break;
            case twoDimHoriz:
              code1 = code2 = 0;
              if (blackPixels) {
                do {
                  code1 += (code3 = this.getBlackCode());
                } while (code3 >= 64);
                do {
                  code2 += (code3 = this.getWhiteCode());
                } while (code3 >= 64);
              } else {
                do {
                  code1 += (code3 = this.getWhiteCode());
                } while (code3 >= 64);
                do {
                  code2 += (code3 = this.getBlackCode());
                } while (code3 >= 64);
              }
              this.addPixels(codingLine[this.codingPos] +
                             code1, blackPixels);
              if (codingLine[this.codingPos] < columns) {
                this.addPixels(codingLine[this.codingPos] + code2,
                               blackPixels ^ 1);
              }
              while (refLine[refPos] <= codingLine[this.codingPos] &&
                     refLine[refPos] < columns) {
                refPos += 2;
              }
              break;
            case twoDimVertR3:
              this.addPixels(refLine[refPos] + 3, blackPixels);
              blackPixels ^= 1;
              if (codingLine[this.codingPos] < columns) {
                ++refPos;
                while (refLine[refPos] <= codingLine[this.codingPos] &&
                       refLine[refPos] < columns)
                  refPos += 2;
              }
              break;
            case twoDimVertR2:
              this.addPixels(refLine[refPos] + 2, blackPixels);
              blackPixels ^= 1;
              if (codingLine[this.codingPos] < columns) {
                ++refPos;
                while (refLine[refPos] <= codingLine[this.codingPos] &&
                       refLine[refPos] < columns) {
                  refPos += 2;
                }
              }
              break;
            case twoDimVertR1:
              this.addPixels(refLine[refPos] + 1, blackPixels);
              blackPixels ^= 1;
              if (codingLine[this.codingPos] < columns) {
                ++refPos;
                while (refLine[refPos] <= codingLine[this.codingPos] &&
                       refLine[refPos] < columns)
                  refPos += 2;
              }
              break;
            case twoDimVert0:
              this.addPixels(refLine[refPos], blackPixels);
              blackPixels ^= 1;
              if (codingLine[this.codingPos] < columns) {
                ++refPos;
                while (refLine[refPos] <= codingLine[this.codingPos] &&
                       refLine[refPos] < columns)
                  refPos += 2;
              }
              break;
            case twoDimVertL3:
              this.addPixelsNeg(refLine[refPos] - 3, blackPixels);
              blackPixels ^= 1;
              if (codingLine[this.codingPos] < columns) {
                if (refPos > 0)
                  --refPos;
                else
                  ++refPos;
                while (refLine[refPos] <= codingLine[this.codingPos] &&
                       refLine[refPos] < columns)
                  refPos += 2;
              }
              break;
            case twoDimVertL2:
              this.addPixelsNeg(refLine[refPos] - 2, blackPixels);
              blackPixels ^= 1;
              if (codingLine[this.codingPos] < columns) {
                if (refPos > 0)
                  --refPos;
                else
                  ++refPos;
                while (refLine[refPos] <= codingLine[this.codingPos] &&
                       refLine[refPos] < columns)
                  refPos += 2;
              }
              break;
            case twoDimVertL1:
              this.addPixelsNeg(refLine[refPos] - 1, blackPixels);
              blackPixels ^= 1;
              if (codingLine[this.codingPos] < columns) {
                if (refPos > 0)
                  --refPos;
                else
                  ++refPos;

                while (refLine[refPos] <= codingLine[this.codingPos] &&
                       refLine[refPos] < columns)
                  refPos += 2;
              }
              break;
            case EOF:
              this.addPixels(columns, 0);
              this.eof = true;
              break;
            default:
              warn('bad 2d code');
              this.addPixels(columns, 0);
              this.err = true;
          }
        }
      } else {
        codingLine[0] = 0;
        this.codingPos = 0;
        blackPixels = 0;
        while (codingLine[this.codingPos] < columns) {
          code1 = 0;
          if (blackPixels) {
            do {
              code1 += (code3 = this.getBlackCode());
            } while (code3 >= 64);
          } else {
            do {
              code1 += (code3 = this.getWhiteCode());
            } while (code3 >= 64);
          }
          this.addPixels(codingLine[this.codingPos] + code1, blackPixels);
          blackPixels ^= 1;
        }
      }

      if (this.byteAlign)
        this.inputBits &= ~7;

      var gotEOL = false;

      if (!this.eoblock && this.row == this.rows - 1) {
        this.eof = true;
      } else {
        code1 = this.lookBits(12);
        while (code1 == 0) {
          this.eatBits(1);
          code1 = this.lookBits(12);
        }
        if (code1 == 1) {
          this.eatBits(12);
          gotEOL = true;
        } else if (code1 == EOF) {
          this.eof = true;
        }
      }

      if (!this.eof && this.encoding > 0) {
        this.nextLine2D = !this.lookBits(1);
        this.eatBits(1);
      }

      if (this.eoblock && gotEOL) {
        code1 = this.lookBits(12);
        if (code1 == 1) {
          this.eatBits(12);
          if (this.encoding > 0) {
            this.lookBits(1);
            this.eatBits(1);
          }
          if (this.encoding >= 0) {
            for (var i = 0; i < 4; ++i) {
              code1 = this.lookBits(12);
              if (code1 != 1)
                warn('bad rtc code: ' + code1);
              this.eatBits(12);
              if (this.encoding > 0) {
                this.lookBits(1);
                this.eatBits(1);
              }
            }
          }
          this.eof = true;
        }
      } else if (this.err && this.eoline) {
        while (true) {
          code1 = this.lookBits(13);
          if (code1 == EOF) {
            this.eof = true;
            return null;
          }
          if ((code1 >> 1) == 1) {
            break;
          }
          this.eatBits(1);
        }
        this.eatBits(12);
        if (this.encoding > 0) {
          this.eatBits(1);
          this.nextLine2D = !(code1 & 1);
        }
      }

      if (codingLine[0] > 0)
        this.outputBits = codingLine[this.codingPos = 0];
      else
        this.outputBits = codingLine[this.codingPos = 1];
      this.row++;
    }

    if (this.outputBits >= 8) {
      this.buf = (this.codingPos & 1) ? 0 : 0xFF;
      this.outputBits -= 8;
      if (this.outputBits == 0 && codingLine[this.codingPos] < columns) {
        this.codingPos++;
        this.outputBits = (codingLine[this.codingPos] -
                           codingLine[this.codingPos - 1]);
      }
    } else {
      var bits = 8;
      this.buf = 0;
      do {
        if (this.outputBits > bits) {
          this.buf <<= bits;
          if (!(this.codingPos & 1)) {
            this.buf |= 0xFF >> (8 - bits);
          }
          this.outputBits -= bits;
          bits = 0;
        } else {
          this.buf <<= this.outputBits;
          if (!(this.codingPos & 1)) {
            this.buf |= 0xFF >> (8 - this.outputBits);
          }
          bits -= this.outputBits;
          this.outputBits = 0;
          if (codingLine[this.codingPos] < columns) {
            this.codingPos++;
            this.outputBits = (codingLine[this.codingPos] -
                               codingLine[this.codingPos - 1]);
          } else if (bits > 0) {
            this.buf <<= bits;
            bits = 0;
          }
        }
      } while (bits);
    }
    if (this.black) {
      this.buf ^= 0xFF;
    }
    return this.buf;
  };

  constructor.prototype.getTwoDimCode = function ccittFaxStreamGetTwoDimCode() {
    var code = 0;
    var p;
    if (this.eoblock) {
      code = this.lookBits(7);
      p = twoDimTable[code];
      if (p[0] > 0) {
        this.eatBits(p[0]);
        return p[1];
      }
    } else {
      for (var n = 1; n <= 7; ++n) {
        code = this.lookBits(n);
        if (n < 7) {
          code <<= 7 - n;
        }
        p = twoDimTable[code];
        if (p[0] == n) {
          this.eatBits(n);
          return p[1];
        }
      }
    }
    warn('Bad two dim code');
    return EOF;
  };

  constructor.prototype.getWhiteCode = function ccittFaxStreamGetWhiteCode() {
    var code = 0;
    var p;
    var n;
    if (this.eoblock) {
      code = this.lookBits(12);
      if (code == EOF)
        return 1;

      if ((code >> 5) == 0)
        p = whiteTable1[code];
      else
        p = whiteTable2[code >> 3];

      if (p[0] > 0) {
        this.eatBits(p[0]);
        return p[1];
      }
    } else {
      for (var n = 1; n <= 9; ++n) {
        code = this.lookBits(n);
        if (code == EOF)
          return 1;

        if (n < 9)
          code <<= 9 - n;
        p = whiteTable2[code];
        if (p[0] == n) {
          this.eatBits(n);
          return p[0];
        }
      }
      for (var n = 11; n <= 12; ++n) {
        code = this.lookBits(n);
        if (code == EOF)
          return 1;
        if (n < 12)
          code <<= 12 - n;
        p = whiteTable1[code];
        if (p[0] == n) {
          this.eatBits(n);
          return p[1];
        }
      }
    }
    warn('bad white code');
    this.eatBits(1);
    return 1;
  };

  constructor.prototype.getBlackCode = function ccittFaxStreamGetBlackCode() {
    var code, p;
    if (this.eoblock) {
      code = this.lookBits(13);
      if (code == EOF)
        return 1;
      if ((code >> 7) == 0)
        p = blackTable1[code];
      else if ((code >> 9) == 0 && (code >> 7) != 0)
        p = blackTable2[(code >> 1) - 64];
      else
        p = blackTable3[code >> 7];

      if (p[0] > 0) {
        this.eatBits(p[0]);
        return p[1];
      }
    } else {
      var n;
      for (n = 2; n <= 6; ++n) {
        code = this.lookBits(n);
        if (code == EOF)
          return 1;
        if (n < 6)
          code <<= 6 - n;
        p = blackTable3[code];
        if (p[0] == n) {
          this.eatBits(n);
          return p[1];
        }
      }
      for (n = 7; n <= 12; ++n) {
        code = this.lookBits(n);
        if (code == EOF)
          return 1;
        if (n < 12)
          code <<= 12 - n;
        if (code >= 64) {
          p = blackTable2[code - 64];
          if (p[0] == n) {
            this.eatBits(n);
            return p[1];
          }
        }
      }
      for (n = 10; n <= 13; ++n) {
        code = this.lookBits(n);
        if (code == EOF)
          return 1;
        if (n < 13)
          code <<= 13 - n;
        p = blackTable1[code];
        if (p[0] == n) {
          this.eatBits(n);
          return p[1];
        }
      }
    }
    warn('bad black code');
    this.eatBits(1);
    return 1;
  };

  constructor.prototype.lookBits = function ccittFaxStreamLookBits(n) {
    var c;
    while (this.inputBits < n) {
      if ((c = this.str.getByte()) == null) {
        if (this.inputBits == 0)
          return EOF;
        return ((this.inputBuf << (n - this.inputBits)) &
                (0xFFFF >> (16 - n)));
      }
      this.inputBuf = (this.inputBuf << 8) + c;
      this.inputBits += 8;
    }
    return (this.inputBuf >> (this.inputBits - n)) & (0xFFFF >> (16 - n));
  };

  constructor.prototype.eatBits = function ccittFaxStreamEatBits(n) {
    if ((this.inputBits -= n) < 0)
      this.inputBits = 0;
  };

  return constructor;
})();

var LZWStream = (function lzwStream() {
  function constructor(str, earlyChange) {
    this.str = str;
    this.dict = str.dict;
    this.cachedData = 0;
    this.bitsCached = 0;

    var maxLzwDictionarySize = 4096;
    var lzwState = {
      earlyChange: earlyChange,
      codeLength: 9,
      nextCode: 258,
      dictionaryValues: new Uint8Array(maxLzwDictionarySize),
      dictionaryLengths: new Uint16Array(maxLzwDictionarySize),
      dictionaryPrevCodes: new Uint16Array(maxLzwDictionarySize),
      currentSequence: new Uint8Array(maxLzwDictionarySize),
      currentSequenceLength: 0
    };
    for (var i = 0; i < 256; ++i) {
      lzwState.dictionaryValues[i] = i;
      lzwState.dictionaryLengths[i] = 1;
    }
    this.lzwState = lzwState;

    DecodeStream.call(this);
  }

  constructor.prototype = Object.create(DecodeStream.prototype);

  constructor.prototype.readBits = function lzwStreamReadBits(n) {
    var bitsCached = this.bitsCached;
    var cachedData = this.cachedData;
    while (bitsCached < n) {
      var c = this.str.getByte();
      if (c == null) {
        this.eof = true;
        return null;
      }
      cachedData = (cachedData << 8) | c;
      bitsCached += 8;
    }
    this.bitsCached = (bitsCached -= n);
    this.cachedData = cachedData;
    this.lastCode = null;
    return (cachedData >>> bitsCached) & ((1 << n) - 1);
  };

  constructor.prototype.readBlock = function lzwStreamReadBlock() {
    var blockSize = 512;
    var estimatedDecodedSize = blockSize * 2, decodedSizeDelta = blockSize;
    var i, j, q;

    var lzwState = this.lzwState;
    if (!lzwState)
      return; // eof was found

    var earlyChange = lzwState.earlyChange;
    var nextCode = lzwState.nextCode;
    var dictionaryValues = lzwState.dictionaryValues;
    var dictionaryLengths = lzwState.dictionaryLengths;
    var dictionaryPrevCodes = lzwState.dictionaryPrevCodes;
    var codeLength = lzwState.codeLength;
    var prevCode = lzwState.prevCode;
    var currentSequence = lzwState.currentSequence;
    var currentSequenceLength = lzwState.currentSequenceLength;

    var decodedLength = 0;
    var currentBufferLength = this.bufferLength;
    var buffer = this.ensureBuffer(this.bufferLength + estimatedDecodedSize);

    for (i = 0; i < blockSize; i++) {
      var code = this.readBits(codeLength);
      var hasPrev = currentSequenceLength > 0;
      if (code < 256) {
        currentSequence[0] = code;
        currentSequenceLength = 1;
      } else if (code >= 258) {
        if (code < nextCode) {
          currentSequenceLength = dictionaryLengths[code];
          for (j = currentSequenceLength - 1, q = code; j >= 0; j--) {
            currentSequence[j] = dictionaryValues[q];
            q = dictionaryPrevCodes[q];
          }
        } else {
          currentSequence[currentSequenceLength++] = currentSequence[0];
        }
      } else if (code == 256) {
        codeLength = 9;
        nextCode = 258;
        currentSequenceLength = 0;
        continue;
      } else {
        this.eof = true;
        delete this.lzwState;
        break;
      }

      if (hasPrev) {
        dictionaryPrevCodes[nextCode] = prevCode;
        dictionaryLengths[nextCode] = dictionaryLengths[prevCode] + 1;
        dictionaryValues[nextCode] = currentSequence[0];
        nextCode++;
        codeLength = (nextCode + earlyChange) & (nextCode + earlyChange - 1) ?
          codeLength : Math.min(Math.log(nextCode + earlyChange) /
          0.6931471805599453 + 1, 12) | 0;
      }
      prevCode = code;

      decodedLength += currentSequenceLength;
      if (estimatedDecodedSize < decodedLength) {
        do {
          estimatedDecodedSize += decodedSizeDelta;
        } while (estimatedDecodedSize < decodedLength);
        buffer = this.ensureBuffer(this.bufferLength + estimatedDecodedSize);
      }
      for (j = 0; j < currentSequenceLength; j++)
        buffer[currentBufferLength++] = currentSequence[j];
    }
    lzwState.nextCode = nextCode;
    lzwState.codeLength = codeLength;
    lzwState.prevCode = prevCode;
    lzwState.currentSequenceLength = currentSequenceLength;

    this.bufferLength = currentBufferLength;
  };

  return constructor;
})();


var Name = (function nameName() {
  function constructor(name) {
    this.name = name;
  }

  constructor.prototype = {
  };

  return constructor;
})();

var Cmd = (function cmdCmd() {
  function constructor(cmd) {
    this.cmd = cmd;
  }

  constructor.prototype = {
  };

  return constructor;
})();

var Dict = (function dictDict() {
  function constructor() {
    this.map = Object.create(null);
  }

  constructor.prototype = {
    get: function dictGet(key1, key2, key3) {
      var value;
      if (typeof (value = this.map[key1]) != 'undefined' || key1 in this.map ||
          typeof key2 == 'undefined') {
        return value;
      }
      if (typeof (value = this.map[key2]) != 'undefined' || key2 in this.map ||
          typeof key3 == 'undefined') {
        return value;
      }

      return this.map[key3] || null;
    },

    set: function dictSet(key, value) {
      this.map[key] = value;
    },

    has: function dictHas(key) {
      return key in this.map;
    },

    forEach: function dictForEach(callback) {
      for (var key in this.map) {
        callback(key, this.map[key]);
      }
    }
  };

  return constructor;
})();

var Ref = (function refRef() {
  function constructor(num, gen) {
    this.num = num;
    this.gen = gen;
  }

  constructor.prototype = {
  };

  return constructor;
})();

// The reference is identified by number and generation,
// this structure stores only one instance of the reference.
var RefSet = (function refSet() {
  function constructor() {
    this.dict = {};
  }

  constructor.prototype = {
    has: function refSetHas(ref) {
      return !!this.dict['R' + ref.num + '.' + ref.gen];
    },

    put: function refSetPut(ref) {
      this.dict['R' + ref.num + '.' + ref.gen] = ref;
    }
  };

  return constructor;
})();

function isBool(v) {
  return typeof v == 'boolean';
}

function isInt(v) {
  return typeof v == 'number' && ((v | 0) == v);
}

function isNum(v) {
  return typeof v == 'number';
}

function isString(v) {
  return typeof v == 'string';
}

function isNull(v) {
  return v === null;
}

function isName(v) {
  return v instanceof Name;
}

function isCmd(v, cmd) {
  return v instanceof Cmd && (!cmd || v.cmd == cmd);
}

function isDict(v, type) {
  return v instanceof Dict && (!type || v.get('Type').name == type);
}

function isArray(v) {
  return v instanceof Array;
}

function isStream(v) {
  return typeof v == 'object' && v != null && ('getChar' in v);
}

function isRef(v) {
  return v instanceof Ref;
}

function isPDFFunction(v) {
  var fnDict;
  if (typeof v != 'object')
    return false;
  else if (isDict(v))
    fnDict = v;
  else if (isStream(v))
    fnDict = v.dict;
  else
    return false;
  return fnDict.has('FunctionType');
}

var EOF = {};

function isEOF(v) {
  return v == EOF;
}

var None = {};

function isNone(v) {
  return v == None;
}

var Lexer = (function lexer() {
  function constructor(stream) {
    this.stream = stream;
  }

  constructor.isSpace = function lexerIsSpace(ch) {
    return ch == ' ' || ch == '\t' || ch == '\x0d' || ch == '\x0a';
  };

  // A '1' in this array means the character is white space.  A '1' or
  // '2' means the character ends a name or command.
  var specialChars = [
    1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 1, 1, 0, 0,   // 0x
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,   // 1x
    1, 0, 0, 0, 0, 2, 0, 0, 2, 2, 0, 0, 0, 0, 0, 2,   // 2x
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 2, 0,   // 3x
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,   // 4x
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 2, 0, 0,   // 5x
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,   // 6x
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 2, 0, 0,   // 7x
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,   // 8x
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,   // 9x
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,   // ax
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,   // bx
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,   // cx
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,   // dx
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,   // ex
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0    // fx
  ];

  function toHexDigit(ch) {
    if (ch >= '0' && ch <= '9')
      return ch.charCodeAt(0) - 48;
    ch = ch.toUpperCase();
    if (ch >= 'A' && ch <= 'F')
      return ch.charCodeAt(0) - 55;
    return -1;
  }

  constructor.prototype = {
    getNumber: function lexerGetNumber(ch) {
      var floating = false;
      var str = ch;
      var stream = this.stream;
      for (;;) {
        ch = stream.lookChar();
        if (ch == '.' && !floating) {
          str += ch;
          floating = true;
        } else if (ch == '-') {
          // ignore minus signs in the middle of numbers to match
          // Adobe's behavior
          warn('Badly formated number');
        } else if (ch >= '0' && ch <= '9') {
          str += ch;
        } else if (ch == 'e' || ch == 'E') {
          floating = true;
        } else {
          // the last character doesn't belong to us
          break;
        }
        stream.skip();
      }
      var value = parseFloat(str);
      if (isNaN(value))
        error('Invalid floating point number: ' + value);
      return value;
    },
    getString: function lexerGetString() {
      var numParen = 1;
      var done = false;
      var str = '';
      var stream = this.stream;
      var ch;
      do {
        ch = stream.getChar();
        switch (ch) {
          case undefined:
            warn('Unterminated string');
            done = true;
            break;
          case '(':
            ++numParen;
            str += ch;
            break;
          case ')':
            if (--numParen == 0) {
              done = true;
            } else {
              str += ch;
            }
            break;
          case '\\':
            ch = stream.getChar();
            switch (ch) {
              case undefined:
                warn('Unterminated string');
                done = true;
                break;
              case 'n':
                str += '\n';
                break;
              case 'r':
                str += '\r';
                break;
              case 't':
                str += '\t';
                break;
              case 'b':
                str += '\b';
                break;
              case 'f':
                str += '\f';
                break;
              case '\\':
              case '(':
              case ')':
                str += ch;
                break;
              case '0': case '1': case '2': case '3':
              case '4': case '5': case '6': case '7':
                var x = ch - '0';
                ch = stream.lookChar();
                if (ch >= '0' && ch <= '7') {
                  stream.skip();
                  x = (x << 3) + (ch - '0');
                  ch = stream.lookChar();
                  if (ch >= '0' && ch <= '7') {
                    stream.skip();
                    x = (x << 3) + (ch - '0');
                  }
                }

                str += String.fromCharCode(x);
                break;
              case '\r':
                ch = stream.lookChar();
                if (ch == '\n')
                  stream.skip();
                break;
              case '\n':
                break;
              default:
                str += ch;
            }
            break;
          default:
            str += ch;
        }
      } while (!done);
      return str;
    },
    getName: function lexerGetName(ch) {
      var str = '';
      var stream = this.stream;
      while (!!(ch = stream.lookChar()) && !specialChars[ch.charCodeAt(0)]) {
        stream.skip();
        if (ch == '#') {
          ch = stream.lookChar();
          var x = toHexDigit(ch);
          if (x != -1) {
            stream.skip();
            var x2 = toHexDigit(stream.getChar());
            if (x2 == -1)
              error('Illegal digit in hex char in name: ' + x2);
            str += String.fromCharCode((x << 4) | x2);
          } else {
            str += '#';
            str += ch;
          }
        } else {
          str += ch;
        }
      }
      if (str.length > 128)
        error('Warning: name token is longer than allowed by the spec: ' +
              str.length);
      return new Name(str);
    },
    getHexString: function lexerGetHexString(ch) {
      var str = '';
      var stream = this.stream;
      for (;;) {
        ch = stream.getChar();
        if (ch == '>') {
          break;
        }
        if (!ch) {
          warn('Unterminated hex string');
          break;
        }
        if (specialChars[ch.charCodeAt(0)] != 1) {
          var x, x2;
          if ((x = toHexDigit(ch)) == -1)
            error('Illegal character in hex string: ' + ch);

          ch = stream.getChar();
          while (specialChars[ch.charCodeAt(0)] == 1)
            ch = stream.getChar();

          if ((x2 = toHexDigit(ch)) == -1)
            error('Illegal character in hex string: ' + ch);

          str += String.fromCharCode((x << 4) | x2);
        }
      }
      return str;
    },
    getObj: function lexerGetObj() {
      // skip whitespace and comments
      var comment = false;
      var stream = this.stream;
      var ch;
      while (true) {
        if (!(ch = stream.getChar()))
          return EOF;
        if (comment) {
          if (ch == '\r' || ch == '\n')
            comment = false;
        } else if (ch == '%') {
          comment = true;
        } else if (specialChars[ch.charCodeAt(0)] != 1) {
          break;
        }
      }

      // start reading token
      switch (ch) {
        case '0': case '1': case '2': case '3': case '4':
        case '5': case '6': case '7': case '8': case '9':
        case '+': case '-': case '.':
          return this.getNumber(ch);
        case '(':
          return this.getString();
        case '/':
          return this.getName(ch);
        // array punctuation
        case '[':
        case ']':
          return new Cmd(ch);
        // hex string or dict punctuation
        case '<':
          ch = stream.lookChar();
          if (ch == '<') {
            // dict punctuation
            stream.skip();
            return new Cmd('<<');
          }
          return this.getHexString(ch);
        // dict punctuation
        case '>':
          ch = stream.lookChar();
          if (ch == '>') {
            stream.skip();
            return new Cmd('>>');
          }
        case '{':
        case '}':
          return new Cmd(ch);
        // fall through
        case ')':
          error('Illegal character: ' + ch);
          return Error;
      }

      // command
      var str = ch;
      while (!!(ch = stream.lookChar()) && !specialChars[ch.charCodeAt(0)]) {
        stream.skip();
        if (str.length == 128) {
          error('Command token too long: ' + str.length);
          break;
        }
        str += ch;
      }
      if (str == 'true')
        return true;
      if (str == 'false')
        return false;
      if (str == 'null')
        return null;
      return new Cmd(str);
    },
    skipToNextLine: function lexerSkipToNextLine() {
      var stream = this.stream;
      while (true) {
        var ch = stream.getChar();
        if (!ch || ch == '\n')
          return;
        if (ch == '\r') {
          if ((ch = stream.lookChar()) == '\n')
            stream.skip();
          return;
        }
      }
    },
    skip: function lexerSkip() {
      this.stream.skip();
    }
  };

  return constructor;
})();

var Parser = (function parserParser() {
  function constructor(lexer, allowStreams, xref) {
    this.lexer = lexer;
    this.allowStreams = allowStreams;
    this.xref = xref;
    this.inlineImg = 0;
    this.refill();
  }

  constructor.prototype = {
    refill: function parserRefill() {
      this.buf1 = this.lexer.getObj();
      this.buf2 = this.lexer.getObj();
    },
    shift: function parserShift() {
      if (isCmd(this.buf2, 'ID')) {
        this.buf1 = this.buf2;
        this.buf2 = null;
        // skip byte after ID
        this.lexer.skip();
      } else {
        this.buf1 = this.buf2;
        this.buf2 = this.lexer.getObj();
      }
    },
    getObj: function parserGetObj(cipherTransform) {
      if (isCmd(this.buf1, 'BI')) { // inline image
        this.shift();
        return this.makeInlineImage(cipherTransform);
      }
      if (isCmd(this.buf1, '[')) { // array
        this.shift();
        var array = [];
        while (!isCmd(this.buf1, ']') && !isEOF(this.buf1))
          array.push(this.getObj());
        if (isEOF(this.buf1))
          error('End of file inside array');
        this.shift();
        return array;
      }
      if (isCmd(this.buf1, '<<')) { // dictionary or stream
        this.shift();
        var dict = new Dict();
        while (!isCmd(this.buf1, '>>') && !isEOF(this.buf1)) {
          if (!isName(this.buf1)) {
            error('Dictionary key must be a name object');
          } else {
            var key = this.buf1.name;
            this.shift();
            if (isEOF(this.buf1))
              break;
            dict.set(key, this.getObj(cipherTransform));
          }
        }
        if (isEOF(this.buf1))
          error('End of file inside dictionary');

        // stream objects are not allowed inside content streams or
        // object streams
        if (isCmd(this.buf2, 'stream')) {
          return this.allowStreams ?
            this.makeStream(dict, cipherTransform) : dict;
        }
        this.shift();
        return dict;
      }
      if (isInt(this.buf1)) { // indirect reference or integer
        var num = this.buf1;
        this.shift();
        if (isInt(this.buf1) && isCmd(this.buf2, 'R')) {
          var ref = new Ref(num, this.buf1);
          this.shift();
          this.shift();
          return ref;
        }
        return num;
      }
      if (isString(this.buf1)) { // string
        var str = this.buf1;
        this.shift();
        if (cipherTransform)
          str = cipherTransform.decryptString(str);
        return str;
      }

      // simple object
      var obj = this.buf1;
      this.shift();
      return obj;
    },
    makeInlineImage: function parserMakeInlineImage(cipherTransform) {
      var lexer = this.lexer;
      var stream = lexer.stream;

      // parse dictionary
      var dict = new Dict();
      while (!isCmd(this.buf1, 'ID') && !isEOF(this.buf1)) {
        if (!isName(this.buf1)) {
          error('Dictionary key must be a name object');
        } else {
          var key = this.buf1.name;
          this.shift();
          if (isEOF(this.buf1))
            break;
          dict.set(key, this.getObj(cipherTransform));
        }
      }

      // parse image stream
      var startPos = stream.pos;

      // searching for the /\sEI\s/
      var state = 0, ch;
      while (state != 4 && (ch = stream.getByte()) != null) {
        switch (ch) {
          case 0x20:
          case 0x0D:
          case 0x0A:
            state = state === 3 ? 4 : 1;
            break;
          case 0x45:
            state = state === 1 ? 2 : 0;
            break;
          case 0x49:
            state = state === 2 ? 3 : 0;
            break;
          default:
            state = 0;
            break;
        }
      }

      // TODO improve the small images performance to remove the limit
      var inlineImgLimit = 500;
      if (++this.inlineImg >= inlineImgLimit) {
        if (this.inlineImg === inlineImgLimit)
          warn('Too many inline images');
        this.shift();
        return null;
      }

      var length = (stream.pos - 4) - startPos;
      var imageStream = stream.makeSubStream(startPos, length, dict);
      if (cipherTransform)
        imageStream = cipherTransform.createStream(imageStream);
      imageStream = this.filter(imageStream, dict, length);
      imageStream.parameters = dict;

      this.buf2 = new Cmd('EI');
      this.shift();

      return imageStream;
    },
    makeStream: function parserMakeStream(dict, cipherTransform) {
      var lexer = this.lexer;
      var stream = lexer.stream;

      // get stream start position
      lexer.skipToNextLine();
      var pos = stream.pos;

      // get length
      var length = dict.get('Length');
      var xref = this.xref;
      if (xref)
        length = xref.fetchIfRef(length);
      if (!isInt(length)) {
        error('Bad ' + length + ' attribute in stream');
        length = 0;
      }

      // skip over the stream data
      stream.pos = pos + length;
      this.shift(); // '>>'
      this.shift(); // 'stream'
      if (!isCmd(this.buf1, 'endstream'))
        error('Missing endstream');
      this.shift();

      stream = stream.makeSubStream(pos, length, dict);
      if (cipherTransform)
        stream = cipherTransform.createStream(stream);
      stream = this.filter(stream, dict, length);
      stream.parameters = dict;
      return stream;
    },
    filter: function parserFilter(stream, dict, length) {
      var filter = dict.get('Filter', 'F');
      var params = dict.get('DecodeParms', 'DP');
      if (isName(filter))
        return this.makeFilter(stream, filter.name, length, params);
      if (isArray(filter)) {
        var filterArray = filter;
        var paramsArray = params;
        for (var i = 0, ii = filterArray.length; i < ii; ++i) {
          filter = filterArray[i];
          if (!isName(filter))
            error('Bad filter name: ' + filter);
          else {
            params = null;
            if (isArray(paramsArray) && (i in paramsArray))
              params = paramsArray[i];
            stream = this.makeFilter(stream, filter.name, length, params);
            // after the first stream the length variable is invalid
            length = null;
          }
        }
      }
      return stream;
    },
    makeFilter: function parserMakeFilter(stream, name, length, params) {
      if (name == 'FlateDecode' || name == 'Fl') {
        if (params) {
          return new PredictorStream(new FlateStream(stream), params);
        }
        return new FlateStream(stream);
      } else if (name == 'LZWDecode' || name == 'LZW') {
        var earlyChange = 1;
        if (params) {
          if (params.has('EarlyChange'))
            earlyChange = params.get('EarlyChange');
          return new PredictorStream(
            new LZWStream(stream, earlyChange), params);
        }
        return new LZWStream(stream, earlyChange);
      } else if (name == 'DCTDecode' || name == 'DCT') {
        var bytes = stream.getBytes(length);
        return new JpegStream(bytes, stream.dict);
      } else if (name == 'ASCII85Decode' || name == 'A85') {
        return new Ascii85Stream(stream);
      } else if (name == 'ASCIIHexDecode' || name == 'AHx') {
        return new AsciiHexStream(stream);
      } else if (name == 'CCITTFaxDecode' || name == 'CCF') {
        return new CCITTFaxStream(stream, params);
      } else {
        error('filter "' + name + '" not supported yet');
      }
      return stream;
    }
  };

  return constructor;
})();

var Linearization = (function linearizationLinearization() {
  function constructor(stream) {
    this.parser = new Parser(new Lexer(stream), false);
    var obj1 = this.parser.getObj();
    var obj2 = this.parser.getObj();
    var obj3 = this.parser.getObj();
    this.linDict = this.parser.getObj();
    if (isInt(obj1) && isInt(obj2) && isCmd(obj3, 'obj') &&
        isDict(this.linDict)) {
      var obj = this.linDict.get('Linearized');
      if (!(isNum(obj) && obj > 0))
        this.linDict = null;
    }
  }

  constructor.prototype = {
    getInt: function linearizationGetInt(name) {
      var linDict = this.linDict;
      var obj;
      if (isDict(linDict) &&
          isInt(obj = linDict.get(name)) &&
          obj > 0) {
        return obj;
      }
      error('"' + name + '" field in linearization table is invalid');
      return 0;
    },
    getHint: function linearizationGetHint(index) {
      var linDict = this.linDict;
      var obj1, obj2;
      if (isDict(linDict) &&
          isArray(obj1 = linDict.get('H')) &&
          obj1.length >= 2 &&
          isInt(obj2 = obj1[index]) &&
          obj2 > 0) {
        return obj2;
      }
      error('Hints table in linearization table is invalid: ' + index);
      return 0;
    },
    get length() {
      if (!isDict(this.linDict))
        return 0;
      return this.getInt('L');
    },
    get hintsOffset() {
      return this.getHint(0);
    },
    get hintsLength() {
      return this.getHint(1);
    },
    get hintsOffset2() {
      return this.getHint(2);
    },
    get hintsLenth2() {
      return this.getHint(3);
    },
    get objectNumberFirst() {
      return this.getInt('O');
    },
    get endFirst() {
      return this.getInt('E');
    },
    get numPages() {
      return this.getInt('N');
    },
    get mainXRefEntriesOffset() {
      return this.getInt('T');
    },
    get pageFirst() {
      return this.getInt('P');
    }
  };

  return constructor;
})();

var XRef = (function xRefXRef() {
  function constructor(stream, startXRef, mainXRefEntriesOffset) {
    this.stream = stream;
    this.entries = [];
    this.xrefstms = {};
    var trailerDict = this.readXRef(startXRef);

    // prepare the XRef cache
    this.cache = [];

    var encrypt = trailerDict.get('Encrypt');
    if (encrypt) {
      var fileId = trailerDict.get('ID');
      this.encrypt = new CipherTransformFactory(this.fetch(encrypt),
                                                fileId[0] /*, password */);
    }

    // get the root dictionary (catalog) object
    if (!isRef(this.root = trailerDict.get('Root')))
      error('Invalid root reference');
  }

  constructor.prototype = {
    readXRefTable: function readXRefTable(parser) {
      var obj;
      while (true) {
        if (isCmd(obj = parser.getObj(), 'trailer'))
          break;
        if (!isInt(obj))
          error('Invalid XRef table');
        var first = obj;
        if (!isInt(obj = parser.getObj()))
          error('Invalid XRef table');
        var n = obj;
        if (first < 0 || n < 0 || (first + n) != ((first + n) | 0))
          error('Invalid XRef table: ' + first + ', ' + n);
        for (var i = first; i < first + n; ++i) {
          var entry = {};
          if (!isInt(obj = parser.getObj()))
            error('Invalid XRef table: ' + first + ', ' + n);
          entry.offset = obj;
          if (!isInt(obj = parser.getObj()))
            error('Invalid XRef table: ' + first + ', ' + n);
          entry.gen = obj;
          obj = parser.getObj();
          if (isCmd(obj, 'n')) {
            entry.uncompressed = true;
          } else if (isCmd(obj, 'f')) {
            entry.free = true;
          } else {
            error('Invalid XRef table: ' + first + ', ' + n);
          }
          if (!this.entries[i]) {
            // In some buggy PDF files the xref table claims to start at 1
            // instead of 0.
            if (i == 1 && first == 1 &&
                entry.offset == 0 && entry.gen == 65535 && entry.free) {
              i = first = 0;
            }
            this.entries[i] = entry;
          }
        }
      }

      // read the trailer dictionary
      var dict;
      if (!isDict(dict = parser.getObj()))
        error('Invalid XRef table');

      // get the 'Prev' pointer
      var prev;
      obj = dict.get('Prev');
      if (isInt(obj)) {
        prev = obj;
      } else if (isRef(obj)) {
        // certain buggy PDF generators generate "/Prev NNN 0 R" instead
        // of "/Prev NNN"
        prev = obj.num;
      }
      if (prev) {
        this.readXRef(prev);
      }

      // check for 'XRefStm' key
      if (isInt(obj = dict.get('XRefStm'))) {
        var pos = obj;
        // ignore previously loaded xref streams (possible infinite recursion)
        if (!(pos in this.xrefstms)) {
          this.xrefstms[pos] = 1;
          this.readXRef(pos);
        }
      }

      return dict;
    },
    readXRefStream: function readXRefStream(stream) {
      var streamParameters = stream.parameters;
      var byteWidths = streamParameters.get('W');
      var range = streamParameters.get('Index');
      if (!range)
        range = [0, streamParameters.get('Size')];
      var i, j;
      while (range.length > 0) {
        var first = range[0], n = range[1];
        if (!isInt(first) || !isInt(n))
          error('Invalid XRef range fields: ' + first + ', ' + n);
        var typeFieldWidth = byteWidths[0];
        var offsetFieldWidth = byteWidths[1];
        var generationFieldWidth = byteWidths[2];
        if (!isInt(typeFieldWidth) || !isInt(offsetFieldWidth) ||
            !isInt(generationFieldWidth)) {
          error('Invalid XRef entry fields length: ' + first + ', ' + n);
        }
        for (i = 0; i < n; ++i) {
          var type = 0, offset = 0, generation = 0;
          for (j = 0; j < typeFieldWidth; ++j)
            type = (type << 8) | stream.getByte();
          // if type field is absent, its default value = 1
          if (typeFieldWidth == 0)
            type = 1;
          for (j = 0; j < offsetFieldWidth; ++j)
            offset = (offset << 8) | stream.getByte();
          for (j = 0; j < generationFieldWidth; ++j)
            generation = (generation << 8) | stream.getByte();
          var entry = {};
          entry.offset = offset;
          entry.gen = generation;
          switch (type) {
            case 0:
              entry.free = true;
              break;
            case 1:
              entry.uncompressed = true;
              break;
            case 2:
              break;
            default:
              error('Invalid XRef entry type: ' + type);
          }
          if (!this.entries[first + i])
            this.entries[first + i] = entry;
        }
        range.splice(0, 2);
      }
      var prev = streamParameters.get('Prev');
      if (isInt(prev))
        this.readXRef(prev);
      return streamParameters;
    },
    indexObjects: function indexObjects() {
      // Simple scan through the PDF content to find objects,
      // trailers and XRef streams.
      function readToken(data, offset) {
        var token = '', ch = data[offset];
        while (ch !== 13 && ch !== 10) {
          if (++offset >= data.length)
            break;
          token += String.fromCharCode(ch);
          ch = data[offset];
        }
        return token;
      }
      function skipUntil(data, offset, what) {
        var length = what.length, dataLength = data.length;
        var skipped = 0;
        // finding byte sequence
        while (offset < dataLength) {
          var i = 0;
          while (i < length && data[offset + i] == what[i])
            ++i;
          if (i >= length)
            break; // sequence found

          offset++;
          skipped++;
        }
        return skipped;
      }
      var trailerBytes = new Uint8Array([116, 114, 97, 105, 108, 101, 114]);
      var startxrefBytes = new Uint8Array([115, 116, 97, 114, 116, 120, 114,
                                          101, 102]);
      var endobjBytes = new Uint8Array([101, 110, 100, 111, 98, 106]);
      var xrefBytes = new Uint8Array([47, 88, 82, 101, 102]);

      var stream = this.stream;
      stream.pos = 0;
      var buffer = stream.getBytes();
      var position = 0, length = buffer.length;
      var trailers = [], xrefStms = [];
      var state = 0;
      var currentToken;
      while (position < length) {
        var ch = buffer[position];
        if (ch === 32 || ch === 9 || ch === 13 || ch === 10) {
          ++position;
          continue;
        }
        if (ch === 37) { // %-comment
          do {
            ++position;
            ch = buffer[position];
          } while (ch !== 13 && ch !== 10);
          continue;
        }
        var token = readToken(buffer, position);
        var m;
        if (token === 'xref') {
          position += skipUntil(buffer, position, trailerBytes);
          trailers.push(position);
          position += skipUntil(buffer, position, startxrefBytes);
        } else if ((m = /^(\d+)\s+(\d+)\s+obj\b/.exec(token))) {
          this.entries[m[1]] = {
            offset: position,
            gen: m[2] | 0,
            uncompressed: true
          };

          var contentLength = skipUntil(buffer, position, endobjBytes) + 7;
          var content = buffer.subarray(position, position + contentLength);

          // checking XRef stream suspect
          // (it shall have '/XRef' and next char is not a letter)
          var xrefTagOffset = skipUntil(content, 0, xrefBytes);
          if (xrefTagOffset < contentLength &&
              content[xrefTagOffset + 5] < 64) {
            xrefStms.push(position);
            this.xrefstms[position] = 1; // don't read it recursively
          }

          position += contentLength;
        } else
          position += token.length + 1;
      }
      // reading XRef streams
      for (var i = 0; i < xrefStms.length; ++i) {
          this.readXRef(xrefStms[i]);
      }
      // finding main trailer
      for (var i = 0; i < trailers.length; ++i) {
        stream.pos = trailers[i];
        var parser = new Parser(new Lexer(stream), true);
        var obj = parser.getObj();
        if (!isCmd(obj, 'trailer'))
          continue;
        // read the trailer dictionary
        var dict;
        if (!isDict(dict = parser.getObj()))
          continue;
        // taking the first one with 'ID'
        if (dict.has('ID'))
          return dict;
      }
      // nothing helps
      error('Invalid PDF structure');
      return null;
    },
    readXRef: function readXref(startXRef) {
      var stream = this.stream;
      stream.pos = startXRef;
      var parser = new Parser(new Lexer(stream), true);
      var obj = parser.getObj();
      // parse an old-style xref table
      if (isCmd(obj, 'xref'))
        return this.readXRefTable(parser);
      // parse an xref stream
      if (isInt(obj)) {
        if (!isInt(parser.getObj()) ||
            !isCmd(parser.getObj(), 'obj') ||
            !isStream(obj = parser.getObj())) {
          error('Invalid XRef stream');
        }
        return this.readXRefStream(obj);
      }
      return this.indexObjects();
    },
    getEntry: function xRefGetEntry(i) {
      var e = this.entries[i];
      if (e.free)
        error('reading an XRef stream not implemented yet');
      return e;
    },
    fetchIfRef: function xRefFetchIfRef(obj) {
      if (!isRef(obj))
        return obj;
      return this.fetch(obj);
    },
    fetch: function xRefFetch(ref, suppressEncryption) {
      var num = ref.num;
      var e = this.cache[num];
      if (e)
        return e;

      e = this.getEntry(num);
      var gen = ref.gen;
      var stream, parser;
      if (e.uncompressed) {
        if (e.gen != gen)
          throw ('inconsistent generation in XRef');
        stream = this.stream.makeSubStream(e.offset);
        parser = new Parser(new Lexer(stream), true, this);
        var obj1 = parser.getObj();
        var obj2 = parser.getObj();
        var obj3 = parser.getObj();
        if (!isInt(obj1) || obj1 != num ||
            !isInt(obj2) || obj2 != gen ||
            !isCmd(obj3)) {
          error('bad XRef entry');
        }
        if (!isCmd(obj3, 'obj')) {
          // some bad pdfs use "obj1234" and really mean 1234
          if (obj3.cmd.indexOf('obj') == 0) {
            num = parseInt(obj3.cmd.substring(3), 10);
            if (!isNaN(num))
              return num;
          }
          error('bad XRef entry');
        }
        if (this.encrypt && !suppressEncryption) {
          try {
            e = parser.getObj(this.encrypt.createCipherTransform(num, gen));
          } catch (ex) {
            // almost all streams must be encrypted, but sometimes
            // they are not probably due to some broken generators
            // re-trying without encryption
            return this.fetch(ref, true);
          }
        } else {
          e = parser.getObj();
        }
        // Don't cache streams since they are mutable.
        if (!isStream(e))
          this.cache[num] = e;
        return e;
      }

      // compressed entry
      stream = this.fetch(new Ref(e.offset, 0));
      if (!isStream(stream))
        error('bad ObjStm stream');
      var first = stream.parameters.get('First');
      var n = stream.parameters.get('N');
      if (!isInt(first) || !isInt(n)) {
        error('invalid first and n parameters for ObjStm stream');
      }
      parser = new Parser(new Lexer(stream), false);
      var i, entries = [], nums = [];
      // read the object numbers to populate cache
      for (i = 0; i < n; ++i) {
        num = parser.getObj();
        if (!isInt(num)) {
          error('invalid object number in the ObjStm stream: ' + num);
        }
        nums.push(num);
        var offset = parser.getObj();
        if (!isInt(offset)) {
          error('invalid object offset in the ObjStm stream: ' + offset);
        }
      }
      // read stream objects for cache
      for (i = 0; i < n; ++i) {
        entries.push(parser.getObj());
        this.cache[nums[i]] = entries[i];
      }
      e = entries[e.gen];
      if (!e) {
        error('bad XRef entry for compressed object');
      }
      return e;
    },
    getCatalogObj: function xRefGetCatalogObj() {
      return this.fetch(this.root);
    }
  };

  return constructor;
})();

var Page = (function pagePage() {
  function constructor(xref, pageNumber, pageDict, ref) {
    this.pageNumber = pageNumber;
    this.pageDict = pageDict;
    this.stats = {
      create: Date.now(),
      compile: 0.0,
      fonts: 0.0,
      images: 0.0,
      render: 0.0
    };
    this.xref = xref;
    this.ref = ref;
  }

  constructor.prototype = {
    getPageProp: function pageGetPageProp(key) {
      return this.xref.fetchIfRef(this.pageDict.get(key));
    },
    inheritPageProp: function pageInheritPageProp(key) {
      var dict = this.pageDict;
      var obj = dict.get(key);
      while (obj === undefined) {
        dict = this.xref.fetchIfRef(dict.get('Parent'));
        if (!dict)
          break;
        obj = dict.get(key);
      }
      return obj;
    },
    get content() {
      return shadow(this, 'content', this.getPageProp('Contents'));
    },
    get resources() {
      return shadow(this, 'resources', this.inheritPageProp('Resources'));
    },
    get mediaBox() {
      var obj = this.inheritPageProp('MediaBox');
      // Reset invalid media box to letter size.
      if (!isArray(obj) || obj.length !== 4)
        obj = [0, 0, 612, 792];
      return shadow(this, 'mediaBox', obj);
    },
    get view() {
      var obj = this.inheritPageProp('CropBox');
      var view = {
        x: 0,
        y: 0,
        width: this.width,
        height: this.height
      };
      if (isArray(obj) && obj.length == 4) {
        var tl = this.rotatePoint(obj[0], obj[1]);
        var br = this.rotatePoint(obj[2], obj[3]);
        view.x = Math.min(tl.x, br.x);
        view.y = Math.min(tl.y, br.y);
        view.width = Math.abs(tl.x - br.x);
        view.height = Math.abs(tl.y - br.y);
      }

      return shadow(this, 'cropBox', view);
    },
    get annotations() {
      return shadow(this, 'annotations', this.inheritPageProp('Annots'));
    },
    get width() {
      var mediaBox = this.mediaBox;
      var rotate = this.rotate;
      var width;
      if (rotate == 0 || rotate == 180) {
        width = (mediaBox[2] - mediaBox[0]);
      } else {
        width = (mediaBox[3] - mediaBox[1]);
      }
      return shadow(this, 'width', width);
    },
    get height() {
      var mediaBox = this.mediaBox;
      var rotate = this.rotate;
      var height;
      if (rotate == 0 || rotate == 180) {
        height = (mediaBox[3] - mediaBox[1]);
      } else {
        height = (mediaBox[2] - mediaBox[0]);
      }
      return shadow(this, 'height', height);
    },
    get rotate() {
      var rotate = this.inheritPageProp('Rotate') || 0;
      // Normalize rotation so it's a multiple of 90 and between 0 and 270
      if (rotate % 90 != 0) {
        rotate = 0;
      } else if (rotate >= 360) {
        rotate = rotate % 360;
      } else if (rotate < 0) {
        // The spec doesn't cover negatives, assume its counterclockwise
        // rotation. The following is the other implementation of modulo.
        rotate = ((rotate % 360) + 360) % 360;
      }
      return shadow(this, 'rotate', rotate);
    },
    startRendering: function pageStartRendering(canvasCtx, continuation) {
      var self = this;
      var stats = self.stats;
      stats.compile = stats.fonts = stats.render = 0;

      var gfx = new CanvasGraphics(canvasCtx);
      var fonts = [];
      var images = new ImagesLoader();

      this.compile(gfx, fonts, images);
      stats.compile = Date.now();

      var displayContinuation = function pageDisplayContinuation() {
        // Always defer call to display() to work around bug in
        // Firefox error reporting from XHR callbacks.
        setTimeout(function pageSetTimeout() {
          var exc = null;
          try {
            self.display(gfx);
            stats.render = Date.now();
          } catch (e) {
            exc = e.toString();
          }
          if (continuation) continuation(exc);
        });
      };

      var fontObjs = FontLoader.bind(
        fonts,
        function pageFontObjs() {
          stats.fonts = Date.now();
          images.notifyOnLoad(function pageNotifyOnLoad() {
            stats.images = Date.now();
            displayContinuation();
          });
        });

      for (var i = 0, ii = fonts.length; i < ii; ++i)
        fonts[i].dict.fontObj = fontObjs[i];
    },


    compile: function pageCompile(gfx, fonts, images) {
      if (this.code) {
        // content was compiled
        return;
      }

      var xref = this.xref;
      var content = xref.fetchIfRef(this.content);
      var resources = xref.fetchIfRef(this.resources);
      if (isArray(content)) {
        // fetching items
        var i, n = content.length;
        for (i = 0; i < n; ++i)
          content[i] = xref.fetchIfRef(content[i]);
        content = new StreamsSequenceStream(content);
      }
      this.code = gfx.compile(content, xref, resources, fonts, images);
    },
    display: function pageDisplay(gfx) {
      assert(this.code instanceof Function,
             'page content must be compiled first');
      var xref = this.xref;
      var resources = xref.fetchIfRef(this.resources);
      var mediaBox = xref.fetchIfRef(this.mediaBox);
      assertWellFormed(isDict(resources), 'invalid page resources');
      gfx.beginDrawing({ x: mediaBox[0], y: mediaBox[1],
            width: this.width,
            height: this.height,
            rotate: this.rotate });
      gfx.execute(this.code, xref, resources);
      gfx.endDrawing();
    },
    rotatePoint: function pageRotatePoint(x, y) {
      var rotate = this.rotate;
      switch (rotate) {
        case 180:
          return {x: this.width - x, y: y};
        case 90:
          return {x: this.width - y, y: this.height - x};
        case 270:
          return {x: y, y: x};
        case 0:
        default:
          return {x: x, y: this.height - y};
      }
    },
    getLinks: function pageGetLinks() {
      var xref = this.xref;
      var annotations = xref.fetchIfRef(this.annotations) || [];
      var i, n = annotations.length;
      var links = [];
      for (i = 0; i < n; ++i) {
        var annotation = xref.fetch(annotations[i]);
        if (!isDict(annotation))
          continue;
        var subtype = annotation.get('Subtype');
        if (!isName(subtype) || subtype.name != 'Link')
          continue;
        var rect = annotation.get('Rect');
        var topLeftCorner = this.rotatePoint(rect[0], rect[1]);
        var bottomRightCorner = this.rotatePoint(rect[2], rect[3]);

        var link = {};
        link.x = Math.min(topLeftCorner.x, bottomRightCorner.x);
        link.y = Math.min(topLeftCorner.y, bottomRightCorner.y);
        link.width = Math.abs(topLeftCorner.x - bottomRightCorner.x);
        link.height = Math.abs(topLeftCorner.y - bottomRightCorner.y);
        var a = this.xref.fetchIfRef(annotation.get('A'));
        if (a) {
          switch (a.get('S').name) {
            case 'URI':
              link.url = a.get('URI');
              break;
            case 'GoTo':
              link.dest = a.get('D');
              break;
            default:
              TODO('other link types');
          }
        } else if (annotation.has('Dest')) {
          // simple destination link
          var dest = annotation.get('Dest');
          link.dest = isName(dest) ? dest.name : dest;
        }
        links.push(link);
      }
      return links;
    }
  };

  return constructor;
})();

var Catalog = (function catalogCatalog() {
  function constructor(xref) {
    this.xref = xref;
    var obj = xref.getCatalogObj();
    assertWellFormed(isDict(obj), 'catalog object is not a dictionary');
    this.catDict = obj;
  }

  constructor.prototype = {
    get toplevelPagesDict() {
      var pagesObj = this.catDict.get('Pages');
      assertWellFormed(isRef(pagesObj), 'invalid top-level pages reference');
      var xrefObj = this.xref.fetch(pagesObj);
      assertWellFormed(isDict(xrefObj), 'invalid top-level pages dictionary');
      // shadow the prototype getter
      return shadow(this, 'toplevelPagesDict', xrefObj);
    },
    get documentOutline() {
      var obj = this.catDict.get('Outlines');
      var xref = this.xref;
      var root = { items: [] };
      if (isRef(obj)) {
        obj = xref.fetch(obj).get('First');
        var processed = new RefSet();
        if (isRef(obj)) {
          var queue = [{obj: obj, parent: root}];
          // to avoid recursion keeping track of the items
          // in the processed dictionary
          processed.put(obj);
          while (queue.length > 0) {
            var i = queue.shift();
            var outlineDict = xref.fetch(i.obj);
            if (!outlineDict.has('Title'))
              error('Invalid outline item');
            var dest = outlineDict.get('A');
            if (dest)
              dest = xref.fetchIfRef(dest).get('D');
            else if (outlineDict.has('Dest')) {
              dest = outlineDict.get('Dest');
              if (isName(dest))
                dest = dest.name;
            }
            var title = xref.fetchIfRef(outlineDict.get('Title'));
            var outlineItem = {
              dest: dest,
              title: stringToPDFString(title),
              color: outlineDict.get('C') || [0, 0, 0],
              count: outlineDict.get('Count'),
              bold: !!(outlineDict.get('F') & 2),
              italic: !!(outlineDict.get('F') & 1),
              items: []
            };
            i.parent.items.push(outlineItem);
            obj = outlineDict.get('First');
            if (isRef(obj) && !processed.has(obj)) {
              queue.push({obj: obj, parent: outlineItem});
              processed.put(obj);
            }
            obj = outlineDict.get('Next');
            if (isRef(obj) && !processed.has(obj)) {
              queue.push({obj: obj, parent: i.parent});
              processed.put(obj);
            }
          }
        }
      }
      obj = root.items.length > 0 ? root.items : null;
      return shadow(this, 'documentOutline', obj);
    },
    get numPages() {
      var obj = this.toplevelPagesDict.get('Count');
      assertWellFormed(
        isInt(obj),
        'page count in top level pages object is not an integer'
      );
      // shadow the prototype getter
      return shadow(this, 'num', obj);
    },
    traverseKids: function catalogTraverseKids(pagesDict) {
      var pageCache = this.pageCache;
      var kids = pagesDict.get('Kids');
      assertWellFormed(isArray(kids),
                       'page dictionary kids object is not an array');
      for (var i = 0; i < kids.length; ++i) {
        var kid = kids[i];
        assertWellFormed(isRef(kid),
                         'page dictionary kid is not a reference');
        var obj = this.xref.fetch(kid);
        if (isDict(obj, 'Page') || (isDict(obj) && !obj.has('Kids'))) {
          pageCache.push(new Page(this.xref, pageCache.length, obj, kid));
        } else { // must be a child page dictionary
          assertWellFormed(
            isDict(obj),
            'page dictionary kid reference points to wrong type of object'
          );
          this.traverseKids(obj);
        }
      }
    },
    get destinations() {
      function fetchDestination(xref, ref) {
        var dest = xref.fetchIfRef(ref);
        return isDict(dest) ? dest.get('D') : dest;
      }

      var xref = this.xref;
      var dests = {}, nameTreeRef, nameDictionaryRef;
      var obj = this.catDict.get('Names');
      if (obj)
        nameTreeRef = xref.fetchIfRef(obj).get('Dests');
      else if (this.catDict.has('Dests'))
        nameDictionaryRef = this.catDict.get('Dests');

      if (nameDictionaryRef) {
        // reading simple destination dictionary
        obj = xref.fetchIfRef(nameDictionaryRef);
        obj.forEach(function catalogForEach(key, value) {
          if (!value) return;
          dests[key] = fetchDestination(xref, value);
        });
      }
      if (nameTreeRef) {
        // reading name tree
        var processed = new RefSet();
        processed.put(nameTreeRef);
        var queue = [nameTreeRef];
        while (queue.length > 0) {
          var i, n;
          obj = xref.fetch(queue.shift());
          if (obj.has('Kids')) {
            var kids = obj.get('Kids');
            for (i = 0, n = kids.length; i < n; i++) {
              var kid = kids[i];
              if (processed.has(kid))
                error('invalid destinations');
              queue.push(kid);
              processed.put(kid);
            }
            continue;
          }
          var names = obj.get('Names');
          for (i = 0, n = names.length; i < n; i += 2) {
            dests[names[i]] = fetchDestination(xref, names[i + 1]);
          }
        }
      }
      return shadow(this, 'destinations', dests);
    },
    getPage: function catalogGetPage(n) {
      var pageCache = this.pageCache;
      if (!pageCache) {
        pageCache = this.pageCache = [];
        this.traverseKids(this.toplevelPagesDict);
      }
      return this.pageCache[n - 1];
    }
  };

  return constructor;
})();

var PDFDoc = (function pdfDoc() {
  function constructor(arg, callback) {
    // Stream argument
    if (typeof arg.isStream !== 'undefined') {
      init.call(this, arg);
    }
    // ArrayBuffer argument
    else if (typeof arg.byteLength !== 'undefined') {
      init.call(this, new Stream(arg));
    }
    else {
      error('Unknown argument type');
    }
  }

  function init(stream) {
    assertWellFormed(stream.length > 0, 'stream must have data');
    this.stream = stream;
    this.setup();
  }

  function find(stream, needle, limit, backwards) {
    var pos = stream.pos;
    var end = stream.end;
    var str = '';
    if (pos + limit > end)
      limit = end - pos;
    for (var n = 0; n < limit; ++n)
      str += stream.getChar();
    stream.pos = pos;
    var index = backwards ? str.lastIndexOf(needle) : str.indexOf(needle);
    if (index == -1)
      return false; /* not found */
    stream.pos += index;
    return true; /* found */
  }

  constructor.prototype = {
    get linearization() {
      var length = this.stream.length;
      var linearization = false;
      if (length) {
        linearization = new Linearization(this.stream);
        if (linearization.length != length)
          linearization = false;
      }
      // shadow the prototype getter with a data property
      return shadow(this, 'linearization', linearization);
    },
    get startXRef() {
      var stream = this.stream;
      var startXRef = 0;
      var linearization = this.linearization;
      if (linearization) {
        // Find end of first obj.
        stream.reset();
        if (find(stream, 'endobj', 1024))
          startXRef = stream.pos + 6;
      } else {
        // Find startxref at the end of the file.
        var start = stream.end - 1024;
        if (start < 0)
          start = 0;
        stream.pos = start;
        if (find(stream, 'startxref', 1024, true)) {
          stream.skip(9);
          var ch;
          do {
            ch = stream.getChar();
          } while (Lexer.isSpace(ch));
          var str = '';
          while ((ch - '0') <= 9) {
            str += ch;
            ch = stream.getChar();
          }
          startXRef = parseInt(str, 10);
          if (isNaN(startXRef))
            startXRef = 0;
        }
      }
      // shadow the prototype getter with a data property
      return shadow(this, 'startXRef', startXRef);
    },
    get mainXRefEntriesOffset() {
      var mainXRefEntriesOffset = 0;
      var linearization = this.linearization;
      if (linearization)
        mainXRefEntriesOffset = linearization.mainXRefEntriesOffset;
      // shadow the prototype getter with a data property
      return shadow(this, 'mainXRefEntriesOffset', mainXRefEntriesOffset);
    },
    // Find the header, remove leading garbage and setup the stream
    // starting from the header.
    checkHeader: function pdfDocCheckHeader() {
      var stream = this.stream;
      stream.reset();
      if (find(stream, '%PDF-', 1024)) {
        // Found the header, trim off any garbage before it.
        stream.moveStart();
        return;
      }
      // May not be a PDF file, continue anyway.
    },
    setup: function pdfDocSetup(ownerPassword, userPassword) {
      this.checkHeader();
      this.xref = new XRef(this.stream,
                           this.startXRef,
                           this.mainXRefEntriesOffset);
      this.catalog = new Catalog(this.xref);
    },
    get numPages() {
      var linearization = this.linearization;
      var num = linearization ? linearization.numPages : this.catalog.numPages;
      // shadow the prototype getter
      return shadow(this, 'numPages', num);
    },
    getPage: function pdfDocGetPage(n) {
      return this.catalog.getPage(n);
    }
  };

  return constructor;
})();

var Encodings = {
  get ExpertEncoding() {
    return shadow(this, 'ExpertEncoding', ['', '', '', '', '', '', '', '', '',
      '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
      '', '', '', '', '', 'space', 'exclamsmall', 'Hungarumlautsmall', '',
      'dollaroldstyle', 'dollarsuperior', 'ampersandsmall', 'Acutesmall',
      'parenleftsuperior', 'parenrightsuperior', 'twodotenleader',
      'onedotenleader', 'comma', 'hyphen', 'period', 'fraction',
      'zerooldstyle', 'oneoldstyle', 'twooldstyle', 'threeoldstyle',
      'fouroldstyle', 'fiveoldstyle', 'sixoldstyle', 'sevenoldstyle',
      'eightoldstyle', 'nineoldstyle', 'colon', 'semicolon', 'commasuperior',
      'threequartersemdash', 'periodsuperior', 'questionsmall', '',
      'asuperior', 'bsuperior', 'centsuperior', 'dsuperior', 'esuperior', '',
      '', 'isuperior', '', '', 'lsuperior', 'msuperior', 'nsuperior',
      'osuperior', '', '', 'rsuperior', 'ssuperior', 'tsuperior', '', 'ff',
      'fi', 'fl', 'ffi', 'ffl', 'parenleftinferior', '', 'parenrightinferior',
      'Circumflexsmall', 'hyphensuperior', 'Gravesmall', 'Asmall', 'Bsmall',
      'Csmall', 'Dsmall', 'Esmall', 'Fsmall', 'Gsmall', 'Hsmall', 'Ismall',
      'Jsmall', 'Ksmall', 'Lsmall', 'Msmall', 'Nsmall', 'Osmall', 'Psmall',
      'Qsmall', 'Rsmall', 'Ssmall', 'Tsmall', 'Usmall', 'Vsmall', 'Wsmall',
      'Xsmall', 'Ysmall', 'Zsmall', 'colonmonetary', 'onefitted', 'rupiah',
      'Tildesmall', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
      '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
      '', 'exclamdownsmall', 'centoldstyle', 'Lslashsmall', '', '',
      'Scaronsmall', 'Zcaronsmall', 'Dieresissmall', 'Brevesmall',
      'Caronsmall', '', 'Dotaccentsmall', '', '', 'Macronsmall', '', '',
      'figuredash', 'hypheninferior', '', '', 'Ogoneksmall', 'Ringsmall',
      'Cedillasmall', '', '', '', 'onequarter', 'onehalf', 'threequarters',
      'questiondownsmall', 'oneeighth', 'threeeighths', 'fiveeighths',
      'seveneighths', 'onethird', 'twothirds', '', '', 'zerosuperior',
      'onesuperior', 'twosuperior', 'threesuperior', 'foursuperior',
      'fivesuperior', 'sixsuperior', 'sevensuperior', 'eightsuperior',
      'ninesuperior', 'zeroinferior', 'oneinferior', 'twoinferior',
      'threeinferior', 'fourinferior', 'fiveinferior', 'sixinferior',
      'seveninferior', 'eightinferior', 'nineinferior', 'centinferior',
      'dollarinferior', 'periodinferior', 'commainferior', 'Agravesmall',
      'Aacutesmall', 'Acircumflexsmall', 'Atildesmall', 'Adieresissmall',
      'Aringsmall', 'AEsmall', 'Ccedillasmall', 'Egravesmall', 'Eacutesmall',
      'Ecircumflexsmall', 'Edieresissmall', 'Igravesmall', 'Iacutesmall',
      'Icircumflexsmall', 'Idieresissmall', 'Ethsmall', 'Ntildesmall',
      'Ogravesmall', 'Oacutesmall', 'Ocircumflexsmall', 'Otildesmall',
      'Odieresissmall', 'OEsmall', 'Oslashsmall', 'Ugravesmall', 'Uacutesmall',
      'Ucircumflexsmall', 'Udieresissmall', 'Yacutesmall', 'Thornsmall',
      'Ydieresissmall'
    ]);
  },
  get MacExpertEncoding() {
    return shadow(this, 'MacExpertEncoding', ['', '', '', '', '', '', '', '',
      '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
      '', '', '', '', '', '', 'space', 'exclamsmall', 'Hungarumlautsmall',
      'centoldstyle', 'dollaroldstyle', 'dollarsuperior', 'ampersandsmall',
      'Acutesmall', 'parenleftsuperior', 'parenrightsuperior',
      'twodotenleader', 'onedotenleader', 'comma', 'hyphen', 'period',
      'fraction', 'zerooldstyle', 'oneoldstyle', 'twooldstyle',
      'threeoldstyle', 'fouroldstyle', 'fiveoldstyle', 'sixoldstyle',
      'sevenoldstyle', 'eightoldstyle', 'nineoldstyle', 'colon', 'semicolon',
      '', 'threequartersemdash', '', 'questionsmall', '', '', '', '',
      'Ethsmall', '', '', 'onequarter', 'onehalf', 'threequarters',
      'oneeighth', 'threeeighths', 'fiveeighths', 'seveneighths', 'onethird',
      'twothirds', '', '', '', '', '', '', 'ff', 'fi', 'fl', 'ffi', 'ffl',
      'parenleftinferior', '', 'parenrightinferior', 'Circumflexsmall',
      'hypheninferior', 'Gravesmall', 'Asmall', 'Bsmall', 'Csmall', 'Dsmall',
      'Esmall', 'Fsmall', 'Gsmall', 'Hsmall', 'Ismall', 'Jsmall', 'Ksmall',
      'Lsmall', 'Msmall', 'Nsmall', 'Osmall', 'Psmall', 'Qsmall', 'Rsmall',
      'Ssmall', 'Tsmall', 'Usmall', 'Vsmall', 'Wsmall', 'Xsmall', 'Ysmall',
      'Zsmall', 'colonmonetary', 'onefitted', 'rupiah', 'Tildesmall', '', '',
      'asuperior', 'centsuperior', '', '', '', '', 'Aacutesmall',
      'Agravesmall', 'Acircumflexsmall', 'Adieresissmall', 'Atildesmall',
      'Aringsmall', 'Ccedillasmall', 'Eacutesmall', 'Egravesmall',
      'Ecircumflexsmall', 'Edieresissmall', 'Iacutesmall', 'Igravesmall',
      'Icircumflexsmall', 'Idieresissmall', 'Ntildesmall', 'Oacutesmall',
      'Ogravesmall', 'Ocircumflexsmall', 'Odieresissmall', 'Otildesmall',
      'Uacutesmall', 'Ugravesmall', 'Ucircumflexsmall', 'Udieresissmall', '',
      'eightsuperior', 'fourinferior', 'threeinferior', 'sixinferior',
      'eightinferior', 'seveninferior', 'Scaronsmall', '', 'centinferior',
      'twoinferior', '', 'Dieresissmall', '', 'Caronsmall', 'osuperior',
      'fiveinferior', '', 'commainferior', 'periodinferior', 'Yacutesmall', '',
      'dollarinferior', '', 'Thornsmall', '', 'nineinferior', 'zeroinferior',
      'Zcaronsmall', 'AEsmall', 'Oslashsmall', 'questiondownsmall',
      'oneinferior', 'Lslashsmall', '', '', '', '', '', '', 'Cedillasmall', '',
      '', '', '', '', 'OEsmall', 'figuredash', 'hyphensuperior', '', '', '',
      '', 'exclamdownsmall', '', 'Ydieresissmall', '', 'onesuperior',
      'twosuperior', 'threesuperior', 'foursuperior', 'fivesuperior',
      'sixsuperior', 'sevensuperior', 'ninesuperior', 'zerosuperior', '',
      'esuperior', 'rsuperior', 'tsuperior', '', '', 'isuperior', 'ssuperior',
      'dsuperior', '', '', '', '', '', 'lsuperior', 'Ogoneksmall',
      'Brevesmall', 'Macronsmall', 'bsuperior', 'nsuperior', 'msuperior',
      'commasuperior', 'periodsuperior', 'Dotaccentsmall', 'Ringsmall'
    ]);
  },
  get MacRomanEncoding() {
    return shadow(this, 'MacRomanEncoding', ['', '', '', '', '', '', '', '',
      '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
      '', '', '', '', '', '', 'space', 'exclam', 'quotedbl', 'numbersign',
      'dollar', 'percent', 'ampersand', 'quotesingle', 'parenleft',
      'parenright', 'asterisk', 'plus', 'comma', 'hyphen', 'period', 'slash',
      'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
      'nine', 'colon', 'semicolon', 'less', 'equal', 'greater', 'question',
      'at', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
      'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
      'bracketleft', 'backslash', 'bracketright', 'asciicircum', 'underscore',
      'grave', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
      'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
      'braceleft', 'bar', 'braceright', 'asciitilde', '', 'Adieresis', 'Aring',
      'Ccedilla', 'Eacute', 'Ntilde', 'Odieresis', 'Udieresis', 'aacute',
      'agrave', 'acircumflex', 'adieresis', 'atilde', 'aring', 'ccedilla',
      'eacute', 'egrave', 'ecircumflex', 'edieresis', 'iacute', 'igrave',
      'icircumflex', 'idieresis', 'ntilde', 'oacute', 'ograve', 'ocircumflex',
      'odieresis', 'otilde', 'uacute', 'ugrave', 'ucircumflex', 'udieresis',
      'dagger', 'degree', 'cent', 'sterling', 'section', 'bullet', 'paragraph',
      'germandbls', 'registered', 'copyright', 'trademark', 'acute',
      'dieresis', 'notequal', 'AE', 'Oslash', 'infinity', 'plusminus',
      'lessequal', 'greaterequal', 'yen', 'mu', 'partialdiff', 'summation',
      'product', 'pi', 'integral', 'ordfeminine', 'ordmasculine', 'Omega',
      'ae', 'oslash', 'questiondown', 'exclamdown', 'logicalnot', 'radical',
      'florin', 'approxequal', 'Delta', 'guillemotleft', 'guillemotright',
      'ellipsis', 'space', 'Agrave', 'Atilde', 'Otilde', 'OE', 'oe', 'endash',
      'emdash', 'quotedblleft', 'quotedblright', 'quoteleft', 'quoteright',
      'divide', 'lozenge', 'ydieresis', 'Ydieresis', 'fraction', 'currency',
      'guilsinglleft', 'guilsinglright', 'fi', 'fl', 'daggerdbl',
      'periodcentered', 'quotesinglbase', 'quotedblbase', 'perthousand',
      'Acircumflex', 'Ecircumflex', 'Aacute', 'Edieresis', 'Egrave', 'Iacute',
      'Icircumflex', 'Idieresis', 'Igrave', 'Oacute', 'Ocircumflex', 'apple',
      'Ograve', 'Uacute', 'Ucircumflex', 'Ugrave', 'dotlessi', 'circumflex',
      'tilde', 'macron', 'breve', 'dotaccent', 'ring', 'cedilla',
      'hungarumlaut', 'ogonek', 'caron'
    ]);
  },
  get StandardEncoding() {
    return shadow(this, 'StandardEncoding', ['', '', '', '', '', '', '', '',
      '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
      '', '', '', '', '', '', 'space', 'exclam', 'quotedbl', 'numbersign',
      'dollar', 'percent', 'ampersand', 'quoteright', 'parenleft',
      'parenright', 'asterisk', 'plus', 'comma', 'hyphen', 'period', 'slash',
      'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
      'nine', 'colon', 'semicolon', 'less', 'equal', 'greater', 'question',
      'at', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
      'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
      'bracketleft', 'backslash', 'bracketright', 'asciicircum', 'underscore',
      'quoteleft', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l',
      'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
      'braceleft', 'bar', 'braceright', 'asciitilde', '', '', 'exclamdown',
      'cent', 'sterling', 'fraction', 'yen', 'florin', 'section', 'currency',
      'quotesingle', 'quotedblleft', 'guillemotleft', 'guilsinglleft',
      'guilsinglright', 'fi', 'fl', '', 'endash', 'dagger', 'daggerdbl',
      'periodcentered', '', 'paragraph', 'bullet', 'quotesinglbase',
      'quotedblbase', 'quotedblright', 'guillemotright', 'ellipsis',
      'perthousand', '', 'questiondown', '', 'grave', 'acute', 'circumflex',
      'tilde', 'macron', 'breve', 'dotaccent', 'dieresis', '', 'ring',
      'cedilla', '', 'hungarumlaut', 'ogonek', 'caron', 'emdash', '', '', '',
      '', '', '', '', '', '', '', '', '', '', '', '', '', 'AE', '',
      'ordfeminine', '', '', '', '', 'Lslash', 'Oslash', 'OE', 'ordmasculine',
      '', '', '', '', '', 'ae', '', '', '', 'dotlessi', '', '', 'lslash',
      'oslash', 'oe', 'germandbls'
    ]);
  },
  get WinAnsiEncoding() {
    return shadow(this, 'WinAnsiEncoding', ['', '', '', '', '', '', '', '', '',
      '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
      '', '', '', '', '', 'space', 'exclam', 'quotedbl', 'numbersign',
      'dollar', 'percent', 'ampersand', 'quotesingle', 'parenleft',
      'parenright', 'asterisk', 'plus', 'comma', 'hyphen', 'period', 'slash',
      'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
      'nine', 'colon', 'semicolon', 'less', 'equal', 'greater', 'question',
      'at', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
      'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
      'bracketleft', 'backslash', 'bracketright', 'asciicircum', 'underscore',
      'grave', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
      'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
      'braceleft', 'bar', 'braceright', 'asciitilde', 'bullet', 'Euro',
      'bullet', 'quotesinglbase', 'florin', 'quotedblbase', 'ellipsis',
      'dagger', 'daggerdbl', 'circumflex', 'perthousand', 'Scaron',
      'guilsinglleft', 'OE', 'bullet', 'Zcaron', 'bullet', 'bullet',
      'quoteleft', 'quoteright', 'quotedblleft', 'quotedblright', 'bullet',
      'endash', 'emdash', 'tilde', 'trademark', 'scaron', 'guilsinglright',
      'oe', 'bullet', 'zcaron', 'Ydieresis', 'space', 'exclamdown', 'cent',
      'sterling', 'currency', 'yen', 'brokenbar', 'section', 'dieresis',
      'copyright', 'ordfeminine', 'guillemotleft', 'logicalnot', 'hyphen',
      'registered', 'macron', 'degree', 'plusminus', 'twosuperior',
      'threesuperior', 'acute', 'mu', 'paragraph', 'periodcentered',
      'cedilla', 'onesuperior', 'ordmasculine', 'guillemotright', 'onequarter',
      'onehalf', 'threequarters', 'questiondown', 'Agrave', 'Aacute',
      'Acircumflex', 'Atilde', 'Adieresis', 'Aring', 'AE', 'Ccedilla',
      'Egrave', 'Eacute', 'Ecircumflex', 'Edieresis', 'Igrave', 'Iacute',
      'Icircumflex', 'Idieresis', 'Eth', 'Ntilde', 'Ograve', 'Oacute',
      'Ocircumflex', 'Otilde', 'Odieresis', 'multiply', 'Oslash', 'Ugrave',
      'Uacute', 'Ucircumflex', 'Udieresis', 'Yacute', 'Thorn', 'germandbls',
      'agrave', 'aacute', 'acircumflex', 'atilde', 'adieresis', 'aring', 'ae',
      'ccedilla', 'egrave', 'eacute', 'ecircumflex', 'edieresis', 'igrave',
      'iacute', 'icircumflex', 'idieresis', 'eth', 'ntilde', 'ograve',
      'oacute', 'ocircumflex', 'otilde', 'odieresis', 'divide', 'oslash',
      'ugrave', 'uacute', 'ucircumflex', 'udieresis', 'yacute', 'thorn',
      'ydieresis'
    ]);
  },
  get symbolsEncoding() {
    return shadow(this, 'symbolsEncoding', ['', '', '', '', '', '', '', '', '',
      '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
      '', '', '', '', '', 'space', 'exclam', 'universal', 'numbersign',
      'existential', 'percent', 'ampersand', 'suchthat', 'parenleft',
      'parenright', 'asteriskmath', 'plus', 'comma', 'minus', 'period',
      'slash', 'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven',
      'eight', 'nine', 'colon', 'semicolon', 'less', 'equal', 'greater',
      'question', 'congruent', 'Alpha', 'Beta', 'Chi', 'Delta', 'Epsilon',
      'Phi', 'Gamma', 'Eta', 'Iota', 'theta1', 'Kappa', 'Lambda', 'Mu', 'Nu',
      'Omicron', 'Pi', 'Theta', 'Rho', 'Sigma', 'Tau', 'Upsilon', 'sigma1',
      'Omega', 'Xi', 'Psi', 'Zeta', 'bracketleft', 'therefore', 'bracketright',
      'perpendicular', 'underscore', 'radicalex', 'alpha', 'beta', 'chi',
      'delta', 'epsilon', 'phi', 'gamma', 'eta', 'iota', 'phi1', 'kappa',
      'lambda', 'mu', 'nu', 'omicron', 'pi', 'theta', 'rho', 'sigma', 'tau',
      'upsilon', 'omega1', 'omega', 'xi', 'psi', 'zeta', 'braceleft', 'bar',
      'braceright', 'similar', '', '', '', '', '', '', '', '', '', '', '', '',
      '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
      '', '', '', 'Euro', 'Upsilon1', 'minute', 'lessequal', 'fraction',
      'infinity', 'florin', 'club', 'diamond', 'heart', 'spade', 'arrowboth',
      'arrowleft', 'arrowup', 'arrowright', 'arrowdown', 'degree', 'plusminus',
      'second', 'greaterequal', 'multiply', 'proportional', 'partialdiff',
      'bullet', 'divide', 'notequal', 'equivalence', 'approxequal', 'ellipsis',
      'arrowvertex', 'arrowhorizex', 'carriagereturn', 'aleph', 'Ifraktur',
      'Rfraktur', 'weierstrass', 'circlemultiply', 'circleplus', 'emptyset',
      'intersection', 'union', 'propersuperset', 'reflexsuperset', 'notsubset',
      'propersubset', 'reflexsubset', 'element', 'notelement', 'angle',
      'gradient', 'registerserif', 'copyrightserif', 'trademarkserif',
      'product', 'radical', 'dotmath', 'logicalnot', 'logicaland', 'logicalor',
      'arrowdblboth', 'arrowdblleft', 'arrowdblup', 'arrowdblright',
      'arrowdbldown', 'lozenge', 'angleleft', 'registersans', 'copyrightsans',
      'trademarksans', 'summation', 'parenlefttp', 'parenleftex',
      'parenleftbt', 'bracketlefttp', 'bracketleftex', 'bracketleftbt',
      'bracelefttp', 'braceleftmid', 'braceleftbt', 'braceex', '',
      'angleright', 'integral', 'integraltp', 'integralex', 'integralbt',
      'parenrighttp', 'parenrightex', 'parenrightbt', 'bracketrighttp',
      'bracketrightex', 'bracketrightbt', 'bracerighttp', 'bracerightmid',
      'bracerightbt'
    ]);
  },
  get zapfDingbatsEncoding() {
    return shadow(this, 'zapfDingbatsEncoding', ['', '', '', '', '', '', '',
      '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
      '', '', '', '', '', '', '', 'space', 'a1', 'a2', 'a202', 'a3', 'a4',
      'a5', 'a119', 'a118', 'a117', 'a11', 'a12', 'a13', 'a14', 'a15', 'a16',
      'a105', 'a17', 'a18', 'a19', 'a20', 'a21', 'a22', 'a23', 'a24', 'a25',
      'a26', 'a27', 'a28', 'a6', 'a7', 'a8', 'a9', 'a10', 'a29', 'a30', 'a31',
      'a32', 'a33', 'a34', 'a35', 'a36', 'a37', 'a38', 'a39', 'a40', 'a41',
      'a42', 'a43', 'a44', 'a45', 'a46', 'a47', 'a48', 'a49', 'a50', 'a51',
      'a52', 'a53', 'a54', 'a55', 'a56', 'a57', 'a58', 'a59', 'a60', 'a61',
      'a62', 'a63', 'a64', 'a65', 'a66', 'a67', 'a68', 'a69', 'a70', 'a71',
      'a72', 'a73', 'a74', 'a203', 'a75', 'a204', 'a76', 'a77', 'a78', 'a79',
      'a81', 'a82', 'a83', 'a84', 'a97', 'a98', 'a99', 'a100', '', '', '', '',
      '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
      '', '', '', '', '', '', '', '', '', '', '', '', 'a101', 'a102', 'a103',
      'a104', 'a106', 'a107', 'a108', 'a112', 'a111', 'a110', 'a109', 'a120',
      'a121', 'a122', 'a123', 'a124', 'a125', 'a126', 'a127', 'a128', 'a129',
      'a130', 'a131', 'a132', 'a133', 'a134', 'a135', 'a136', 'a137', 'a138',
      'a139', 'a140', 'a141', 'a142', 'a143', 'a144', 'a145', 'a146', 'a147',
      'a148', 'a149', 'a150', 'a151', 'a152', 'a153', 'a154', 'a155', 'a156',
      'a157', 'a158', 'a159', 'a160', 'a161', 'a163', 'a164', 'a196', 'a165',
      'a192', 'a166', 'a167', 'a168', 'a169', 'a170', 'a171', 'a172', 'a173',
      'a162', 'a174', 'a175', 'a176', 'a177', 'a178', 'a179', 'a193', 'a180',
      'a199', 'a181', 'a200', 'a182', '', 'a201', 'a183', 'a184', 'a197',
      'a185', 'a194', 'a198', 'a186', 'a195', 'a187', 'a188', 'a189', 'a190',
      'a191'
    ]);
  }
};

var IDENTITY_MATRIX = [1, 0, 0, 1, 0, 0];

var EvalState = (function evalState() {
  function constructor() {
    // Are soft masks and alpha values shapes or opacities?
    this.alphaIsShape = false;
    this.fontSize = 0;
    this.textMatrix = IDENTITY_MATRIX;
    this.leading = 0;
    // Start of text line (in text coordinates)
    this.lineX = 0;
    this.lineY = 0;
    // Character and word spacing
    this.charSpacing = 0;
    this.wordSpacing = 0;
    this.textHScale = 1;
    // Color spaces
    this.fillColorSpace = null;
    this.strokeColorSpace = null;
  }
  constructor.prototype = {
  };
  return constructor;
})();

var PartialEvaluator = (function partialEvaluator() {
  function constructor() {
    this.state = new EvalState();
    this.stateStack = [];
  }

  var OP_MAP = {
    // Graphics state
    w: 'setLineWidth',
    J: 'setLineCap',
    j: 'setLineJoin',
    M: 'setMiterLimit',
    d: 'setDash',
    ri: 'setRenderingIntent',
    i: 'setFlatness',
    gs: 'setGState',
    q: 'save',
    Q: 'restore',
    cm: 'transform',

    // Path
    m: 'moveTo',
    l: 'lineTo',
    c: 'curveTo',
    v: 'curveTo2',
    y: 'curveTo3',
    h: 'closePath',
    re: 'rectangle',
    S: 'stroke',
    s: 'closeStroke',
    f: 'fill',
    F: 'fill',
    'f*': 'eoFill',
    B: 'fillStroke',
    'B*': 'eoFillStroke',
    b: 'closeFillStroke',
    'b*': 'closeEOFillStroke',
    n: 'endPath',

    // Clipping
    W: 'clip',
    'W*': 'eoClip',

    // Text
    BT: 'beginText',
    ET: 'endText',
    Tc: 'setCharSpacing',
    Tw: 'setWordSpacing',
    Tz: 'setHScale',
    TL: 'setLeading',
    Tf: 'setFont',
    Tr: 'setTextRenderingMode',
    Ts: 'setTextRise',
    Td: 'moveText',
    TD: 'setLeadingMoveText',
    Tm: 'setTextMatrix',
    'T*': 'nextLine',
    Tj: 'showText',
    TJ: 'showSpacedText',
    "'": 'nextLineShowText',
    '"': 'nextLineSetSpacingShowText',

    // Type3 fonts
    d0: 'setCharWidth',
    d1: 'setCharWidthAndBounds',

    // Color
    CS: 'setStrokeColorSpace',
    cs: 'setFillColorSpace',
    SC: 'setStrokeColor',
    SCN: 'setStrokeColorN',
    sc: 'setFillColor',
    scn: 'setFillColorN',
    G: 'setStrokeGray',
    g: 'setFillGray',
    RG: 'setStrokeRGBColor',
    rg: 'setFillRGBColor',
    K: 'setStrokeCMYKColor',
    k: 'setFillCMYKColor',

    // Shading
    sh: 'shadingFill',

    // Images
    BI: 'beginInlineImage',
    ID: 'beginImageData',
    EI: 'endInlineImage',

    // XObjects
    Do: 'paintXObject',

    // Marked content
    MP: 'markPoint',
    DP: 'markPointProps',
    BMC: 'beginMarkedContent',
    BDC: 'beginMarkedContentProps',
    EMC: 'endMarkedContent',

    // Compatibility
    BX: 'beginCompat',
    EX: 'endCompat'
  };

  constructor.prototype = {
    evaluate: function partialEvaluatorEvaluate(stream, xref, resources, fonts,
                                                images) {
      resources = xref.fetchIfRef(resources) || new Dict();
      var xobjs = xref.fetchIfRef(resources.get('XObject')) || new Dict();
      var patterns = xref.fetchIfRef(resources.get('Pattern')) || new Dict();
      var parser = new Parser(new Lexer(stream), false);
      var args = [], argsArray = [], fnArray = [], obj;

      while (!isEOF(obj = parser.getObj())) {
        if (isCmd(obj)) {
          var cmd = obj.cmd;
          var fn = OP_MAP[cmd];
          assertWellFormed(fn, "Unknown command '" + cmd + "'");
          // TODO figure out how to type-check vararg functions

          if ((cmd == 'SCN' || cmd == 'scn') && !args[args.length - 1].code) {
            // compile tiling patterns
            var patternName = args[args.length - 1];
            // SCN/scn applies patterns along with normal colors
            if (isName(patternName)) {
              var pattern = xref.fetchIfRef(patterns.get(patternName.name));
              if (pattern) {
                var dict = isStream(pattern) ? pattern.dict : pattern;
                var typeNum = dict.get('PatternType');
                if (typeNum == 1) {
                  patternName.code = this.evaluate(pattern, xref,
                                                   dict.get('Resources'),
                                                   fonts, images);
                }
              }
            }
          } else if (cmd == 'Do' && !args[0].code) {
            // eagerly compile XForm objects
            var name = args[0].name;
            var xobj = xobjs.get(name);
            if (xobj) {
              xobj = xref.fetchIfRef(xobj);
              assertWellFormed(isStream(xobj), 'XObject should be a stream');

              var type = xobj.dict.get('Subtype');
              assertWellFormed(
                isName(type),
                'XObject should have a Name subtype'
              );

              if ('Form' == type.name) {
                args[0].code = this.evaluate(xobj, xref,
                                             xobj.dict.get('Resources'), fonts,
                                             images);
              }
              if (xobj instanceof JpegStream)
                images.bind(xobj); // monitoring image load
            }
          } else if (cmd == 'Tf') { // eagerly collect all fonts
            var fontRes = resources.get('Font');
            if (fontRes) {
              fontRes = xref.fetchIfRef(fontRes);
              var font = xref.fetchIfRef(fontRes.get(args[0].name));
              assertWellFormed(isDict(font));
              if (!font.translated) {
                font.translated = this.translateFont(font, xref, resources);
                if (fonts && font.translated) {
                  // keep track of each font we translated so the caller can
                  // load them asynchronously before calling display on a page
                  fonts.push(font.translated);
                }
              }
            }
          }

          fnArray.push(fn);
          argsArray.push(args);
          args = [];
        } else if (obj != null) {
          assertWellFormed(args.length <= 33, 'Too many arguments');
          args.push(obj);
        }
      }

      return function partialEvaluatorReturn(gfx) {
        for (var i = 0, length = argsArray.length; i < length; i++)
          gfx[fnArray[i]].apply(gfx, argsArray[i]);
      };
    },

    extractEncoding: function partialEvaluatorExtractEncoding(dict,
                                                              xref,
                                                              properties) {
      var type = properties.type, encoding;
      if (properties.composite) {
        if (type == 'CIDFontType2') {
          var defaultWidth = xref.fetchIfRef(dict.get('DW')) || 1000;
          properties.defaultWidth = defaultWidth;

          var glyphsWidths = {};
          var widths = xref.fetchIfRef(dict.get('W'));
          if (widths) {
            var start = 0, end = 0;
            for (var i = 0; i < widths.length; i++) {
              var code = widths[i];
              if (isArray(code)) {
                for (var j = 0; j < code.length; j++)
                  glyphsWidths[start++] = code[j];
                start = 0;
              } else if (start) {
                var width = widths[++i];
                for (var j = start; j <= code; j++)
                  glyphsWidths[j] = width;
                start = 0;
              } else {
                start = code;
              }
            }
          }
          properties.widths = glyphsWidths;

          var cidToGidMap = dict.get('CIDToGIDMap');
          if (!cidToGidMap || !isRef(cidToGidMap)) {
            return Object.create(GlyphsUnicode);
          }

          // Extract the encoding from the CIDToGIDMap
          var glyphsStream = xref.fetchIfRef(cidToGidMap);
          var glyphsData = glyphsStream.getBytes(0);

          // Glyph ids are big-endian 2-byte values
          encoding = properties.encoding;

          // Set encoding 0 to later verify the font has an encoding
          encoding[0] = { unicode: 0, width: 0 };
          for (var j = 0; j < glyphsData.length; j++) {
            var glyphID = (glyphsData[j++] << 8) | glyphsData[j];
            if (glyphID == 0)
              continue;

            var code = j >> 1;
            var width = glyphsWidths[code];
            encoding[code] = {
              unicode: glyphID,
              width: isNum(width) ? width : defaultWidth
            };
          }
        } else if (type == 'CIDFontType0') {
          if (isName(encoding)) {
            // Encoding is a predefined CMap
            if (encoding.name == 'Identity-H') {
              TODO('Need to create an identity cmap');
            } else {
              TODO('Need to support predefined CMaps see PDF 32000-1:2008 ' +
                   '9.7.5.2 Predefined CMaps');
            }
          } else {
            TODO('Need to support encoding streams see PDF 32000-1:2008 ' +
                 '9.7.5.3');
          }
        }
        return Object.create(GlyphsUnicode);
      }

      var differences = properties.differences;
      var map = properties.encoding;
      var baseEncoding = null;
      if (dict.has('Encoding')) {
        encoding = xref.fetchIfRef(dict.get('Encoding'));
        if (isDict(encoding)) {
          var baseName = encoding.get('BaseEncoding');
          if (baseName)
            baseEncoding = Encodings[baseName.name].slice();

          // Load the differences between the base and original
          if (encoding.has('Differences')) {
            var diffEncoding = encoding.get('Differences');
            var index = 0;
            for (var j = 0; j < diffEncoding.length; j++) {
              var data = diffEncoding[j];
              if (isNum(data))
                index = data;
              else
                differences[index++] = data.name;
            }
          }
        } else if (isName(encoding)) {
          baseEncoding = Encodings[encoding.name].slice();
        } else {
          error('Encoding is not a Name nor a Dict');
        }
      }

      if (!baseEncoding) {
        switch (type) {
          case 'TrueType':
            baseEncoding = Encodings.WinAnsiEncoding.slice();
            break;
          case 'Type1':
            baseEncoding = Encodings.StandardEncoding.slice();
            break;
          default:
            warn('Unknown type of font: ' + type);
            baseEncoding = [];
            break;
        }
      }

      // merge in the differences
      var firstChar = properties.firstChar;
      var lastChar = properties.lastChar;
      var widths = properties.widths || [];
      var glyphs = {};
      for (var i = firstChar; i <= lastChar; i++) {
        var glyph = differences[i];
        var replaceGlyph = true;
        if (!glyph) {
          glyph = baseEncoding[i];
          replaceGlyph = false;
        }
        var index = GlyphsUnicode[glyph] || i;
        var width = widths[i] || widths[glyph];
        map[i] = {
          unicode: index,
          width: isNum(width) ? width : properties.defaultWidth
        };

        if (glyph && (replaceGlyph || !glyphs[glyph]))
            glyphs[glyph] = map[i];

        // If there is no file, the character mapping can't be modified
        // but this is unlikely that there is any standard encoding with
        // chars below 0x1f, so that's fine.
        if (!properties.file)
          continue;

        if (index <= 0x1f || (index >= 127 && index <= 255))
          map[i].unicode += kCmapGlyphOffset;
      }

      if (type == 'TrueType' && dict.has('ToUnicode') && differences) {
        var cmapObj = dict.get('ToUnicode');
        if (isRef(cmapObj)) {
          cmapObj = xref.fetch(cmapObj);
        }
        if (isName(cmapObj)) {
          error('ToUnicode file cmap translation not implemented');
        } else if (isStream(cmapObj)) {
          var tokens = [];
          var token = '';
          var beginArrayToken = {};

          var cmap = cmapObj.getBytes(cmapObj.length);
          for (var i = 0; i < cmap.length; i++) {
            var byte = cmap[i];
            if (byte == 0x20 || byte == 0x0D || byte == 0x0A ||
                byte == 0x3C || byte == 0x5B || byte == 0x5D) {
              switch (token) {
                case 'usecmap':
                  error('usecmap is not implemented');
                  break;

                case 'beginbfchar':
                case 'beginbfrange':
                case 'begincidchar':
                case 'begincidrange':
                  token = '';
                  tokens = [];
                  break;

                case 'endcidrange':
                case 'endbfrange':
                  for (var j = 0; j < tokens.length; j += 3) {
                    var startRange = tokens[j];
                    var endRange = tokens[j + 1];
                    var code = tokens[j + 2];
                    while (startRange < endRange) {
                      var mapping = map[startRange] || {};
                      mapping.unicode = code++;
                      map[startRange] = mapping;
                      ++startRange;
                    }
                  }
                  break;

                case 'endcidchar':
                case 'endbfchar':
                  for (var j = 0; j < tokens.length; j += 2) {
                    var index = tokens[j];
                    var code = tokens[j + 1];
                    var mapping = map[index] || {};
                    mapping.unicode = code;
                    map[index] = mapping;
                  }
                  break;

                case '':
                  break;

                default:
                  if (token[0] >= '0' && token[0] <= '9')
                    token = parseInt(token, 10); // a number
                  tokens.push(token);
                  token = '';
              }
              switch (byte) {
                case 0x5B:
                  // begin list parsing
                  tokens.push(beginArrayToken);
                  break;
                case 0x5D:
                  // collect array items
                  var items = [], item;
                  while (tokens.length &&
                         (item = tokens.pop()) != beginArrayToken)
                    items.unshift(item);
                  tokens.push(items);
                  break;
              }
            } else if (byte == 0x3E) {
              if (token.length) {
                // parsing hex number
                tokens.push(parseInt(token, 16));
                token = '';
              }
            } else {
              token += String.fromCharCode(byte);
            }
          }
        }
      }
      return glyphs;
    },

    getBaseFontMetricsAndMap: function getBaseFontMetricsAndMap(name) {
      var map = {};
      if (/^Symbol(-?(Bold|Italic))*$/.test(name)) {
        // special case for symbols
        var encoding = Encodings.symbolsEncoding.slice();
        for (var i = 0, n = encoding.length, j; i < n; i++) {
          if (!(j = encoding[i]))
            continue;
          map[i] = GlyphsUnicode[j] || 0;
        }
      }

      var defaultWidth = 0;
      var widths = Metrics[stdFontMap[name] || name];
      if (isNum(widths)) {
        defaultWidth = widths;
        widths = null;
      }

      return {
        defaultWidth: defaultWidth,
        widths: widths || [],
        map: map
      };
    },

    translateFont: function partialEvaluatorTranslateFont(dict, xref,
                                                          resources) {
      var baseDict = dict;
      var type = dict.get('Subtype');
      assertWellFormed(isName(type), 'invalid font Subtype');

      var composite = false;
      if (type.name == 'Type0') {
        // If font is a composite
        //  - get the descendant font
        //  - set the type according to the descendant font
        //  - get the FontDescriptor from the descendant font
        var df = dict.get('DescendantFonts');
        if (!df)
          return null;

        if (isRef(df))
          df = xref.fetch(df);

        dict = xref.fetch(isRef(df) ? df : df[0]);

        type = dict.get('Subtype');
        assertWellFormed(isName(type), 'invalid font Subtype');
        composite = true;
      }

      // Before PDF 1.5 if the font was one of the base 14 fonts, having a
      // FontDescriptor was not required.
      // This case is here for compatibility.
      var descriptor = xref.fetchIfRef(dict.get('FontDescriptor'));
      if (!descriptor) {
        // Note for Type3 fonts: it has no no base font, feeding default
        // font name and trying to get font metrics as the same way as for
        // a font without descriptor.
        var baseFontName = dict.get('BaseFont') || new Name('sans-serif');

        // Using base font name as a font name.
        baseFontName = baseFontName.name.replace(/,/g, '_');
        var metricsAndMap = this.getBaseFontMetricsAndMap(baseFontName);

        var properties = {
          type: type.name,
          encoding: metricsAndMap.map,
          differences: [],
          widths: metricsAndMap.widths,
          defaultWidth: metricsAndMap.defaultWidth,
          firstChar: 0,
          lastChar: 256
        };
        this.extractEncoding(dict, xref, properties);

        return {
          name: baseFontName,
          dict: baseDict,
          properties: properties
        };
      }

      // According to the spec if 'FontDescriptor' is declared, 'FirstChar',
      // 'LastChar' and 'Widths' should exists too, but some PDF encoders seems
      // to ignore this rule when a variant of a standart font is used.
      // TODO Fill the width array depending on which of the base font this is
      // a variant.
      var firstChar = xref.fetchIfRef(dict.get('FirstChar')) || 0;
      var lastChar = xref.fetchIfRef(dict.get('LastChar')) || 256;
      var defaultWidth = 0;
      var glyphWidths = {};
      var encoding = {};
      var widths = xref.fetchIfRef(dict.get('Widths'));
      if (widths) {
        for (var i = 0, j = firstChar; i < widths.length; i++, j++)
          glyphWidths[j] = widths[i];
        defaultWidth = parseFloat(descriptor.get('MissingWidth')) || 0;
      } else {
        // Trying get the BaseFont metrics (see comment above).
        var baseFontName = dict.get('BaseFont');
        if (isName(baseFontName)) {
          var metricsAndMap = this.getBaseFontMetricsAndMap(baseFontName.name);

          glyphWidths = metricsAndMap.widths;
          defaultWidth = metricsAndMap.defaultWidth;
          encoding = metricsAndMap.map;
        }
      }

      var fontName = xref.fetchIfRef(descriptor.get('FontName'));
      assertWellFormed(isName(fontName), 'invalid font name');

      var fontFile = descriptor.get('FontFile', 'FontFile2', 'FontFile3');
      if (fontFile) {
        fontFile = xref.fetchIfRef(fontFile);
        if (fontFile.dict) {
          var subtype = fontFile.dict.get('Subtype');
          if (subtype)
            subtype = subtype.name;

          var length1 = fontFile.dict.get('Length1');
          if (!isInt(length1))
            length1 = xref.fetchIfRef(length1);

          var length2 = fontFile.dict.get('Length2');
          if (!isInt(length2))
            length2 = xref.fetchIfRef(length2);
        }
      }

      var properties = {
        type: type.name,
        subtype: subtype,
        file: fontFile,
        length1: length1,
        length2: length2,
        composite: composite,
        fixedPitch: false,
        textMatrix: IDENTITY_MATRIX,
        firstChar: firstChar || 0,
        lastChar: lastChar || 256,
        bbox: descriptor.get('FontBBox'),
        ascent: descriptor.get('Ascent'),
        descent: descriptor.get('Descent'),
        xHeight: descriptor.get('XHeight'),
        capHeight: descriptor.get('CapHeight'),
        defaultWidth: defaultWidth,
        flags: descriptor.get('Flags'),
        italicAngle: descriptor.get('ItalicAngle'),
        differences: [],
        widths: glyphWidths,
        encoding: encoding
      };
      properties.glyphs = this.extractEncoding(dict, xref, properties);

      return {
        name: fontName.name,
        dict: baseDict,
        file: fontFile,
        properties: properties
      };
    }
  };

  return constructor;
})();

// <canvas> contexts store most of the state we need natively.
// However, PDF needs a bit more state, which we store here.
var CanvasExtraState = (function canvasExtraState() {
  function constructor(old) {
    // Are soft masks and alpha values shapes or opacities?
    this.alphaIsShape = false;
    this.fontSize = 0;
    this.textMatrix = IDENTITY_MATRIX;
    this.leading = 0;
    // Current point (in user coordinates)
    this.x = 0;
    this.y = 0;
    // Start of text line (in text coordinates)
    this.lineX = 0;
    this.lineY = 0;
    // Character and word spacing
    this.charSpacing = 0;
    this.wordSpacing = 0;
    this.textHScale = 1;
    // Color spaces
    this.fillColorSpaceObj = null;
    this.strokeColorSpaceObj = null;
    this.fillColorObj = null;
    this.strokeColorObj = null;
    // Default fore and background colors
    this.fillColor = "#000000";
    this.strokeColor = "#000000";

    this.old = old;
  }

  constructor.prototype = {
    clone: function canvasextra_clone() {
      return Object.create(this);
    },
    setCurrentPoint: function canvasextra_setCurrentPoint(x, y) {
      this.x = x;
      this.y = y;
    }
  };
  return constructor;
})();

function ScratchCanvas(width, height) {
  var canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

var CanvasGraphics = (function canvasGraphics() {
  function constructor(canvasCtx, imageCanvas) {
    this.ctx = canvasCtx;
    this.current = new CanvasExtraState();
    this.stateStack = [];
    this.pendingClip = null;
    this.res = null;
    this.xobjs = null;
    this.ScratchCanvas = imageCanvas || ScratchCanvas;
  }

  var LINE_CAP_STYLES = ['butt', 'round', 'square'];
  var LINE_JOIN_STYLES = ['miter', 'round', 'bevel'];
  var NORMAL_CLIP = {};
  var EO_CLIP = {};

  constructor.prototype = {
    beginDrawing: function canvasGraphicsBeginDrawing(mediaBox) {
      var cw = this.ctx.canvas.width, ch = this.ctx.canvas.height;
      this.ctx.save();
      switch (mediaBox.rotate) {
        case 0:
          this.ctx.transform(1, 0, 0, -1, 0, ch);
          break;
        case 90:
          this.ctx.transform(0, 1, 1, 0, 0, 0);
          break;
        case 180:
          this.ctx.transform(-1, 0, 0, 1, cw, 0);
          break;
        case 270:
          this.ctx.transform(0, -1, -1, 0, cw, ch);
          break;
      }
      this.ctx.scale(cw / mediaBox.width, ch / mediaBox.height);
    },

    compile: function canvasGraphicsCompile(stream, xref, resources, fonts,
                                            images) {
      var pe = new PartialEvaluator();
      return pe.evaluate(stream, xref, resources, fonts, images);
    },

    execute: function canvasGraphicsExecute(code, xref, resources) {
      resources = xref.fetchIfRef(resources) || new Dict();
      var savedXref = this.xref, savedRes = this.res, savedXobjs = this.xobjs;
      this.xref = xref;
      this.res = resources || new Dict();
      this.xobjs = xref.fetchIfRef(this.res.get('XObject')) || new Dict();

      code(this);

      this.xobjs = savedXobjs;
      this.res = savedRes;
      this.xref = savedXref;
    },

    endDrawing: function canvasGraphicsEndDrawing() {
      this.ctx.restore();
    },

    // Graphics state
    setLineWidth: function canvasGraphicsSetLineWidth(width) {
      this.ctx.lineWidth = width;
    },
    setLineCap: function canvasGraphicsSetLineCap(style) {
      this.ctx.lineCap = LINE_CAP_STYLES[style];
    },
    setLineJoin: function canvasGraphicsSetLineJoin(style) {
      this.ctx.lineJoin = LINE_JOIN_STYLES[style];
    },
    setMiterLimit: function canvasGraphicsSetMiterLimit(limit) {
      this.ctx.miterLimit = limit;
    },
    setDash: function canvasGraphicsSetDash(dashArray, dashPhase) {
      this.ctx.mozDash = dashArray;
      this.ctx.mozDashOffset = dashPhase;
    },
    setRenderingIntent: function canvasGraphicsSetRenderingIntent(intent) {
      TODO('set rendering intent: ' + intent);
    },
    setFlatness: function canvasGraphicsSetFlatness(flatness) {
      TODO('set flatness: ' + flatness);
    },
    setGState: function canvasGraphicsSetGState(dictName) {
      var extGState = this.xref.fetchIfRef(this.res.get('ExtGState'));
      if (isDict(extGState) && extGState.has(dictName.name)) {
        var gsState = this.xref.fetchIfRef(extGState.get(dictName.name));
        var self = this;
        gsState.forEach(function canvasGraphicsSetGStateForEach(key, value) {
          switch (key) {
            case 'Type':
              break;
            case 'LW':
              self.setLineWidth(value);
              break;
            case 'LC':
              self.setLineCap(value);
              break;
            case 'LJ':
              self.setLineJoin(value);
              break;
            case 'ML':
              self.setMiterLimit(value);
              break;
            case 'D':
              self.setDash(value[0], value[1]);
              break;
            case 'RI':
              self.setRenderingIntent(value);
              break;
            case 'FL':
              self.setFlatness(value);
              break;
            case 'Font':
              self.setFont(value[0], value[1]);
              break;
            case 'OP':
            case 'op':
            case 'OPM':
            case 'BG':
            case 'BG2':
            case 'UCR':
            case 'UCR2':
            case 'TR':
            case 'TR2':
            case 'HT':
            case 'SM':
            case 'SA':
            case 'BM':
            case 'SMask':
            case 'CA':
            case 'ca':
            case 'AIS':
            case 'TK':
              TODO('graphic state operator ' + key);
              break;
            default:
              warn('Unknown graphic state operator ' + key);
              break;
          }
        });
      }

    },
    save: function canvasGraphicsSave() {
      this.ctx.save();
      if (this.ctx.$saveCurrentX) {
        this.ctx.$saveCurrentX();
      }
      var old = this.current;
      this.stateStack.push(old);
      this.current = old.clone();
    },
    restore: function canvasGraphicsRestore() {
      var prev = this.stateStack.pop();
      if (prev) {
        if (this.ctx.$restoreCurrentX) {
          this.ctx.$restoreCurrentX();
        }
        this.current = prev;
        this.ctx.restore();
      }
    },
    transform: function canvasGraphicsTransform(a, b, c, d, e, f) {
      this.ctx.transform(a, b, c, d, e, f);
    },

    // Path
    moveTo: function canvasGraphicsMoveTo(x, y) {
      this.ctx.moveTo(x, y);
      this.current.setCurrentPoint(x, y);
    },
    lineTo: function canvasGraphicsLineTo(x, y) {
      this.ctx.lineTo(x, y);
      this.current.setCurrentPoint(x, y);
    },
    curveTo: function canvasGraphicsCurveTo(x1, y1, x2, y2, x3, y3) {
      this.ctx.bezierCurveTo(x1, y1, x2, y2, x3, y3);
      this.current.setCurrentPoint(x3, y3);
    },
    curveTo2: function canvasGraphicsCurveTo2(x2, y2, x3, y3) {
      var current = this.current;
      this.ctx.bezierCurveTo(current.x, current.y, x2, y2, x3, y3);
      current.setCurrentPoint(x3, y3);
    },
    curveTo3: function canvasGraphicsCurveTo3(x1, y1, x3, y3) {
      this.curveTo(x1, y1, x3, y3, x3, y3);
      this.current.setCurrentPoint(x3, y3);
    },
    closePath: function canvasGraphicsClosePath() {
      this.ctx.closePath();
    },
    rectangle: function canvasGraphicsRectangle(x, y, width, height) {
      this.ctx.rect(x, y, width, height);
    },
    stroke: function canvasGraphicsStroke() {
      var ctx = this.ctx;
      var strokeColor = this.current.strokeColor;
      if (strokeColor && strokeColor.type === 'Pattern') {
        // for patterns, we transform to pattern space, calculate
        // the pattern, call stroke, and restore to user space
        ctx.save();
        ctx.strokeStyle = strokeColor.getPattern(ctx);
        ctx.stroke();
        ctx.restore();
      } else {
        ctx.stroke();
      }

      this.consumePath();
    },
    closeStroke: function canvasGraphicsCloseStroke() {
      this.closePath();
      this.stroke();
    },
    fill: function canvasGraphicsFill() {
      var ctx = this.ctx;
      var fillColor = this.current.fillColor;

      if (fillColor && fillColor.type === 'Pattern') {
        ctx.save();
        ctx.fillStyle = fillColor.getPattern(ctx);
        ctx.fill();
        ctx.restore();
      } else {
        ctx.fill();
      }

      this.consumePath();
    },
    eoFill: function canvasGraphicsEoFill() {
      var savedFillRule = this.setEOFillRule();
      this.fill();
      this.restoreFillRule(savedFillRule);
    },
    fillStroke: function canvasGraphicsFillStroke() {
      var ctx = this.ctx;

      var fillColor = this.current.fillColor;
      if (fillColor && fillColor.type === 'Pattern') {
        ctx.save();
        ctx.fillStyle = fillColor.getPattern(ctx);
        ctx.fill();
        ctx.restore();
      } else {
        ctx.fill();
      }

      var strokeColor = this.current.strokeColor;
      if (strokeColor && strokeColor.type === 'Pattern') {
        ctx.save();
        ctx.strokeStyle = strokeColor.getPattern(ctx);
        ctx.stroke();
        ctx.restore();
      } else {
        ctx.stroke();
      }

      this.consumePath();
    },
    eoFillStroke: function canvasGraphicsEoFillStroke() {
      var savedFillRule = this.setEOFillRule();
      this.fillStroke();
      this.restoreFillRule(savedFillRule);
    },
    closeFillStroke: function canvasGraphicsCloseFillStroke() {
      return this.fillStroke();
    },
    closeEOFillStroke: function canvasGraphicsCloseEOFillStroke() {
      var savedFillRule = this.setEOFillRule();
      this.fillStroke();
      this.restoreFillRule(savedFillRule);
    },
    endPath: function canvasGraphicsEndPath() {
      this.consumePath();
    },

    // Clipping
    clip: function canvasGraphicsClip() {
      this.pendingClip = NORMAL_CLIP;
    },
    eoClip: function canvasGraphicsEoClip() {
      this.pendingClip = EO_CLIP;
    },

    // Text
    beginText: function canvasGraphicsBeginText() {
      this.current.textMatrix = IDENTITY_MATRIX;
      if (this.ctx.$setCurrentX) {
        this.ctx.$setCurrentX(0);
      }
      this.current.x = this.current.lineX = 0;
      this.current.y = this.current.lineY = 0;
    },
    endText: function canvasGraphicsEndText() {
    },
    setCharSpacing: function canvasGraphicsSetCharSpacing(spacing) {
      this.current.charSpacing = spacing;
    },
    setWordSpacing: function canvasGraphicsSetWordSpacing(spacing) {
      this.current.wordSpacing = spacing;
    },
    setHScale: function canvasGraphicsSetHScale(scale) {
      this.current.textHScale = scale / 100;
    },
    setLeading: function canvasGraphicsSetLeading(leading) {
      this.current.leading = -leading;
    },
    setFont: function canvasGraphicsSetFont(fontRef, size) {
      var font;
      // the tf command uses a name, but graphics state uses a reference
      if (isName(fontRef)) {
        font = this.xref.fetchIfRef(this.res.get('Font'));
        if (!isDict(font))
         return;

        font = font.get(fontRef.name);
      } else if (isRef(fontRef)) {
        font = fontRef;
      }
      font = this.xref.fetchIfRef(font);
      if (!font)
        error('Referenced font is not found');

      var fontObj = font.fontObj;
      this.current.font = fontObj;
      this.current.fontSize = size;

      var name = fontObj.loadedName || 'sans-serif';
      if (this.ctx.$setFont) {
        this.ctx.$setFont(name, size);
      } else {
        var bold = fontObj.black ? (fontObj.bold ? 'bolder' : 'bold') :
                                   (fontObj.bold ? 'bold' : 'normal');

        var italic = fontObj.italic ? 'italic' : 'normal';
        var serif = fontObj.serif ? 'serif' : 'sans-serif';
        var typeface = '"' + name + '", ' + serif;
        var rule = italic + ' ' + bold + ' ' + size + 'px ' + typeface;
        this.ctx.font = rule;
      }
    },
    setTextRenderingMode: function canvasGraphicsSetTextRenderingMode(mode) {
      TODO('text rendering mode: ' + mode);
    },
    setTextRise: function canvasGraphicsSetTextRise(rise) {
      TODO('text rise: ' + rise);
    },
    moveText: function canvasGraphicsMoveText(x, y) {
      this.current.x = this.current.lineX += x;
      this.current.y = this.current.lineY += y;
      if (this.ctx.$setCurrentX) {
        this.ctx.$setCurrentX(this.current.x);
      }
    },
    setLeadingMoveText: function canvasGraphicsSetLeadingMoveText(x, y) {
      this.setLeading(-y);
      this.moveText(x, y);
    },
    setTextMatrix: function canvasGraphicsSetTextMatrix(a, b, c, d, e, f) {
      this.current.textMatrix = [a, b, c, d, e, f];

      if (this.ctx.$setCurrentX) {
        this.ctx.$setCurrentX(0);
      }
      this.current.x = this.current.lineX = 0;
      this.current.y = this.current.lineY = 0;
    },
    nextLine: function canvasGraphicsNextLine() {
      this.moveText(0, this.current.leading);
    },
    showText: function canvasGraphicsShowText(text) {
      var ctx = this.ctx;
      var current = this.current;
      var font = current.font;

      ctx.save();
      ctx.transform.apply(ctx, current.textMatrix);
      ctx.scale(1, -1);
      ctx.translate(current.x, -1 * current.y);
      ctx.transform.apply(ctx, font.textMatrix || IDENTITY_MATRIX);

      var glyphs = font.charsToGlyphs(text);
      var fontSize = current.fontSize;
      var charSpacing = current.charSpacing;
      var wordSpacing = current.wordSpacing;
      var textHScale = current.textHScale;
      ctx.scale(1 / textHScale, 1);

      var width = 0;
      var glyphsLength = glyphs.length;
      for (var i = 0; i < glyphsLength; ++i) {
        var glyph = glyphs[i];
        if (glyph === null) {
          // word break
          width += wordSpacing;
          continue;
        }

        var unicode = glyph.unicode;
        var char = (unicode >= 0x10000) ?
          String.fromCharCode(0xD800 | ((unicode - 0x10000) >> 10),
          0xDC00 | (unicode & 0x3FF)) : String.fromCharCode(unicode);

        ctx.fillText(char, width, 0);
        width += glyph.width * fontSize * 0.001 + charSpacing;
      }
      current.x += width;

      this.ctx.restore();
    },
    showSpacedText: function canvasGraphicsShowSpacedText(arr) {
      var ctx = this.ctx;
      var current = this.current;
      var fontSize = current.fontSize;
      var textHScale = current.textHScale;
      var arrLength = arr.length;
      for (var i = 0; i < arrLength; ++i) {
        var e = arr[i];
        if (isNum(e)) {
          if (ctx.$addCurrentX) {
            ctx.$addCurrentX(-e * 0.001 * fontSize);
          } else {
            current.x -= e * 0.001 * fontSize * textHScale;
          }
        } else if (isString(e)) {
          this.showText(e);
        } else {
          malformed('TJ array element ' + e + ' is not string or num');
        }
      }
    },
    nextLineShowText: function canvasGraphicsNextLineShowText(text) {
      this.nextLine();
      this.showText(text);
    },
    nextLineSetSpacingShowText:
      function canvasGraphicsNextLineSetSpacingShowText(wordSpacing,
                                                        charSpacing,
                                                        text) {
      this.setWordSpacing(wordSpacing);
      this.setCharSpacing(charSpacing);
      this.nextLineShowText(text);
    },

    // Type3 fonts
    setCharWidth: function canvasGraphicsSetCharWidth(xWidth, yWidth) {
      TODO('type 3 fonts ("d0" operator) xWidth: ' + xWidth + ' yWidth: ' +
           yWidth);
    },
    setCharWidthAndBounds: function canvasGraphicsSetCharWidthAndBounds(xWidth,
                                                                        yWidth,
                                                                        llx,
                                                                        lly,
                                                                        urx,
                                                                        ury) {
      TODO('type 3 fonts ("d1" operator) xWidth: ' + xWidth + ' yWidth: ' +
           yWidth + ' llx: ' + llx + ' lly: ' + lly + ' urx: ' + urx +
           ' ury ' + ury);
    },

    // Color
    setStrokeColorSpace: function canvasGraphicsSetStrokeColorSpace(space) {
      this.current.strokeColorSpace =
          ColorSpace.parse(space, this.xref, this.res);
    },
    setFillColorSpace: function canvasGraphicsSetFillColorSpace(space) {
      this.current.fillColorSpace =
          ColorSpace.parse(space, this.xref, this.res);
    },
    setStrokeColor: function canvasGraphicsSetStrokeColor(/*...*/) {
      var cs = this.current.strokeColorSpace;
      var color = cs.getRgb(arguments);
      this.setStrokeRGBColor.apply(this, color);
    },
    setStrokeColorN: function canvasGraphicsSetStrokeColorN(/*...*/) {
      var cs = this.current.strokeColorSpace;

      if (cs.name == 'Pattern') {
        // wait until fill to actually get the pattern, since Canvas
        // calcualtes the pattern according to the current coordinate space,
        // not the space when the pattern is set.
        var pattern = Pattern.parse(arguments, cs, this.xref, this.res,
                                    this.ctx);
        this.current.strokeColor = pattern;
      } else {
        this.setStrokeColor.apply(this, arguments);
      }
    },
    setFillColor: function canvasGraphicsSetFillColor(/*...*/) {
      var cs = this.current.fillColorSpace;
      var color = cs.getRgb(arguments);
      this.setFillRGBColor.apply(this, color);
    },
    setFillColorN: function canvasGraphicsSetFillColorN(/*...*/) {
      var cs = this.current.fillColorSpace;

      if (cs.name == 'Pattern') {
        // wait until fill to actually get the pattern
        var pattern = Pattern.parse(arguments, cs, this.xref, this.res,
                                    this.ctx);
        this.current.fillColor = pattern;
      } else {
        this.setFillColor.apply(this, arguments);
      }
    },
    setStrokeGray: function canvasGraphicsSetStrokeGray(gray) {
      this.setStrokeRGBColor(gray, gray, gray);
    },
    setFillGray: function canvasGraphicsSetFillGray(gray) {
      this.setFillRGBColor(gray, gray, gray);
    },
    setStrokeRGBColor: function canvasGraphicsSetStrokeRGBColor(r, g, b) {
      var color = Util.makeCssRgb(r, g, b);
      this.ctx.strokeStyle = color;
      this.current.strokeColor = color;
    },
    setFillRGBColor: function canvasGraphicsSetFillRGBColor(r, g, b) {
      var color = Util.makeCssRgb(r, g, b);
      this.ctx.fillStyle = color;
      this.current.fillColor = color;
    },
    setStrokeCMYKColor: function canvasGraphicsSetStrokeCMYKColor(c, m, y, k) {
      var color = Util.makeCssCmyk(c, m, y, k);
      this.ctx.strokeStyle = color;
      this.current.strokeColor = color;
    },
    setFillCMYKColor: function canvasGraphicsSetFillCMYKColor(c, m, y, k) {
      var color = Util.makeCssCmyk(c, m, y, k);
      this.ctx.fillStyle = color;
      this.current.fillColor = color;
    },

    // Shading
    shadingFill: function canvasGraphicsShadingFill(shadingName) {
      var xref = this.xref;
      var res = this.res;
      var ctx = this.ctx;

      var shadingRes = xref.fetchIfRef(res.get('Shading'));
      if (!shadingRes)
        error('No shading resource found');

      var shading = xref.fetchIfRef(shadingRes.get(shadingName.name));
      if (!shading)
        error('No shading object found');

      var shadingFill = Pattern.parseShading(shading, null, xref, res, ctx);

      this.save();
      ctx.fillStyle = shadingFill.getPattern();

      var inv = ctx.mozCurrentTransformInverse;
      if (inv) {
        var canvas = ctx.canvas;
        var width = canvas.width;
        var height = canvas.height;

        var bl = Util.applyTransform([0, 0], inv);
        var br = Util.applyTransform([0, width], inv);
        var ul = Util.applyTransform([height, 0], inv);
        var ur = Util.applyTransform([height, width], inv);

        var x0 = Math.min(bl[0], br[0], ul[0], ur[0]);
        var y0 = Math.min(bl[1], br[1], ul[1], ur[1]);
        var x1 = Math.max(bl[0], br[0], ul[0], ur[0]);
        var y1 = Math.max(bl[1], br[1], ul[1], ur[1]);

        this.ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      } else {
        // HACK to draw the gradient onto an infinite rectangle.
        // PDF gradients are drawn across the entire image while
        // Canvas only allows gradients to be drawn in a rectangle
        // The following bug should allow us to remove this.
        // https://bugzilla.mozilla.org/show_bug.cgi?id=664884

        this.ctx.fillRect(-1e10, -1e10, 2e10, 2e10);
      }

      this.restore();
    },

    // Images
    beginInlineImage: function canvasGraphicsBeginInlineImage() {
      error('Should not call beginInlineImage');
    },
    beginImageData: function canvasGraphicsBeginImageData() {
      error('Should not call beginImageData');
    },
    endInlineImage: function canvasGraphicsEndInlineImage(image) {
      this.paintImageXObject(null, image, true);
    },

    // XObjects
    paintXObject: function canvasGraphicsPaintXObject(obj) {
      var xobj = this.xobjs.get(obj.name);
      if (!xobj)
        return;
      xobj = this.xref.fetchIfRef(xobj);
      assertWellFormed(isStream(xobj), 'XObject should be a stream');

      var oc = xobj.dict.get('OC');
      if (oc) {
        TODO('oc for xobject');
      }

      var opi = xobj.dict.get('OPI');
      if (opi) {
        TODO('opi for xobject');
      }

      var type = xobj.dict.get('Subtype');
      assertWellFormed(isName(type), 'XObject should have a Name subtype');
      if ('Image' == type.name) {
        this.paintImageXObject(obj, xobj, false);
      } else if ('Form' == type.name) {
        this.paintFormXObject(obj, xobj);
      } else if ('PS' == type.name) {
        warn('(deprecated) PostScript XObjects are not supported');
      } else {
        malformed('Unknown XObject subtype ' + type.name);
      }
    },

    paintFormXObject: function canvasGraphicsPaintFormXObject(ref, stream) {
      this.save();

      var matrix = stream.dict.get('Matrix');
      if (matrix && isArray(matrix) && 6 == matrix.length)
        this.transform.apply(this, matrix);

      var bbox = stream.dict.get('BBox');
      if (bbox && isArray(bbox) && 4 == bbox.length) {
        this.rectangle.apply(this, bbox);
        this.clip();
        this.endPath();
      }

      this.execute(ref.code, this.xref, stream.dict.get('Resources'));

      this.restore();
    },

    paintImageXObject: function canvasGraphicsPaintImageXObject(ref, image,
                                                                inline) {
      this.save();

      var ctx = this.ctx;
      var dict = image.dict;
      var w = dict.get('Width', 'W');
      var h = dict.get('Height', 'H');
      // scale the image to the unit square
      ctx.scale(1 / w, -1 / h);

      // If the platform can render the image format directly, the
      // stream has a getImage property which directly returns a
      // suitable DOM Image object.
      if (image.getImage) {
        var domImage = image.getImage();
        ctx.drawImage(domImage, 0, 0, domImage.width, domImage.height,
                      0, -h, w, h);
        this.restore();
        return;
      }

      var imageObj = new PDFImage(this.xref, this.res, image, inline);

      var tmpCanvas = new this.ScratchCanvas(w, h);
      var tmpCtx = tmpCanvas.getContext('2d');
      if (imageObj.imageMask) {
        var fillColor = this.current.fillColor;
        tmpCtx.fillStyle = (fillColor && fillColor.type === 'Pattern') ?
          fillColor.getPattern(tmpCtx) : fillColor;
        tmpCtx.fillRect(0, 0, w, h);
      }
      var imgData = tmpCtx.getImageData(0, 0, w, h);
      var pixels = imgData.data;

      if (imageObj.imageMask) {
        var inverseDecode = !!imageObj.decode && imageObj.decode[0] > 0;
        imageObj.applyStencilMask(pixels, inverseDecode);
      } else
        imageObj.fillRgbaBuffer(pixels, imageObj.decode);

      tmpCtx.putImageData(imgData, 0, 0);
      ctx.drawImage(tmpCanvas, 0, -h);
      this.restore();
    },

    // Marked content

    markPoint: function canvasGraphicsMarkPoint(tag) {
      TODO('Marked content');
    },
    markPointProps: function canvasGraphicsMarkPointProps(tag, properties) {
      TODO('Marked content');
    },
    beginMarkedContent: function canvasGraphicsBeginMarkedContent(tag) {
      TODO('Marked content');
    },
    beginMarkedContentProps:
      function canvasGraphicsBeginMarkedContentProps(tag, properties) {
      TODO('Marked content');
    },
    endMarkedContent: function canvasGraphicsEndMarkedContent() {
      TODO('Marked content');
    },

    // Compatibility

    beginCompat: function canvasGraphicsBeginCompat() {
      TODO('ignore undefined operators (should we do that anyway?)');
    },
    endCompat: function canvasGraphicsEndCompat() {
      TODO('stop ignoring undefined operators');
    },

    // Helper functions

    consumePath: function canvasGraphicsConsumePath() {
      if (this.pendingClip) {
        var savedFillRule = null;
        if (this.pendingClip == EO_CLIP)
          savedFillRule = this.setEOFillRule();

        this.ctx.clip();

        this.pendingClip = null;
        if (savedFillRule !== null)
          this.restoreFillRule(savedFillRule);
      }
      this.ctx.beginPath();
    },
    // We generally keep the canvas context set for
    // nonzero-winding, and just set evenodd for the operations
    // that need them.
    setEOFillRule: function canvasGraphicsSetEOFillRule() {
      var savedFillRule = this.ctx.mozFillRule;
      this.ctx.mozFillRule = 'evenodd';
      return savedFillRule;
    },
    restoreFillRule: function canvasGraphicsRestoreFillRule(rule) {
      this.ctx.mozFillRule = rule;
    }
  };

  return constructor;
})();

var Util = (function utilUtil() {
  function constructor() {}
  constructor.makeCssRgb = function makergb(r, g, b) {
    var ri = (255 * r) | 0, gi = (255 * g) | 0, bi = (255 * b) | 0;
    return 'rgb(' + ri + ',' + gi + ',' + bi + ')';
  };
  constructor.makeCssCmyk = function makecmyk(c, m, y, k) {
    c = (new DeviceCmykCS()).getRgb([c, m, y, k]);
    var ri = (255 * c[0]) | 0, gi = (255 * c[1]) | 0, bi = (255 * c[2]) | 0;
    return 'rgb(' + ri + ',' + gi + ',' + bi + ')';
  };
  constructor.applyTransform = function apply(p, m) {
    var xt = p[0] * m[0] + p[1] * m[2] + m[4];
    var yt = p[0] * m[1] + p[1] * m[3] + m[5];
    return [xt, yt];
  };

  return constructor;
})();

var ColorSpace = (function colorSpaceColorSpace() {
  // Constructor should define this.numComps, this.defaultColor, this.name
  function constructor() {
    error('should not call ColorSpace constructor');
  }

  constructor.prototype = {
    // Input: array of size numComps representing color component values
    // Output: array of rgb values, each value ranging from [0.1]
    getRgb: function cs_getRgb(color) {
      error('Should not call ColorSpace.getRgb: ' + color);
    },
    // Input: Uint8Array of component values, each value scaled to [0,255]
    // Output: Uint8Array of rgb values, each value scaled to [0,255]
    getRgbBuffer: function cs_getRgbBuffer(input) {
      error('Should not call ColorSpace.getRgbBuffer: ' + input);
    }
  };

  constructor.parse = function colorspace_parse(cs, xref, res) {
    if (isName(cs)) {
      var colorSpaces = xref.fetchIfRef(res.get('ColorSpace'));
      if (isDict(colorSpaces)) {
        var refcs = colorSpaces.get(cs.name);
        if (refcs)
          cs = refcs;
      }
    }

    cs = xref.fetchIfRef(cs);

    if (isName(cs)) {
      var mode = cs.name;
      this.mode = mode;

      switch (mode) {
        case 'DeviceGray':
        case 'G':
          return new DeviceGrayCS();
        case 'DeviceRGB':
        case 'RGB':
          return new DeviceRgbCS();
        case 'DeviceCMYK':
        case 'CMYK':
          return new DeviceCmykCS();
        case 'Pattern':
          return new PatternCS(null);
        default:
          error('unrecognized colorspace ' + mode);
      }
    } else if (isArray(cs)) {
      var mode = cs[0].name;
      this.mode = mode;

      switch (mode) {
        case 'DeviceGray':
        case 'G':
          return new DeviceGrayCS();
        case 'DeviceRGB':
        case 'RGB':
          return new DeviceRgbCS();
        case 'DeviceCMYK':
        case 'CMYK':
          return new DeviceCmykCS();
        case 'CalGray':
          return new DeviceGrayCS();
        case 'CalRGB':
          return new DeviceRgbCS();
        case 'ICCBased':
          var stream = xref.fetchIfRef(cs[1]);
          var dict = stream.dict;
          var numComps = dict.get('N');
          if (numComps == 1)
            return new DeviceGrayCS();
          if (numComps == 3)
            return new DeviceRgbCS();
          if (numComps == 4)
            return new DeviceCmykCS();
          break;
        case 'Pattern':
          var baseCS = cs[1];
          if (baseCS)
            baseCS = ColorSpace.parse(baseCS, xref, res);
          return new PatternCS(baseCS);
        case 'Indexed':
          var base = ColorSpace.parse(cs[1], xref, res);
          var hiVal = cs[2] + 1;
          var lookup = xref.fetchIfRef(cs[3]);
          return new IndexedCS(base, hiVal, lookup);
        case 'Separation':
          var alt = ColorSpace.parse(cs[2], xref, res);
          var tintFn = new PDFFunction(xref, xref.fetchIfRef(cs[3]));
          return new SeparationCS(alt, tintFn);
        case 'Lab':
        case 'DeviceN':
        default:
          error('unimplemented color space object "' + mode + '"');
      }
    } else {
      error('unrecognized color space object: "' + cs + '"');
    }
    return null;
  };

  return constructor;
})();

var SeparationCS = (function separationCS() {
  function constructor(base, tintFn) {
    this.name = 'Separation';
    this.numComps = 1;
    this.defaultColor = [1];

    this.base = base;
    this.tintFn = tintFn;
  }

  constructor.prototype = {
    getRgb: function sepcs_getRgb(color) {
      var tinted = this.tintFn.func(color);
      return this.base.getRgb(tinted);
    },
    getRgbBuffer: function sepcs_getRgbBuffer(input, bits) {
      var tintFn = this.tintFn;
      var base = this.base;
      var scale = 1 / ((1 << bits) - 1);

      var length = input.length;
      var pos = 0;

      var numComps = base.numComps;
      var baseBuf = new Uint8Array(numComps * length);
      for (var i = 0; i < length; ++i) {
        var scaled = input[i] * scale;
        var tinted = tintFn.func([scaled]);
        for (var j = 0; j < numComps; ++j)
          baseBuf[pos++] = 255 * tinted[j];
      }
      return base.getRgbBuffer(baseBuf, 8);

    }
  };

  return constructor;
})();

var PatternCS = (function patternCS() {
  function constructor(baseCS) {
    this.name = 'Pattern';
    this.base = baseCS;
  }
  constructor.prototype = {};

  return constructor;
})();

var IndexedCS = (function indexedCS() {
  function constructor(base, highVal, lookup) {
    this.name = 'Indexed';
    this.numComps = 1;
    this.defaultColor = [0];

    this.base = base;
    var baseNumComps = base.numComps;
    this.highVal = highVal;

    var length = baseNumComps * highVal;
    var lookupArray = new Uint8Array(length);
    if (isStream(lookup)) {
      var bytes = lookup.getBytes(length);
      lookupArray.set(bytes);
    } else if (isString(lookup)) {
      for (var i = 0; i < length; ++i)
        lookupArray[i] = lookup.charCodeAt(i);
    } else {
      error('Unrecognized lookup table: ' + lookup);
    }
    this.lookup = lookupArray;
  }

  constructor.prototype = {
    getRgb: function indexcs_getRgb(color) {
      var numComps = this.base.numComps;

      var start = color[0] * numComps;
      var c = [];

      for (var i = start, ii = start + numComps; i < ii; ++i)
        c.push(this.lookup[i]);

      return this.base.getRgb(c);
    },
    getRgbBuffer: function indexcs_getRgbBuffer(input) {
      var base = this.base;
      var numComps = base.numComps;
      var lookup = this.lookup;
      var length = input.length;

      var baseBuf = new Uint8Array(length * numComps);
      var baseBufPos = 0;
      for (var i = 0; i < length; ++i) {
        var lookupPos = input[i] * numComps;
        for (var j = 0; j < numComps; ++j) {
          baseBuf[baseBufPos++] = lookup[lookupPos + j];
        }
      }

      return base.getRgbBuffer(baseBuf, 8);
    }
  };
  return constructor;
})();

var DeviceGrayCS = (function deviceGrayCS() {
  function constructor() {
    this.name = 'DeviceGray';
    this.numComps = 1;
    this.defaultColor = [0];
  }

  constructor.prototype = {
    getRgb: function graycs_getRgb(color) {
      var c = color[0];
      return [c, c, c];
    },
    getRgbBuffer: function graycs_getRgbBuffer(input, bits) {
      var scale = 255 / ((1 << bits) - 1);
      var length = input.length;
      var rgbBuf = new Uint8Array(length * 3);
      for (var i = 0, j = 0; i < length; ++i) {
        var c = (scale * input[i]) | 0;
        rgbBuf[j++] = c;
        rgbBuf[j++] = c;
        rgbBuf[j++] = c;
      }
      return rgbBuf;
    }
  };
  return constructor;
})();

var DeviceRgbCS = (function deviceRgbCS() {
  function constructor(bits) {
    this.name = 'DeviceRGB';
    this.numComps = 3;
    this.defaultColor = [0, 0, 0];
  }
  constructor.prototype = {
    getRgb: function rgbcs_getRgb(color) {
      return color;
    },
    getRgbBuffer: function rgbcs_getRgbBuffer(input, bits) {
      if (bits == 8)
        return input;
      var scale = 255 / ((1 << bits) - 1);
      var i, length = input.length;
      var rgbBuf = new Uint8Array(length);
      for (i = 0; i < length; ++i)
        rgbBuf[i] = (scale * input[i]) | 0;
      return rgbBuf;
    }
  };
  return constructor;
})();

var DeviceCmykCS = (function deviceCmykCS() {
  function constructor() {
    this.name = 'DeviceCMYK';
    this.numComps = 4;
    this.defaultColor = [0, 0, 0, 1];
  }
  constructor.prototype = {
    getRgb: function cmykcs_getRgb(color) {
      var c = color[0], m = color[1], y = color[2], k = color[3];
      var c1 = 1 - c, m1 = 1 - m, y1 = 1 - y, k1 = 1 - k;

      var x, r, g, b;
      // this is a matrix multiplication, unrolled for performance
      // code is taken from the poppler implementation
      x = c1 * m1 * y1 * k1; // 0 0 0 0
      r = g = b = x;
      x = c1 * m1 * y1 * k;  // 0 0 0 1
      r += 0.1373 * x;
      g += 0.1216 * x;
      b += 0.1255 * x;
      x = c1 * m1 * y * k1; // 0 0 1 0
      r += x;
      g += 0.9490 * x;
      x = c1 * m1 * y * k;  // 0 0 1 1
      r += 0.1098 * x;
      g += 0.1020 * x;
      x = c1 * m * y1 * k1; // 0 1 0 0
      r += 0.9255 * x;
      b += 0.5490 * x;
      x = c1 * m * y1 * k;  // 0 1 0 1
      r += 0.1412 * x;
      x = c1 * m * y * k1; // 0 1 1 0
      r += 0.9294 * x;
      g += 0.1098 * x;
      b += 0.1412 * x;
      x = c1 * m * y * k;  // 0 1 1 1
      r += 0.1333 * x;
      x = c * m1 * y1 * k1; // 1 0 0 0
      g += 0.6784 * x;
      b += 0.9373 * x;
      x = c * m1 * y1 * k;  // 1 0 0 1
      g += 0.0588 * x;
      b += 0.1412 * x;
      x = c * m1 * y * k1; // 1 0 1 0
      g += 0.6510 * x;
      b += 0.3137 * x;
      x = c * m1 * y * k;  // 1 0 1 1
      g += 0.0745 * x;
      x = c * m * y1 * k1; // 1 1 0 0
      r += 0.1804 * x;
      g += 0.1922 * x;
      b += 0.5725 * x;
      x = c * m * y1 * k;  // 1 1 0 1
      b += 0.0078 * x;
      x = c * m * y * k1; // 1 1 1 0
      r += 0.2118 * x;
      g += 0.2119 * x;
      b += 0.2235 * x;

      return [r, g, b];
    },
    getRgbBuffer: function cmykcs_getRgbBuffer(colorBuf, bits) {
      var scale = 1 / ((1 << bits) - 1);
      var length = colorBuf.length / 4;
      var rgbBuf = new Uint8Array(length * 3);
      var rgbBufPos = 0;
      var colorBufPos = 0;

      for (var i = 0; i < length; i++) {
        var cmyk = [];
        for (var j = 0; j < 4; ++j)
          cmyk.push(scale * colorBuf[colorBufPos++]);

        var rgb = this.getRgb(cmyk);
        for (var j = 0; j < 3; ++j)
          rgbBuf[rgbBufPos++] = Math.round(rgb[j] * 255);
      }

      return rgbBuf;
    }
  };
  return constructor;
})();

var Pattern = (function patternPattern() {
  // Constructor should define this.getPattern
  function constructor() {
    error('should not call Pattern constructor');
  }

  constructor.prototype = {
    // Input: current Canvas context
    // Output: the appropriate fillStyle or strokeStyle
    getPattern: function pattern_getStyle(ctx) {
      error('Should not call Pattern.getStyle: ' + ctx);
    }
  };

  constructor.parse = function pattern_parse(args, cs, xref, res, ctx) {
    var length = args.length;

    var patternName = args[length - 1];
    if (!isName(patternName))
      error('Bad args to getPattern: ' + patternName);

    var patternRes = xref.fetchIfRef(res.get('Pattern'));
    if (!patternRes)
      error('Unable to find pattern resource');

    var pattern = xref.fetchIfRef(patternRes.get(patternName.name));
    var dict = isStream(pattern) ? pattern.dict : pattern;
    var typeNum = dict.get('PatternType');

    switch (typeNum) {
      case 1:
        var base = cs.base;
        var color;
        if (base) {
          var baseComps = base.numComps;

          color = [];
          for (var i = 0; i < baseComps; ++i)
            color.push(args[i]);

          color = base.getRgb(color);
        }
        var code = patternName.code;
        return new TilingPattern(pattern, code, dict, color, xref, ctx);
      case 2:
        var shading = xref.fetchIfRef(dict.get('Shading'));
        var matrix = dict.get('Matrix');
        return Pattern.parseShading(shading, matrix, xref, res, ctx);
      default:
        error('Unknown type of pattern: ' + typeNum);
    }
    return null;
  };

  constructor.parseShading = function pattern_shading(shading, matrix,
      xref, res, ctx) {

    var dict = isStream(shading) ? shading.dict : shading;
    var type = dict.get('ShadingType');

    switch (type) {
      case 2:
      case 3:
        // both radial and axial shadings are handled by RadialAxial shading
        return new RadialAxialShading(dict, matrix, xref, res, ctx);
      default:
        return new DummyShading();
    }
  };
  return constructor;
})();

var DummyShading = (function dummyShading() {
  function constructor() {
    this.type = 'Pattern';
  }
  constructor.prototype = {
    getPattern: function dummy_getpattern() {
      return 'hotpink';
    }
  };
  return constructor;
})();

// Radial and axial shading have very similar implementations
// If needed, the implementations can be broken into two classes
var RadialAxialShading = (function radialAxialShading() {
  function constructor(dict, matrix, xref, res, ctx) {
    this.matrix = matrix;
    this.coordsArr = dict.get('Coords');
    this.shadingType = dict.get('ShadingType');
    this.type = 'Pattern';

    this.ctx = ctx;
    this.curMatrix = ctx.mozCurrentTransform;

    var cs = dict.get('ColorSpace', 'CS');
    cs = ColorSpace.parse(cs, xref, res);
    this.cs = cs;

    var t0 = 0.0, t1 = 1.0;
    if (dict.has('Domain')) {
      var domainArr = dict.get('Domain');
      t0 = domainArr[0];
      t1 = domainArr[1];
    }

    var extendStart = false, extendEnd = false;
    if (dict.has('Extend')) {
      var extendArr = dict.get('Extend');
      extendStart = extendArr[0];
      extendEnd = extendArr[1];
      TODO('Support extend');
    }

    this.extendStart = extendStart;
    this.extendEnd = extendEnd;

    var fnObj = dict.get('Function');
    fnObj = xref.fetchIfRef(fnObj);
    if (isArray(fnObj))
      error('No support for array of functions');
    else if (!isPDFFunction(fnObj))
      error('Invalid function');
    var fn = new PDFFunction(xref, fnObj);

    // 10 samples seems good enough for now, but probably won't work
    // if there are sharp color changes. Ideally, we would implement
    // the spec faithfully and add lossless optimizations.
    var step = (t1 - t0) / 10;
    var diff = t1 - t0;

    var colorStops = [];
    for (var i = t0; i <= t1; i += step) {
      var color = fn.func([i]);
      var rgbColor = Util.makeCssRgb.apply(this, cs.getRgb(color));
      colorStops.push([(i - t0) / diff, rgbColor]);
    }

    this.colorStops = colorStops;
  }

  constructor.prototype = {
    getPattern: function radialAxialShadingGetPattern() {
      var coordsArr = this.coordsArr;
      var type = this.shadingType;
      var p0, p1, r0, r1;
      if (type == 2) {
        p0 = [coordsArr[0], coordsArr[1]];
        p1 = [coordsArr[2], coordsArr[3]];
      } else if (type == 3) {
        p0 = [coordsArr[0], coordsArr[1]];
        p1 = [coordsArr[3], coordsArr[4]];
        r0 = coordsArr[2];
        r1 = coordsArr[5];
      } else {
        error('getPattern type unknown: ' + type);
      }

      var matrix = this.matrix;
      if (matrix) {
        p0 = Util.applyTransform(p0, matrix);
        p1 = Util.applyTransform(p1, matrix);
      }

      // if the browser supports getting the tranform matrix, convert
      // gradient coordinates from pattern space to current user space
      var curMatrix = this.curMatrix;
      var ctx = this.ctx;
      if (curMatrix) {
        var userMatrix = ctx.mozCurrentTransformInverse;

        p0 = Util.applyTransform(p0, curMatrix);
        p0 = Util.applyTransform(p0, userMatrix);

        p1 = Util.applyTransform(p1, curMatrix);
        p1 = Util.applyTransform(p1, userMatrix);
      }

      var colorStops = this.colorStops, grad;
      if (type == 2)
        grad = ctx.createLinearGradient(p0[0], p0[1], p1[0], p1[1]);
      else if (type == 3)
        grad = ctx.createRadialGradient(p0[0], p0[1], r0, p1[0], p1[1], r1);

      for (var i = 0, ii = colorStops.length; i < ii; ++i) {
        var c = colorStops[i];
        grad.addColorStop(c[0], c[1]);
      }
      return grad;
    }
  };
  return constructor;
})();

var TilingPattern = (function tilingPattern() {
  var PAINT_TYPE_COLORED = 1, PAINT_TYPE_UNCOLORED = 2;

  function constructor(pattern, code, dict, color, xref, ctx) {
      function multiply(m, tm) {
        var a = m[0] * tm[0] + m[1] * tm[2];
        var b = m[0] * tm[1] + m[1] * tm[3];
        var c = m[2] * tm[0] + m[3] * tm[2];
        var d = m[2] * tm[1] + m[3] * tm[3];
        var e = m[4] * tm[0] + m[5] * tm[2] + tm[4];
        var f = m[4] * tm[1] + m[5] * tm[3] + tm[5];
        return [a, b, c, d, e, f];
      }

      TODO('TilingType');

      this.matrix = dict.get('Matrix');
      this.curMatrix = ctx.mozCurrentTransform;
      this.invMatrix = ctx.mozCurrentTransformInverse;
      this.ctx = ctx;
      this.type = 'Pattern';

      var bbox = dict.get('BBox');
      var x0 = bbox[0], y0 = bbox[1], x1 = bbox[2], y1 = bbox[3];

      var xstep = dict.get('XStep');
      var ystep = dict.get('YStep');

      var topLeft = [x0, y0];
      // we want the canvas to be as large as the step size
      var botRight = [x0 + xstep, y0 + ystep];

      var width = botRight[0] - topLeft[0];
      var height = botRight[1] - topLeft[1];

      // TODO: hack to avoid OOM, we would idealy compute the tiling
      // pattern to be only as large as the acual size in device space
      // This could be computed with .mozCurrentTransform, but still
      // needs to be implemented
      while (Math.abs(width) > 512 || Math.abs(height) > 512) {
        width = 512;
        height = 512;
      }

      var tmpCanvas = new ScratchCanvas(width, height);

      // set the new canvas element context as the graphics context
      var tmpCtx = tmpCanvas.getContext('2d');
      var graphics = new CanvasGraphics(tmpCtx);

      var paintType = dict.get('PaintType');
      switch (paintType) {
        case PAINT_TYPE_COLORED:
          tmpCtx.fillStyle = ctx.fillStyle;
          tmpCtx.strokeStyle = ctx.strokeStyle;
          break;
        case PAINT_TYPE_UNCOLORED:
          color = Util.makeCssRgb.apply(this, color);
          tmpCtx.fillStyle = color;
          tmpCtx.strokeStyle = color;
          break;
        default:
          error('Unsupported paint type: ' + paintType);
      }

      var scale = [width / xstep, height / ystep];
      this.scale = scale;

      // transform coordinates to pattern space
      var tmpTranslate = [1, 0, 0, 1, -topLeft[0], -topLeft[1]];
      var tmpScale = [scale[0], 0, 0, scale[1], 0, 0];
      graphics.transform.apply(graphics, tmpScale);
      graphics.transform.apply(graphics, tmpTranslate);

      if (bbox && isArray(bbox) && 4 == bbox.length) {
        graphics.rectangle.apply(graphics, bbox);
        graphics.clip();
        graphics.endPath();
      }

      var res = xref.fetchIfRef(dict.get('Resources'));
      graphics.execute(code, xref, res);

      this.canvas = tmpCanvas;
  }

  constructor.prototype = {
    getPattern: function tiling_getPattern() {
      var matrix = this.matrix;
      var curMatrix = this.curMatrix;
      var ctx = this.ctx;

      if (curMatrix)
        ctx.setTransform.apply(ctx, curMatrix);

      if (matrix)
        ctx.transform.apply(ctx, matrix);

      var scale = this.scale;
      ctx.scale(1 / scale[0], 1 / scale[1]);

      return ctx.createPattern(this.canvas, 'repeat');
    }
  };
  return constructor;
})();


var PDFImage = (function pdfImage() {
  function constructor(xref, res, image, inline) {
    this.image = image;
    if (image.getParams) {
      // JPX/JPEG2000 streams directly contain bits per component
      // and color space mode information.
      TODO('get params from actual stream');
      // var bits = ...
      // var colorspace = ...
    }
    // TODO cache rendered images?

    var dict = image.dict;
    this.width = dict.get('Width', 'W');
    this.height = dict.get('Height', 'H');

    if (this.width < 1 || this.height < 1)
      error('Invalid image width: ' + this.width + ' or height: ' +
            this.height);

    this.interpolate = dict.get('Interpolate', 'I') || false;
    this.imageMask = dict.get('ImageMask', 'IM') || false;

    var bitsPerComponent = image.bitsPerComponent;
    if (!bitsPerComponent) {
      bitsPerComponent = dict.get('BitsPerComponent', 'BPC');
      if (!bitsPerComponent) {
        if (this.imageMask)
          bitsPerComponent = 1;
        else
          error('Bits per component missing in image: ' + this.imageMask);
      }
    }
    this.bpc = bitsPerComponent;

    if (!this.imageMask) {
      var colorSpace = dict.get('ColorSpace', 'CS');
      if (!colorSpace) {
        TODO('JPX images (which don"t require color spaces');
        colorSpace = new Name('DeviceRGB');
      }
      this.colorSpace = ColorSpace.parse(colorSpace, xref, res);
      this.numComps = this.colorSpace.numComps;
    }

    this.decode = dict.get('Decode', 'D');

    var mask = xref.fetchIfRef(dict.get('Mask'));
    var smask = xref.fetchIfRef(dict.get('SMask'));

    if (mask) {
      TODO('masked images');
    } else if (smask) {
      this.smask = new PDFImage(xref, res, smask);
    }
  }

  constructor.prototype = {
    getComponents: function getComponents(buffer, decodeMap) {
      var bpc = this.bpc;
      if (bpc == 8)
        return buffer;

      var width = this.width;
      var height = this.height;
      var numComps = this.numComps;

      var length = width * height;
      var bufferPos = 0;
      var output = bpc <= 8 ? new Uint8Array(length) :
        bpc <= 16 ? new Uint16Array(length) : new Uint32Array(length);
      var rowComps = width * numComps;

      if (bpc == 1) {
        var valueZero = 0, valueOne = 1;
        if (decodeMap) {
          valueZero = decodeMap[0] ? 1 : 0;
          valueOne = decodeMap[1] ? 1 : 0;
        }
        var mask = 0;
        var buf = 0;

        for (var i = 0, ii = length; i < ii; ++i) {
          if (i % rowComps == 0) {
            mask = 0;
            buf = 0;
          } else {
            mask >>= 1;
          }

          if (mask <= 0) {
            buf = buffer[bufferPos++];
            mask = 128;
          }

          output[i] = !(buf & mask) ? valueZero : valueOne;
        }
      } else {
        if (decodeMap != null)
          TODO('interpolate component values');
        var bits = 0, buf = 0;
        for (var i = 0, ii = length; i < ii; ++i) {
          if (i % rowComps == 0) {
            buf = 0;
            bits = 0;
          }

          while (bits < bpc) {
            buf = (buf << 8) | buffer[bufferPos++];
            bits += 8;
          }

          var remainingBits = bits - bpc;
          output[i] = buf >> remainingBits;
          buf = buf & ((1 << remainingBits) - 1);
          bits = remainingBits;
        }
      }
      return output;
    },
    getOpacity: function getOpacity() {
      var smask = this.smask;
      var width = this.width;
      var height = this.height;
      var buf = new Uint8Array(width * height);

      if (smask) {
        var sw = smask.width;
        var sh = smask.height;
        if (sw != this.width || sh != this.height)
          error('smask dimensions do not match image dimensions: ' + sw +
                ' != ' + this.width + ', ' + sh + ' != ' + this.height);

        smask.fillGrayBuffer(buf);
        return buf;
      } else {
        for (var i = 0, ii = width * height; i < ii; ++i)
          buf[i] = 255;
      }
      return buf;
    },
    applyStencilMask: function applyStencilMask(buffer, inverseDecode) {
      var width = this.width, height = this.height;
      var bitStrideLength = (width + 7) >> 3;
      var imgArray = this.image.getBytes(bitStrideLength * height);
      var imgArrayPos = 0;
      var i, j, mask, buf;
      // removing making non-masked pixels transparent
      var bufferPos = 3; // alpha component offset
      for (i = 0; i < height; i++) {
        mask = 0;
        for (j = 0; j < width; j++) {
          if (!mask) {
            buf = imgArray[imgArrayPos++];
            mask = 128;
          }
          if (!(buf & mask) == inverseDecode) {
            buffer[bufferPos] = 0;
          }
          bufferPos += 4;
          mask >>= 1;
        }
      }
    },
    fillRgbaBuffer: function fillRgbaBuffer(buffer, decodeMap) {
      var numComps = this.numComps;
      var width = this.width;
      var height = this.height;
      var bpc = this.bpc;

      // rows start at byte boundary;
      var rowBytes = (width * numComps * bpc + 7) >> 3;
      var imgArray = this.image.getBytes(height * rowBytes);

      var comps = this.colorSpace.getRgbBuffer(
        this.getComponents(imgArray, decodeMap), bpc);
      var compsPos = 0;
      var opacity = this.getOpacity();
      var opacityPos = 0;
      var length = width * height * 4;

      for (var i = 0; i < length; i += 4) {
        buffer[i] = comps[compsPos++];
        buffer[i + 1] = comps[compsPos++];
        buffer[i + 2] = comps[compsPos++];
        buffer[i + 3] = opacity[opacityPos++];
      }
    },
    fillGrayBuffer: function fillGrayBuffer(buffer) {
      var numComps = this.numComps;
      if (numComps != 1)
        error('Reading gray scale from a color image: ' + numComps);

      var width = this.width;
      var height = this.height;
      var bpc = this.bpc;

      // rows start at byte boundary;
      var rowBytes = (width * numComps * bpc + 7) >> 3;
      var imgArray = this.image.getBytes(height * rowBytes);

      var comps = this.getComponents(imgArray);
      var length = width * height;

      for (var i = 0; i < length; ++i)
        buffer[i] = comps[i];
    }
  };
  return constructor;
})();

var PDFFunction = (function pdfFunction() {
  function constructor(xref, fn) {
    var dict = fn.dict;
    if (!dict)
      dict = fn;

    var types = [this.constructSampled,
                 null,
                 this.constructInterpolated,
                 this.constructStiched,
                 this.constructPostScript];

    var typeNum = dict.get('FunctionType');
    var typeFn = types[typeNum];
    if (!typeFn)
      error('Unknown type of function');

    typeFn.call(this, fn, dict, xref);
  }

  constructor.prototype = {
    constructSampled: function pdfFunctionConstructSampled(str, dict) {
      var domain = dict.get('Domain');
      var range = dict.get('Range');

      if (!domain || !range)
        error('No domain or range');

      var inputSize = domain.length / 2;
      var outputSize = range.length / 2;

      if (inputSize != 1)
        error('No support for multi-variable inputs to functions: ' +
              inputSize);

      var size = dict.get('Size');
      var bps = dict.get('BitsPerSample');
      var order = dict.get('Order');
      if (!order)
        order = 1;
      if (order !== 1)
        error('No support for cubic spline interpolation: ' + order);

      var encode = dict.get('Encode');
      if (!encode) {
        encode = [];
        for (var i = 0; i < inputSize; ++i) {
          encode.push(0);
          encode.push(size[i] - 1);
        }
      }
      var decode = dict.get('Decode');
      if (!decode)
        decode = range;

      var samples = this.getSampleArray(size, outputSize, bps, str);

      this.func = function pdfFunctionFunc(args) {
        var clip = function pdfFunctionClip(v, min, max) {
          if (v > max)
            v = max;
          else if (v < min)
            v = min;
          return v;
        };

        if (inputSize != args.length)
          error('Incorrect number of arguments: ' + inputSize + ' != ' +
                args.length);

        for (var i = 0; i < inputSize; i++) {
          var i2 = i * 2;

          // clip to the domain
          var v = clip(args[i], domain[i2], domain[i2 + 1]);

          // encode
          v = encode[i2] + ((v - domain[i2]) *
                            (encode[i2 + 1] - encode[i2]) /
                            (domain[i2 + 1] - domain[i2]));

          // clip to the size
          args[i] = clip(v, 0, size[i] - 1);
        }

        // interpolate to table
        TODO('Multi-dimensional interpolation');
        var floor = Math.floor(args[0]);
        var ceil = Math.ceil(args[0]);
        var scale = args[0] - floor;

        floor *= outputSize;
        ceil *= outputSize;

        var output = [], v = 0;
        for (var i = 0; i < outputSize; ++i) {
          if (ceil == floor) {
            v = samples[ceil + i];
          } else {
            var low = samples[floor + i];
            var high = samples[ceil + i];
            v = low * scale + high * (1 - scale);
          }

          var i2 = i * 2;
          // decode
          v = decode[i2] + (v * (decode[i2 + 1] - decode[i2]) /
                            ((1 << bps) - 1));

          // clip to the domain
          output.push(clip(v, range[i2], range[i2 + 1]));
        }

        return output;
      };
    },
    getSampleArray: function pdfFunctionGetSampleArray(size, outputSize, bps,
                                                       str) {
      var length = 1;
      for (var i = 0; i < size.length; i++)
        length *= size[i];
      length *= outputSize;

      var array = [];
      var codeSize = 0;
      var codeBuf = 0;

      var strBytes = str.getBytes((length * bps + 7) / 8);
      var strIdx = 0;
      for (var i = 0; i < length; i++) {
        var b;
        while (codeSize < bps) {
          codeBuf <<= 8;
          codeBuf |= strBytes[strIdx++];
          codeSize += 8;
        }
        codeSize -= bps;
        array.push(codeBuf >> codeSize);
        codeBuf &= (1 << codeSize) - 1;
      }
      return array;
    },
    constructInterpolated: function pdfFunctionConstructInterpolated(str,
                                                                     dict) {
      var c0 = dict.get('C0') || [0];
      var c1 = dict.get('C1') || [1];
      var n = dict.get('N');

      if (!isArray(c0) || !isArray(c1))
        error('Illegal dictionary for interpolated function');

      var length = c0.length;
      var diff = [];
      for (var i = 0; i < length; ++i)
        diff.push(c1[i] - c0[i]);

      this.func = function pdfFunctionConstructInterpolatedFunc(args) {
        var x = args[0];

        var out = [];
        for (var j = 0; j < length; ++j)
          out.push(c0[j] + (x^n * diff[i]));

        return out;
      };
    },
    constructStiched: function pdfFunctionConstructStiched(fn, dict, xref) {
      var domain = dict.get('Domain');
      var range = dict.get('Range');

      if (!domain)
        error('No domain');

      var inputSize = domain.length / 2;
      if (inputSize != 1)
        error('Bad domain for stiched function');

      var fnRefs = dict.get('Functions');
      var fns = [];
      for (var i = 0, ii = fnRefs.length; i < ii; ++i)
        fns.push(new PDFFunction(xref, xref.fetchIfRef(fnRefs[i])));

      var bounds = dict.get('Bounds');
      var encode = dict.get('Encode');

      this.func = function pdfFunctionConstructStichedFunc(args) {
        var clip = function pdfFunctionConstructStichedFuncClip(v, min, max) {
          if (v > max)
            v = max;
          else if (v < min)
            v = min;
          return v;
        };

        // clip to domain
        var v = clip(args[0], domain[0], domain[1]);
        // calulate which bound the value is in
        for (var i = 0, ii = bounds.length; i < ii; ++i) {
          if (v < bounds[i])
            break;
        }

        // encode value into domain of function
        var dmin = domain[0];
        if (i > 0)
          dmin = bounds[i - 1];
        var dmax = domain[1];
        if (i < bounds.length)
          dmax = bounds[i];

        var rmin = encode[2 * i];
        var rmax = encode[2 * i + 1];

        var v2 = rmin + (v - dmin) * (rmax - rmin) / (dmax - dmin);

        // call the appropropriate function
        return fns[i].func([v2]);
      };
    },
    constructPostScript: function pdfFunctionConstructPostScript() {
      TODO('unhandled type of function');
      this.func = function pdfFunctionConstructPostScriptFunc() {
        return [255, 105, 180];
      };
    }
  };

  return constructor;
})();
