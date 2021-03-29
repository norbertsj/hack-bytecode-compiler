#!/usr/bin/env node
'use strict';

const { createReadStream, createWriteStream } = require('fs');
const { createInterface } = require('readline');

/**
 *
 * Arithmetic/Logic commands
 * add | x+y     | integer
 * sub | x-y     | integer
 * neg | -y      | integer
 * eq  | x == 0  | boolean
 * gt  | x > y   | boolean
 * lt  | x < y   | boolean
 * and | x AND y | boolean
 * or  | x OR y  | boolean
 * not | NOT x   | boolean
 *
 *
 * Segments
 * local
 * argument
 * this
 * that
 * constant
 * static
 * pointer
 * temp
 * 
 * Memory map
 * SP   0 Stack pointer
 * LCL  1 local segment
 * ARG  2 argument segment
 * THIS 3 this segment
 * THAT 4 that segment
 * temp 5 temp segment start
 * temp 6
 * temp 7
 * temp 8
 * temp 9
 * temp 10
 * temp 11
 * temp 12 temp segment end
 * 
 * pointer is either 0/1 (points to THIS or THAT segment base address)
 * THAT = 0
 * THIS = 1
 *
 * Pointers
 * ptr = <addr>
 * *ptr = Memory[<addr>]
 * 
 * push pointer 0/1
 * *SP = THIS/THAT; SP++
 * 
 * pop pointer 0/1
 * SP--; THIS/THAT = *SP 
 *
 * push segment i
 * addr = segmentPointer + i; *SP = *addr; SP++
 *
 * pop segment i
 * addr = segmentPointer + i; SP--; *addr = *SP
 * 
 * push constant i
 * *SP = i; SP++
 * 
 * Static
 * ? 
 * 
 *
 */

/**
 * Lets try writing Hack assembly here to see how to actually implement
 * push local 7
 * // addr = segmentPointer + i
 * @7       // A=i
 * D=A      // D=i
 * @LCL     // A=LCL
 * A=D+A    // A=i+LCL
 * 
 * // *SP = *addr
 * D=M      // D=M[LCL+i] getting the value from local segment
 * @SP      // A=SP
 * A=M      // A=&M[SP]
 * M=D      // M[SP]=M[LCL+i] storing the value from local segment into the stack
 * 
 * // SP++
 * @SP 
 * M=M+1
 * 
 * 
 * 
 * push argument 1
 * push this 1
 * push that 1
 * push constant 1
 * push static 1
 * push pointer 0
 * push pointer 1
 * push temp 1
 * 
 */

const SegmentBase = {
    'local': 1,
    'argument': 2,
    'temp': 5
};


// @todo...
function translate(input) {
    const result = [];

    if (!input || input.length === 0) {
        throw new Error('Invalid input');
    }

    return result;
}

function main() {
    const args = process.argv.slice(2);
    const path = args[0];

    if (!path) {
        console.log('Please provide VM file as an argument (local dir only)');
        return;
    }

    const fileName = path.split('.')[0];
    const input = [];

    console.log(`Translating ${fileName}.vm file...`)

    const rl = createInterface({
        input: createReadStream(path),
        crlfDelay: Infinity
    });

    rl.on('line', (line) => input.push(line));
    rl.on('close', () => {
        const output = translate(input);
        const wstream = createWriteStream(`${fileName}.asm`);
        for (const line of output) {
            wstream.write(line + '\n');
        }

        console.log('Done');
    });
}

main();
